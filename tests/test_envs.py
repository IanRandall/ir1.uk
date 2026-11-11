"""Save-button test in hostile embeddings: sandboxed iframes (chat-app file previews), srcdoc, file:// in Chromium + WebKit."""
import asyncio, sys, threading, http.server, functools, html, tempfile
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
BUNDLE = str(ROOT / "ian-randall-preview.html")
ENVDIR = Path(tempfile.mkdtemp(prefix="ir1-envtest-"))
PORT = 8799

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ENVDIR))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    QuietHandler = None
    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h).serve_forever()

def write_parents():
    import shutil; shutil.copy(BUNDLE, ENVDIR / "bundle.html")
    src = open(BUNDLE).read()
    style = "<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>"
    for name, sb in [("sb-scripts", "allow-scripts"), ("sb-scripts-same", "allow-scripts allow-same-origin")]:
        open(ENVDIR / f"{name}.html", "w").write(f'<!doctype html>{style}<iframe sandbox="{sb}" src="bundle.html"></iframe>')
        open(ENVDIR / f"{name}-srcdoc.html", "w").write(f'<!doctype html>{style}<iframe sandbox="{sb}" srcdoc="{html.escape(src, quote=True)}"></iframe>')

ENVS = [
    ("chromium", "file:// direct", "file://" + BUNDLE, False),
    ("chromium", "http direct", f"http://127.0.0.1:{PORT}/bundle.html", False),
    ("chromium", 'iframe sandbox="allow-scripts"', f"http://127.0.0.1:{PORT}/sb-scripts.html", True),
    ("chromium", 'iframe sandbox="allow-scripts allow-same-origin"', f"http://127.0.0.1:{PORT}/sb-scripts-same.html", True),
    ("chromium", 'srcdoc sandbox="allow-scripts"', f"http://127.0.0.1:{PORT}/sb-scripts-srcdoc.html", True),
    ("chromium", 'file:// parent, iframe sandbox="allow-scripts"', (ENVDIR / "sb-scripts.html").as_uri(), True),
]

async def run_env(browser, bname, label, url, framed, submit):
    page = await browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(url); await page.wait_for_timeout(1200)
    f = page.frames[1] if framed else page.main_frame
    await f.evaluate("__balloon.enterHockey()"); await page.wait_for_timeout(500)
    # real fling with the mouse to start the round, then shorten the clock
    bx, by = await f.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    m = page.mouse; await m.move(bx, by); await m.down()
    for i in range(6): await m.move(bx, by - i * 60); await page.wait_for_timeout(16)
    await m.up(); await page.wait_for_timeout(1200)
    await f.evaluate("if(!__balloon.hockey.score) __balloon.hockey.score = 2; __balloon.hockey.running = true; __balloon.hockey.timeLeft = 0.2")
    await f.wait_for_selector(".endcard:not([hidden])"); await page.wait_for_timeout(300)
    formShown = await f.evaluate("!document.querySelector('.board-form').hidden")
    await f.click(".initials input >> nth=0")
    await page.keyboard.type("ian", delay=50)
    if submit == "click": await f.click(".board-form button")
    else: await page.keyboard.press("Enter")
    await page.wait_for_timeout(400)
    s = await f.evaluate("""() => ({
      status: document.querySelector('.board-status').textContent,
      me: [...document.querySelectorAll('.board-list li.me')].map(l => l.textContent.replace(/\\s+/g,' ').trim()),
      formHidden: document.querySelector('.board-form').hidden,
      url: location.href.slice(0, 40), origin: String(self.origin)
    })""")
    ok = formShown and "saved" in s["status"] and any("IAN" in x for x in s["me"])
    await page.close()
    return ok, s, errs

async def main():
    write_parents()
    threading.Thread(target=serve, daemon=True).start()
    allok = True
    async with async_playwright() as p:
        browsers = {}
        for bname, label, url, framed in ENVS:
            if bname not in browsers:
                try:
                    browsers[bname] = await (p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]) if bname == "chromium" else getattr(p, bname).launch())
                except Exception as e:
                    print("SKIP", bname, e); browsers[bname] = None
            b = browsers[bname]
            if not b: allok = False; continue
            for submit in ("click", "enter"):
                try:
                    ok, s, errs = await run_env(b, bname, label, url, framed, submit)
                except Exception as e:
                    ok, s, errs = False, {"exception": str(e)[:300]}, []
                allok &= ok
                print(("PASS" if ok else "FAIL"), f"{bname:8s} {label:52s} {submit:5s}", s, ("errors=" + str(errs)) if errs else "")
        for b in browsers.values():
            if b: await b.close()
    print("ALL OK" if allok else "SOME FAILED")
asyncio.run(main())
