#!/usr/bin/env python3
"""Build a PortSimEnv-format 3D twin of Dublin Port from OSM features + AWS terrarium tiles.

Output (same schema as FineEnvs/PortSimEnv viewer/twin/):
  twin.json.gz, terrain.png, cover.png, scenery.json.gz
surface.webp is a repeating 70 m detail atlas in the original, so it is kept as-is.
"""
from __future__ import annotations

import gzip, io, json, math, sys, urllib.request
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

ROOT = Path("/workspace/dublin-portsim")
FEAT = ROOT / "tools/osm/features.json.gz"
OUT = ROOT / "viewer/twin"
ORIGIN_LL = (53.3465, -6.1940)  # lat, lon — centre of Dublin Port
CRS = "EPSG:32629"
EXTENT = [-9000.0, -7500.0, 8000.0, 12000.0]  # same window as the Barcelona twin
GRID = 40.0
COVER_RES = 20.0
GROUND_RES = 10.0

COVER_CLASSES = [
    "urban", "port", "industrial", "residential", "commercial", "rail",
    "dirt", "grass", "park", "forest", "scrub", "sand", "farm", "cemetery",
    "apron", "runway",
]
COVER_INDEX = {n: i for i, n in enumerate(COVER_CLASSES)}

# landuse / natural / leisure -> cover class
COVER_MAP = {
    "port": "port", "harbour": "port", "industrial": "industrial",
    "residential": "residential", "commercial": "commercial", "retail": "commercial",
    "railway": "rail", "brownfield": "dirt", "construction": "dirt",
    "grass": "grass", "meadow": "grass", "recreation_ground": "grass",
    "forest": "forest", "wood": "forest", "scrub": "scrub", "heath": "scrub",
    "beach": "sand", "sand": "sand", "farmland": "farm", "farmyard": "farm",
    "orchard": "farm", "allotments": "farm", "cemetery": "cemetery",
    "park": "park", "garden": "park", "pitch": "grass", "golf_course": "grass",
    "village_green": "park", "religious": "urban", "education": "urban",
    "military": "industrial", "quarry": "dirt",
}

HIGHWAY_W = {
    "motorway": 26, "motorway_link": 15, "trunk": 20, "trunk_link": 15,
    "primary": 15, "primary_link": 11, "secondary": 11, "secondary_link": 11,
    "tertiary": 8, "tertiary_link": 8, "residential": 8, "unclassified": 8,
    "service": 8, "living_street": 8, "busway": 8,
}

BUILDING_KIND = {
    "industrial": 2, "warehouse": 2, "manufacture": 2, "hangar": 2, "shed": 2,
    "container": 2, "service": 2, "garages": 2, "garage": 2, "hut": 2,
    "apartments": 0, "residential": 0, "house": 0, "detached": 0, "terrace": 0,
    "semidetached_house": 0, "bungalow": 0, "dormitory": 0,
    "commercial": 1, "retail": 1, "office": 1, "supermarket": 1, "hotel": 1,
    "yes": 1, "transportation": 1, "train_station": 1, "civic": 1, "public": 1,
    "church": 3, "cathedral": 3, "chapel": 3, "mosque": 3,
    "school": 1, "university": 1, "hospital": 1, "college": 1,
    "greenhouse": 4, "roof": 5, "construction": 5,
}


def transformer():
    return Transformer.from_crs("EPSG:4326", CRS, always_xy=True)


def make_frame(tf):
    lat, lon = ORIGIN_LL
    e0, n0 = tf.transform(lon, lat)
    e0, n0 = int(round(e0)), int(round(n0))
    tw = int((EXTENT[2] - EXTENT[0]) / GRID) + 1  # 426
    th = int((EXTENT[3] - EXTENT[1]) / GRID) + 1  # 488
    cw = int(round((EXTENT[2] - EXTENT[0]) / COVER_RES))  # 850
    ch = int(round((EXTENT[3] - EXTENT[1]) / COVER_RES))  # 975
    return {
        "origin_ll": [lat, lon],
        "crs": CRS,
        "e0": e0,
        "n0": n0,
        "extent": EXTENT,
        "grid": GRID,
        "ground_res": GROUND_RES,
        "terrain": {"w": tw, "h": th, "enc": "(R*256+G)/10-50 m"},
        "cover_res": COVER_RES,
        "_cover_wh": (cw, ch),
    }


def xy(tf, frame, lon, lat):
    e, n = tf.transform(lon, lat)
    return (round(e - frame["e0"], 1), round(n - frame["n0"], 1))


def flat_xy(coords):
    out = []
    for x, y in coords:
        out.extend((round(float(x), 1), round(float(y), 1)))
    return out


def poly_from_lonlat(tf, frame, coords, close=True):
    pts = [xy(tf, frame, lon, lat) for lon, lat in coords]
    if close and pts and pts[0] != pts[-1]:
        pts.append(pts[0])
    if len(pts) < 3:
        return None
    try:
        p = Polygon(pts)
        if not p.is_valid:
            p = p.buffer(0)
        if p.is_empty:
            return None
        return p
    except Exception:
        return None


def line_from_lonlat(tf, frame, coords):
    pts = [xy(tf, frame, lon, lat) for lon, lat in coords]
    if len(pts) < 2:
        return None
    return LineString(pts)


def load_ways():
    with gzip.open(FEAT, "rt", encoding="utf-8") as f:
        return json.load(f)["ways"]


def classify_ways(ways, tf, frame):
    land_cover = defaultdict(list)  # class -> polygons
    water_polys = []
    buildings = []
    tanks = []
    spires = []
    roads = []
    parking = []
    rails = []
    walls = []
    armour = []
    shores = []
    breakwaters = []
    coast_lines = []
    named_areas = {}
    piers = []

    for w in ways:
        t = w["t"]
        coords = w["c"]
        name = t.get("name") or ""
        man = t.get("man_made")
        nat = t.get("natural")
        lu = t.get("landuse")
        bldg = t.get("building")
        hwy = t.get("highway")

        # named industrial / harbour areas (for quay picking)
        if name and lu in {"industrial", "harbour", "port", "commercial"} and len(coords) >= 4:
            p = poly_from_lonlat(tf, frame, coords)
            if p and p.area > 100:
                named_areas[name] = named_areas.get(name) or p
                # if duplicate names, keep the larger
                if p.area > named_areas[name].area:
                    named_areas[name] = p

        if nat == "coastline" and len(coords) >= 2:
            ln = line_from_lonlat(tf, frame, coords)
            if ln:
                coast_lines.append(ln)
                shores.append(flat_xy(ln.coords))

        if man == "breakwater" or (man == "pier" and t.get("area") != "yes"):
            ln = line_from_lonlat(tf, frame, coords)
            if ln and ln.length >= 20:
                (breakwaters if man == "breakwater" else walls).append(flat_xy(ln.coords))
                if man == "pier":
                    piers.append({"name": name, "line": ln, "tags": t, "id": w["id"]})

        if man in {"pier", "quay", "groyne"} and (t.get("area") == "yes" or (coords[0] == coords[-1] and len(coords) >= 4)):
            p = poly_from_lonlat(tf, frame, coords)
            if p:
                piers.append({"name": name, "poly": p, "tags": t, "id": w["id"]})
                walls.append(flat_xy(list(p.exterior.coords)))

        # water
        if nat == "water" or t.get("waterway") in {"dock", "riverbank"} or t.get("water") in {
            "river", "basin", "harbour", "canal", "lock", "pond", "reservoir",
        } or lu == "harbour" or t.get("harbour"):
            p = poly_from_lonlat(tf, frame, coords)
            if p and p.area > 50:
                water_polys.append(p)

        # cover
        key = lu or nat or t.get("leisure") or t.get("amenity")
        if lu == "harbour" or name.lower().endswith("terminal") or "container terminal" in name.lower():
            cls = "port"
        else:
            cls = COVER_MAP.get(key)
        if cls and len(coords) >= 4:
            p = poly_from_lonlat(tf, frame, coords)
            if p and p.area > 40:
                land_cover[cls].append(p)

        # buildings
        if bldg and bldg != "no" and len(coords) >= 4:
            p = poly_from_lonlat(tf, frame, coords)
            if not p or p.area < 12:
                continue
            # skip tiny footprints
            h = None
            if t.get("height"):
                try:
                    h = float(str(t["height"]).split()[0].replace("m", ""))
                except ValueError:
                    h = None
            if h is None and t.get("building:levels"):
                try:
                    h = float(str(t["building:levels"]).split(";")[0]) * 3.2
                except ValueError:
                    h = None
            if h is None:
                h = {2: 8.0, 0: 10.0, 3: 16.0, 4: 6.0}.get(BUILDING_KIND.get(bldg, 1), 9.0)
            h = float(max(3.0, min(h, 220.0)))
            kind = BUILDING_KIND.get(bldg, 1)
            if man == "storage_tank" or bldg == "tank":
                # handled as tank below if possible
                pass
            ring = list(p.exterior.coords)[:-1]
            if len(ring) >= 3:
                buildings.append([round(h, 1), 0.0, kind, *flat_xy(ring)])

        # tanks / silos
        if man in {"storage_tank", "silo", "tank"} or bldg in {"tank", "silo"}:
            p = poly_from_lonlat(tf, frame, coords) if len(coords) >= 3 else None
            if p and not p.is_empty:
                c = p.centroid
                # equivalent radius from area
                rad = max(1.5, min(40.0, math.sqrt(max(p.area, 1) / math.pi)))
                h = 11.0 if man == "storage_tank" else 16.0
                if t.get("height"):
                    try:
                        h = float(str(t["height"]).split()[0].replace("m", ""))
                    except ValueError:
                        pass
                kind = 0 if man == "storage_tank" else 1
                tanks.append([round(c.x, 1), round(c.y, 1), round(rad, 1), round(h, 1), kind, 0, 0.0])

        if man == "chimney":
            # use centroid of way or first point
            if len(coords) >= 1:
                x, y = xy(tf, frame, *coords[len(coords) // 2])
                h = 80.0
                if t.get("height"):
                    try:
                        h = float(str(t["height"]).split()[0].replace("m", ""))
                    except ValueError:
                        pass
                spires.append([round(x, 1), round(y, 1), round(h, 1), 0.0, "chimney"])

        if man == "lighthouse":
            x, y = xy(tf, frame, *coords[len(coords) // 2])
            spires.append([round(x, 1), round(y, 1), 20.0, 0.0, "lighthouse"])

        if t.get("tower:type") or (man == "tower" and t.get("tower:type") in {"communication", "bell_tower", "observation"}):
            x, y = xy(tf, frame, *coords[len(coords) // 2])
            h = 45.0
            if t.get("height") or t.get("tower:height"):
                try:
                    h = float(str(t.get("height") or t.get("tower:height")).split()[0])
                except ValueError:
                    pass
            typ = t.get("tower:type") or "communication"
            spires.append([round(x, 1), round(y, 1), round(h, 1), 0.0, typ])

        # The Spire / Monument of Light
        if "spire" in name.lower() and "o'connell" in name.lower() or name == "The Spire":
            x, y = xy(tf, frame, *coords[len(coords) // 2])
            spires.append([round(x, 1), round(y, 1), 120.0, 0.0, "monument"])

        # roads
        if hwy in HIGHWAY_W and len(coords) >= 2 and t.get("area") != "yes":
            ln = line_from_lonlat(tf, frame, coords)
            if ln and ln.length >= 8:
                layer = 1 if t.get("bridge") in {"yes", "viaduct"} or t.get("layer") not in (None, "0", "-1") and t.get("bridge") else 0
                if t.get("bridge") in {"yes", "viaduct"}:
                    layer = 1
                roads.append([HIGHWAY_W[hwy], layer, *flat_xy(ln.coords)])

        if t.get("amenity") == "parking" and len(coords) >= 4:
            p = poly_from_lonlat(tf, frame, coords)
            if p and p.area > 40:
                parking.append(flat_xy(list(p.exterior.coords)[:-1]))

        if t.get("railway") in {"rail", "light_rail", "tram", "narrow_gauge", "disused", "yard"} and len(coords) >= 2:
            ln = line_from_lonlat(tf, frame, coords)
            if ln and ln.length >= 8:
                rails.append(flat_xy(ln.coords))

        if man in {"gantry", "crane"}:
            # skip; cranes are built by the viewer from the task
            pass

    return {
        "land_cover": land_cover,
        "water": water_polys,
        "buildings": buildings,
        "tanks": tanks,
        "spires": spires,
        "roads": roads,
        "parking": parking,
        "rails": rails,
        "walls": walls,
        "armour": armour,
        "shores": shores,
        "breakwaters": breakwaters,
        "coast": coast_lines,
        "named": named_areas,
        "piers": piers,
    }


def sea_and_land(layers, frame):
    """Land = extent box minus (OSM water + a Dublin Bay / harbour channel mask)."""
    x0, y0, x1, y1 = frame["extent"]
    world = box(x0, y0, x1, y1)
    waters = [p for p in layers["water"] if p.intersects(world)]

    # Dublin Bay: east of a line just outside the port entrance, plus the
    # approaches around Great South Wall / North Bull. Coastline ways already
    # describe the shore; we also add a large eastern sea so the 17 km frame
    # is not empty beyond the OSM tile coverage.
    # Port mouth is near Poolbeg lighthouse ~ (lon -6.1514, lat 53.3421).
    # In twin metres that's roughly X≈2800, Y≈-450. Channel runs west to the city.
    sea_east = box(2200, y0, x1, y1)  # open bay from just west of the lighthouse
    # The working harbour / Liffey mouth: a corridor along the river east of Tom Clarke Bridge.
    # Approximate channel through the port (west-east), ~350 m wide around Y≈-50..+50? 
    # Origin is 53.3465,-6.194 → river is slightly north/south of origin.
    # Liffey through the port is about lat 53.345-53.347. That's Y ≈ -150..+50.
    # Extend a channel polygon from the city (X=-2500) to the bay (X=2500).
    channel = Polygon([
        (-2800, -280), (-200, -200), (800, -260), (1800, -420), (2300, -700),
        (2300, 200), (1600, 280), (600, 220), (-200, 260), (-2800, 220),
        (-2800, -280),
    ])
    waters.extend([sea_east, channel])

    try:
        water_u = unary_union(waters)
        if not water_u.is_valid:
            water_u = water_u.buffer(0)
        land = world.difference(water_u)
        # keep large industrial / port polygons as land (quays that the channel mask may have cut)
        port_keep = []
        for name, p in layers["named"].items():
            if any(s in name.lower() for s in ("terminal", "container", "port company", "esso", "circle k", "poolbeg", "ocean pier", "pigeon")):
                port_keep.append(p)
        if port_keep:
            land = unary_union([land, *port_keep]).intersection(world)
        if not land.is_valid:
            land = land.buffer(0)
    except Exception as e:
        print("land union failed", e, file=sys.stderr)
        land = world
        water_u = sea_east

    return land, water_u


def rings_of(geom):
    """twin.land / cover format: list of polygons, each [outer, *holes] as flat xy."""
    if geom is None or geom.is_empty:
        return []
    geoms = []
    if geom.geom_type == "Polygon":
        geoms = [geom]
    elif geom.geom_type == "MultiPolygon":
        geoms = list(geom.geoms)
    out = []
    for g in geoms:
        if g.is_empty or g.area < 20:
            continue
        outer = flat_xy(list(g.exterior.coords))
        holes = [flat_xy(list(h.coords)) for h in g.interiors if len(h.coords) >= 4]
        out.append([outer, *holes] if holes else [outer])
    return out


def cover_polys(layers, land):
    """Simplify cover layers to lists of [outer, *holes] polygons, clipped to land."""
    out = {}
    for cls, polys in layers["land_cover"].items():
        try:
            u = unary_union(polys)
            if land is not None:
                u = u.intersection(land)
            if not u.is_empty:
                rings = rings_of(u)
                if rings:
                    out[cls] = rings
        except Exception as e:
            print("cover", cls, e, file=sys.stderr)
    return out


def longest_edge_on_water(poly, water, min_len=200):
    """Return (sw, ne) of the longest *chain* of water-facing edges, oriented so n points to water."""
    if poly is None or poly.is_empty:
        return None
    from shapely.geometry import Point
    geom = poly.buffer(0)
    ext = list(geom.exterior.coords)
    if ext[0] == ext[-1]:
        ext = ext[:-1]
    npts = len(ext)
    if npts < 2:
        return None

    def wet_normal(a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        for sign in (1, -1):
            nx, ny = sign * (-dy / L), sign * (dx / L)
            probe = Point(mx + nx * 30, my + ny * 30)
            try:
                in_water = (not geom.contains(probe)) and (water.contains(probe) or water.distance(probe) < 15)
            except Exception:
                in_water = False
            if in_water:
                return L, (nx, ny)
        return L, None

    flags = []
    for i in range(npts):
        a, b = ext[i], ext[(i + 1) % npts]
        L, nrm = wet_normal(a, b)
        flags.append((L, nrm, a, b))

    # walk circularly and merge contiguous wet segments
    wet_idx = [i for i, (L, nrm, _, _) in enumerate(flags) if nrm is not None and L >= 8]
    if not wet_idx:
        return None
    # expand to runs
    best = None  # (length, start_pt, end_pt, nrm)
    # linearize by rotation
    start0 = None
    for i in range(npts):
        prev_wet = flags[i - 1][1] is not None and flags[i - 1][0] >= 8
        cur_wet = flags[i][1] is not None and flags[i][0] >= 8
        if cur_wet and not prev_wet:
            start0 = i
            break
    if start0 is None:
        start0 = wet_idx[0]
    i = start0
    for _ in range(npts + 1):
        if flags[i][1] is None or flags[i][0] < 8:
            i = (i + 1) % npts
            if i == start0:
                break
            continue
        # start of a run
        j = i
        length = 0.0
        nsum = [0.0, 0.0]
        a0 = flags[i][2]
        b1 = flags[i][3]
        while flags[j][1] is not None and flags[j][0] >= 8:
            L, nrm, a, b = flags[j]
            length += L
            nsum[0] += nrm[0] * L
            nsum[1] += nrm[1] * L
            b1 = b
            j = (j + 1) % npts
            if j == i:
                break
        if best is None or length > best[0]:
            best = (length, a0, b1, (nsum[0], nsum[1]))
        if j == i:
            break
        i = j
        if i == start0:
            break
    if not best or best[0] < min_len:
        # fall back to the single longest wet edge, even if short
        cand = [(L, a, b, nrm) for (L, nrm, a, b) in flags if nrm is not None]
        if not cand:
            return None
        L, a, b, n_wanted = max(cand, key=lambda x: x[0])
        best = (L, a, b, n_wanted)
    _, a, b, n_wanted = best
    def n_of(p, q):
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy) or 1
        d = (dx / L, dy / L)
        return (d[1], -d[0]), p, q
    n1, p, q = n_of(a, b)
    if n1[0] * n_wanted[0] + n1[1] * n_wanted[1] < 0:
        p, q = q, p
    return (round(p[0], 1), round(p[1], 1)), (round(q[0], 1), round(q[1], 1))


def build_sites(layers, water, tf, frame):
    named = layers["named"]
    sites = {}
    routes_extra = {}

    def envelope_water_side(poly, water, min_len=200):
        """If the quay is a rectangular yard, the water-facing side of the envelope is the true face."""
        from shapely.geometry import Point
        minx, miny, maxx, maxy = poly.bounds
        sides = [
            ((minx, miny), (maxx, miny), (0, -1)),  # south
            ((maxx, miny), (maxx, maxy), (1, 0)),   # east
            ((maxx, maxy), (minx, maxy), (0, 1)),   # north
            ((minx, maxy), (minx, miny), (-1, 0)),  # west
        ]
        best = None
        for a, b, nrm in sides:
            L = math.hypot(b[0]-a[0], b[1]-a[1])
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            probe = Point(mx + nrm[0]*40, my + nrm[1]*40)
            try:
                wet = water.contains(probe) or water.distance(probe) < 20
            except Exception:
                wet = False
            if wet and (best is None or L > best[0]):
                best = (L, a, b, nrm)
        if not best or best[0] < min_len:
            return None, 0
        _, a, b, n_wanted = best
        def n_of(p, q):
            dx, dy = q[0]-p[0], q[1]-p[1]
            L = math.hypot(dx, dy) or 1
            d = (dx/L, dy/L)
            return (d[1], -d[0]), p, q
        n1, p, q = n_of(a, b)
        if n1[0]*n_wanted[0] + n1[1]*n_wanted[1] < 0:
            p, q = q, p
        return ((round(p[0],1), round(p[1],1)), (round(q[0],1), round(q[1],1))), best[0]

    def add(key, poly, rail=18.0, lane=250.0):
        if poly is None:
            return
        pair = longest_edge_on_water(poly, water, min_len=120)
        chain_len = 0
        if pair:
            chain_len = math.hypot(pair[1][0]-pair[0][0], pair[1][1]-pair[0][1])
        env_pair, env_len = envelope_water_side(poly, water, min_len=150)
        # Prefer the envelope side that faces the Liffey / harbour channel
        # (north bank -> south face, south bank -> north face) when the
        # detected chain is a short notch relative to that face.
        ch_pair, ch_len = None, 0
        from shapely.geometry import Point as _P
        cy = poly.centroid.y
        prefer = (0, -1) if cy > 0 else (0, 1)
        minx, miny, maxx, maxy = poly.bounds
        cand = [((minx, miny), (maxx, miny), (0, -1)), ((maxx, maxy), (minx, maxy), (0, 1))]
        for a, b, nrm in cand:
            if nrm[0]*prefer[0] + nrm[1]*prefer[1] <= 0:
                continue
            L = math.hypot(b[0]-a[0], b[1]-a[1])
            mx, my = (a[0]+b[0])/2, (a[1]+b[1])/2
            probe = _P(mx + nrm[0]*40, my + nrm[1]*40)
            try:
                wet = water.contains(probe) or water.distance(probe) < 25
            except Exception:
                wet = False
            if wet and L > 150:
                def _n_of(p, q, n_wanted):
                    dx, dy = q[0]-p[0], q[1]-p[1]
                    LL = math.hypot(dx, dy) or 1
                    d = (dx/LL, dy/LL)
                    n1 = (d[1], -d[0])
                    if n1[0]*n_wanted[0] + n1[1]*n_wanted[1] < 0:
                        p, q = q, p
                    return ((round(p[0],1), round(p[1],1)), (round(q[0],1), round(q[1],1))), L
                ch_pair, ch_len = _n_of(a, b, nrm)
        if ch_pair and (chain_len < 0.7 * ch_len or chain_len < 250):
            print(f"  {key}: using channel envelope {ch_len:.0f}m over chain {chain_len:.0f}m")
            pair = ch_pair
        elif env_pair and env_len > chain_len * 1.5 and chain_len < 250:
            print(f"  {key}: using envelope face {env_len:.0f}m over chain {chain_len:.0f}m")
            pair = env_pair
        if not pair:
            ext = list(poly.buffer(0).exterior.coords)
            best = max(((LineString([a, b]).length, a, b) for a, b in zip(ext, ext[1:])), default=None)
            if not best or best[0] < 80:
                print("  no edge for", key, file=sys.stderr)
                return
            _, a, b = best
            pair = ( (round(a[0], 1), round(a[1], 1)), (round(b[0], 1), round(b[1], 1)) )
        sw, ne = pair
        sites[key] = {"sw": [sw[0], sw[1]], "ne": [ne[0], ne[1]], "rail_offset": rail}
        # entry: 200 m off the mid-face toward water
        dx, dy = ne[0] - sw[0], ne[1] - sw[1]
        L = math.hypot(dx, dy) or 1
        d = (dx / L, dy / L)
        n = (d[1], -d[0])
        mid = ((sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2)
        entry = [round(mid[0] + n[0] * 180, 1), round(mid[1] + n[1] * 180, 1)]
        routes_extra[key] = {"entry": entry, "lane": lane}
        print(f"  site {key}: sw={sites[key]['sw']} ne={sites[key]['ne']} len={L:.0f}m entry={entry}")

    # MTL (south container terminal) and DFT (prefer eastern north-side terminals)
    add("MTL", named.get("Container Terminal"), rail=17.5, lane=220)
    # DFT / berth 50: prefer Terminal 5 (eastern deep-water) then Terminal 2, then Ocean Pier
    dft = named.get("Terminal 5") or named.get("Terminal 2") or named.get("Ocean Pier Container Terminal")
    add("50N", dft, rail=18.0, lane=250)
    # RoRo / ferry (Terminal 1 landuse is the southern ferry berth area)
    if named.get("Terminal 1"):
        add("51", named.get("Terminal 1"), rail=16.0, lane=200)
    if named.get("Ocean Pier Container Terminal"):
        add("32", named.get("Ocean Pier Container Terminal"), rail=17.0, lane=220)
    # oil: Esso / Texaco along the river
    if named.get("Esso / Texaco Joint Fuel Terminal"):
        add("OB", named.get("Esso / Texaco Joint Fuel Terminal"), rail=14.0, lane=180)
    return sites, routes_extra


def apm_slabs_for(sites):
    """Yard paving polygons on the land side of each container quay."""
    slabs = []
    for key, s in sites.items():
        sw, ne = s["sw"], s["ne"]
        dx, dy = ne[0] - sw[0], ne[1] - sw[1]
        L = math.hypot(dx, dy) or 1
        d = (dx / L, dy / L)
        n = (d[1], -d[0])  # water
        # land is -n; slabs from 15 m to 220 m inland, split into ~80 m bays
        inland = (-n[0], -n[1])
        step = 80.0
        t = 10.0
        while t < L - 10:
            t2 = min(L - 10, t + step)
            corners = []
            for tt, dd in ((t, 20), (t2, 20), (t2, 200), (t, 200)):
                corners.append((
                    sw[0] + d[0] * tt + inland[0] * dd,
                    sw[1] + d[1] * tt + inland[1] * dd,
                ))
            slabs.append(flat_xy(corners))
            t = t2
    return slabs


def raster_cover(frame, land, water, cover, sites):
    cw, ch = frame["_cover_wh"]
    x0, y0, x1, y1 = frame["extent"]
    img = Image.new("L", (cw, ch), 255)  # water
    draw = ImageDraw.Draw(img)

    def to_px(x, y):
        j = (x - x0) / COVER_RES
        i = (y1 - y) / COVER_RES
        return (j, i)

    def draw_geom(geom, val):
        if geom is None or geom.is_empty:
            return
        geoms = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        for g in geoms:
            if g.is_empty or g.area < 10:
                continue
            pts = [to_px(x, y) for x, y in g.exterior.coords]
            draw.polygon(pts, fill=val)
            for h in g.interiors:
                draw.polygon([to_px(x, y) for x, y in h.coords], fill=255 if val != 255 else 0)

    # land default = urban (0)
    draw_geom(land, COVER_INDEX["urban"])
    # paint classes in a sensible order; use both unioned rings and raw polys
    order = ["farm", "forest", "scrub", "sand", "grass", "park", "cemetery",
             "residential", "commercial", "industrial", "rail", "dirt", "port", "apron"]
    raw = getattr(raster_cover, "_raw", {})
    for cls in order:
        val = COVER_INDEX[cls]
        for g in raw.get(cls, []):
            draw_geom(g, val)
        if cls not in cover:
            continue
        for poly in cover[cls]:
            outer = list(zip(poly[0][0::2], poly[0][1::2]))
            draw.polygon([to_px(x, y) for x, y in outer], fill=val)
            for hole in poly[1:]:
                pts = list(zip(hole[0::2], hole[1::2]))
                draw.polygon([to_px(x, y) for x, y in pts], fill=COVER_INDEX["urban"])
    # paint water last so docks/channel stay wet
    draw_geom(water, 255)
    # apron near container sites
    for s in sites.values():
        sw, ne = s["sw"], s["ne"]
        dx, dy = ne[0] - sw[0], ne[1] - sw[1]
        L = math.hypot(dx, dy) or 1
        d = (dx / L, dy / L)
        inland = (-d[1], d[0])  # -n
        corners = [
            (sw[0] + inland[0] * 8, sw[1] + inland[1] * 8),
            (ne[0] + inland[0] * 8, ne[1] + inland[1] * 8),
            (ne[0] + inland[0] * 180, ne[1] + inland[1] * 180),
            (sw[0] + inland[0] * 180, sw[1] + inland[1] * 180),
        ]
        draw.polygon([to_px(x, y) for x, y in corners], fill=COVER_INDEX["port"])
    return img


def mercator_tile(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1.0 / math.cos(lat_r)) / math.pi) / 2.0 * n
    return x, y


def inv_mercator(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat_r = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    return math.degrees(lat_r), lon


def fetch_terrain(tf, frame):
    z = 13
    tw, th = frame["terrain"]["w"], frame["terrain"]["h"]
    x0, y0, x1, y1 = frame["extent"]
    # corners in lon/lat
    def ll(X, Y):
        e, n = frame["e0"] + X, frame["n0"] + Y
        lon, lat = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True).transform(e, n)
        return lat, lon
    corners = [ll(x, y) for x in (x0, x1) for y in (y0, y1)]
    xs, ys = [], []
    for lat, lon in corners:
        x, y = mercator_tile(lat, lon, z)
        xs.append(x); ys.append(y)
    tx0, tx1 = int(math.floor(min(xs))), int(math.ceil(max(xs)))
    ty0, ty1 = int(math.floor(min(ys))), int(math.ceil(max(ys)))
    print(f"terrain tiles z{z} x {tx0}..{tx1-1} y {ty0}..{ty1-1} n={(tx1-tx0)*(ty1-ty0)}")
    tiles = {}
    for ty in range(ty0, ty1):
        for tx in range(tx0, tx1):
            cache = Path("/workspace/dublin-portsim/tools/osm/terrarium")
            cache.mkdir(parents=True, exist_ok=True)
            dest = cache / f"{z}_{tx}_{ty}.png"
            try:
                if not dest.exists():
                    url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{tx}/{ty}.png"
                    req = urllib.request.Request(url, headers={"User-Agent": "DublinPortSim/0.1"})
                    with urllib.request.urlopen(req, timeout=20) as r:
                        dest.write_bytes(r.read())
                tiles[(tx, ty)] = Image.open(dest).convert("RGB")
                print("  tile", tx, ty, "ok")
            except Exception as e:
                print("  tile fail", tx, ty, e)
                tiles[(tx, ty)] = Image.new("RGB", (256, 256), (128, 0, 0))
    # sample heights
    H = np.zeros((th, tw), dtype=np.float32)
    to_ll = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
    for i in range(th):
        for j in range(tw):
            X = x0 + j * GRID
            Y = y1 - i * GRID  # row 0 = north
            lon, lat = to_ll.transform(frame["e0"] + X, frame["n0"] + Y)
            x, y = mercator_tile(lat, lon, z)
            tx, ty = int(math.floor(x)), int(math.floor(y))
            im = tiles.get((tx, ty))
            if im is None:
                continue
            u = (x - tx) * 256
            v = (y - ty) * 256
            ui, vi = int(min(255, max(0, u))), int(min(255, max(0, v)))
            R, G, B = im.getpixel((ui, vi))
            h = (R * 256 + G + B / 256.0) - 32768.0
            H[i, j] = h
    return H


def encode_terrain(H, land, water, frame):
    """Encode heights as (R*256+G)/10-50, flatten water slightly negative, land >= 0."""
    th, tw = H.shape
    x0, y0, x1, y1 = frame["extent"]
    out = np.zeros((th, tw, 3), dtype=np.uint8)
    from shapely.geometry import Point
    for i in range(th):
        for j in range(tw):
            X = x0 + j * GRID
            Y = y1 - i * GRID
            h = float(H[i, j])
            # flatten water
            try:
                wet = water.contains(Point(X, Y)) if water is not None else False
            except Exception:
                wet = False
            if wet:
                h = -2.0
            else:
                h = max(0.0, h)
            # encode
            v = int(round((h + 50.0) * 10.0))
            v = max(0, min(65535, v))
            out[i, j, 0] = v // 256
            out[i, j, 1] = v % 256
            out[i, j, 2] = 0
    return Image.fromarray(out, "RGB")


def build_routes(tf, frame, sites, routes_extra):
    # Sea: mid-Dublin Bay, east of the walls
    sea = list(xy(tf, frame, -6.12, 53.335))
    mouth_out = list(xy(tf, frame, -6.146, 53.342))  # just outside Poolbeg / entrance
    mouth_in = list(xy(tf, frame, -6.175, 53.3445))  # inside the walls
    anch = {
        "centre": list(xy(tf, frame, -6.13, 53.338)),
        "along": [0.95, -0.3],
        "half": [1200.0, 700.0],
    }
    # cruise along Ocean Pier / south wall if we have site 32, else Terminal 5 face
    cruise = None
    src = sites.get("32") or sites.get("50N")
    if src:
        cruise = {"a": src["sw"][:], "b": src["ne"][:]}
    routes = {
        "sea": [round(sea[0], 1), round(sea[1], 1)],
        "mouth_out": [round(mouth_out[0], 1), round(mouth_out[1], 1)],
        "mouth_in": [round(mouth_in[0], 1), round(mouth_in[1], 1)],
        "anchorage": anch,
        "cruise": cruise,
    }
    for k, v in routes_extra.items():
        rec = {"entry": v["entry"], "lane": v["lane"]}
        # simple via: mouth_in -> a point closer to the entry
        rec["via"] = [
            [round((mouth_in[0] * 2 + v["entry"][0]) / 3, 1),
             round((mouth_in[1] * 2 + v["entry"][1]) / 3, 1)],
        ]
        routes[k] = rec
    return routes


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tf = transformer()
    frame = make_frame(tf)
    print("frame e0,n0", frame["e0"], frame["n0"], "terrain", frame["terrain"], "cover", frame["_cover_wh"])
    ways = load_ways()
    print("ways", len(ways))
    layers = classify_ways(ways, tf, frame)
    print("buildings", len(layers["buildings"]), "roads", len(layers["roads"]),
          "tanks", len(layers["tanks"]), "spires", len(layers["spires"]),
          "parking", len(layers["parking"]), "rail", len(layers["rails"]),
          "water", len(layers["water"]), "named", list(layers["named"]))
    land, water = sea_and_land(layers, frame)
    print("land area km2", round(land.area / 1e6, 2), "water km2", round(water.area / 1e6, 2))
    print("raw cover polys", {k: len(v) for k, v in layers["land_cover"].items()})
    # ensure named industrial / port yards contribute to cover even if union failed
    for name, p in layers["named"].items():
        low = name.lower()
        cls = "port" if any(s in low for s in ("terminal", "container", "harbour", "port company")) else "industrial"
        layers["land_cover"][cls].append(p)
    cover = cover_polys(layers, land)
    print("cover keys", {k: len(v) for k, v in cover.items()})
    sites, routes_extra = build_sites(layers, water, tf, frame)
    if "50N" not in sites or "MTL" not in sites:
        print("WARNING missing core sites", sites.keys(), file=sys.stderr)
    routes = build_routes(tf, frame, sites, routes_extra)
    slabs = apm_slabs_for({k: v for k, v in sites.items() if k in {"50N", "MTL"}})
    land_rings = rings_of(land)
    print("land rings", len(land_rings), "slabs", len(slabs))

    # terrain
    H = fetch_terrain(tf, frame)
    print("terrain height range", float(np.nanmin(H)), float(np.nanmax(H)), "mean", float(np.nanmean(H)))
    terr_im = encode_terrain(H, land, water, frame)
    terr_im.save(OUT / "terrain.png")
    print("wrote terrain.png", (OUT / "terrain.png").stat().st_size)

    raster_cover._raw = layers['land_cover']
    cov_im = raster_cover(frame, land, water, cover, sites)
    cov_im.save(OUT / "cover.png")
    print("wrote cover.png", (OUT / "cover.png").stat().st_size)

    # twin buildings: keep a port-neighbourhood subset so scenery can add the rest
    # (load concatenates data.buildings + scenery.buildings)
    def in_port(b):
        # b = [h, base, kind, x,y,...]; centroid of first pts
        xs = b[3::2]; ys = b[4::2]
        if not xs:
            return False
        x, y = sum(xs) / len(xs), sum(ys) / len(ys)
        return -2500 <= x <= 2500 and -2000 <= y <= 2000

    twin_buildings = [b for b in layers["buildings"] if in_port(b)]
    scenery_buildings = layers["buildings"]  # all
    print("twin buildings", len(twin_buildings), "scenery buildings", len(scenery_buildings))

    frame_pub = {k: v for k, v in frame.items() if not k.startswith("_")}
    twin = {
        "routes": routes,
        "frame": frame_pub,
        "sites": sites,
        "land": land_rings,
        "walls": layers["walls"],
        "armour": layers["armour"],
        "shores": layers["shores"],
        "breakwaters": layers["breakwaters"],
        "buildings": twin_buildings,
        "tanks": layers["tanks"],
        "spires": layers["spires"],
        "landmarks": {},
        "cover": cover,
        "cover_classes": COVER_CLASSES,
        "roads": layers["roads"][:20],  # scenery.roads replace these on load
        "best_blocks": [],
        "apm_slabs": slabs,
        "rail": layers["rails"],
    }
    with gzip.open(OUT / "twin.json.gz", "wt", encoding="utf-8") as f:
        json.dump(twin, f, separators=(",", ":"))
    print("wrote twin.json.gz", (OUT / "twin.json.gz").stat().st_size)

    scenery = {
        "buildings": scenery_buildings,
        "roads": layers["roads"],
        "parking": layers["parking"],
        "source": {
            "provider": "OpenStreetMap contributors",
            "licence": "ODbL-1.0",
            "timestamps": {"city": "2026-11-19", "streets": "2026-11-19"},
        },
    }
    with gzip.open(OUT / "scenery.json.gz", "wt", encoding="utf-8") as f:
        json.dump(scenery, f, separators=(",", ":"))
    print("wrote scenery.json.gz", (OUT / "scenery.json.gz").stat().st_size)
    print("DONE sites", list(sites))


if __name__ == "__main__":
    main()
