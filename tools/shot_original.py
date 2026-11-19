from pathlib import Path
from playwright.sync_api import sync_playwright
out = Path("/workspace/dublin-portsim/compare-original.png")
url = "https://fineenvs-portsimenv.hf.space/viewer/#/task/dock-24B-w06x1-busy-0"
with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    print("goto", url)
    page.goto(url, wait_until="networkidle", timeout=120000)
    page.wait_for_timeout(3000)
    try:
        page.wait_for_selector("canvas", timeout=90000)
        print("canvas found")
        # wait for 3D to render
        page.wait_for_timeout(20000)
    except Exception as e:
        print("canvas wait failed", e)
        page.wait_for_timeout(5000)
    page.screenshot(path=str(out), full_page=False)
    Path("/tmp/original-page.txt").write_text(page.url + "\n" + page.title() + "\n" + page.locator("body").inner_text()[:3000])
    print("saved", out, "size", out.stat().st_size, "url", page.url)
    # count canvases
    print("canvases", page.locator("canvas").count())
    browser.close()
