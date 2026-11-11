# ir1.uk

[Ian Randall](https://ir1.uk)'s site: one static page, no dependencies. A ring of text forms a squishy balloon you can drag, squash, fling, and pop. There is also a 15-second game of air hockey with a global leaderboard.

Live at [https://ir1.uk](https://ir1.uk).

## How to play

Drag the balloon and let go to fling it. It bounces off the edges, and every few bounces the colours change. Squash it into a wall and hold it there, or press **P**, and it pops into letter particles. Click, or press Enter or Space, and it pulls itself back together. The arrow keys nudge it.

Double-tap the balloon, or press **H**, to play air hockey. Fling it up into the goal. You have 15 seconds. At the end, sign the leaderboard with one to three initials. On the live site that board is shared; if the score server cannot be reached, the score is kept on that device and the page says so.

## Layout

- `index.html`, `styles.css`, `script.js` — the page, as separate files for editing.
- `build.py` — builds the preview, `dist/`, and the upload zip.
- `server/api/scores.php` — the leaderboard (PHP 7.4 or newer, no database).
- `server/api/data/` — fallback place for score files. `.htaccess` denies web access; `index.html` is an empty placeholder.
- `server/README.txt` — short upload notes. `build.py` copies this into `dist/`.
- `tests/` — Playwright checks. Not part of the deployed site.

## Build and deploy

```bash
python3 build.py
```

That writes three things, all gitignored:

- `ian-randall-preview.html` — the page as a single file. Opening it from `file://` works; scores stay on the device.
- `dist/` — `index.html` with the CSS and JS inlined, plus `api/scores.php` and `api/data/`.
- `ian-randall-site.zip` — the contents of `dist/`, ready to upload.

Hosting is Ian's own PHP server. Upload the contents of `dist/` by hand so `index.html` sits next to `api/scores.php`. PHP 7.4+ is enough.

Score files are written outside the web root when that directory is writable: a folder called `ian-randall-scores` next to the web root, created on the first save. If that is not possible they fall back to `api/data/`. To force a path, set `SCORES_DIR` near the top of `scores.php`.

## Leaderboard API

`GET api/scores.php`

```json
{"ok": true, "scores": [{"id": "ab12cd34ef56", "i": "IAN", "s": 7, "t": 1710000000000}]}
```

`scores` is the top 20. `i` is initials, `s` is the score, `t` is the time in milliseconds.

`POST api/scores.php` with `{"initials": "IAN", "score": 7}` adds the entry and returns the same list plus `entry` (`id`, `i`, `s`, `t`, `rank`).

Protections:

- Same-origin only. There is no `Access-Control-Allow-Origin` header. If `Origin` is sent, its host must match `Host`. If `Sec-Fetch-Site` is sent, it must be `same-origin` or `none`. The body must be `Content-Type: application/json` and at most 512 bytes.
- Initials are 1–3 letters, checked against a small block list. Scores are integers from 1 to 150.
- Five saves per IP address per minute. The address is stored only as a short hash, for the rate limit.
- `flock` covers the score file and the rate-limit file. Each write goes to a temporary file and is renamed into place. The files (`scores.json.php`, `ratelimit.json.php`) start with `<?php exit;` so they are not readable as data even where `.htaccess` is ignored.

The site sits behind Cloudflare. `CF-Connecting-IP` is taken as the visitor address only when the connection itself comes from [Cloudflare's published IP ranges](https://www.cloudflare.com/ips/). A request that merely adds the header is rated against the connection address instead.

## Tests

The tests use Playwright and Chromium. `tests/test_global.py` also needs a `php` binary on `PATH` (override with the `PHP` environment variable). Build first, so the preview file and `dist/` exist. `tests/test_site.py` saves screenshots under `shots/` (gitignored) and, with no argument, opens `http://127.0.0.1:8765/`.

```bash
python3 build.py
python3 tests/test_site.py
python3 tests/test_save.py
python3 tests/test_exits.py
python3 tests/test_envs.py
PHP=php python3 tests/test_global.py
```

Install Playwright the usual way if it is not already there (`pip install playwright`, then `python3 -m playwright install chromium`). The site itself has nothing to install.

## Dependencies

There are no dependencies, so there is no package manifest, and Dependabot isn't needed.
