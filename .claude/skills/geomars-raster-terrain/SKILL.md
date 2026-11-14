---
name: geomars-raster-terrain
description: Use when inspecting, checking, or preparing raster and elevation data for GeoMars (DEMs, orthoimages, HiRISE/CTX/MOLA rasters), deriving slope or aspect, checking CRS and pixel size on a planetary body, or choosing GDAL/rasterio workflows for tiling and cloud-optimized outputs. Symptoms include "wrong slope values", "CRS is missing", "raster does not align", "how do I make the terrain tiles".
---

# GeoMars Raster and Terrain Workflows

## Overview

Planetary rasters are often georeferenced to a Mars sphere, not an Earth datum. Most wrong results (slopes off by a large factor, misaligned overlays, bogus areas) come from skipping inspection. Inspect first, then transform, then validate.

**Core principle:** Read the raster's metadata before writing any transform.

## Step 1: Inspect before anything else

Use the tools already available on the machine. Do not install packages during preparation.

```bash
gdalinfo -stats <input.tif>
```

Check and record:

- Size, band count, data type
- Pixel size (x and y) and its units
- CRS: is it missing, a Mars sphere, or a projected system?
- No-data value and whether it is set
- Geotransform origin and extent
- Overviews and block layout

If `gdalinfo` is not installed, report that and stop. Do not install GDAL without user approval.

## Step 2: CRS and units

- Mars products often use an IAU Mars sphere. PROJ references may appear as `IAU_2015` codes; verify the exact code with `projinfo` before using it.
- Pixel size must be in meters for slope calculations. If the raster is in degrees, convert before computing slope, or the slope is wrong.
- Never reproject with an assumed Earth datum. If the CRS is missing, label the raster `unknown CRS` and stop until the source label is checked.

## Step 3: Derive terrain with explicit parameters

Compute slope and aspect from the DEM in meters, with the pixel size passed explicitly:

```bash
gdaldem slope -compute_edges -s 1.0 -of GTiff dem.tif slope.tif
gdaldem aspect -compute_edges dem.tif aspect.tif
```

Notes:

- `-s` is the vertical-to-horizontal scale factor. Set it to 1.0 only when both axes are in the same units. Record the value used.
- Use `-compute_edges` so border cells are not blank, or mask them explicitly.
- Keep the no-data value consistent through the chain. Verify with `gdalinfo -stats`.
- Record every derivation as `derived` with its input product, tool, and parameters.

## Step 4: Outputs

- Write derived products to the project data folder only, never outside the working directory.
- For web use, produce Cloud Optimized GeoTIFFs with tiling and overviews:

```bash
gdal_translate -of COG -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BLOCKSIZE=512 in.tif out_cog.tif
```

- Validate after writing: `gdalinfo out_cog.tif` shows the expected CRS, extent, pixel size, and no-data value.
- Compare the output extent with the input extent. A shift means the transform went wrong.

## Step 5: Visual and numeric checks

- Spot-check at least three known locations: a flat area should give near-zero slope, a ramp should give the expected gradient.
- Check that min and max values are physically plausible for the body. Implausible values usually mean a unit or no-data error.
- Confirm the alignment of two layers by overlaying a fixed control point, not by eye.

## Mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| Pixel size in degrees used for slope | Slopes far too low or high | Reproject or convert to meters first |
| CRS assumed to be Earth WGS84 | Shifted or scaled overlays | Read the product label, use the Mars sphere |
| No-data not declared | Edge values treated as elevation | Set and verify no-data |
| Output written outside the project | Violates project boundary | Write inside the project data folder |
| Installing GDAL or Python packages to finish the task | Violates preparation scope | Report the missing tool instead |

## Quick reference

| Task | Command |
|---|---|
| Inspect | `gdalinfo -stats file.tif` |
| CRS details | `gdalinfo file.tif` then `projinfo` on the WKT |
| Slope | `gdaldem slope -compute_edges -s 1.0 dem.tif slope.tif` |
| Aspect | `gdaldem aspect -compute_edges dem.tif aspect.tif` |
| COG output | `gdal_translate -of COG -co COMPRESS=DEFLATE in.tif out.tif` |
| Validate COG | `gdalinfo out.tif` (check LAYOUT=COG and overviews) |

## Checklist

- [ ] Metadata inspected and recorded
- [ ] CRS confirmed as a Mars sphere or projected system
- [ ] Pixel size in meters
- [ ] No-data declared and preserved
- [ ] Parameters recorded with `derived` status
- [ ] Output inside the project folder
- [ ] Spot checks and extent comparison done
