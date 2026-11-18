# Notes: FineEnvs/PortSimEnv and the Dublin Port clone

Studied 18 Nov 2026 from the public Space
https://huggingface.co/spaces/FineEnvs/PortSimEnv
(API, recursive tree, and raw files). License: CC-BY-SA 4.0.
Short description: "Dock planning on real Port of Barcelona calls".

## What the original is

A Docker Hugging Face Space (`sdk: docker`, port 8000, `base_path: /web`)
that serves an OpenEnv reinforcement-learning environment for **berth
planning** at two real Port of Barcelona container quays:

- quay **36A**, Terminal Catalunya (BEST), 13 ship-to-shore cranes
- quay **24B**, APM Terminals Barcelona, 9 cranes on that stretch

The agent (or a human in the web UI) must plan **who docks where and when,
and with how many cranes**, over one to three weeks of real 2024 calls.
The published plan has already broken (late ships, unscheduled extras,
closures, crane outages, gales, diverted traffic, emergencies, priority
cargo). One graded `submit_plan` per episode is scored against a stored
CP-SAT optimum.

Stack:

- Python 3.12, FastAPI / uvicorn (`berth_openenv.server`)
- OpenEnv MCP environment (`/reset`, `/step`, `/ws`, `/mcp`)
- Task API under `/berth_planning/...`
- Read-only viewer JSON under `/api/...`
- Core library `berth_core` (task/plan model, generators, CP-SAT solve,
  reward rubrics)
- Front end: static JS/CSS (`openenv/berth_openenv/web/`) — task list,
  berth-chart editor, 3D digital twin of Barcelona, play mode over a
  WebSocket session
- Optional Gradio UI
- Tasks served from `tasks/dock-v1-eval` and `dock-v1-train` (1,050 train,
  50 eval by default)
- 3D twin assets fetched at image build from the public HF bucket
  FineEnvs/PortSimEnv
- Data source for the Barcelona calls: Port de Barcelona open data, CC BY-SA 4.0

## Core model (faithful rules to reuse)

A quay is a row of numbered **sections** (Barcelona uses the port's own
numbering, about 42 m each). Each ship needs a run of consecutive sections
for a number of hours. Times are whole hours from Monday 00:00 UTC.

A plan entry is `{ship, berth_hour, section[, cranes]}`.

Checks (from `berth_core/model.py`, `check.py`, and `web/model.js`):

- Cannot berth before `arrival`
- Must fit on the quay; cannot overlap other ships or `blocks`
  (ships already alongside, or closed sections)
- On crane-rule tasks: `handling = ceil(workload / cranes)`, crane use
  never exceeds the pool (minus outages), crane count in `[min, max]`,
  and at most `max_moves_per_hour` ships may berth or leave in one hour
- `no_moves` windows (wind, by ship length): a ship may not berth or
  leave inside a window that applies to it; if work finishes inside a
  window it waits alongside until the window ends
- Cost = sum(sections × hours late × weight + deadline penalty)
  + 5 × ships moved off their planned sections

Reward (dock-v1 / rubric v3, from the Space README and `reward.py`):

- Infeasible: `0.2 ×` share of ships placed with no violation
- Feasible: `0.2 + 0.8 × exp(−gap / 0.5)` where
  `gap = (cost − optimum) / (optimum − unavoidable + 100)`
- A proven optimum scores 1.0; no submission scores 0

Tools: `get_situation()`, `check_plan(plan)` (10 per episode),
`submit_plan(plan)`.

## What the Dublin clone should do

Same planning game, re-themed to **Dublin Port** (not Barcelona):

- Real geography and named terminals on both banks of the Liffey
- Mixed traffic: RoRo ferries, container feeders, cruise, bulk, tankers
- Tidal and channel constraints using official Dublin Port depths and
  under-keel clearances (these play the role that wind windows play in
  Barcelona, where they apply)
- A static web app so it can be opened on Vercel without a Python
  server; Python environment code kept in the repo for the same model

There is no public equivalent of the Barcelona 2024 call dataset used
here, so Dublin **call lists and slot times are synthetic / illustrative**,
not official schedules. Vessel types and regular ferry names on the
Dublin–Holyhead corridor are real; IMO numbers are omitted so nothing
fictional is labelled as a real ship identity. Berth lengths, depths,
UKC, tidal levels, and operators below are taken from cited official or
operator sources.

## Verified Dublin Port facts (with sources)

### Geography and operators

- **Tom Clarke (East Link) Bridge**: opening span 31.5 m; clearance
  6.35 m above Chart Datum (1.85 m at HAT). VHF 12/13, call sign EAST LINK.
  Source: Dublin Port Notice to Mariners, Thomas Clarke (East Link) Bridge,
  Dec 2025 / 2026 notice.
- **Berth 18**, North Quay Extension, in front of the Tom Clarke Bridge
  (Open House Dublin / Dublin Port boat-tour pages).
- **Alexandra Basin RoRo jetty, Berths 26 and 27**: used by large ferries
  on the Dublin–Liverpool service; current ships about 195 m LOA; jetty
  designed for ferries up to 240 m. Berth 25 is unused because of proximity
  to that jetty. Source: Dublin Port Harbour Master assessment, Sep 2026.
- **Ocean Pier**: ABR drawing gives Ocean Pier West quay 415 m and South
  94 m (Dublin Port ABR drawings, 2014). The 2025 berth-depth notice lists
  operational berths 28–40 in this part of the north side, including
  berth 32 at 370 m.
- **Oil jetties**: western jetty OB1 & OB2 (majority of petroleum);
  eastern jetty OB3 & OB4 (majority of bitumen and all LPG). Source:
  EPA / MP2 planning material describing existing use.
- **Dublin Ferryport Terminals (DFT / ICG)**: LoLo container terminal at
  berths 50A, 50N and 50S. Operator site (current): 480 m of berths for
  container ships, depth 9–11 m, three Liebherr 40 t gantry cranes.
  Older Dublin Port Yearbook (2014) quoted 580 m and a fourth 45 t crane;
  the clone uses the operator's current 480 m / 3-crane figure plus the
  2025 Harbour Master lengths/depths.
- **Irish Ferries Terminal 1**: berths 49 and 51A. **Stena Line Terminal 2**:
  berth 51. **Seatruck Terminal 5**: historically berths 52 and 53.
  **P&O Terminal 3**: historically berth 21, with ABR plans to relocate.
  Source: EPA planning appeal report table of existing operators.
- **MTL (Marine Terminals Ltd, Peel Ports)** LoLo terminal on the south
  side / Poolbeg at berths 41–45 (Dublin Port Yearbook 2014; 3FM project
  description). The 2014 yearbook quoted 700 m total berth length; the
  clone uses the August 2025 Harbour Master lengths instead.
- **MP2 / ABR works**: Berths 52/53 are being infilled; new river Berth 52
  and jetty Berth 53 are under construction. Source: Dublin Port Annual
  Report 2025 and MP2 EIAR. Berth 53 is blank in the Aug 2025 depth notice,
  consistent with works.
- **3FM** (Poolbeg) is a proposed future project (planning live in 2026),
  not modelled as built infrastructure.
- **Tolka estuary** and the South Dublin Bay and River Tolka SPA bound the
  north-east of the port (MP2 EIAR).

### Official depths and UKC — Notice to Mariners 12.4, 8 Aug 2025
Harbour Master Captain Michael McKenna. Depths in metres below Chart Datum
for survey/design; "above chart datum" in the notice header refers to the
unit system of the tables (values are the usual positive design depths).

Channel / approach survey depths:

| Reach | Survey depth (m) |
|---|---|
| Outer Fairway to VTS | 9.2 |
| VTS to corner berth OB1 | 9.0 |
| OB1 west to North Wall Quay Light | 7.6 |
| Alexandra Basin East | 7.7 |
| Alexandra Basin West, north of RoRo berth | 7.5 |
| Alexandra Basin West, south of RoRo berth | 6.1 |
| North Wall Quay Light to Buoy 20 | 7.5 |
| Buoy 20 to East Link Bridge | 6.4 |
| River west of East Link Bridge | 3.1 |

Minimum UKC: **1.0 m** for a manoeuvring vessel in the channel, fairway or
basins; **0.5 m** for a vessel alongside a berth over all stages of the tide.

Selected berths used in the clone (length, design, survey, approach), all
from the same notice:

| Berth | Length (m) | Design | Survey | Approach |
|---|---|---|---|---|
| 18 | 200 | 6.5 | 6.5 | 6.4 |
| 21/22 | 200 | 6.5 | 6.6 | 6.6 |
| 26 | 220 | — | 6.9 | 6.7 |
| 27 | 220 | — | 6.9 | 6.9 |
| 32 | 370 | 9.5 | 9.2 | 7.5 |
| 36 | 200 | 10.3 | 10.2 | 7.7 |
| 38 | 300 | 10.3 | 10.1 | 7.7 |
| OB1 | 185 | 10.4 | 10.3 | 7.7 |
| OB2 | 185 | 10.7 | 10.4 | 7.8 |
| OB3 | 185 | 10.1 | 9.8 | 7.8 |
| OB4 | 160 | 6.5 | 6.2 | 6.2 |
| 41 | 150 | 7.4 | 7.2 | 7.2 |
| 42 | 110 | 11.0 | 10.8 | 7.8 |
| 43 | 130 | 11.0 | 10.8 | 7.8 |
| 44 | 80 | 11.0 | 10.8 | 7.8 |
| 45d | 160 | 8.7 | 8.5 | 8.5 |
| 49 | 210 | 11.0 | 9.8 | 9.0 |
| 50A | 170 | 11.0 | 10.6 | 7.7 |
| 50N | 370 | 9.5 | 9.2 | 7.6 |
| 50S | (basin face) | 9.5 | 9.1 | 7.6 |
| 51 | 200 | 8.0 | 7.8 | 7.8 |
| 51A | 180 | 8.0 | 7.8 | 7.8 |
| 52 | 200 | 8.0 | 7.5 | 7.3 |
| 53 | (blank) | | | |

DFT 50N and 50S are two faces of one basin; 50N's listed length is 370 m.
The operator's published container berthage is 480 m, which does not equal
50A+50N+50S added naively. The planner uses official per-berth lengths and
notes the 480 m figure.

### Tides — Dublin Port Tide Tables 2026 (North Wall)

Predictions computed with Poltips-4 at the National Oceanography Centre.
Datum is Chart Datum. Semi-diurnal (two high and two low waters per day).
High water on Dublin Bar is 0.06 m lower and low water 0.06 m higher than
North Wall; times are not appreciably different.

Published levels (metres above CD):

- HAT 4.50
- MHWS 4.10
- MHWN 3.40
- MSL 2.41
- MLWN 1.50
- MLWS 0.70
- LAT −0.10

### Regular vessels (public fleet data, not a dated call list)

- Irish Ferries **Ulysses**: 209 m / 31.2 m / draught 6.4 m, Dublin–Holyhead
  (Irish Ferry Enthusiasts fleet list; Ship Technology).
- Irish Ferries **W.B. Yeats**: 194.8 m / 31.6 m / draught 6.7 m
  (Irish Ferries welcome-aboard deck plan).
- Stena **Stena Estrid**: 215 m × 28 m, Dublin–Holyhead (Stena Line).
- Stena **Stena Adventurer**: 210.8 m × 29.3 m, draught 6.3 m (Stena Line).
- Harbour Master (2026): Dublin–Liverpool ferries currently about 195 m LOA.

## Assumptions (not verified as current operational truth)

Listed in the README as well.

- Planning grid of **40 m sections** on long LoLo quays (the Barcelona
  environment uses about 42 m). Remainder metres on a berth are unused.
- Illustrative weekly call lists and ferry slot times, not official
  Dublin Port or operator schedules.
- Synthetic feeder, tanker, bulk and cruise names (no IMO numbers).
- Crane productivity on DFT: **25 container moves per crane-hour**
  (assumed; Barcelona's model used 28). MTL treated similarly where a
  crane pool is used; MTL's current crane count was not verified, so
  the Poolbeg scenario **does not** enforce a crane-pool rule unless
  noted, or uses a clearly assumed pool of 3.
- RoRo passenger-ferry handling time **2 hours**, freight RoRo **6 hours**,
  unless a scenario notice says otherwise.
- Semi-diurnal tide in the simulator is a harmonic curve anchored at
  official MSL / MHWS / MLWS, period 12.42 h, with a spring–neap
  modulation between official spring and neap ranges. It is not the
  official daily prediction for a named date.
- A ship may transit a reach only when `survey_depth + tide − 1.0 m UKC ≥ draught`,
  and may lie alongside only when `survey_depth + tide − 0.5 m UKC ≥ draught`.
  Approach-depth tidal windows use the official approach depth for that berth.
- Channel used for inbound/outbound traffic in the model is the
  "VTS to corner berth OB1" survey depth of 9.0 m (plus tide). Inner
  reaches use the shallower official figures when the berth is west of OB1.
- Berth 52 is treated as limited/available at the 2025 notice depths;
  berth 53 is treated as closed for MP2 works.
- Ferry operator-to-berth assignments follow the planning-report table
  (Irish Ferries 49 & 51A, Stena 51, Alexandra jetty 26/27 for the
  Liverpool service). Operators can change; this is a snapshot.
- Best-known plan costs in the web app come from a heuristic search
  (greedy + local improvement), not a proven CP-SAT optimum. The reward
  formula is the same, but the "optimum" is a best-known feasible cost.

## Deployment plan

Port the interactive planner to a static web app (HTML/CSS/JS) on Vercel.
Keep a Python package in-repo with the same task schema, checks, and
reward. Do not require the original 3D Barcelona twin or Docker Space
runtime to try a Dublin episode.
