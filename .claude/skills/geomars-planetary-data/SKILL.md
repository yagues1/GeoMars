---
name: geomars-planetary-data
description: Use when handling NASA or USGS Mars data for GeoMars (Jezero Crater, HiRISE, CTX, THEMIS, CRISM, MOLA, Perseverance, MEDA, Mastcam-Z, Navcam), labeling scientific values, dealing with missing coverage, planetocentric coordinates, dataset dates, provenance, or separating observations from physical estimates. Symptoms include "is this observed or estimated", "where does this value come from", "no data for this area".
---

# GeoMars Planetary Data Rules

## Overview

GeoMars is a functional prototype. Every value shown to the user must be traceable to a source, dated, and labeled by its epistemic status. Missing coverage is never filled in, interpolated silently, or presented as observed.

**Core principle:** A value without provenance, date, and status is not allowed in the UI or in the data layer.

## Status labels (use exactly these)

| Label | Meaning | Example |
|---|---|---|
| `observed` | Measured by an instrument or rover, with source and date | MOLA elevation, HiRISE image |
| `derived` | Computed from observed data by a documented method | Slope from a DEM |
| `estimated` | Model or assumption, not measured | Vehicle energy use, travel time |
| `unavailable` | No sufficient data for this area or property | Outside DEM coverage |

Never mix labels inside one value. A derived value keeps the label of its inputs plus `derived`.

## Provenance record

Every dataset or value carries at least:

- `source` (agency, archive, or mission)
- `product` (dataset ID or PDS product identifier)
- `instrument` and `mission`
- `observation_date` (acquisition date, not download date)
- `resolution` (ground sample distance or grid spacing, in meters)
- `coverage` (the region the data actually covers)
- `known_limitations` (text, shown to the user when relevant)
- `status` (one of the four labels above)

If a field is unknown, record `unknown`. Do not guess.

## Authoritative sources

Confirm each product's details in its own label or documentation. Primary entry points:

- NASA Mars Trek: https://trek.nasa.gov/
- USGS Astrogeology: https://astrogeology.usgs.gov/
- NASA Planetary Data System: https://pds.nasa.gov/

Do not treat a secondary blog, aggregator, or AI-generated summary as a provenance source.

## Coordinates and reference frames

- Confirm the body reference (IAU Mars) and the radius used by each dataset from its label. The IAU 2015 mean radius of Mars is commonly cited as 3396.19 km; verify it against the product label before relying on it.
- Keep **planetocentric** and **planetographic** latitudes distinct. Planetographic latitude is what many map tools display. Never mix them silently.
- Confirm the longitude convention (east-positive or west-positive, and range 0-360 or -180 to 180) per dataset.
- Store coordinates with their frame and convention. A coordinate without its frame is invalid.
- The Jezero Crater center coordinates must be verified against a NASA or USGS source before use. Do not hard-code values from memory.

## Dates

- Show the observation date next to every historical observation.
- Mission data are not "current". Phrase them as "observed on YYYY-MM-DD" or "from mission archive".
- Atmospheric and weather data (MEDA, historical records) must always show the time range.

## Missing coverage

- If a location is outside a dataset's footprint, the value is `unavailable`. Show a discreet notice in the UI. Never fill the gap with a neighbouring value.
- A nearby observation may be shown only when it is labeled as nearby and includes its distance.
- Do not decide route-eligibility here. Coverage thresholds for route computation belong to open research decision #68 and must stay unresolved until Opus evaluates the data.

## Remote sensing versus in-situ measurement

- Orbital observations (HiRISE, CTX, THEMIS, CRISM, MOLA) describe surfaces at their resolution. They do not describe a specific rock or a specific square meter.
- Rover measurements (Perseverance instruments, MEDA, Mastcam-Z, Navcam) are local to the rover's position and time.
- Never present an orbital value as a rover measurement, or the reverse.

## Scientific claims

- Do not write interpretive claims (age of a formation, presence of water at a location, habitability) without a cited source and a stated level of confidence.
- Destination descriptions must be brief, English, and attributable. Prefer "the crater floor shows layered sediment deposits in [source]" over unqualified statements.
- Sampling is suggested, never simulated, and no persistent sample inventory is implied.

## Physical estimates

- Vehicle parameters (mass, speed, battery, slope limit) are configurable estimates. Label them `estimated` and state that they are not published vehicle specifications.
- Never mix estimated parameters with observed terrain values in one displayed number.

## Process rules

- Do not download NASA or USGS datasets during preparation or design phases unless the user explicitly asks. Record the candidate product and its URL instead.
- Do not run unverified scripts from downloaded archives.
- Keep derived files and downloaded products inside the project data directory only.

## Quick checklist

- [ ] Status label set (`observed`, `derived`, `estimated`, `unavailable`)
- [ ] Source, product, instrument, date, resolution, coverage, limitations recorded
- [ ] Coordinate frame and longitude convention stated
- [ ] Missing coverage shown as `unavailable`, not filled
- [ ] Orbital and rover data not conflated
- [ ] No scientific claim without citation and confidence
