# Dublin PortSim

A Dublin Port themed clone of [FineEnvs/PortSimEnv](https://huggingface.co/spaces/FineEnvs/PortSimEnv): you plan who docks where and when (and with how many cranes) after the published plan has broken.

The original environment is a Python OpenEnv + 3D viewer for **real 2024 Port of Barcelona container calls**. This project keeps the same planning rules and reward, but the geography, terminals, vessel mix and tidal constraints are those of **Dublin Port**. The interactive episode runs entirely in the browser (static web app). A Python package in `python/` implements the same model for agents and tests.

Live app: https://dublin-portsim.vercel.app  
Source: https://github.com/Ricksocial2908/dublin-portsim

## How to play

1. Pick a scenario (DFT containers, Irish Sea ferries, Ocean Pier, Poolbeg / MTL, oil berths, or a whole-port storm week).
2. Read the notices — late ships, closures, gales, crane outages, tidal windows.
3. Place every ship on a legal berth and hour on the chart (or click a berth on the map). Drag blocks to adjust.
4. **Check plan** reports violations and cost. **Submit plan** grades the episode.

Cost is section-hours of delay past each ship’s due time, plus a penalty of 5 for moving a ship off its planned berth. A valid plan is scored against a best-known feasible cost with the original dock-v1 formula:

`0.2 + 0.8 × exp(−gap / 0.5)`, where `gap = (cost − best_known) / (best_known − unavoidable + 100)`.

An infeasible plan scores `0.2 ×` the share of ships placed with no violation.

## What is real, and what is assumed

Verified from official or operator sources (see `notes.md` for citations):

- Terminals and operators: Alexandra Basin RoRo jetty (berths 26–27), Ocean Pier, oil berths OB1–OB4, Dublin Ferryport Terminals (DFT) at 50A/50N/50S, Irish Ferries at 49 and 51A, Stena Line at 51, MTL / Peel Ports at Poolbeg berths 41–45, Tom Clarke (East Link) Bridge, the Liffey channel, the Tolka estuary.
- Berth lengths, survey/design/approach depths and under-keel clearances from Dublin Port Notice to Mariners 12.4 (8 August 2025).
- Tidal levels at Dublin North Wall from Dublin Port Tide Tables 2026 (HAT, MHWS, MHWN, MSL, MLWN, MLWS, LAT).
- Regular Dublin–Holyhead ferries and published dimensions (Ulysses, W.B. Yeats, Stena Estrid, Stena Adventurer). Liverpool RoRo length ~195 m from the Harbour Master’s 2026 assessment.

Assumptions and limits, not official schedules or a proven optimum:

- All weekly call lists and slot times are **synthetic / illustrative**. They are not Dublin Port or operator schedules.
- Container, tanker, bulk and cruise names are fictional. No IMO numbers are used.
- Planning grid on long LoLo quays is **40 m sections** (the Barcelona environment uses about 42 m). Spare metres at the end of a berth are left unused.
- DFT crane productivity is assumed at **25 moves per crane-hour**. DFT’s three Liebherr gantry cranes are from the operator. MTL’s crane fleet was not verified; the Poolbeg scenario does not enforce a crane-pool cap.
- Passenger RoRo handling is assumed **2 hours**, freight RoRo **6 hours**, unless a notice says otherwise.
- The tide in the simulator is a semi-diurnal harmonic curve anchored at the official levels (period 12.42 h, with a spring–neap modulation). It is not the official prediction for a named date.
- Transit is allowed when `depth + tide − 1.0 m ≥ draught`. A ship may lie alongside when `survey + tide − 0.5 m ≥ draught`. Binding tidal windows use each berth’s official approach depth.
- The inbound channel depth used for most eastern berths is the official survey figure **9.0 m** (VTS to OB1). Shallower official reaches are applied for western berths.
- Berth 53 is treated as closed for MP2 works; berth 52 uses the 2025 notice depths.
- Operator-to-berth assignments follow a planning-report snapshot (Irish Ferries 49 & 51A, Stena 51, 26/27 for the Liverpool service) and can change in real life.
- “Best known” costs come from a heuristic search, not a proven CP-SAT optimum.

## Stack

- Static web app in `web/` (no build step)
- Python 3 package in `python/dublin_portsim`
- License: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), share-alike with the original

## Run locally

```bash
# web
python3 -m http.server 8080 --directory web

# python checks
python3 -m pip install -e python
python3 -m dublin_portsim.cli --task dub-dft-w12-busy-0
```

## Attribution

Adapted from [PortSimEnv v1](https://huggingface.co/spaces/FineEnvs/PortSimEnv) by FineEnvs (CC BY-SA 4.0). Original Barcelona work uses Port de Barcelona open data. This Dublin themed work is not affiliated with Dublin Port Company, Irish Ferries, Stena Line, ICG, Peel Ports, or P&O. Official notices and tide tables remain the property of their publishers; only facts needed to set depths, clearances and tidal levels were used.
