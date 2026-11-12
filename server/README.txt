Ian Randall's site: upload guide
================================

What's here
  index.html          the whole page (styles and script are inside it)
  api/scores.php      the global air-hockey leaderboard (needs PHP 7.4 or newer, no database)
  api/data/           where scores are saved if they can't be kept outside your web root
    .htaccess         stops anyone downloading the score files (Apache)
  README.txt          this file (you don't need to upload it)

Upload
  1. Upload index.html and the api folder into your site's web root
     (the folder your domain serves, often public_html, www, or htdocs).
     Keep the folder structure: yoursite/index.html and yoursite/api/scores.php.
  2. Make sure PHP can write the scores somewhere. scores.php tries, in order:
       a) a folder called "ian-randall-scores" NEXT TO your web root (not inside it),
          e.g. /home/ian/ian-randall-scores if your site is /home/ian/public_html.
          It creates this itself if it's allowed to. This is the best place.
       b) otherwise api/data/ inside the site. For that, api/data must be writable by PHP:
          chmod 775 api/data   (or 777 if 775 isn't enough on your host)
     To force a specific place, edit the SCORES_DIR line near the top of api/scores.php,
     e.g.  const SCORES_DIR = '/home/ian/ian-randall-scores';
  3. Check it: open https://yourdomain/api/scores.php in a browser.
       {"ok":true,"scores":[]}                    -> working
       {"ok":false,"error":"score storage..."}    -> PHP can't write; redo step 2
       the PHP code itself, or a download         -> PHP isn't running on the server
  4. Open the site, play a round (double-tap the circle or press H), sign the board.
     It should say "saved to the global board".

Notes
  - Saves are limited to 5 per minute per visitor, initials are 1-3 letters, scores 1-24.
  - Each round asks the server for a token when the clock starts, and the save sends it back.
    A score with no token, a reused token, or a score saved before the round could have
    finished is refused. The message under the leaderboard says why.
  - Only pages on your own domain can save scores (no cross-site access).
  - If the server can't be reached, the page still works and keeps scores on that device,
    and the message under the leaderboard says so.
  - Score files are scores.json.php, ratelimit.json.php, used.json.php, secret.json.php
    and scores.lock. secret.json.php is created for you; leave it there.
    To reset the board, delete scores.json.php (leave the secret). Visitor IPs are only
    stored hashed, for the rate limit.
  - On nginx, .htaccess is ignored, but the score files start with "<?php exit;" so they
    can't be read through the web anyway.
