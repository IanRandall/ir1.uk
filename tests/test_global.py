"""Global leaderboard end-to-end: php -S serving dist/, Chromium, two separate browser contexts."""
import asyncio, subprocess, shutil, os, time, threading, http.server, json, hmac, hashlib, urllib.request, urllib.error
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
PHP = os.environ.get("PHP", "php")
SRV = "/tmp/gsrv"; PORT = 8820; NOPHP_PORT = 8821
URL = f"http://127.0.0.1:{PORT}/"
STORE = SRV + "/ian-randall-scores"

def setup():
    shutil.rmtree(SRV, ignore_errors=True); os.makedirs(SRV)
    shutil.copytree(ROOT / "dist", SRV + "/www")
    p = subprocess.Popen([PHP, "-S", f"127.0.0.1:{PORT}", "-t", SRV + "/www"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=SRV + "/www", **kwargs)
        def log_message(self, format, *args):
            pass
    threading.Thread(target=http.server.ThreadingHTTPServer(("127.0.0.1", NOPHP_PORT), QuietHandler).serve_forever, daemon=True).start()
    time.sleep(1); return p

async def finish_game(page, score=None, settle=False):
    await page.evaluate("__balloon.enterHockey()"); await page.wait_for_timeout(600)
    bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    m = page.mouse; await m.move(bx, by); await m.down()
    for i in range(6): await m.move(bx, by - i * 60); await page.wait_for_timeout(16)
    await m.up(); await page.wait_for_timeout(1300)
    await page.evaluate(f"""__balloon.hockey.score = {score} || __balloon.hockey.score || 2;
                           __balloon.hockey.running = true; __balloon.hockey.timeLeft = 0.2""")
    await page.wait_for_selector(".endcard:not([hidden])")
    if settle:
        await settle_token(page)
    else:
        await page.wait_for_timeout(700)

# scores.php refuses a save until MIN_ELAPSED_MS (13000) after the token was issued.
async def settle_token(page):
    try:
        await page.wait_for_function(
            "() => { const s = __balloon.ticketState; return s === 'ok' || s === 'fail' || s === 'local'; }",
            timeout=5000,
        )
    except Exception as e:
        print("  ticket not ready:", e)
        return
    tok = await page.evaluate("__balloon.ticket")
    if not tok: return
    iat = int(str(tok).split(".")[0])
    delay = (iat + 14000) / 1000 - time.time()
    if delay > 0:
        await page.wait_for_timeout(int(delay * 1000) + 300)

async def sign(page, initials):
    await page.wait_for_selector(".board-form:not([hidden])", timeout=5000)
    await page.locator(".initials input").nth(0).click()
    await page.keyboard.type(initials, delay=40)
    await page.click(".board-form .save"); await page.wait_for_timeout(700)

async def board(page):
    return await page.evaluate("""() => ({
      rows: [...document.querySelectorAll('.board-list li')].map(l => (l.classList.contains('me') ? '*' : '') + [...l.children].map(c => c.textContent).join(' ').replace(/\\s+/g,' ').trim() || l.textContent),
      status: document.querySelector('.board-status').textContent,
      formHidden: document.querySelector('.board-form').hidden })""")

results = []
def check(name, cond, info):
    results.append(cond); print("PASS" if cond else "FAIL", name, "|", info)

async def newpage(b, errs, mobile=False):
    ctx = await b.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1280, "height": 800}, has_touch=mobile, is_mobile=mobile)
    page = await ctx.new_page()
    # the browser itself logs expected 422/429 API answers as "Failed to load resource"; those aren't page errors
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and not ("Failed to load resource" in m.text and any(c in m.text for c in ("403", "409", "413", "422", "429"))) else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, page

def php_json(path):
    raw = Path(path).read_text()
    guard = "<?php exit; ?>\n"
    if not raw.startswith(guard):
        raise AssertionError("data file missing php guard: " + path)
    return json.loads(raw[len(guard):])

def api(body, headers=None):
    h = {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{PORT}", "Sec-Fetch-Site": "same-origin"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(URL + "api/scores.php", data=json.dumps(body).encode(), method="POST", headers=h)
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return res.status, json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            data = json.loads(raw)
        except Exception:
            data = {"raw": raw[:200]}
        return e.code, data

def api_get():
    req = urllib.request.Request(URL + "api/scores.php")
    with urllib.request.urlopen(req, timeout=5) as res:
        return res.status, json.loads(res.read().decode())

def wait_until(iat_ms, extra_ms):
    delay = (iat_ms + extra_ms) / 1000 - time.time()
    if delay > 0:
        time.sleep(delay)

def reset_board():
    if not os.path.isdir(STORE):
        return
    for name in ("scores.json.php", "ratelimit.json.php", "used.json.php"):
        p = os.path.join(STORE, name)
        if os.path.exists(p):
            os.remove(p)

def api_cases():
    """Token issue, too-early, implausible score, save, and reuse. Directly against php -S."""
    try:
        code, data = api_get()
        check("GET scores before any save", code == 200 and data.get("ok") and data.get("scores") == [], data)

        code, a = api({"start": True})
        code_b, b = api({"start": True})
        tok_a, tok_b = a.get("token"), b.get("token")
        issued = isinstance(tok_a, str) and isinstance(tok_b, str) and tok_a != tok_b
        issued = issued and len(tok_a.split(".")) == 3 and len(tok_a.split(".")[0]) == 13
        check("start issues a unique signed token", code == 200 and code_b == 200 and a.get("ok") and issued, (code, tok_a[:24] + "…" if tok_a else a, tok_b[:24] + "…" if tok_b else b))
        if not tok_a:
            return
        iat = int(tok_a.split(".")[0])

        code, early = api({"initials": "ZZZ", "score": 1, "token": tok_a})
        check("save before the round can end is rejected", code == 422 and "round still in progress" in early.get("error", ""), early)

        code, missing = api({"initials": "ZZZ", "score": 1})
        check("save without a token is rejected", code == 422 and "missing round token" in missing.get("error", ""), missing)

        code, big = api({"initials": "ZZZ", "score": 25, "token": tok_a})
        check("score above MAX_SCORE is rejected", code == 422 and big.get("error") == "score out of range", big)

        flipped = tok_a[:-1] + ("0" if tok_a[-1] != "0" else "1")
        code, forged = api({"initials": "ZZZ", "score": 1, "token": flipped})
        check("altered token is rejected", code == 422 and "unrecognised" in forged.get("error", ""), forged)

        secret = php_json(os.path.join(STORE, "secret.json.php"))["k"]
        old = iat - 700000
        nonce = "0123456789abcdef"
        sig = hmac.new(bytes.fromhex(secret), f"{old}.{nonce}".encode(), hashlib.sha256).hexdigest()
        code, expired = api({"initials": "ZZZ", "score": 1, "token": f"{old}.{nonce}.{sig}"})
        check("expired token is rejected", code == 422 and "expired" in expired.get("error", ""), expired)

        code, cross = api({"start": True}, {"Origin": "http://evil.example"})
        check("cross-origin start is rejected", code == 403 and "cross-site" in cross.get("error", ""), cross)

        secret_path = os.path.join(STORE, "secret.json.php")
        outside = os.path.commonpath([secret_path, SRV + "/www"]) != SRV + "/www" and secret_path.startswith(STORE)
        web_copy = os.path.exists(SRV + "/www/api/data/secret.json.php")
        check("secret is outside the web root and php-guarded", outside and not web_copy and secret and len(secret) == 64, secret_path)

        wait_until(iat, 14000)
        elapsed = time.time() * 1000 - iat
        check("wait landed inside the implausible window", elapsed < 17000, round(elapsed))
        code, high = api({"initials": "MAX", "score": 24, "token": tok_a})
        check("score implausible for elapsed time is rejected", code == 422 and "too high" in high.get("error", ""), high)

        code, saved = api({"initials": "API", "score": 3, "token": tok_a})
        entry = saved.get("entry") or {}
        on_board = any(s.get("i") == "API" and s.get("s") == 3 for s in saved.get("scores") or [])
        check("save with a fresh token succeeds", code == 200 and saved.get("ok") and entry.get("s") == 3 and entry.get("i") == "API" and on_board, saved.get("entry"))

        code, again = api({"initials": "REU", "score": 3, "token": tok_a})
        check("reusing a token is rejected", code == 409 and "already saved" in again.get("error", ""), again)

        used = php_json(os.path.join(STORE, "used.json.php"))
        check("used-token file keeps the nonce and is php-guarded", tok_a.split(".")[1] in used, list(used)[:2])
    finally:
        reset_board()

async def check_goal_pause(b):
    errs = []
    ctx, page = await newpage(b, errs)
    try:
        await page.goto(URL)
        await page.wait_for_timeout(500)
        # Measured inside the page so a slow mouse can't outlast the pause.
        # On the goal frame: ignore a pointer, then shove the puck into the goal.
        # The next frame must have put it back, still on one point.
        paused = await page.evaluate("""() => new Promise((resolve) => {
          __balloon.enterHockey();
          const h = __balloon.hockey, ball = __balloon.ball, fg = document.getElementById("fg");
          h.running = true; h.started = true; h.timeLeft = 12; h.score = 0; h.hold = 0;
          ball.x = innerWidth / 2; ball.y = -ball.R - 80; ball.vy = -2000;
          const t0 = performance.now();
          let phase = 0, goalAt = 0, timeAtGoal = 0, grabbed = null, pause0 = 0, resetting = false, restored = null;
          function tick() {
            if (phase === 0 && h.score >= 1 && h.hold > 0) {
              phase = 1; goalAt = performance.now(); timeAtGoal = h.timeLeft; pause0 = h.hold;
              resetting = document.querySelector(".goal").classList.contains("resetting");
              try {
                fg.dispatchEvent(new PointerEvent("pointerdown", { clientX: ball.x, clientY: ball.y, pointerId: 7, bubbles: true, cancelable: true, pointerType: "mouse" }));
                grabbed = __balloon.dragOn;
                fg.dispatchEvent(new PointerEvent("pointerup", { clientX: ball.x, clientY: ball.y, pointerId: 7, bubbles: true, pointerType: "mouse" }));
              } catch (e) { grabbed = String(e); }
              ball.y = -900; ball.vy = -4000; ball.vx = 2200;
              requestAnimationFrame(tick); return;
            }
            if (phase === 1) {
              phase = 2;
              restored = { x: ball.x, y: ball.y, vy: ball.vy, vx: ball.vx, score: h.score, hold: h.hold };
              requestAnimationFrame(tick); return;
            }
            if (phase === 2 && h.hold === 0) {
              resolve({
                pause: __balloon.goalPause, pause0, resetting, grabbed, restored,
                dt: performance.now() - goalAt, timeDrop: timeAtGoal - h.timeLeft, score: h.score,
                resettingAfter: document.querySelector(".goal").classList.contains("resetting"),
                spawn: innerHeight * 0.78
              });
              return;
            }
            if (performance.now() - t0 > 3000) resolve({ timeout: true, phase, score: h.score, hold: h.hold });
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        })""")
        pause = paused.get("pause") or 0
        started = (not paused.get("timeout") and paused.get("score") == 1 and paused.get("resetting")
                   and paused.get("grabbed") is False and 0.6 <= pause <= 1.0
                   and pause - 0.2 < paused.get("pause0", 0) <= pause)
        check("goal starts a short reset and ignores a hit", started, paused)
        rest = paused.get("restored") or {}
        spawn = paused.get("spawn") or 0
        stuck = (rest.get("score") == 1 and rest.get("hold", 0) > 0
                 and abs(rest.get("y", 0) - spawn) < 3 and abs(rest.get("vy", 9)) < 1 and abs(rest.get("vx", 9)) < 1)
        check("puck is held in place and cannot score again", stuck, rest)
        ended = (not paused.get("timeout") and paused.get("score") == 1 and not paused.get("resettingAfter")
                 and 500 <= paused.get("dt", 0) <= 1500 and paused.get("timeDrop", 0) > 0.5)
        check("timer keeps running and the reset ends", ended, {k: paused.get(k) for k in ("dt", "timeDrop", "resettingAfter", "score", "timeout")})

        bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
        await page.mouse.move(bx, by)
        await page.mouse.down()
        await page.mouse.move(bx + 70, by - 40, steps=6)
        grabbed = await page.evaluate("__balloon.dragOn")
        await page.mouse.up()
        check("puck can be hit again after the reset", grabbed, grabbed)
        check("no console errors during the reset", not errs, errs)
    finally:
        try:
            await page.evaluate("__balloon.exitHockey()")
        except Exception:
            pass
        await ctx.close()

async def main():
    srv = setup()
    try:
        api_cases()
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
            errsA, errsB = [], []
            ctxA, A = await newpage(b, errsA); ctxB, B = await newpage(b, errsB, mobile=True)
            await A.goto(URL); await B.goto(URL); await A.wait_for_timeout(800)
            await check_goal_pause(b)

            await finish_game(A, 7); await sign(A, "aaa"); early = await board(A)
            check("too-early save shows in the status line", "round still in progress" in early["status"] and not early["formHidden"], early)
            await settle_token(A)
            await A.click(".board-form .save"); await A.wait_for_timeout(700)
            sa = await board(A)
            check("A saves globally", "global board" in sa["status"] and "*1. AAA 7" in sa["rows"], sa)

            await finish_game(B, 9, settle=True); sb0 = await board(B)
            check("B (separate context, mobile) sees A's score before signing", any("AAA 7" in r for r in sb0["rows"]), sb0)
            await sign(B, "bbb"); sb = await board(B)
            check("B saves globally, ranked #1", "#1" in sb["status"] and sb["rows"][:2] == ["*1. BBB 9", "2. AAA 7"], sb)

            await A.click(".done"); await finish_game(A, 1); sa2 = await board(A)
            check("A's next end card shows B's score too", sa2["rows"][:2] == ["1. BBB 9", "2. AAA 7"], sa2)
            await A.click(".done")

            await finish_game(A, 3)
            await sign(A, "fuk"); s = await board(A)
            check("profanity rejected with message, form stays", s["status"] == "pick different initials" and not s["formHidden"], s)
            await settle_token(A)
            for _ in range(3): await A.keyboard.press("Backspace")
            await A.locator(".initials input").nth(0).click()
            await A.evaluate("document.querySelectorAll('.initials input').forEach(i => { i.value=''; i.dataset.prev=''; })")
            await A.keyboard.type("CCC", delay=40); await A.click(".board-form .save"); await A.wait_for_timeout(700)
            s = await board(A)
            check("fixed initials then saved", "global board" in s["status"] and any(r.startswith("*") and "CCC 3" in r for r in s["rows"]), s)
            await A.click(".done")

            for k, ini in enumerate(["DDD", "EEE"]):
                await finish_game(A, 2, settle=True); await sign(A, ini); await A.click(".done")
            # Played rounds are ~14s apart, so six of them no longer fit in the one-minute
            # window. Clear it and fill five saves at once; the next one from the page is refused.
            rate_path = STORE + "/ratelimit.json.php"
            if os.path.exists(rate_path): os.remove(rate_path)
            issued = []
            for _ in range(5):
                code, data = api({"start": True})
                issued.append(data.get("token"))
            iat0 = int(issued[0].split(".")[0])
            delay = (iat0 + 14000) / 1000 - time.time()
            if delay > 0: await asyncio.sleep(delay + 0.3)
            filled = []
            for ini, tok in zip(["RTA", "RTB", "RTC", "RTD", "RTE"], issued):
                code, data = api({"initials": ini, "score": 1, "token": tok})
                filled.append(code)
            check("five quick saves fill the rate limit", filled == [200] * 5, filled)
            await finish_game(A, 2, settle=True); await sign(A, "FFF"); s = await board(A)
            check("next save in that minute is rate limited, form stays", "too many saves" in s["status"] and not s["formHidden"], s)
            await A.click(".done")

            # highlighted entry outside the top five gets its real rank
            os.remove(STORE + "/ratelimit.json.php")
            await finish_game(A, 1, settle=True); await sign(A, "LOW"); s = await board(A)
            check("entry below top 5 shown with its rank", s["rows"][-1].startswith("*") and "LOW 1" in s["rows"][-1] and len(s["rows"]) == 6, s)
            await A.click(".done")

            # drag still works after a global save (regression for the old bug)
            await A.wait_for_timeout(1200)
            bx, by = await A.evaluate("[__balloon.ball.x, __balloon.ball.y]")
            await A.mouse.move(bx, by); await A.mouse.down(); await A.mouse.move(bx + 40, by + 30, steps=8)
            dragged = await A.evaluate("__balloon.dragOn"); await A.mouse.up()
            check("circle draggable after global save", dragged, dragged)

            check("no console errors in A/B", not errsA and not errsB, (errsA, errsB))
            await ctxA.close(); await ctxB.close()

            # fallbacks
            for label, url in [("file:// preview", (ROOT / "ian-randall-preview.html").as_uri()),
                               ("host without PHP", f"http://127.0.0.1:{NOPHP_PORT}/")]:
                errs = []; ctx, P = await newpage(b, errs)
                await P.goto(url); await P.wait_for_timeout(800)
                await finish_game(P, 4); s0 = await board(P)
                await sign(P, "loc"); s = await board(P)
                ok = "this device" in s0["status"] and "saved" in s["status"] and any(r.startswith("*") and "LOC" in r for r in s["rows"])
                # A host with no PHP answers the round-start POST with 501. That is the fallback working.
                real = [e for e in errs if not ("without PHP" in label and "Failed to load resource" in e and ("501" in e or "404" in e))]
                check(f"fallback: {label}", ok and not real, {"load": s0["status"], **s, "errs": real})
                await ctx.close()

            # server reachable at load but failing at save time -> local save with message
            errs = []; ctx, P = await newpage(b, errs)
            await P.goto(URL); await P.wait_for_timeout(800)
            await finish_game(P, 5)
            await P.wait_for_selector(".board-form:not([hidden])")
            os.chmod(STORE, 0o555); os.chmod(STORE + "/scores.json.php", 0o444); os.chmod(STORE + "/scores.lock", 0o444)
            await sign(P, "OUT"); s = await board(P)
            os.chmod(STORE, 0o755); os.chmod(STORE + "/scores.lock", 0o664); os.chmod(STORE + "/scores.json.php", 0o664)
            check("server error at save -> saved on this device with message", "couldn't reach the score server" in s["status"] and any(r.startswith("*") and "OUT" in r for r in s["rows"]), s)
            await ctx.close()
            await b.close()
    finally:
        srv.terminate()
    print("ALL OK" if all(results) else "SOME FAILED")
asyncio.run(main())
