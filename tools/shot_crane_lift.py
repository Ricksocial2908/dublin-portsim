from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path("/workspace/dublin-portsim/crane-lift.png")
URL = "http://127.0.0.1:8112/viewer/#/task/dub-dft-w12-busy-0?plan=optimal"

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: print("pageerror", e))
    print("goto", URL)
    page.goto(URL, wait_until="networkidle", timeout=120000)
    page.wait_for_selector("canvas", timeout=90000)
    page.wait_for_timeout(4000)
    # Seek to a berth hour when a feeder is alongside (Liffey Feeder docks h 2).
    page.evaluate(
        """() => {
          const r = document.querySelector('input.range');
          if (!r) return false;
          r.value = '3.4';
          r.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }"""
    )
    page.wait_for_timeout(2500)
    info = page.evaluate(
        """async () => {
          const t0 = performance.now();
          while (!window.__portScene && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 200));
          const s = window.__portScene;
          if (!s) return { ok: false, error: 'no __portScene' };
          // wait until some actor is alongside
          const t1 = performance.now();
          while (performance.now() - t1 < 8000) {
            const n = [...s.actors.values()].filter(a => a.pose && a.pose.phase === 'alongside').length;
            if (n) break;
            await new Promise(r => setTimeout(r, 200));
          }
          const along = [...s.actors.values()].filter(a => a.pose && a.pose.phase === 'alongside').map(a => a.name);
          const res = s.testDischargeTop();
          return { ...res, along, time: s.time };
        }"""
    )
    print("discharge start", info)
    if not info or not info.get("ok"):
        page.screenshot(path=str(OUT), full_page=False)
        Path("/tmp/crane-lift-fail.txt").write_text(page.locator("body").inner_text()[:3000])
        print("failed, saved anyway", OUT.stat().st_size)
        browser.close()
        raise SystemExit(1)
    # Wait until mid-lift: hoisting or trolley (history event after pickup).
    # Cycle is scaled to ~20s; pickup ~3-4s, hoist ~6s, trolley ~8-10s.
    mid = None
    for i in range(40):
        page.wait_for_timeout(500)
        mid = page.evaluate(
            """() => {
              const s = window.__portScene;
              const L = (s.lifts || []).find(l => l.active);
              const rec = s.selectedBox;
              const panel = document.querySelector('.box-panel');
              if (L && L.lastBox) s._lookAtLift(L.lastBox);
              return {
                elapsed: L ? L.elapsed : null,
                arrived: L ? L.arrived : null,
                marks: L && L.job && L.job.mark,
                box: L && L.lastBox,
                state: rec && rec.state,
                history: rec && rec.history,
                panel: panel && !panel.hidden ? panel.innerText : '',
                phase: L && L.job ? 'running' : 'none',
              };
            }"""
        )
        print("tick", i, mid)
        if mid and mid.get("arrived") and mid.get("elapsed") and mid["elapsed"] > 7.5:
            break
    page.wait_for_timeout(400)  # settle a frame
    page.screenshot(path=str(OUT), full_page=False)
    print("saved", OUT, OUT.stat().st_size)
    Path("/tmp/crane-lift.txt").write_text(str(info) + "\n" + str(mid) + "\n" + page.locator("body").inner_text()[:2500])
    browser.close()
