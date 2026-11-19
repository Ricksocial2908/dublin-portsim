#!/usr/bin/env python3
"""Parse official OSM map tiles into a compact features.json.gz, then delete the XML."""
from __future__ import annotations
import gzip, json, sys, xml.etree.ElementTree as ET
from pathlib import Path

KEEP_KEYS = {
    "building", "building:levels", "building:material", "height", "man_made",
    "landuse", "natural", "waterway", "water", "harbour", "leisure", "amenity",
    "highway", "bridge", "layer", "railway", "gauge", "aeroway", "area",
    "name", "ref", "mooring", "military", "barrier", "place", "wetland",
    "industrial", "craft", "tower:type", "tower:height", "historic",
    "religion", "denotation", "storage_tank", "content", "diameter",
    "location", "seamark:type", "dock", "landuse:port", "port",
}

TILE_DIR = Path("/workspace/dublin-portsim/tools/osm/tiles")
OUT = Path("/workspace/dublin-portsim/tools/osm/features.json.gz")

def useful(tags: dict) -> bool:
    if not tags:
        return False
    if any(k in tags for k in (
        "building", "landuse", "natural", "waterway", "water", "harbour",
        "leisure", "highway", "railway", "aeroway", "man_made", "amenity",
        "barrier", "mooring", "dock", "seamark:type",
    )):
        return True
    return False

def _localname(tag: str) -> str:
    return tag.split("}")[-1] if tag else tag

def parse_tile(path: Path, nodes: dict, ways: list, way_ids: set):
    # Official map API lists nodes, then ways, then relations.
    # Only clear node/way elements after they are processed; clearing every
    # end-event would wipe <nd>/<tag> children before the parent way is seen.
    local = {}
    context = ET.iterparse(str(path), events=("end",))
    n_ways_seen = 0
    for _, el in context:
        name = _localname(el.tag)
        if name == "node":
            nid = int(el.attrib["id"])
            local[nid] = (float(el.attrib["lon"]), float(el.attrib["lat"]))
            el.clear()
        elif name == "way":
            n_ways_seen += 1
            wid = int(el.attrib["id"])
            tags = {}
            refs = []
            for ch in el:
                ctag = _localname(ch.tag)
                if ctag == "nd" and "ref" in ch.attrib:
                    refs.append(int(ch.attrib["ref"]))
                elif ctag == "tag":
                    k, v = ch.attrib.get("k"), ch.attrib.get("v")
                    if k in KEEP_KEYS:
                        tags[k] = v
            if useful(tags) and wid not in way_ids and len(refs) >= 2:
                coords = []
                ok = True
                for r in refs:
                    p = local.get(r) or nodes.get(r)
                    if p is None:
                        ok = False
                        break
                    coords.append(p)
                if ok and len(coords) >= 2:
                    way_ids.add(wid)
                    ways.append({"id": wid, "t": tags, "c": [[round(x, 6), round(y, 6)] for x, y in coords]})
            el.clear()
    if len(nodes) < 400_000:
        nodes.update(local)
    return len(local), n_ways_seen

def main():
    tiles = sorted(TILE_DIR.glob("tile_*.osm"))
    print("tiles", len(tiles), "bytes", sum(p.stat().st_size for p in tiles))
    nodes = {}
    ways = []
    way_ids = set()
    for p in tiles:
        n, nw = parse_tile(p, nodes, ways, way_ids)
        print(f"  {p.name}: local_nodes={n} ways_in_file={nw} kept={len(ways)} node_cache={len(nodes)}", flush=True)
    # drop node cache before write
    del nodes
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT, "wt", encoding="utf-8") as f:
        json.dump({"ways": ways, "source": "OpenStreetMap contributors, ODbL-1.0, api.openstreetmap.org map API"}, f, separators=(",", ":"))
    print("wrote", OUT, OUT.stat().st_size, "ways", len(ways), flush=True)
    if len(ways) < 50:
        raise SystemExit(f"refusing to delete tiles: only {len(ways)} ways extracted")
    freed = 0
    for p in tiles:
        freed += p.stat().st_size
        p.unlink()
    print("deleted tiles, freed", freed, flush=True)

if __name__ == "__main__":
    main()
