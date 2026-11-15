# GeoMars V1.0

Exploring Mars demands far more than a static map: astronauts and mission planners must weigh terrain hazards, scientific targets, and environmental constraints scattered across multiple planetary missions. **GeoMars V1.0** addresses this challenge as a two-part system for **Jezero Crater**: an offline-first, terrain-aware navigation web application built on real NASA and USGS observations, paired with an ergonomic rugged tablet concept designed for crewed surface operations.

## Interactive Visualization & Scientific Data Integration

Built with MapLibre GL JS, the application opens with a rotating 3D Mars globe (Viking color mosaic) that flies smoothly down into Jezero Crater. All map tiles, elevation grids, and vector layers are stored locally so the entire platform operates offline without network access. Users can switch seamlessly between 2D and 3D terrain—scaled to true Martian planetary proportions (**R = 3,396,190 m**)—across **Satellite**, **Topographic** (hypsometric tinting, hillshade, and 100 m contours), and **Hybrid** styles.

Rather than relying on synthetic terrain, GeoMars integrates curated planetary datasets with full source provenance:

- **Topography & Imagery:** 5 m/px CTX orthomosaics and 20 m/px CTX stereo elevation models inside Jezero Crater, framed by regional 463 m/px MOLA topography.

- **Geology & Thermophysics:** USGS SIM 3464 geological unit maps and landing ellipses, alongside 100 m/px THEMIS day and night infrared mosaics.

- **Surface Mission Context:** *Perseverance* rover traverse paths, waypoints, and sealed rock-sample sites (such as *Sapphire Canyon*), searchable by site name, sample name, or Martian coordinates.

## Terrain-Aware Routing & Simulated EVA Navigation

GeoMars operates in two synchronized modes. In **Mission Planning**, users can click anywhere to inspect local elevation, derived slope, geological unit, THEMIS infrared brightness, and the nearest scientific site, or select an origin and destination within the CTX elevation footprint to compute an optimized traverse.

Pathfinding runs asynchronously in a Web Worker using a deterministic A* algorithm over a 40 m grid aggregated from the 20 m DEM. The engine enforces strict physical safety boundaries—removing DEM data gaps and slopes exceeding 20° from the graph—while minimizing a physical cost function that combines slope-adjusted travel time, estimated vehicle energy consumption, caution penalties for 15°–20° inclines, and buffer zones around missing data. Once a route is calculated, **Astronaut Navigation** mode simulates the traverse with a tilted follow camera, directional marker, remaining distance and time metrics, contextual turn and slope alerts, and an orbiting arrival view displaying destination sampling notes.

## Ergonomic Hardware & Spacesuit Integration Concept

To bridge the gap between mission software and field usability, the team designed a conceptual rugged tablet engineered around human factors for bulky pressurized gloves (informed by NASA's Z-2 spacesuit context). The hardware supports two operational modes: **Mode A**, secured inside a pressurized rover via a positive mechanical latch, and **Mode B**, carried by hand or docked to the astronaut's thigh during extravehicular activities (EVAs).

Key mechanical and material design choices include:

- **Dust-Aware Unibody & Grip:** A CNC-machined 6061-T651 aluminum enclosure minimizes seams, paired with a raised, shallow-contoured rear grip in SSP2575 silicone elastomer that improves gloved retention without creating deep traps for abrasive Martian regolith.

- **Protected Optical Stack & Active Stylus:** An aluminosilicate cover glass coated with diamond-like carbon (DLC) and SiO₂/TiO₂ anti-reflective layers, bonded with compliant silicone RTV. Input is supported by an oversized active stylus with a replaceable tip and a braided Vectran tether to prevent loss.

- **Suit Docking & Wireless Power:** Samarium-cobalt (Sm₂Co₁₇) magnets align the tablet with a thigh-mounted suit dock—backed up by a secondary mechanical restraint—to enable copper-and-ferrite inductive charging while thermally isolating charging losses away from the spacesuit.

## Source Data Provenance

All planetary datasets are openly sourced with full attribution:

| Dataset | Resolution | Provider | Type |
|---------|------------|----------|------|
| CTX Orthomosaic | 5 m/px | USGS Astrogeology / MRO | Observed |
| CTX DEM | 20 m/px | USGS Astrogeology / MRO | Observed |
| THEMIS Day IR | 100 m/px | USGS SIM 3464 | Observed |
| THEMIS Night IR | 100 m/px | USGS SIM 3464 | Observed |
| MOLA Regional DEM | 463 m/px | NASA MGS | Observed |
| SWIM Ice Consistency | ~5 m sensing | PSI / JPL | Estimated |
| MAG/ER Magnetization | 1° × 1° | NASA GSFC | Observed |

Full data sources, DOIs, and citations are documented in `/data/raw/manifest.json` and referenced throughout the codebase.

## Documentation & Technical Reports

Comprehensive engineering documentation is available in the `/docs/` directory (root of project):

- **Core Architecture:** `IMPLEMENTATION_SUMMARY.md`, `ROUTING_IMPLEMENTATION.md`, `CRS_PROJECTIONS.md`
- **Data Pipeline:** `DATA_PIPELINE.md`, `EVA_GENERATION.md`, `THEMIS_INTEGRATION.md`
- **Diagnosis & Debugging:** `DIAGNOSTIC_REPORTS/` (routing issues, grid coverage analysis)
- **Engineering Transparency:** Full scope, design decisions, and known limitations

The complete technical documentation spans **over 40 pages** covering data processing workflows, routing algorithms, coordinate reference systems, EVA simulation logic, and integration with planetary datasets. See `DOCUMENTATION_INDEX.md` in the root directory for a structured overview of all technical documents.

## Physical Screen Design (SolidWorks Models)

The ergonomic tablet design includes complete CAD models available in `/physical_screen_design/`:

- **Main Tablet Body:** Full assembly with aluminum unibody, grip contours, and mounting points
- **Thigh Dock Assembly:** Magnetic coupling mechanism with mechanical backup restraint
- **Stylus Design:** Oversized active stylus with Vectran tether attachment
- **Exploded Views:** All assemblies with bill of materials and dimensional annotations

These SolidWorks files support prototyping, manufacturing preparation, and human-factors verification. See `physical_screen_design/README.md` for model versions, file structures, and assembly instructions.

## Getting Started

### Development Setup

```bash
# Install dependencies
npm install

# Start development server (http://localhost:5180)
npm run dev

# Production build
npm run build && npm run preview → http://localhost:4173
```

### Data Pipeline

The application requires preprocessed planetary datasets in `/public/data/`. To regenerate grids from raw NASA/USGS sources:

```bash
.venv-geo/Scripts/python scripts/prepare_data.py  # Full pipeline: ortho, terrain, topo, slope, themis, routing, eva
```

Raw data is stored in `/data/raw/` (gitignored). All source files include download URLs and checksums for provenance tracking.

## Current State & Known Limitations

GeoMars V1.0 serves as a functional offline prototype with transparent documentation of coverage boundaries:

- ✅ **Offline-first operation:** All tiles and grids cached locally
- ✅ **Real planetary data:** No synthetic terrain generation
- ✅ **Deterministic routing:** A* pathfinding with physical cost functions
- ✅ **Multi-layer visualization:** Satellite, topographic, geologic, and mission context layers
- ⚠️ **Unintegrated datasets:** CRISM mineralogy and MEDA weather data documented but not yet integrated
- ⚠️ **Estimated parameters:** Vehicle energy consumption and surface roughness use best-available proxies where direct observations are unavailable
- ⚠️ **Hardware concept:** CAD models require environmental testing and human-factors validation before flight qualification

## Contributing & Citation

This project demonstrates how open planetary datasets and human-centered industrial design converge into practical exploration tools. For academic citation:

- **Software:** Cite GeoMars V1.0 with reference to source data providers (USGS, NASA GSFC, PDS Atmospheres)
- **Design:** Refer to physical design documentation in `/physical_screen_design/docs/` and human-factors rationale in `/docs/HUMAN_FACTORS.md`

## License

GeoMars branding and code are original. All planetary data remains under respective provider licenses (typically public domain or CC-BY).

---

**NASA/JPL-Caltech, USGS Astrogeology Science Center, MSSS (CTX), ASU (THEMIS), NASA Solar System Treks.**
