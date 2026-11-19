from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path("/workspace/dublin-portsim/compare-dublin.png")
base = "http://127.0.0.1:8112"
url = base + "/viewer/#/task/dub-dft-w12-busy-0?plan=optimal"
report = []
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: report.append(f"pageerror: {e}"))
    page.on("console", lambda m: report.append(f"console {m.type}: {m.text}") if m.type in ("error","warning") else None)
    print("goto", url)
    page.goto(url, wait_until="networkidle", timeout=120000)
    page.wait_for_timeout(2000)
    try:
        page.wait_for_selector("canvas", timeout=90000)
        print("canvas found")
        page.wait_for_timeout(18000)
    except Exception as e:
        print("canvas wait failed", e)
        page.wait_for_timeout(5000)
    page.screenshot(path=str(out), full_page=False)
    print("saved", out, "size", out.stat().st_size, "url", page.url, "canvases", page.locator("canvas").count())
    Path("/tmp/dublin-page.txt").write_text(page.url + "\n" + page.title() + "\n" + page.locator("body").inner_text()[:4000])
    # --- editor: switch plans / drag is hard; at least evaluate optimal visible and open play ---
    body = page.locator("body").inner_text()
    report.append("title="+page.title())
    report.append("has canvas="+str(page.locator("canvas").count()))
    report.append("has Dock chart="+str("Dock chart" in body or "ship" in body.lower()))
    report.append("has Feasible="+str("Feasible" in body or "feasible" in body.lower() or "Optimal" in body))

    # Play episode: submit published/optimal plan
    play = base + "/viewer/#/play?split=test&task=dub-dft-w12-busy-0"
    print("goto play", play)
    page.goto(play, wait_until="networkidle", timeout=120000)
    page.wait_for_timeout(2000)
    # might show picker or start automatically? URL has task, but play may still need Start
    # click start if present
    for sel in ["#p-start", "button:has-text('Start')", "button:has-text('Play')", "[data-act='start']"]:
        loc = page.locator(sel)
        if loc.count():
            try:
                loc.first.click(timeout=3000)
                print("clicked", sel)
                break
            except Exception as e:
                print("click fail", sel, e)
    page.wait_for_timeout(4000)
    # if picker table, click the dft row then start
    if page.locator("#picker").count() and page.locator("#picker").is_visible():
        row = page.locator("text=dub-dft-w12-busy-0")
        if row.count():
            row.first.click()
            print("clicked task row")
        st = page.locator("#p-start, button:has-text('Start episode'), button:has-text('Start')")
        if st.count():
            st.first.click()
            print("clicked start")
        page.wait_for_timeout(4000)
    # Load optimal into draft if a plan dropdown exists; otherwise submit current draft (published)
    # Try check_plan then submit_plan
    chk = page.locator('[data-call="check_plan"]')
    sub = page.locator('[data-call="submit_plan"]')
    print("check btn", chk.count(), "submit btn", sub.count())
    if chk.count():
        chk.first.click()
        page.wait_for_timeout(1500)
        print("clicked check")
    if page.locator('[data-act="confirm-submit"]').count()==0 and sub.count():
        sub.first.click()
        page.wait_for_timeout(800)
        print("clicked submit")
    conf = page.locator('[data-act="confirm-submit"]')
    if conf.count():
        conf.first.click()
        page.wait_for_timeout(1500)
        print("confirmed submit")
    page.screenshot(path="/workspace/dublin-portsim/compare-dublin-play.png", full_page=False)
    play_txt = page.locator("body").inner_text()
    Path("/tmp/dublin-play.txt").write_text(page.url+"\n"+play_txt[:4000])
    report.append("play url="+page.url)
    report.append("play has reward="+str("reward" in play_txt.lower() or "submitted" in play_txt.lower() or "Episode ended" in play_txt or "grade" in play_txt.lower()))
    print("PLAY TEXT HEAD:\n", play_txt[:1500])
    browser.close()
Path("/tmp/dublin-report.txt").write_text("\n".join(report))
print("REPORT\n", "\n".join(report))
