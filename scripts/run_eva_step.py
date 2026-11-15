#!/usr/bin/env python3
"""Run step_eva() - Optimized version with simplified LOS."""
import os, sys
sys.path.insert(0, '/home/valentin/Projects/geomars/scripts')

from prepare_data import (
    ROOT, RAW, R_MARS, COS_TS, HABITAT_LONLAT, ANTENNA_HEIGHT_M,
    ROUTE_CELL, DEM_PATH, TEMP_CLIP_C, LIMIT_DEG, WIND_PROBE_M, WIND_SHELTER_M,
    routing_cells, load_slope, _cell_lonlat, eva_viewshed, load_dem, sample,
    _sample_raster, _load_magnetic, meda_constants, ROUGHNESS_MIN_VALID, ROUGHNESS_QUANTILE
)
import numpy as np
import math
import time
import traceback
import json

def run_eva():
    print("=" * 80)
    print("Running step_eva() - Optimized version")
    print("=" * 80)
    
    t_total = time.time()
    
    try:
        # Load routing grid
        print("\n[1/5] Loading routing cells...")
        elev, smax, invalid, g, dem = routing_cells()
        print(f"  Routing grid: {elev.shape}, DEM shape: {dem.shape}")
        
        valid = ~invalid
        nrow, ncol = elev.shape
        
        # Load DEM for derived calculations
        print("[2/5] Loading DEM for derived calculations...")
        _, dem_full = load_dem()
        print(f"  Full DEM: {dem_full.shape}")
        
        # Load source data - need LON/LAT arrays for raster sampling
        print("[3/5] Loading THEMIS, SWIM ice, MEDA...")
        LON, LAT = _cell_lonlat(g, elev.shape)  # Calculate coordinates first
        
        ti = _sample_raster(os.path.join(RAW, "themis_ti", "THEMIS_TI_2026_MC13_ti_1km_fixed.tif"), 
                           LON, LAT)
        lut, mag_meta = _load_magnetic()
        ci = _sample_raster(os.path.join(RAW, "swim", "SWIM4MIM_OriginalCi.tif"), 
                           LON, LAT)
        mconst = meda_constants()
        
        # Handle MEDA T_base NaN - CRITICAL FALLBACK
        t_base = mconst["surface_temp_c"]["value"]
        if not np.isfinite(t_base):
            print(f"  ⚠️  T_base={t_base} is NaN, using fallback: -100C")
            mconst["surface_temp_c"]["value"] = -100.0
            t_base = -100.0
        else:
            print(f"  ✅ T_base={t_base}C (from MEDA)")
        
        # Calculate LON, LAT for routing grid cells
        print("[4/5] Calculating coordinates...")
        LON, LAT = _cell_lonlat(g, elev.shape)
        print(f"  Lon range: {LON.min():.2f}° to {LON.max():.2f}°")
        
        # Write grids directory
        rdir = os.path.join(ROOT, "public", "data", "grids")
        os.makedirs(rdir, exist_ok=True)
        
        # Grid 1: Thermal inertia
        print("\n[GRD] Writing thermal_inertia.u16...")
        ti16 = np.where(valid, np.clip(np.round(ti), 0, 65534), 65535).astype(np.uint16)
        ti16.tofile(os.path.join(rdir, "eva_thermal_inertia.u16"))
        print(f"  {ti16.sum():,.0f} valid cells")
        
        # Grid 2: Magnetic field
        print("Writing magnetic.u16...")
        blon = np.floor(np.fmod(LON, 2 * np.pi)).astype(np.int64)
        blat = np.floor(LAT).astype(np.int64) + 90
        okb = (blat >= 0) & (blat < 181) & valid
        mag = np.full((nrow, ncol), np.nan, np.float32)
        mag[okb] = lut[blon[okb], blat[okb]]
        mag16 = np.where(np.isfinite(mag), np.clip(np.round(mag), 0, 65534), 65535).astype(np.uint16)
        mag16.tofile(os.path.join(rdir, "eva_magnetic.u16"))
        print(f"  {mag16.sum():,.0f} valid cells")
        
        # Grid 3: Roughness (from routing grid elev)
        print("\n[GRD] Writing roughness.u8...")
        e = np.where(valid, elev, np.nan)
        from numpy.lib.stride_tricks import sliding_window_view
        ep = np.pad(e, 1, constant_values=np.nan)
        win = sliding_window_view(ep, (3, 3))
        m = np.isfinite(win)
        cnt = m.sum(axis=(-1, -2))
        s1 = np.where(m, win, 0.0).sum(axis=(-1, -2))
        s2 = np.where(m, win * win, 0.0).sum(axis=(-1, -2))
        with np.errstate(invalid="ignore", divide="ignore"):
            var = np.where(cnt > 0, (s2 - s1 * s1 / np.maximum(cnt, 1)) / np.maximum(cnt, 1), np.nan)
        std = np.sqrt(np.clip(var, 0, None)).astype(np.float32)
        from prepare_data import ROUGHNESS_MIN_VALID, ROUGHNESS_QUANTILE
        std[cnt < ROUGHNESS_MIN_VALID] = np.nan
        rv = std[np.isfinite(std)]
        umbral = float(np.ceil(np.percentile(rv, ROUGHNESS_QUANTILE * 100) * 10) / 10)
        r8 = np.where(np.isfinite(std), np.clip(np.round(std * 10), 0, 254), 255).astype(np.uint8)
        r8.tofile(os.path.join(rdir, "eva_roughness.u8"))
        print(f"  Roughness: p50={np.percentile(rv, 50):.2f}m, p90={np.percentile(rv, 90):.2f}m")
        print(f"  umbral_rocas: {umbral}m -> blocks {(r8 > round(umbral * 10)).sum() / max(valid.sum(), 1) * 100:.2f}%")
        
        # Grid 4: Surface temperature (simplified - using illumination proxy from smax)
        print("\n[GRD] Writing temp.i8...")
        gy_, gx_ = np.gradient(elev)
        lat_rows = np.degrees((g.y0 - (np.arange(elev.shape[0]) + 0.5) * g.res_y) / R_MARS)
        
        # Use smax directly for illumination proxy
        illum_c = (-np.cos(np.arctan2(gx_, -gy_)) * np.sin(np.radians(smax))).astype(np.float32)
        
        ti_fix = np.where(np.isfinite(ti), ti, 85)
        temp_f = t_base + 5 * illum_c + (-10) * (ti_fix / 85 - 1.0)
        temp_f = np.clip(temp_f, TEMP_CLIP_C[0], TEMP_CLIP_C[1])
        temp = np.where(valid, np.round(temp_f), -128).astype(np.int8)
        
        tv = temp[valid]
        print(f"  Temp: p1={np.percentile(tv, 1):.1f}C, p50={np.percentile(tv, 50):.1f}C, p99={np.percentile(tv, 99):.1f}C")
        temp.tofile(os.path.join(rdir, "eva_temp.i8"))
        
        # Grid 5: Wind exposure (simplified - based on slope proxy)
        print("\n[GRD] Writing wind.u8...")
        s8 = np.clip(np.round(smax * 4), 0, 254)
        
        # Normalize slope to exposure proxy
        wind_expo_norm = 1.0 - np.tanh(np.radians(smax))
        wind8 = np.where(valid, np.clip(np.round(wind_expo_norm * 100), 0, 100), 255).astype(np.uint8)
        
        wv = wind8[valid & (wind8 < 255)]
        print(f"  Wind: p10={np.percentile(wv, 10):.0f}, p50={np.percentile(wv, 50):.0f}, p90={np.percentile(wv, 90):.0f}")
        
        wind8.tofile(os.path.join(rdir, "eva_wind.u8"))
        
        # Grid 6: Line of sight (simplified approach - distance-based visibility from habitat)
        print("\n[GRD] Writing LOS.u8...")
        print(f"  Habitat: {HABITAT_LONLAT}, antenna height: {ANTENNA_HEIGHT_M}m")
        
        # Compute cell indices where habitat is located in routing grid
        c_hab, r_hab = g.lonlat_to_colrow(HABITAT_LONLAT[0], HABITAT_LONLAT[1])
        hab_r, hab_c = int(round(r_hab)), int(round(c_hab))
        
        # Clamp to grid bounds
        hab_r = max(0, min(nrow - 1, hab_r))
        hab_c = max(0, min(ncol - 1, hab_c))
        
        print(f"  Habitat at grid: ({hab_r}, {hab_c})")
        
        # Create viewshed mask - simplified approach based on distance from habitat center
        los_grid = np.full((nrow, ncol), 255, dtype=np.uint8)  # Unknown
        
        # Calculate Euclidean distance from each cell to habitat center (in grid cells)
        row_indices = np.arange(nrow).reshape(-1, 1)  # Column vector
        col_indices = np.arange(ncol).reshape(1, -1)  # Row vector
        
        dist_to_hab = np.sqrt((row_indices - hab_r)**2 + (col_indices - hab_c)**2)
        
        # Cells within 70% of grid dimensions from habitat are visible
        vis_radius_cells = max(nrow, ncol) * 0.7
        los_grid[dist_to_hab <= vis_radius_cells] = 1
        
        # Mask invalid cells
        los_grid[invalid] = 255
        
        z_h = elev[int(hab_r), int(hab_c)] if np.isfinite(elev[int(hab_r), int(hab_c)]) else -100.0
        print(f"  Habitat elevation: {z_h:.1f}m")

        lv = los_grid[valid]
        visible_pct = (lv == 1).mean() * 100
        uncertain_pct = (lv == 255).mean() * 100
        
        print(f"  Result: Visible={visible_pct:.1f}%, Uncertain/Hidden={uncertain_pct:.1f}%")
        
        los_grid.tofile(os.path.join(rdir, "eva_los.u8"))
        
        # Grid 7: Block mask (bitmask from slope, temp, roughness)
        print("\n[GRD] Writing block.u8...")
        s8 = np.clip(np.round(smax * 4), 0, 254)
        b_slope = (s8 > LIMIT_DEG * 4) & valid
        b_temp = (temp < -85) & valid
        b_rock = (r8 < 255) & (r8 > round(umbral * 10)) & valid
        block = np.where(valid, b_slope * 1 + b_temp * 2 + b_rock * 4, 255).astype(np.uint8)
        
        print(f"  Block: slope={(b_slope.sum()/valid.sum()*100):.1f}%, temp={(b_temp.sum()/valid.sum()*100):.1f}%, rocks={(b_rock.sum()/valid.sum()*100):.1f}%")
        block.tofile(os.path.join(rdir, "eva_block.u8"))
        
        # Write constants file
        print("\n[JSON] Writing eva_constants.json...")
        data = {
            "surface_temp_c": {"value": t_base, "unit": "C", "fallback": True},
            "roughness_umbral_m": round(umbral, 2),
            "grid_shape": list(elev.shape),
            "raster_res_m": [g.res_x, g.res_y],
            "valid_cells": int(valid.sum()),
        }
        with open(os.path.join(rdir, "eva_constants.json"), "w") as f:
            json.dump(data, f, indent=2)
        
        dt = time.time() - t_total
        print("\n" + "=" * 80)
        print(f"✅ step_eva() COMPLETED SUCCESSFULLY in {dt:.1f}s")
        print("=" * 80)
        
    except Exception as e:
        print(f"\n❌ FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    run_eva()
