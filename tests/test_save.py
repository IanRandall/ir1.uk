"""Leaderboard save test: finish a real game, sign like a user would, check visible feedback."""
import asyncio, sys
from pathlib import Path
from playwright.async_api import async_playwright
URL = (Path(__file__).resolve().parent.parent / "ian-randall-preview.html").as_uri()
THROW_LS = "Storage.prototype.setItem = function(){ throw new DOMException('QuotaExceededError','QuotaExceededError'); };"
NULL_LS = "Object.defineProperty(window,'localStorage',{get(){ throw new DOMException('SecurityError','SecurityError'); }});"

async def finish_game(page):
    await page.evaluate("__balloon.enterHockey()"); await page.wait_for_timeout(700)
    bx, by = await page.evaluate("[__balloon.ball.x, __balloon.ball.y]")
    m = page.mouse; await m.move(bx, by); await m.down()
    for i in range(6): await m.move(bx, by - i*60); await page.wait_for_timeout(16)
    await m.up(); await page.wait_for_timeout(1500)
    await page.evaluate("if(!__balloon.hockey.score) __balloon.hockey.score = 2; __balloon.hockey.running = true; __balloon.hockey.timeLeft = 0.2")
    await page.wait_for_selector(".endcard:not([hidden])"); await page.wait_for_timeout(300)

async def state(page):
    return await page.evaluate("""() => ({
      formHidden: document.querySelector('.board-form').hidden,
      me: [...document.querySelectorAll('.board-list li.me')].map(l => l.textContent.replace(/\\s+/g,' ').trim()),
      status: (document.querySelector('.board-status')||{}).textContent || '',
      stored: (()=>{ try { return localStorage.getItem('ianrandall.hockey.v1'); } catch(e) { return 'ERR '+e.name; } })(),
    })""")

async def case(b, name, action, expect_saved, init=None, mobile=False):
    ctx = await b.new_context(viewport={"width":390,"height":844} if mobile else {"width":1280,"height":800}, has_touch=mobile, is_mobile=mobile)
    if init: await ctx.add_init_script(init)
    page = await ctx.new_page(); errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    await page.goto(URL); await page.wait_for_timeout(800)
    await finish_game(page)
    await action(page); await page.wait_for_timeout(300)
    s = await state(page)
    if expect_saved: ok = bool(s["me"]) and "saved" in s["status"].lower()
    else: ok = (not s["formHidden"]) and len(s["status"]) > 0 and not s["me"]
    print(("PASS" if ok and not errs else "FAIL"), f"{'mobile ' if mobile else ''}{name:34s}", s, errs)
    await ctx.close(); return ok and not errs

def type_then(text, click_box=0, submit="click"):
    async def f(page):
        inputs = page.locator(".initials input")
        if page.context._impl_obj._options.get("hasTouch"): await inputs.nth(click_box).tap()
        else: await inputs.nth(click_box).click()
        await page.keyboard.type(text, delay=60)
        if submit == "click": await page.click(".board-form .save")
        elif submit == "tap": await page.tap(".board-form .save")
        else: await page.keyboard.press("Enter")
    return f
async def paste_all(page):
    await page.locator(".initials input").nth(0).click()
    await page.keyboard.insert_text("ian")
    await page.click(".board-form .save")

async def empty_then_fix(page):
    await page.click(".board-form .save"); await page.wait_for_timeout(200)
    st = await state(page); assert "initials" in st["status"], st
    await page.keyboard.type("IAN"); await page.click(".board-form .save")
async def overwrite(page):
    await page.locator(".initials input").nth(0).click(); await page.keyboard.type("IAX")
    await page.locator(".initials input").nth(2).click(); await page.keyboard.type("N")
    v = await page.evaluate("[...document.querySelectorAll('.initials input')].map(i=>i.value).join('')"); assert v == "IAN", v
    await page.click(".board-form .save")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"])
        res = [
          await case(b, "IAN, click save", type_then("IAN"), True),
          await case(b, "ian lowercase, click save", type_then("ian"), True),
          await case(b, "IAN, press Enter", type_then("IAN", submit="enter"), True),
          await case(b, "paste 'ian' into first box", paste_all, True),
          await case(b, "click 2nd box first, type IAN", type_then("IAN", click_box=1), True),
          await case(b, "only 2 letters (ia)", type_then("ia"), True),
          await case(b, "only 1 letter", type_then("i"), True),
          await case(b, "no letters", type_then(""), False),
          await case(b, "setItem throws (file:// / private)", type_then("IAN"), True, init=THROW_LS),
          await case(b, "localStorage getter throws", type_then("IAN"), True, init=NULL_LS),
          await case(b, "IAN, tap save", type_then("IAN", submit="tap"), True, mobile=True),
          await case(b, "ia, tap save", type_then("ia", submit="tap"), True, mobile=True),
          await case(b, "empty, tap save", type_then("", submit="tap"), False, mobile=True),
          await case(b, "empty then fix then save", empty_then_fix, True),
          await case(b, "overwrite box: type IAX, back, N", overwrite, True),
        ]
        print("ALL OK" if all(res) else "SOME FAILED"); await b.close()
asyncio.run(main())
