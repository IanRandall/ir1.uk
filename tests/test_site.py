import asyncio, os, sys
from pathlib import Path
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
OUT = str(Path(__file__).resolve().parent.parent / "shots") + "/"
S = "({x:Math.round(__balloon.ball.x),y:Math.round(__balloon.ball.y),vx:Math.round(__balloon.ball.vx),vy:Math.round(__balloon.ball.vy),p:+__balloon.ball.pressure.toFixed(2),charge:+__balloon.ball.popCharge.toFixed(2),theme:__balloon.theme,s:__balloon.state})"
async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
        page = await b.new_page(viewport={"width":1280,"height":800})
        errs=[]
        page.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type=="error" else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        await page.goto(URL); await page.wait_for_timeout(1500)
        print("title", await page.title(), "gl", await page.evaluate("__balloon.hasGL"))
        await page.screenshot(path=OUT+"01-normal.png")
        m = page.mouse
        await m.move(640,400); await m.down()
        for i in range(30):
            await m.move(640+i*21, 400+i*14); await page.wait_for_timeout(16)
        await page.wait_for_timeout(120)
        print("corner", await page.evaluate(S))
        await page.screenshot(path=OUT+"02-squashed-corner.png")
        for i in range(8):
            await m.move(1100-i*70, 700-i*45); await page.wait_for_timeout(16)
        await m.up()
        for k in range(8):
            await page.wait_for_timeout(250); print("fling", await page.evaluate(S))
        await page.screenshot(path=OUT+"03-after-fling.png")
        await page.wait_for_timeout(2500)
        bx,by = await page.evaluate("[__balloon.ball.x,__balloon.ball.y]")
        await m.move(bx,by); await m.down()
        for i in range(20):
            await m.move(bx-(bx)*(i/14), by); await page.wait_for_timeout(16)
        await page.wait_for_timeout(80)
        print("wall", await page.evaluate(S))
        await page.screenshot(path=OUT+"04-squashed-wall.png")
        t=0
        for i in range(200):
            await m.move(-120, by); await page.wait_for_timeout(16); t+=1
            if await page.evaluate("__balloon.state") != "ball": break
        print("popped after frames", t, await page.evaluate("__balloon.state"))
        await m.up()
        await page.wait_for_timeout(200)
        await page.screenshot(path=OUT+"05-popping.png")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=OUT+"06-popped-settled.png")
        await m.click(640,300); await page.wait_for_timeout(450)
        await page.screenshot(path=OUT+"07-reforming.png")
        await page.wait_for_timeout(1500)
        print("after reform", await page.evaluate(S))
        bx,by = await page.evaluate("[__balloon.ball.x,__balloon.ball.y]")
        await m.click(bx,by); await page.wait_for_timeout(120); await m.click(bx,by)
        await page.wait_for_timeout(700)
        print("hockey", await page.evaluate("__balloon.hockey.on"))
        for shot in range(3):
            await page.wait_for_timeout(900)
            bx,by = await page.evaluate("[__balloon.ball.x,__balloon.ball.y]")
            await m.move(bx,by); await m.down()
            for i in range(6):
                await m.move(bx + (640-bx)*i/6, by-15-i*30); await page.wait_for_timeout(16)
            await m.up()
            await page.wait_for_timeout(500)
            if shot==0: await page.screenshot(path=OUT+"08-hockey.png")
        await page.wait_for_timeout(1000)
        print("score", await page.evaluate("__balloon.hockey.score"), "running", await page.evaluate("__balloon.hockey.running"))
        await page.wait_for_timeout(13000)
        await page.screenshot(path=OUT+"09-hockey-end.png")
        vis = await page.is_visible(".board-form")
        print("form visible", vis)
        if vis:
            await page.keyboard.type("IRR"); await page.keyboard.press("Enter"); await page.wait_for_timeout(300)
            print("board", await page.inner_text(".board-list"))
            await page.screenshot(path=OUT+"10-leaderboard.png")
        mp = await b.new_page(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        mp.on("pageerror", lambda e: errs.append(f"mobile pageerror: {e}"))
        await mp.goto(URL); await mp.wait_for_timeout(1200)
        await mp.screenshot(path=OUT+"11-mobile.png")
        cdp = await mp.context.new_cdp_session(mp)
        async def touch(t, x, y):
            await cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": [] if t=="touchEnd" else [{"x": x, "y": y}]})
        await touch("touchStart",195,422)
        for i in range(25):
            await touch("touchMove",195-i*12,422+i*20); await mp.wait_for_timeout(16)
        await mp.wait_for_timeout(100)
        print("mobile corner", await mp.evaluate(S))
        await mp.screenshot(path=OUT+"12-mobile-squashed.png")
        await touch("touchEnd",0,0)
        print("ERRORS:", errs or "none")
        await b.close()
asyncio.run(main())
