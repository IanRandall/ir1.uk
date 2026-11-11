<?php
/**
 * Global air-hockey leaderboard for Ian Randall's site.
 *   GET  api/scores.php                         -> {"ok":true,"scores":[{id,i,s,t},...]}   (top 20)
 *   POST api/scores.php  {"initials":"IAN","score":7}
 *                                               -> {"ok":true,"scores":[...],"entry":{id,i,s,t,rank}}
 * No database: a JSON file guarded by flock(). Works on PHP 7.4+.
 */

// ---------------------------------------------------------------- settings
// Where scores are stored. Leave '' for automatic:
//   1. a folder next to (outside) your web root, e.g. /home/you/ian-randall-scores, if PHP can create it;
//   2. otherwise api/data/ (blocked from the web by .htaccess, and the files start with "<?php exit;").
// Or set an absolute path here, e.g. '/home/ian/ian-randall-scores'.
const SCORES_DIR = '';
const TOP_KEEP   = 100;  // entries kept on disk
const TOP_SHOW   = 20;   // entries returned
const MAX_SCORE  = 150;  // generous ceiling for a 15 second round; the puck respawns instantly, so fast swipers on mobile score a lot
const MAX_BODY   = 512;  // bytes
const RATE_MAX   = 5;    // saves allowed per IP ...
const RATE_WINDOW = 60;  // ... per this many seconds
const BLOCKED = ['ASS','CUM','FAG','FCK','FUC','FUK','FKU','FUX','KKK','NIG','NGR','NGA','SEX','TIT','DIK','DIC','COK','CNT','KNT','JIZ','WTF','NAZ','SUK','SUC','XXX','VAG','CLT','POO'];

// ---------------------------------------------------------------- helpers
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
// Deliberately no Access-Control-Allow-Origin header: other sites' pages can't read or write this.

function respond($code, $data) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}
function fail($code, $msg) { respond($code, ['ok' => false, 'error' => $msg]); }

function data_dir() {
    $candidates = [];
    if (SCORES_DIR !== '') $candidates[] = SCORES_DIR;
    else {
        $root = isset($_SERVER['DOCUMENT_ROOT']) ? realpath($_SERVER['DOCUMENT_ROOT']) : false;
        if ($root && dirname($root) !== $root) {
            $outside = dirname($root) . DIRECTORY_SEPARATOR . 'ian-randall-scores';
            // only use it if it already exists or PHP may create it, and it's really outside the web root
            if (is_dir($outside) || is_writable(dirname($root))) $candidates[] = $outside;
        }
        $candidates[] = __DIR__ . DIRECTORY_SEPARATOR . 'data';
    }
    foreach ($candidates as $dir) {
        // a storage folder that already exists is always used (never silently switch and split the board)
        if (is_dir($dir)) {
            if (is_writable($dir)) return $dir;
            fail(500, 'score storage is not writable');
        }
        if (@mkdir($dir, 0775, true) && is_writable($dir)) return $dir;
    }
    fail(500, 'score storage is not writable');
}

// Data files are PHP files that exit immediately, so even a server that ignores .htaccess won't serve them.
const GUARD = "<?php exit; ?>\n";
function read_json($path, $default) {
    if (!is_file($path)) return $default;
    $raw = @file_get_contents($path);
    if ($raw === false) return $default;
    if (strncmp($raw, GUARD, strlen(GUARD)) === 0) $raw = substr($raw, strlen(GUARD));
    $v = json_decode($raw, true);
    return is_array($v) ? $v : $default;
}
function write_json($path, $value) {
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, GUARD . json_encode($value, JSON_UNESCAPED_SLASHES)) === false) return false;
    @chmod($tmp, 0664);
    if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    return true;
}
function sort_scores(&$list) {
    usort($list, function ($a, $b) {
        if ($a['s'] !== $b['s']) return $b['s'] - $a['s'];
        return $a['t'] - $b['t'];  // earlier score wins a tie
    });
}
function clean_list($list) {
    $out = [];
    foreach ((array)$list as $e) {
        if (!is_array($e) || !isset($e['id'], $e['i'], $e['s'], $e['t'])) continue;
        $out[] = ['id' => (string)$e['id'], 'i' => (string)$e['i'], 's' => (int)$e['s'], 't' => (int)$e['t']];
    }
    sort_scores($out);
    return $out;
}
// Cloudflare's published edge ranges (https://www.cloudflare.com/ips/). The CF-Connecting-IP
// header is only trusted when the request really arrives from one of these, so it can't be faked.
const CF_RANGES = [
    '173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18',
    '108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17',
    '162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22',
    '2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32',
    '2a06:98c0::/29','2c0f:f248::/32',
];
function ip_in_range($ip, $cidr) {
    list($net, $bits) = explode('/', $cidr);
    $a = @inet_pton($ip); $b = @inet_pton($net);
    if ($a === false || $b === false || strlen($a) !== strlen($b)) return false;
    $bits = (int)$bits; $bytes = intdiv($bits, 8); $rem = $bits % 8;
    if ($bytes && substr($a, 0, $bytes) !== substr($b, 0, $bytes)) return false;
    if ($rem) {
        $mask = (0xFF << (8 - $rem)) & 0xFF;
        if ((ord($a[$bytes]) & $mask) !== (ord($b[$bytes]) & $mask)) return false;
    }
    return true;
}
function from_cloudflare($ip) {
    foreach (CF_RANGES as $r) if (ip_in_range($ip, $r)) return true;
    return false;
}
function client_ip() {
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP']) && from_cloudflare($ip)) {
        $real = trim($_SERVER['HTTP_CF_CONNECTING_IP']);
        if (filter_var($real, FILTER_VALIDATE_IP)) return $real;
    }
    return $ip;
}
function client_key() {
    // Real visitor IP (via Cloudflare when applicable). Stored hashed, never as a raw IP.
    return substr(hash('sha256', 'ian-randall-hockey|' . client_ip()), 0, 20);
}

// ---------------------------------------------------------------- request
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
$dir = data_dir();
$scoresFile = $dir . DIRECTORY_SEPARATOR . 'scores.json.php';
$rateFile   = $dir . DIRECTORY_SEPARATOR . 'ratelimit.json.php';
$lockFile   = $dir . DIRECTORY_SEPARATOR . 'scores.lock';

$lock = @fopen($lockFile, 'c');
if (!$lock) fail(500, 'score storage is not writable');

if ($method === 'GET' || $method === 'HEAD') {
    flock($lock, LOCK_SH);
    $list = clean_list(read_json($scoresFile, []));
    flock($lock, LOCK_UN);
    respond(200, ['ok' => true, 'scores' => array_slice($list, 0, TOP_SHOW)]);
}

if ($method !== 'POST') { header('Allow: GET, POST'); fail(405, 'method not allowed'); }

// same-origin only
$host = isset($_SERVER['HTTP_HOST']) ? strtolower($_SERVER['HTTP_HOST']) : '';
if (isset($_SERVER['HTTP_SEC_FETCH_SITE']) && !in_array($_SERVER['HTTP_SEC_FETCH_SITE'], ['same-origin', 'none'], true)) fail(403, 'cross-site requests are not allowed');
if (!empty($_SERVER['HTTP_ORIGIN'])) {
    $oh = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
    $op = parse_url($_SERVER['HTTP_ORIGIN'], PHP_URL_PORT);
    $originHost = strtolower($oh . ($op ? ':' . $op : ''));
    if ($originHost !== $host) fail(403, 'cross-site requests are not allowed');
}
// JSON only (a cross-site form post can't send this content type without a CORS preflight, which we never approve)
$ctype = isset($_SERVER['CONTENT_TYPE']) ? strtolower($_SERVER['CONTENT_TYPE']) : '';
if (strpos($ctype, 'application/json') !== 0) fail(415, 'send JSON');

// size limit
if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > MAX_BODY) fail(413, 'request too large');
$in = fopen('php://input', 'rb');
$body = $in ? stream_get_contents($in, MAX_BODY + 1) : '';
if (strlen((string)$body) > MAX_BODY) fail(413, 'request too large');
$req = json_decode((string)$body, true);
if (!is_array($req)) fail(400, 'bad JSON');

// validate
$initials = isset($req['initials']) && is_string($req['initials']) ? strtoupper(trim($req['initials'])) : '';
if (!preg_match('/^[A-Z]{1,3}$/', $initials)) fail(422, 'initials must be 1 to 3 letters');
if (in_array($initials, BLOCKED, true)) fail(422, 'pick different initials');
$score = isset($req['score']) ? $req['score'] : null;
if (is_string($score) && preg_match('/^\d{1,3}$/', $score)) $score = (int)$score;
if (!is_int($score) || $score < 1 || $score > MAX_SCORE) fail(422, 'score out of range');

flock($lock, LOCK_EX);
// rate limit (per hashed IP, sliding window)
$now = time();
$rate = read_json($rateFile, []);
foreach ($rate as $k => $times) {
    $rate[$k] = array_values(array_filter((array)$times, function ($t) use ($now) { return is_int($t) && $t > $now - RATE_WINDOW; }));
    if (!$rate[$k]) unset($rate[$k]);
}
$key = client_key();
$mine = isset($rate[$key]) ? $rate[$key] : [];
if (count($mine) >= RATE_MAX) {
    flock($lock, LOCK_UN);
    header('Retry-After: ' . max(1, RATE_WINDOW - ($now - min($mine))));
    fail(429, 'too many saves, try again in a minute');
}
$mine[] = $now;
$rate[$key] = $mine;
write_json($rateFile, $rate);

// add the entry
$list = clean_list(read_json($scoresFile, []));
$entry = ['id' => bin2hex(random_bytes(6)), 'i' => $initials, 's' => $score, 't' => (int)round(microtime(true) * 1000)];
$list[] = $entry;
sort_scores($list);
$rank = null;
foreach ($list as $n => $e) { if ($e['id'] === $entry['id']) { $rank = $n + 1; break; } }
$list = array_slice($list, 0, TOP_KEEP);
$ok = write_json($scoresFile, $list);
flock($lock, LOCK_UN);
if (!$ok) fail(500, 'could not save the score');

$entry['rank'] = $rank;
respond(200, ['ok' => true, 'scores' => array_slice($list, 0, TOP_SHOW), 'entry' => $entry]);
