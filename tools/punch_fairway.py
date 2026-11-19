#!/usr/bin/env python3
"""Punch a navigation fairway in front of each Dublin quay so ships can berth.

The land union (and some named OSM terminal polygons) had filled part of the
Liffey in front of DFT, so every planned approach failed 'route clearance'
and ships stayed at anchor. This subtracts a water-side pocket from land,
repaints cover.png, and places approach waypoints mid-channel.
"""
from __future__ import annotations

import gzip
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from shapely.geometry import Polygon, box, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
TWIN = ROOT / "viewer" / "twin" / "twin.json.gz"
COVER = ROOT / "viewer" / "twin" / "cover.png"


def flat_xy(coords):
    out = []
    for x, y in coords:
        out.extend((round(float(x), 1), round(float(y), 1)))
    return out


def ring(flat):
    pts = list(zip(flat[0::2], flat[1::2]))
    if pts and pts[0] != pts[-1]:
        pts.append(pts[0])
    return pts


def poly_from_rings(rings):
    p = Polygon(ring(rings[0]), [ring(r) for r in rings[1:]])
    return p if p.is_valid else p.buffer(0)


def rings_of(geom):
    if geom is None or geom.is_empty:
        return []
    geoms = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    out = []
    for g in geoms:
        if g.is_empty or g.area < 20:
            continue
        g = g if g.is_valid else g.buffer(0)
        if g.is_empty:
            continue
        parts = [g] if g.geom_type == "Polygon" else list(g.geoms)
        for p in parts:
            if p.is_empty or p.area < 20:
                continue
            outer = flat_xy(list(p.exterior.coords))
            holes = [flat_xy(list(h.coords)) for h in p.interiors if len(h.coords) >= 4]
            out.append([outer, *holes] if holes else [outer])
    return out


def site_axes(site):
    sw, ne = site["sw"], site["ne"]
    dx, dy = ne[0] - sw[0], ne[1] - sw[1]
    length = math.hypot(dx, dy) or 1.0
    d = (dx / length, dy / length)
    n = (d[1], -d[0])  # water side, same as viewer/twin.js
    return sw, ne, d, n, length


def pocket_poly(site, along=140.0, near=3.0, far=400.0):
    sw, ne, d, n, _ = site_axes(site)
    a = (sw[0] - d[0] * along, sw[1] - d[1] * along)
    b = (ne[0] + d[0] * along, ne[1] + d[1] * along)
    return Polygon([
        (a[0] + n[0] * near, a[1] + n[1] * near),
        (b[0] + n[0] * near, b[1] + n[1] * near),
        (b[0] + n[0] * far, b[1] + n[1] * far),
        (a[0] + n[0] * far, a[1] + n[1] * far),
    ])


def liffey_corridor():
    """Wide working-harbour water, joining the bay box at X≈2200."""
    return Polygon([
        (-2800, -320), (-1600, -360), (-700, -460), (-200, -520),
        (200, -620), (800, -650), (1600, -500), (2300, -800),
        (2300, 280), (1600, 300), (800, 260), (200, 180),
        (-200, 200), (-700, 160), (-1600, 240), (-2800, 250),
        (-2800, -320),
    ])


def mid_water_y(land, x, y_lo=-800, y_hi=400, step=4.0):
    y = y_lo
    best = None
    cur = None
    while y <= y_hi:
        wet = not land.contains(box(x - 0.5, y - 0.5, x + 0.5, y + 0.5).centroid) and not land.contains(
            __import__("shapely.geometry", fromlist=["Point"]).geometry.Point(x, y)
            if False else None
        )
        y += step
    # use Point properly
    from shapely.geometry import Point
    y = y_lo
    best = None
    cur = None
    while y <= y_hi:
        wet = not land.contains(Point(x, y))
        if wet:
            if cur is None:
                cur = [y, y]
            else:
                cur[1] = y
        elif cur is not None:
            if best is None or (cur[1] - cur[0]) > (best[1] - best[0]):
                best = cur[:]
            cur = None
        y += step
    if cur is not None and (best is None or (cur[1] - cur[0]) > (best[1] - best[0])):
        best = cur
    if not best:
        return None
    return (best[0] + best[1]) / 2.0, best[1] - best[0], best[0], best[1]


# rewrite mid_water_y cleanly below in main to avoid the mess
from shapely.geometry import Point


def water_band(land, x, y_lo=-800, y_hi=400, step=4.0):
    best = None
    cur = None
    y = y_lo
    while y <= y_hi:
        wet = not land.contains(Point(x, y))
        if wet:
            if cur is None:
                cur = [y, y]
            else:
                cur[1] = y
        elif cur is not None:
            if best is None or (cur[1] - cur[0]) > (best[1] - best[0]):
                best = cur[:]
            cur = None
        y += step
    if cur is not None and (best is None or (cur[1] - cur[0]) > (best[1] - best[0])):
        best = cur
    if not best:
        return None
    lo, hi = best
    return (lo + hi) / 2.0, hi - lo, lo, hi


def paint_cover(path: Path, frame, water_geom):
    im = Image.open(path)
    arr = np.array(im)
    h, w = arr.shape
    x0, y0, x1, y1 = frame["extent"]
    res = frame["cover_res"]
    # only paint the harbour window to stay fast
    xs0, xs1 = -3000, 2500
    ys0, ys1 = -900, 400
    j0 = max(0, int((xs0 - x0) / res))
    j1 = min(w, int((xs1 - x0) / res) + 1)
    i0 = max(0, int((y1 - ys1) / res))
    i1 = min(h, int((y1 - ys0) / res) + 1)
    # sample cell centres
    n = 0
    for i in range(i0, i1):
        Y = y1 - (i + 0.5) * res
        for j in range(j0, j1):
            X = x0 + (j + 0.5) * res
            if water_geom.contains(Point(X, Y)):
                if arr[i, j] != 255:
                    arr[i, j] = 255
                    n += 1
    Image.fromarray(arr, mode="L").save(path, optimize=True)
    return n


def place_routes(land, sites, routes):
    # Keep the open-bay waypoints; rewrite per-quay entry / via / lane.
    for key, site in sites.items():
        sw, ne, d, n, length = site_axes(site)
        # approach from the end closer to the port mouth (east, +X)
        mouth_end = ne if ne[0] >= sw[0] else sw
        entry_x = mouth_end[0] + (1 if mouth_end is ne else -1) * d[0] * 120
        # 120 m past the mouthward end, along the quay axis if it's east-west
        if abs(d[0]) < 0.4:
            entry_x = max(sw[0], ne[0]) + 120
        # preferred Y is mid-channel at that X
        # and a comfortable lane offset from the face
        along_x = mouth_end[0] + d[0] * 80
        # actually set entry in twin XY
        ex = mouth_end[0] + d[0] * 120 + n[0] * 0  # x/y filled below
        # use a point 120 m beyond the mouthward end, then snap Y/offset to water
        base = (mouth_end[0] + d[0] * 120, mouth_end[1] + d[1] * 120)
        band = water_band(land, base[0])
        # lane: 200 m off the face if that cell is wet, else mid-band
        lane = 200
        face_mid = ((sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2)
        # sample water distance off mid-face
        if band:
            # local z of mid-band at mid-face x
            mid_at_entry = band[0]
            # entry placed at lane offset if wet, else mid
            entry_off = lane
            entry_pt = (base[0] + n[0] * entry_off, base[1] + n[1] * entry_off)
            if land.contains(Point(*entry_pt)) and band:
                entry_off = max(80, min(lane, abs((mid_at_entry - mouth_end[1]) if abs(n[1]) > 0.5 else (mid_at_entry - mouth_end[0]))))
                # snap to mid-channel along water normal
                # mid-band Y at entry X:
                entry_pt = (base[0] + n[0] * abs(mid_at_entry - (mouth_end[1] if abs(n[1]) > 0.7 else mouth_end[0])),
                            base[1] + n[1] * abs(mid_at_entry - (mouth_end[1] if abs(n[1]) > 0.7 else mouth_end[0])))
                # simpler: start at face, go along n until mid of band projected
            # compute offset along n from the mouth_end to mid-channel point (base.x, midY)
            midY = band[0]
            mid_pt = (base[0], midY) if abs(n[1]) > 0.6 else (midY, base[1])
            # For nearly horizontal quays (50N, 32, OB), n is ~[0,-1] or [0,1]
            if abs(n[1]) >= abs(n[0]):
                mid_pt = (base[0], midY)
            else:
                bandx = water_band_x(land, base[1])
                mid_pt = (bandx[0], base[1]) if bandx else (base[0], base[1])
            # lane = distance from face to a point 0.45 of the way to the far bank, clamped
            face_y = mouth_end[1]
            if abs(n[1]) >= abs(n[0]):
                # z = (pt - face) · n
                # pick offset 200m if remaining width allows, else 0.4 * width
                width = band[1]
                lane = int(max(140, min(250, width * 0.45)))
                entry_pt = (base[0] + n[0] * lane, base[1] + n[1] * lane)
                if land.contains(Point(*entry_pt)):
                    lane = int(max(80, min(lane, abs(midY - face_y) * 0.85)))
                    entry_pt = (base[0] + n[0] * lane, base[1] + n[1] * lane)
            else:
                width = band[1] if band else 300
                lane = int(max(140, min(250, width * 0.45)))
                entry_pt = (base[0] + n[0] * lane, base[1] + n[1] * lane)
            # via further toward the bay along +X, mid channel
            via_x = base[0] + 700
            vb = water_band(land, via_x)
            via_pt = (via_x, vb[0] if vb else entry_pt[1])
        else:
            lane = 200
            entry_pt = (base[0] + n[0] * lane, base[1] + n[1] * lane)
            via_pt = (base[0] + 700 + n[0] * lane, base[1] + n[1] * lane)
        routes[key] = {
            "entry": [round(entry_pt[0], 1), round(entry_pt[1], 1)],
            "lane": int(lane),
            "via": [[round(via_pt[0], 1), round(via_pt[1], 1)]],
        }
        print(f"  routes {key}: entry={routes[key]['entry']} lane={lane} via={routes[key]['via']}")
    return routes


def water_band_x(land, y, x_lo=-2000, x_hi=2500, step=4.0):
    best = None
    cur = None
    x = x_lo
    while x <= x_hi:
        wet = not land.contains(Point(x, y))
        if wet:
            if cur is None:
                cur = [x, x]
            else:
                cur[1] = x
        elif cur is not None:
            if best is None or (cur[1] - cur[0]) > (best[1] - best[0]):
                best = cur[:]
            cur = None
        x += step
    if cur is not None and (best is None or (cur[1] - cur[0]) > (best[1] - best[0])):
        best = cur
    if not best:
        return None
    lo, hi = best
    return (lo + hi) / 2.0, hi - lo, lo, hi


def main():
    twin = json.loads(gzip.open(TWIN).read())
    land = unary_union([poly_from_rings(r) for r in twin["land"]])
    before = land.area
    pockets = [pocket_poly(s) for s in twin["sites"].values()]
    corridor = liffey_corridor()
    water = unary_union([*pockets, corridor]).buffer(0)
    land = land.difference(water)
    if not land.is_valid:
        land = land.buffer(0)
    print(f"land area {before/1e6:.2f} -> {land.area/1e6:.2f} km2")
    for k, s in twin["sites"].items():
        sw, ne, d, n, L = site_axes(s)
        mid = ((sw[0] + ne[0]) / 2 + n[0] * 40, (sw[1] + ne[1]) / 2 + n[1] * 40)
        print(f"  40m off {k} mid-face land? {land.contains(Point(*mid))} pt={mid}")

    twin["land"] = rings_of(land)
    twin["routes"] = place_routes(land, twin["sites"], twin["routes"])

    out = gzip.compress(json.dumps(twin, separators=(",", ":")).encode(), 6)
    TWIN.write_bytes(out)
    print("wrote", TWIN, "bytes", len(out))

    painted = paint_cover(COVER, twin["frame"], water)
    print("cover.png water pixels painted", painted)


if __name__ == "__main__":
    main()
