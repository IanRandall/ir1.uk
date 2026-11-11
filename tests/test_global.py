"""Global leaderboard end-to-end: php -S serving dist/, Chromium, two separate browser contexts."""
import asyncio, subprocess, shutil, os, time, threading, http.server, functools
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
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SRV + "/www")
    h.log_message = lambda *a: None
    threading.Thread(target=http.server.ThreadingHTTPServer(("127.0.0.1", NOPHP_PORT), h).serve_forever, daemon=True).start()
    time.sleep(1); return p

async def finish_game(page, score=None):
    await page.evaluate("__balloon.enterHockey()"); await page.wait_for_timeout(600)
    bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    m = page.mouse; await m.move(bx, by); await m.down()
    for i in range(6): await m.move(bx, by - i * 60); await page.wait_for_timeout(16)
    await m.up(); await page.wait_for_timeout(1300)
    await page.evaluate(f"""__balloon.hockey.score = {score} || __balloon.hockey.score || 2;
                           __balloon.hockey.running = true; __balloon.hockey.timeLeft = 0.2""")
    await page.wait_for_selector(".endcard:not([hidden])")
    await page.wait_for_timeout(700)

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
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and not ("Failed to load resource" in m.text and ("422" in m.text or "429" in m.text)) else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    return ctx, page

async def main():
    srv = setup()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
            errsA, errsB = [], []
            ctxA, A = await newpage(b, errsA); ctxB, B = await newpage(b, errsB, mobile=True)
            await A.goto(URL); await B.goto(URL); await A.wait_for_timeout(800)

            await finish_game(A, 7); await sign(A, "aaa"); sa = await board(A)
            check("A saves globally", "global board" in sa["status"] and "*1. AAA 7" in sa["rows"], sa)

            await finish_game(B, 9); sb0 = await board(B)
            check("B (separate context, mobile) sees A's score before signing", any("AAA 7" in r for r in sb0["rows"]), sb0)
            await sign(B, "bbb"); sb = await board(B)
            check("B saves globally, ranked #1", "#1" in sb["status"] and sb["rows"][:2] == ["*1. BBB 9", "2. AAA 7"], sb)

            await A.click(".done"); await finish_game(A, 1); sa2 = await board(A)
            check("A's next end card shows B's score too", sa2["rows"][:2] == ["1. BBB 9", "2. AAA 7"], sa2)
            await A.click(".done")

            await finish_game(A, 3)
            await sign(A, "fuk"); s = await board(A)
            check("profanity rejected with message, form stays", s["status"] == "pick different initials" and not s["formHidden"], s)
            for _ in range(3): await A.keyboard.press("Backspace")
            await A.locator(".initials input").nth(0).click()
            await A.evaluate("document.querySelectorAll('.initials input').forEach(i => { i.value=''; i.dataset.prev=''; })")
            await A.keyboard.type("CCC", delay=40); await A.click(".board-form .save"); await A.wait_for_timeout(700)
            s = await board(A)
            check("fixed initials then saved", "global board" in s["status"] and any(r.startswith("*") and "CCC 3" in r for r in s["rows"]), s)
            await A.click(".done")

            # rate limit: 3 saves so far from 127.0.0.1; 2 more allowed, then refused
            for k, ini in enumerate(["DDD", "EEE"]):
                await finish_game(A, 2); await sign(A, ini); await A.click(".done")
            await finish_game(A, 2); await sign(A, "FFF"); s = await board(A)
            check("6th save in a minute is rate limited, form stays", "too many saves" in s["status"] and not s["formHidden"], s)
            await A.click(".done")

            # highlighted entry outside the top five gets its real rank
            os.remove(STORE + "/ratelimit.json.php")
            await finish_game(A, 1); await sign(A, "LOW"); s = await board(A)
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
                check(f"fallback: {label}", ok and not errs, {"load": s0["status"], **s, "errs": errs})
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
