import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright
URL = (Path(__file__).resolve().parent.parent / "ian-randall-preview.html").as_uri()

async def drag_works(page, touch=False):
    await page.wait_for_timeout(1500)  # let ball settle
    bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    W, H = await page.evaluate("[innerWidth, innerHeight]")
    tx, ty = (bx - 60 if bx > W/2 else bx + 60), (by - 50 if by > H/2 else by + 50)
    grabbed = False
    if touch:
        cdp = await page.context.new_cdp_session(page)
        T = lambda t, x=None, y=None: cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [] if x is None else [{"x": x, "y": y, "id": 1}]})
        await T("touchStart", bx, by)
        for i in range(1, 16):
            await T("touchMove", bx + (tx-bx)*i/15, by + (ty-by)*i/15); await page.wait_for_timeout(16)
            if await page.evaluate("__balloon.dragOn"): grabbed = True
        nx, ny = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
        await T("touchEnd"); await page.wait_for_timeout(100)
    else:
        m = page.mouse
        await m.move(bx, by); await m.down()
        for i in range(1, 16):
            await m.move(bx + (tx-bx)*i/15, by + (ty-by)*i/15); await page.wait_for_timeout(16)
            if await page.evaluate("__balloon.dragOn"): grabbed = True
        nx, ny = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
        await m.up(); await page.wait_for_timeout(100)
    moved = ((nx-tx)**2 + (ny-ty)**2) ** .5 < 25
    return grabbed and moved

async def play_round(page, score=True):
    await page.evaluate("__balloon.enterHockey()")
    await page.wait_for_timeout(600)
    if score:
        await page.evaluate("localStorage.clear()")
    bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    m = page.mouse
    await m.move(bx, by); await m.down()
    for i in range(6):
        await m.move(bx, by - i*60); await page.wait_for_timeout(16)
    await m.up()
    await page.wait_for_timeout(1500)
    st = await page.evaluate("[__balloon.hockey.running, __balloon.hockey.over, __balloon.dragOn, __balloon.ball.x|0, __balloon.ball.y|0]")
    if not st[0]: print("  round not started after fling:", st, (bx, by))
    await page.evaluate("__balloon.hockey.running = true; __balloon.hockey.timeLeft = 0.3")
    await page.wait_for_selector(".endcard:not([hidden])")
    await page.wait_for_timeout(200)
    return await page.evaluate("__balloon.hockey.score")

async def scenario(b, name, exit_fn, vp, mobile):
    ctx = await b.new_context(viewport=vp, has_touch=mobile, is_mobile=mobile, device_scale_factor=2 if mobile else 1)
    page = await ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(URL); await page.wait_for_timeout(800)
    results = [(None, None, await drag_works(page, mobile))]  # baseline
    for rnd in range(2):  # repeat games
        sc = await play_round(page)
        await exit_fn(page)
        await page.wait_for_timeout(300)
        hidden = await page.evaluate("document.querySelector('.endcard').hidden")
        ok = await drag_works(page, mobile)
        results.append((sc, hidden, ok))
    await ctx.close()
    print(f"{'mobile' if mobile else 'desktop'} {name:22s} rounds(score,cardHidden,dragOK)={results} errors={errs}")
    return all(r[2] and r[1] is not False for r in results) and not errs

async def sign_done(page):
    vis = await page.evaluate("!document.querySelector('.board-form').hidden")
    assert vis, "form not shown"
    await page.keyboard.type("IAN")
    await page.click(".board-form .save")
    await page.wait_for_timeout(200)
    await page.click(".done")
async def done_only(page): await page.click(".done")
async def sign_escape(page):
    await page.keyboard.type("IAN"); await page.keyboard.press("Enter"); await page.wait_for_timeout(200)
    await page.keyboard.press("Escape")
async def escape_in_input(page): await page.keyboard.press("Escape")
async def replay_then_done(page):
    await page.click(".replay"); await page.wait_for_timeout(300)
    await page.evaluate("__balloon.hockey.running=true; __balloon.hockey.timeLeft=0.2")
    await page.wait_for_selector(".endcard:not([hidden])"); await page.click(".done")
async def replay_only(page):
    await page.click(".replay")
async def sign_tap_done(page):
    await page.keyboard.type("IAN"); await page.tap(".board-form .save"); await page.wait_for_timeout(200)
    await page.tap(".done")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
        allok = True
        for vp, mobile in [({"width":1280,"height":800}, False), ({"width":390,"height":844}, True)]:
            for name, fn in [("sign+done", sign_done), ("done (no sign)", done_only), ("sign+Escape", sign_escape),
                             ("Escape (no sign)", escape_in_input), ("replay then done", replay_then_done), ("play again", replay_only)] + ([("tap sign+done", sign_tap_done)] if mobile else []):
                try: allok &= await scenario(b, name, fn, vp, mobile)
                except Exception as e: print("FAIL", name, mobile, e); allok = False
        print("ALL OK" if allok else "SOME FAILED")
        await b.close()
asyncio.run(main())
