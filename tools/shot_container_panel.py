from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path("/workspace/dublin-portsim")
CLICK = ROOT / "container-click.png"
RELATED = ROOT / "container-related.png"
URL = "http://127.0.0.1:8112/viewer/#/task/dub-dft-w12-busy-0?plan=optimal"
LOG = Path("/tmp/container-panel.txt")

def launch(p):
    return p.chromium.launch(
        executable_path="/usr/bin/google-chrome",
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
    )

def ready(page):
    page.goto(URL, wait_until="networkidle", timeout=120000)
    page.wait_for_selector("canvas", timeout=90000)
    page.wait_for_timeout(4000)
    page.evaluate(
        """() => {
          const r = document.querySelector('input.range');
          if (!r) return;
          r.value = '3.4';
          r.dispatchEvent(new Event('input', { bubbles: true }));
        }"""
    )
    page.wait_for_timeout(2000)
    page.wait_for_function("() => window.__portScene && window.__portScene.actors && window.__portScene.actors.size", timeout=15000)

with sync_playwright() as p:
    browser = launch(p)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.on("pageerror", lambda e: print("pageerror", e))
    ready(page)

    light = page.evaluate("""() => {
      const sel = document.querySelector('[data-act=light]');
      return sel ? { value: sel.value, label: sel.selectedOptions[0] && sel.selectedOptions[0].textContent, options: [...sel.options].map(o => o.textContent) } : null;
    }""")
    print("light", light)

    traffic = page.evaluate("""() => {
      const s = window.__portScene;
      return [...s.actors.values()].map(a => ({
        name: a.name, phase: a.pose && a.pose.phase, reason: a.sched && a.sched.reason,
        vBerth: a.sched && a.sched.visualBerth,
      }));
    }""")
    print("traffic")
    for r in traffic:
        print(" ", r)

    yard = page.evaluate("""() => {
      const s = window.__portScene;
      if (!s._boxRecords || !s._boxRecords.size) s._refreshCatalog();
      return s.testSelectYardBox();
    }""")
    print("yard", {k: yard.get(k) if k != "panel" else (yard.get("panel") or "")[:500] for k in (yard or {})})
    page.wait_for_timeout(1300)  # camera fly
    page.screenshot(path=str(CLICK), full_page=False)
    print("saved", CLICK, CLICK.stat().st_size)

    related = page.evaluate("""() => window.__portScene.testSelectRelated()""")
    print("related", {k: related.get(k) if k != "panel" else (related.get("panel") or "")[:500] for k in (related or {})})
    page.wait_for_timeout(1100)
    page.screenshot(path=str(RELATED), full_page=False)
    print("saved", RELATED, RELATED.stat().st_size)

    # ship click list: first alongside ship
    shipList = page.evaluate("""() => {
      const s = window.__portScene;
      const a = [...s.actors.values()].find(x => x.pose && x.pose.phase === 'alongside') || [...s.actors.values()][0];
      if (!a) return { ok: false, error: 'no ship' };
      s._onShipClick(a);
      return { ok: true, name: a.name, count: (s.boxPanel.innerText.match(/containers on this call/) || [s.boxPanel.innerText])[0], preview: s.boxPanel.innerText.slice(0, 600) };
    }""")
    print("shipList", shipList)

    # ISO check digit spot-check on a few catalog numbers
    iso = page.evaluate("""() => {
      const recs = [...window.__portScene._boxRecords.values()].slice(0, 8);
      const val = (ch) => {
        if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
        const n = ch.toUpperCase().charCodeAt(0) - 65;
        return n + 10 + Math.floor((n + 10) / 11);
      };
      const check = (body) => {
        let sum = 0, w = 1;
        for (let i = 0; i < 10; i++) { sum += val(body[i]) * w; w *= 2; }
        const d = sum % 11; return d === 10 ? 0 : d;
      };
      return recs.map(r => ({ iso: r.iso, ok: r.iso && r.iso.length === 11 && check(r.iso.slice(0,10)) === Number(r.iso[10]) }));
    }""")
    print("iso", iso)

    LOG.write_text(
        f"light={light}\n\nyard={yard}\n\nrelated={related}\n\nshipList={shipList}\n\niso={iso}\n\ntraffic={traffic}\n",
        encoding="utf-8",
    )
    browser.close()
    if not yard or not yard.get("ok"):
        raise SystemExit("yard select failed")
    if not related or not related.get("ok"):
        raise SystemExit("related select failed")
