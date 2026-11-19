# PortSimEnv v1 · Dublin Port

A CC BY-SA 4.0 adaptation of [FineEnvs/PortSimEnv](https://huggingface.co/spaces/FineEnvs/PortSimEnv): the same viewer, 3D twin renderer (Three.js), berth-chart editor, tools and wording, with the port data and geometry changed from Barcelona to **Dublin Port**.

Live: [https://dublin-portsim.vercel.app](https://dublin-portsim.vercel.app) (opens `/viewer/`, the original UI path).

Repo: [Ricksocial2908/dublin-portsim](https://github.com/Ricksocial2908/dublin-portsim).

## What is the same as PortSimEnv

- The original Space front-end (`viewer/`: layout, light theme, Overview / Play / Explorer, dock chart, 3D stage, cranes, ships, cargo replay, camera controls).
- Planning model and in-page grader (`evaluatePlan`, check / submit, reward formula).
- Attribution chrome and CC BY-SA 4.0 license.

## What changed

- Twin frame is UTM **29N** (EPSG:32629) centred on Dublin Port (`53.3465, -6.194`).
- Land, buildings, roads, tanks, quay walls and land cover come from OpenStreetMap (ODbL) extracts of the port and inner city.
- Terrain from AWS Terrain Tiles (terrarium), encoded like the original `(R*256+G)/10-50 m`.
- Sites: **50N** (DFT, official 50A 170 m + 50N 370 m face), **MTL** (combined berths 41–45, ~619 m OSM quay), plus **51** (RoRo), **32** (Ocean Pier) and **OB** (oil) for the 3D harbour.
- Tasks (single-quay weeks, like the original): `dub-dft-w12-busy-0`, `dub-mtl-poolbeg-0`, `dub-oil-tide-0`. Call lists are synthetic (see assumptions below); berth lengths, depths and tides are from official notices.
- Play runs the same tools in-page (Vercel cannot host the original `/ws` OpenEnv session). Explorer check / submit already ran client-side in the original.
- Click a container on an alongside ship and the nearest STS crane discharges it in real time (trolley, spreader, quay handoff, optional truck to a yard slot). The box history records `discharged by crane N at <sim time>`. Yard or quay boxes still open the detail panel, with an optional **Load onto ship** reverse move.

## Attribution

Adapted from [FineEnvs/PortSimEnv](https://huggingface.co/spaces/FineEnvs/PortSimEnv) (CC BY-SA 4.0). Map data © OpenStreetMap contributors (ODbL 1.0). Terrain: [Mapzen / AWS Terrain Tiles](https://github.com/tilezen/joerd). Official berth and tidal figures: Dublin Port Company Notice to Mariners 12.4 (8 August 2025) and Irish Tide Tables 2026, North Wall.


## Assumptions
See notes.md for verified sources and assumed call lists, crane rates and overhangs.

A navigation fairway (berth pockets ~400 m off each working face, plus a Liffey corridor out to the bay) is subtracted from the land mask so ships can approach. Some named OSM terminal polygons had been painted back over the basin and were blocking every inbound route (`route clearance`). Mid-channel entry/lane waypoints are placed from that punched water, not surveyed leading lights. A few later ships on the busy DFT week can still fail clearance on tight turns; the first planned call (Liffey Feeder) berths normally.
