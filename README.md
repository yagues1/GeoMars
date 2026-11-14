# GeoMars V1.0

Terrain-aware navigation for **Jezero Crater, Mars** — a Google-Maps-like web app built on real NASA / USGS data.
Open the app, watch Mars rotate and the camera descend onto Jezero, pick an origin and a destination, compute an
optimised route for a crewed exploration vehicle over the real CTX elevation model, and follow it in a simulated
astronaut-navigation view.

> Built for the NASA Space Apps Challenge. Routes are **estimates for exploration planning and education**, not
> astronaut-grade or safety-certified traverse plans.

## Run locally

Requirements: Node.js ≥ 20 (tested with 22.15).

```bash
npm install
npm run dev
```

Open **http://localhost:5180**. Production build: `npm run build && npm run preview` → http://localhost:4173.
Unit tests (routing engine): `npm test`.

All map tiles, elevation grids and vectors are already in `public/data/` — no network access to NASA services is
needed at runtime.

## What works

| Area | Implemented |
|---|---|
| Intro | Mars globe (Viking colour mosaic) rotates, cinematic fly-down onto Jezero, seamless hand-off to the local map (skippable; honours reduced-motion). |
| Map | MapLibre GL JS: pan, wheel/pinch zoom, rotate/tilt (right-drag / two-finger), keyboard, touch. |
| Styles | **Satellite** (CTX 5 m orthomosaic over Viking colour), **Topographic** (hypsometric tint + hillshade from CTX DEM/MOLA + 100 m contours), **Hybrid** (orthomosaic + DEM hillshade). |
| 2D / 3D | 3D terrain from the CTX DEM (20 m) inside the crater region and MOLA (463 m) beyond. "True scale" or "Relief ×2" (visual only). |
| Modes | **Mission Planning** (Explore / Route tools) and **Astronaut Navigation**, sharing one state (route, terrain, camera). |
| Explore | Click → card with elevation (observed), slope (derived), USGS geologic unit, THEMIS night-IR brightness, nearest site; discreet "no data" notices. |
| Route | Click origin, click destination, *Calculate route* → A* on the DEM-derived graph in a Web Worker; distance + time; details (energy, ascent, max slope, search stats); Clear route. |
| Navigation | Directional arrow following the computed geometry, tilted follow camera with smoothed bearing, remaining distance/time, progress bar, contextual instructions (turns, steep stretches, arrival), Start / Pause / Resume / Restart, return to planning. |
| Arrival | Orbiting arrival shot, pulse marker, destination card (site description, sampling interest), *Plan next route from here*. |
| Layers | Slope, contours, geologic units, scientific sites, THEMIS night/day IR, hazard zones, Perseverance traverse, routing coverage, landing ellipse; automatic transparency when overlays are combined. CRISM minerals and MEDA weather are listed as **unavailable** (not integrated). |
| Search | Site names, sample names (e.g. "Sapphire Canyon") and coordinates (`18.45, 77.40`, `18.45N 77.40E`, `282.6W`). |
| Data & sources | Modal with provenance (source, product, instrument, date, resolution, coverage, status, limitations) for every dataset. |

## Scientific data

All coordinates: **Mars 2000 sphere, R = 3,396,190 m, planetocentric latitude, east-positive longitude (−180…180)** —
read from each product's GeoTIFF WKT / GIS projection files.

| Dataset | Source / product | Resolution | Coverage | Date | Status | Role |
|---|---|---|---|---|---|---|
| CTX orthomosaic | USGS Astrogeology — *Mars 2020 Science Investigation* `M20_JezeroCrater_CTXortho_mosaic_5m.tif` (MRO CTX) | 5 m/px | 77.00–78.58° E, 17.58–19.29° N | pub. 2021-10-14 | observed | Satellite / hybrid basemap |
| CTX DEM mosaic | USGS — `M20_JezeroCrater_CTXDEM_20m.tif` (CTX stereo, Ames Stereo Pipeline, tied to MOLA) | 20 m/px | 76.997–78.583° E, 17.581–19.290° N | pub. 2021-10-14 | observed | Routing, 3D, elevation, topo |
| Slope / hazard / routing grid / contours | Derived by `scripts/prepare_data.py` from the CTX DEM | 20 m (slope), 40 m (routing) | CTX DEM footprint | — | derived | Hazard zones, slope layer, routing |
| MOLA DEM (window) | USGS — `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`, window 64–91° E, 5–32° N | 463 m/px | regional | MGS 1997–2001 | observed | 3D & topo context outside CTX (never routing) |
| Viking MDIM 2.1 colour | NASA Mars Trek WMTS `Mars_Viking_MDIM21_ClrMosaic_global_232m` | ~2.6 km (global), ~326 m (regional) as downloaded | global | Viking 1976–80 | observed | Globe intro, regional colour |
| MOLA colour shaded relief | NASA Mars Trek WMTS `Mars_MGS_MOLA_ClrShade_merge_global_463m` | ~2.6 km as downloaded | global | MGS | derived | Globe in Topographic style |
| Geologic map | USGS SIM 3464 (Sun & Stack 2020), GIS database `GeoUnits_v1`, `LandingEllipse`, `MapBoundary` | 1:75,000 | Jezero + Nili Planum | 2020 | observed (interpretive map) | Geology layer & inspection |
| THEMIS IR controlled mosaics | Distributed with SIM 3464 (`nili_THEMIS_{Day,Night}IR_Controlled_oct2018.tif`) | 100 m/px | 76.8–77.8° E, 17.7–18.7° N | Oct 2018 | observed (8-bit stretched, uncalibrated) | Thermophysical context layer |
| Perseverance traverse & waypoints | NASA/JPL MMGIS `M20_traverse.json`, `M20_waypoints.json` | rover-scale | rover path, sols 13–2022 | 2021–2026 | observed | Traverse layer, sample-site positions |
| Rock-sample table | NASA Science *Mars Rock Samples* | — | sample sites | sols 164–1441 | observed | Scientific destinations |
| IAU feature centres | USGS Gazetteer of Planetary Nomenclature (Jezero, Neretva Vallis, Sava Vallis) | — | — | — | observed | Landmarks / search |

Sample-site markers are placed at the **rover waypoint of the sol on which the sample was sealed** (last MMGIS waypoint
at or before that sol) — rover-scale approximate, stated in each card.

Validation: the CTX DEM gives −2567.4 m at the first Perseverance waypoint, which the rover file lists at −2569.9 m
(Δ = 2.5 m).

## Decision #68 — where routing is supported

* **Visual exploration:** whole planet (Viking/MOLA) and full detail over the Jezero CTX footprint.
* **Routing:** only inside the **CTX DEM footprint** (≈ 77.0–78.6° E, 17.6–19.3° N; ~89 × 101 km), the only product with
  a resolution adequate for vehicle-scale slopes. MOLA (463 m) is never used for routing.
* Inside the footprint, cells without DEM data (13,977 px, 0.06 %), a 2-cell frame at the DEM edge, and cells steeper
  than the vehicle limit are **not graph nodes**. Cells within 2 cells of a data gap are flagged *lower confidence* and
  penalised. Clicking outside the footprint returns *"outside the CTX elevation model"* — no route is fabricated.
* Higher-resolution HiRISE DTMs (1 m) exist for parts of the crater floor but were not integrated in V1.0, so slopes
  are representative at ~40–60 m scale; boulders, small scarps and ripples are not resolved.

## Routing model

* **Graph:** 2,228 × 2,533 grid of 40 m cells (2×2 aggregation of the 20 m DEM). Cell slope = *maximum* of the 20 m
  central-difference slopes inside the cell (conservative), east–west spacing corrected per row for the
  equirectangular projection. 8-connected; diagonal moves require both orthogonal neighbours to be traversable.
* **Hard constraints (edge removal, not penalty):** no-data cells; slope > `maxSlopeDeg` (20°, estimated).
* **Cost (equivalent seconds, non-negative):** `t + 0.3·E[Wh] + t·1.5·caution + t·0.75·lowConfidence`
  with `t = L3D / (v_nom · speedFactor(slope))`, `speedFactor = max(0.35, 1 − 0.65·(s/20°)^1.5)`,
  `E = m·g·(Crr·cosθ + sinθ)⁺·L/η` (no regenerative braking credited), caution scaling linearly over 15–20°.
* **Algorithm:** A* with heuristic `straight-line distance (minimum cell spacing) / v_nom` — admissible and
  consistent, verified against Dijkstra in `tests/routing.test.ts`. Deterministic (ties broken by node index).
  Runs in a Web Worker (typed arrays, binary heap): typical crater-floor routes 50–150 ms; a 124 km corner-to-corner
  route ≈ 10 s.
* **Post-processing:** line-of-sight simplification that never crosses excluded or lower-confidence cells and never
  accepts a steeper cell than the optimiser itself chose on that stretch; distance, time and energy are then
  re-measured on the **final displayed geometry** (3D surface length on the Mars sphere).
* **Failure handling:** endpoints on steep ground snap to safe observed terrain within 120 m (reported); otherwise
  the engine explains *outside coverage*, *DEM gap*, *too steep*, *blocked by slopes* or *blocked by data gaps* (a
  diagnostic reachability check, never shown as a route).
* **Vehicle model (ESTIMATED — not a real vehicle specification):** 10 km/h nominal, 3000 kg, rolling resistance 0.15,
  drivetrain efficiency 0.75, slope limit 20° (conservative, below the 25° quoted for the Apollo LRV), caution 15°,
  Mars g = 3.71 m/s² (NASA fact sheet). Configured in `src/routing/vehicle.ts`.
* **Navigation simulation:** progress is driven by simulated vehicle time along the route's per-segment estimated
  speeds (×60 time warp), so distance travelled — not animation frames — defines position.

## Architecture

```
scripts/            Python (rasterio/GDAL 3.12, pyproj, geopandas) data pipeline + Mars Trek fetcher + POI builder
public/data/        tiles/{globe,globe_mola,ortho,topo,terrain,slope,hazard,themis_*}/z/x/y, grids/, vector/
src/config          planetary constants (verified radius, bounds)
src/geo             Mars-sphere distance/bearing, coordinate parsing & formatting
src/data            dataset provenance, geologic unit catalogue + point-in-polygon, loaders
src/routing         vehicle model, A* engine (pure, tested), Web Worker + client
src/navigation      simulator (time → position along route), controller (arrow, follow camera, arrival)
src/map             MapLibre style (local sources only), MapView (intro, layers, interactions), markers
src/state           zustand store + actions
src/ui              panels, navigation HUD, layers menu, search, data & sources modal, icons/brand
tests/              routing tests (wall with gap, no-data barrier, A* = Dijkstra, determinism, coverage)
```

**Map engine choice:** MapLibre GL JS 5 — one renderer gives the globe projection (intro), 2D raster maps, 3D
`raster-dem` terrain, hillshade, pitch/bearing camera and touch gestures, with local tiles. The Web-Mercator *tiling
scheme* is applied to Mars lon/lat purely for display; every physical quantity uses the Mars sphere. Because MapLibre
scales heights with the Earth radius, terrain exaggeration `R_earth/R_mars = 1.878` renders relief at true Mars
proportion ("True scale").

## Reproducing the data

Raw products are not committed (≈ 1 GB). To rebuild `public/data/`:

```bash
python -m venv .venv-geo
.venv-geo/Scripts/python -m pip install rasterio numpy pillow pyproj scipy pyogrio geopandas shapely matplotlib
```

Download into `data/raw/`: the two USGS Jezero CTX GeoTIFFs (links on the USGS product page), `sim3464_database.zip`
(unzip to `data/raw/sim3464/`), `M20_traverse.json` and `M20_waypoints.json` from NASA MMGIS; extract the MOLA window
and Trek mosaics (see `scripts/fetch_trek_global.py` docstring), then:

```bash
.venv-geo/Scripts/python -I scripts/prepare_data.py
.venv-geo/Scripts/python -I scripts/build_pois.py
```

## Known limitations

* Routing slopes come from a 20 m DEM: obstacles below ~40–60 m (rocks, small scarps, sand ripples) are invisible;
  stereo noise can inflate local slopes. HiRISE 1 m DTMs are not integrated.
* Vehicle parameters, travel time and energy are estimates of a hypothetical vehicle.
* No calibrated thermal values: THEMIS layers are 8-bit stretched brightness (relative).
* Not integrated in V1.0: CRISM mineral maps, MEDA historical weather (shown as unavailable).
* SIM 3464 geology was drawn on a semi-controlled mosaic: ~100–200 m offsets relative to the CTX orthomosaic are possible.
* Very long routes (> ~80 km) can take several seconds to compute.
* Desktop and tablet are supported; phones work but are not a design target.

## Credits

NASA/JPL-Caltech, USGS Astrogeology Science Center, MSSS (CTX), ASU (THEMIS), NASA Solar System Treks.
Sun, V., and Stack, K., 2020, USGS SIM 3464, https://doi.org/10.3133/sim3464. Mangold et al. 2021, *Science*,
https://doi.org/10.1126/science.abl4051. Fergason et al. 2020 (Mars 2020 TRN products). GeoMars branding and code are original.
