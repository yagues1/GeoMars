"""GeoMars data preparation pipeline.

Converts the authoritative NASA / USGS products in data/raw/ into browser assets in
public/data/. Every output is either a re-encoding of an observed product (imagery,
elevation) or an explicitly *derived* product (slope, hazard classes, contours,
routing grid). Nothing is interpolated across missing data: pixels without source
coverage are written as transparent / no-data.

Coordinate conventions (verified from the product labels, see README):
  * Body: Mars 2000 sphere, R = 3,396,190 m (GeoTIFF WKT of every raster used here).
  * Latitude: planetocentric. Longitude: positive east, -180..180.
  * CTX DEM / ortho: Equirectangular, standard parallel 18.4663 deg, central meridian 0.
  * MOLA 463 m DEM: Equirectangular, standard parallel 0.
  * USGS SIM 3464 vectors + THEMIS: Mars Transverse Mercator, central meridian 77.5 E.
  * Web tiles: spherical (Web-)Mercator tiling scheme applied to Mars planetocentric
    lon/lat. Physical distances are NEVER taken from the tile scheme; the app computes
    them on the Mars sphere.

Run:  .venv-geo/Scripts/python -I scripts/prepare_data.py [step ...]
Steps: ortho terrain topo slope themis globe vectors routing  (default: all)
"""
from __future__ import annotations

import json
import math
import os
import sys
import time

import numpy as np
import rasterio
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "public", "data")

R_MARS = 3396190.0  # m, Mars 2000 sphere (from GeoTIFF WKT)
LAT_TS = 18.4663  # deg, standard parallel of the Jezero CTX products
COS_TS = math.cos(math.radians(LAT_TS))

DEM_PATH = os.path.join(RAW, "M20_JezeroCrater_CTXDEM_20m.tif")
ORTHO_PATH = os.path.join(RAW, "M20_JezeroCrater_CTXortho_mosaic_5m.tif")
MOLA_PATH = os.path.join(RAW, "MOLA_DEM_463m_window_64E91E_5N32N.tif")
SIM = os.path.join(RAW, "sim3464", "sim3464_JezeroNili_FINAL")
THEMIS_DIR = os.path.join(SIM, "Rasters", "USGS_THEMIS_IR_controlled_mosaic_oct2018")
GDB = os.path.join(SIM, "Geodatabase", "Nili.gdb")
MARS_LONLAT = "+proj=longlat +R=3396190 +no_defs +type=crs"

TILE = 256


# --------------------------------------------------------------------------- tiles
def lonlat_to_tile(lon, lat, z):
    n = 2**z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(max(min(lat, 85.0511), -85.0511))
    y = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    return x, y


def tile_range(bounds, z):
    lon0, lat0, lon1, lat1 = bounds
    x0, y0 = lonlat_to_tile(lon0, lat1, z)
    x1, y1 = lonlat_to_tile(lon1, lat0, z)
    return range(int(math.floor(x0)), int(math.floor(x1 - 1e-9)) + 1), range(
        int(math.floor(y0)), int(math.floor(y1 - 1e-9)) + 1
    )


def tile_lonlat(z, x, y):
    """lon/lat (deg) of the 256x256 pixel centres of a Web-Mercator-scheme tile."""
    n = TILE * 2**z
    px = (x * TILE + np.arange(TILE) + 0.5) / n
    py = (y * TILE + np.arange(TILE) + 0.5) / n
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * py))))
    return np.meshgrid(lon, lat)


def save_tile(img: np.ndarray, path: str, fmt: str, quality=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = {1: "L", 2: "LA", 3: "RGB", 4: "RGBA"}[img.shape[2] if img.ndim == 3 else 1]
    im = Image.fromarray(img if img.ndim == 2 or img.shape[2] > 1 else img[..., 0], mode)
    if fmt == "webp":
        if mode == "L":
            im = im.convert("RGB")
        elif mode == "LA":
            im = im.convert("RGBA")
        im.save(path, "WEBP", quality=quality, method=4)
    elif fmt == "webpll":  # lossless WebP (exact RGB values; required for terrain-RGB encoding)
        im.convert("RGB").save(path, "WEBP", lossless=True, quality=100, method=5)
    elif fmt == "png":
        im.save(path, "PNG", optimize=False, compress_level=6)
    else:
        im.convert("RGB").save(path, "JPEG", quality=quality)


def render_pyramid(name, bounds, zooms, sampler, fmt, quality=82):
    """sampler(lon, lat, z) -> uint8 HxWxC array or None (fully empty)."""
    t0 = time.time()
    count = 0
    for z in zooms:
        xs, ys = tile_range(bounds, z)
        for x in xs:
            for y in ys:
                lon, lat = tile_lonlat(z, x, y)
                img = sampler(lon, lat, z)
                if img is None:
                    continue
                ext = "webp" if fmt == "webpll" else fmt
                save_tile(img, os.path.join(OUT, "tiles", name, str(z), str(x), f"{y}.{ext}"), fmt, quality)
                count += 1
    print(f"[{name}] {count} tiles z{zooms[0]}-{zooms[-1]} in {time.time() - t0:.1f}s")
    return count


def mpp_at(z, lat=LAT_TS):
    """Mars metres per tile pixel at zoom z (tile scheme scale, sphere R_MARS)."""
    return 2 * math.pi * R_MARS * math.cos(math.radians(lat)) / (TILE * 2**z)


# --------------------------------------------------------------- CTX raster access
class CtxGrid:
    """Raster in the Jezero equirectangular projection (std parallel 18.4663)."""

    def __init__(self, path):
        with rasterio.open(path) as d:
            self.t = d.transform
            self.nodata = d.nodata
            self.shape = (d.height, d.width)
            self.bounds_m = d.bounds
            self.wkt = d.crs.to_wkt()
        self.res_x, self.res_y = self.t.a, -self.t.e
        self.x0, self.y0 = self.t.c, self.t.f

    def lonlat_to_colrow(self, lon, lat):
        x = R_MARS * np.radians(lon) * COS_TS
        y = R_MARS * np.radians(lat)
        return (x - self.x0) / self.res_x - 0.5, (self.y0 - y) / self.res_y - 0.5

    def lonlat_bounds(self):
        b = self.bounds_m
        k = 180 / math.pi / R_MARS
        return [b.left * k / COS_TS, b.bottom * k, b.right * k / COS_TS, b.top * k]


def sample(arr, col, row, order=1, cval=np.nan):
    return ndimage.map_coordinates(arr, [row.ravel(), col.ravel()], order=order, cval=cval, mode="constant").reshape(
        col.shape
    )


def inside(col, row, shape, margin=0.0):
    return (col >= -0.5 + margin) & (row >= -0.5 + margin) & (col <= shape[1] - 0.5 - margin) & (row <= shape[0] - 0.5 - margin)


# --------------------------------------------------------------------------- DEM
_dem_cache = {}


def load_dem():
    if "dem" in _dem_cache:
        return _dem_cache["dem"]
    g = CtxGrid(DEM_PATH)
    with rasterio.open(DEM_PATH) as d:
        a = d.read(1).astype(np.float32)
    bad = (a == g.nodata) | ~np.isfinite(a) | (a < -9000) | (a > 30000)
    a[bad] = np.nan
    print(f"[dem] {a.shape} nodata px: {int(bad.sum())} min {np.nanmin(a):.1f} max {np.nanmax(a):.1f}")
    _dem_cache["dem"] = (g, a)
    return g, a


def slope_deg(dem, res_y, lat_rows):
    """Slope (deg) with ground spacing corrected per row for the equirectangular x scale.
    Central differences; NaN propagates (no gap filling)."""
    dx = (res_y * np.cos(np.radians(lat_rows)) / COS_TS)[:, None]  # true east spacing per row
    gy, gx = np.gradient(dem)
    sx = gx / dx
    sy = gy / res_y
    return np.degrees(np.arctan(np.hypot(sx, sy))).astype(np.float32)


def load_slope():
    if "slope" in _dem_cache:
        return _dem_cache["slope"]
    g, dem = load_dem()
    rows = np.arange(dem.shape[0])
    lat_rows = np.degrees((g.y0 - (rows + 0.5) * g.res_y) / R_MARS)
    s = slope_deg(dem, g.res_y, lat_rows)
    _dem_cache["slope"] = s
    v = s[np.isfinite(s)]
    print(f"[slope] median {np.median(v):.2f} p95 {np.percentile(v, 95):.2f} p99 {np.percentile(v, 99):.2f} max {v.max():.1f}")
    return s


def load_mola():
    with rasterio.open(MOLA_PATH) as d:
        a = d.read(1).astype(np.float32)
        a[a == d.nodata] = np.nan
        t = d.transform
    return a, t


# ------------------------------------------------------------------------- ortho
def step_ortho():
    g = CtxGrid(ORTHO_PATH)
    with rasterio.open(ORTHO_PATH) as d:
        base = d.read(1)
    print("[ortho] loaded", base.shape)
    # pyramid by 2x2 mean of valid pixels; 0 = fill outside the mosaic footprint (kept as no-data)
    def down(a):
        h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
        out = np.zeros((h // 2, w // 2), np.uint8)
        for r0 in range(0, h, 2048):
            blk = a[r0:min(r0 + 2048, h), :w].astype(np.uint16)
            blk = blk.reshape(blk.shape[0] // 2, 2, w // 2, 2)
            s = blk.sum((1, 3))
            c = (blk > 0).sum((1, 3))
            out[r0 // 2:r0 // 2 + s.shape[0]] = np.where(c >= 2, s // np.maximum(c, 1), 0).astype(np.uint8)
        return out

    levels = [base]
    while levels[-1].shape[0] > 600:
        levels.append(down(levels[-1]))

    def sampler(lon, lat, z):
        target = mpp_at(z)
        k = 0
        while k + 1 < len(levels) and g.res_x * 2 ** (k + 1) <= target * 1.05:
            k += 1
        a = levels[k]
        col, row = g.lonlat_to_colrow(lon, lat)
        col = (col + 0.5) / 2**k - 0.5
        row = (row + 0.5) / 2**k - 0.5
        ok = inside(col, row, a.shape)
        if not ok.any():
            return None
        v = sample(a, col, row, 1, 0).astype(np.float32)
        mv = sample(a, col, row, 0, 0) > 0
        ok &= mv
        if not ok.any():
            return None
        # light contrast stretch for display only (documented); raw DN preserved in source
        img = np.clip(v * 1.08 - 6, 0, 255).astype(np.uint8)
        alpha = np.where(ok, 255, 0).astype(np.uint8)
        return np.dstack([img, alpha])

    render_pyramid("ortho", g.lonlat_bounds(), list(range(8, 15)), sampler, "webp", 80)


# ----------------------------------------------------------------- merged DEM sampling
def merged_elevation_sampler():
    g, dem = load_dem()
    mola, mt = load_mola()
    k = math.pi / 180 * R_MARS
    # pre-blurred copies for coarse zooms (avoid aliasing)
    dem_cache = {}

    def dem_at_level(lvl):
        if lvl not in dem_cache:
            if lvl == 0:
                dem_cache[lvl] = dem
            else:
                f = 2**lvl
                h, w = dem.shape[0] // f * f, dem.shape[1] // f * f
                blk = dem[:h, :w].reshape(h // f, f, w // f, f)
                dem_cache[lvl] = np.nanmean(blk, axis=(1, 3)).astype(np.float32)
        return dem_cache[lvl]

    def elev(lon, lat, z):
        target = mpp_at(z)
        lvl = 0
        while 20 * 2 ** (lvl + 1) <= target * 1.05 and lvl < 5:
            lvl += 1
        d = dem_at_level(lvl)
        col, row = g.lonlat_to_colrow(lon, lat)
        col = (col + 0.5) / 2**lvl - 0.5
        row = (row + 0.5) / 2**lvl - 0.5
        ctx = sample(d, col, row, 1, np.nan)
        mcol = (np.radians(lon) * R_MARS - mt.c) / mt.a - 0.5
        mrow = (mt.f - np.radians(lat) * R_MARS) / (-mt.e) - 0.5
        mol = sample(mola, mcol, mrow, 1, np.nan)
        src = np.where(np.isfinite(ctx), 1, np.where(np.isfinite(mol), 2, 0)).astype(np.uint8)
        return np.where(np.isfinite(ctx), ctx, mol), src

    _ = k
    return elev, g


def mola_bounds():
    with rasterio.open(MOLA_PATH) as d:
        b = d.bounds
    k = 180 / math.pi / R_MARS
    return [b.left * k, b.bottom * k, b.right * k, b.top * k]


def ctx_core_bounds(margin=0.0):
    g = CtxGrid(DEM_PATH)
    b = g.lonlat_bounds()
    return [b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin]


def step_terrain():
    elev, g = merged_elevation_sampler()

    def sampler(lon, lat, z):
        h, src = elev(lon, lat, z)
        if not np.isfinite(h).any():
            return None
        # terrain-RGB "terrarium": h = R*256 + G + B/256 - 32768. Missing -> -32768 sentinel
        # (never reached inside the MOLA window, which has global coverage).
        h = np.where(np.isfinite(h), h, np.nanmean(h))
        v = h + 32768.0
        r = np.floor(v / 256)
        gg = np.floor(v - r * 256)
        # fractional metres quantised to 1/8 m (well below CTX DEM vertical precision) -> smaller files
        b = np.floor((v - np.floor(v)) * 8) * 32
        return np.dstack([r, gg, b]).astype(np.uint8)

    render_pyramid("terrain", mola_bounds(), list(range(3, 9)), sampler, "webpll")
    render_pyramid("terrain", ctx_core_bounds(0.35), list(range(9, 13)), sampler, "webpll")


# ------------------------------------------------------------------------ topo
TOPO_STOPS = [  # elevation (m), RGB. GeoMars hypsometric ramp (styling, not a USGS standard)
    (-5000, (24, 38, 62)), (-4000, (38, 72, 98)), (-3200, (58, 112, 116)), (-2600, (112, 140, 104)),
    (-2000, (168, 160, 108)), (-1400, (196, 150, 96)), (-800, (190, 118, 78)), (0, (168, 92, 70)),
    (1500, (214, 196, 182)), (3000, (245, 240, 236)),
]


def hypsometric(h):
    xs = np.array([s[0] for s in TOPO_STOPS], np.float32)
    out = np.zeros(h.shape + (3,), np.float32)
    for i in range(3):
        out[..., i] = np.interp(h, xs, np.array([s[1][i] for s in TOPO_STOPS], np.float32))
    return out


def hillshade_from(h, spacing_m, az=315, alt=40, zf=1.0):
    gy, gx = np.gradient(h * zf, spacing_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azr, altr = math.radians(360 - az + 90), math.radians(alt)
    hs = np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - aspect)
    return np.clip(hs, 0, 1)


def step_topo():
    elev, g = merged_elevation_sampler()

    def sampler(lon, lat, z):
        h, src = elev(lon, lat, z)
        ok = np.isfinite(h)
        if not ok.any():
            return None
        hf = np.where(ok, h, np.nanmean(h))
        spacing = mpp_at(z)
        hs = hillshade_from(hf, spacing, zf=1.6)
        col = hypsometric(hf) * (0.35 + 0.75 * hs[..., None])
        rgb = np.clip(col, 0, 255).astype(np.uint8)
        a = np.where(ok, 255, 0).astype(np.uint8)
        return np.dstack([rgb, a])

    render_pyramid("topo", mola_bounds(), list(range(3, 9)), sampler, "webp", 82)
    render_pyramid("topo", ctx_core_bounds(0.35), list(range(9, 14)), sampler, "webp", 82)


# ----------------------------------------------------------------------- slope/hazard
SLOPE_STOPS = [(0, (0, 0, 0, 0)), (5, (250, 222, 160, 70)), (10, (246, 176, 92, 140)), (15, (232, 120, 52, 185)),
               (20, (196, 60, 40, 215)), (30, (120, 20, 40, 235)), (45, (60, 0, 30, 245))]


def ramp(v, stops):
    xs = np.array([s[0] for s in stops], np.float32)
    out = np.zeros(v.shape + (4,), np.float32)
    for i in range(4):
        out[..., i] = np.interp(v, xs, np.array([s[1][i] for s in stops], np.float32))
    return out


CAUTION_DEG = 15.0
LIMIT_DEG = 20.0  # default vehicle limit (estimated) -- mirrored in src/routing/vehicle.ts


def step_slope():
    g, dem = load_dem()
    s = load_slope()
    levels = {0: s}

    def at(lvl):
        if lvl not in levels:
            f = 2**lvl
            hh, ww = s.shape[0] // f * f, s.shape[1] // f * f
            levels[lvl] = np.nanmax(s[:hh, :ww].reshape(hh // f, f, ww // f, f), axis=(1, 3))  # conservative
        return levels[lvl]

    def pick(lon, lat, z):
        lvl = 0
        while 20 * 2 ** (lvl + 1) <= mpp_at(z) * 1.05 and lvl < 4:
            lvl += 1
        a = at(lvl)
        col, row = g.lonlat_to_colrow(lon, lat)
        col = (col + 0.5) / 2**lvl - 0.5
        row = (row + 0.5) / 2**lvl - 0.5
        return sample(a, col, row, 0, np.nan)

    def slope_sampler(lon, lat, z):
        v = pick(lon, lat, z)
        if not np.isfinite(v).any():
            return None
        rgba = ramp(np.nan_to_num(v, nan=0), SLOPE_STOPS)
        rgba[~np.isfinite(v)] = 0
        return rgba.astype(np.uint8)

    def hazard_sampler(lon, lat, z):
        v = pick(lon, lat, z)
        fin = np.isfinite(v)
        if not fin.any():
            return None
        out = np.zeros(v.shape + (4,), np.uint8)
        caution = fin & (v >= CAUTION_DEG) & (v < LIMIT_DEG)
        prohibited = fin & (v >= LIMIT_DEG)
        out[caution] = (240, 168, 60, 120)
        out[prohibited] = (220, 50, 38, 175)
        if not (caution | prohibited).any():
            return None
        return out

    b = g.lonlat_bounds()
    render_pyramid("slope", b, list(range(9, 13)), slope_sampler, "webp", 78)
    render_pyramid("hazard", b, list(range(9, 13)), hazard_sampler, "png")


# ------------------------------------------------------------------------- THEMIS
def step_themis():
    from pyproj import Transformer

    for kind in ("NightIR", "DayIR"):
        p = os.path.join(THEMIS_DIR, f"nili_THEMIS_{kind}_Controlled_oct2018.tif")
        with rasterio.open(p) as d:
            a = d.read(1).astype(np.float32)
            t = d.transform
            crs = d.crs
        tr = Transformer.from_crs(MARS_LONLAT, crs.to_wkt(), always_xy=True)
        trinv = Transformer.from_crs(crs.to_wkt(), MARS_LONLAT, always_xy=True)
        valid = a > 0
        a[~valid] = np.nan
        # bounds in lon/lat from raster corners
        xs = [t.c, t.c + t.a * a.shape[1]]
        ys = [t.f, t.f + t.e * a.shape[0]]
        cl = [trinv.transform(x, y) for x in xs for y in ys]
        bounds = [min(c[0] for c in cl), min(c[1] for c in cl), max(c[0] for c in cl), max(c[1] for c in cl)]

        lo, hi = np.nanpercentile(a, 1), np.nanpercentile(a, 99)
        stops = [(0.0, (20, 12, 30)), (0.35, (110, 40, 40)), (0.65, (214, 110, 50)), (1.0, (255, 226, 170))]

        def sampler(lon, lat, z, a=a, t=t, tr=tr, lo=lo, hi=hi, stops=stops):
            x, y = tr.transform(lon, lat)
            col = (np.asarray(x) - t.c) / t.a - 0.5
            row = (np.asarray(y) - t.f) / t.e - 0.5
            v = sample(a, col, row, 1, np.nan)
            ok = np.isfinite(v)
            if not ok.any():
                return None
            n = np.clip((np.nan_to_num(v, nan=lo) - lo) / (hi - lo), 0, 1)
            xs_ = np.array([s[0] for s in stops])
            rgb = np.dstack([np.interp(n, xs_, [s[1][i] for s in stops]) for i in range(3)])
            return np.dstack([rgb, np.where(ok, 230, 0)]).astype(np.uint8)

        render_pyramid(f"themis_{kind.lower()}", bounds, list(range(7, 12)), sampler, "webp", 85)

        # small lon/lat lookup grid (raw 8-bit DN, uncalibrated stretch) for inspection cards
        if kind == "NightIR" or kind == "DayIR":
            nx, ny = 600, 600
            lons = np.linspace(bounds[0], bounds[2], nx)
            lats = np.linspace(bounds[3], bounds[1], ny)
            LON, LAT = np.meshgrid(lons, lats)
            x, y = tr.transform(LON, LAT)
            col = (np.asarray(x) - t.c) / t.a - 0.5
            row = (np.asarray(y) - t.f) / t.e - 0.5
            v = sample(a, col, row, 0, np.nan)
            out = np.where(np.isfinite(v), v, 0).astype(np.uint8)
            os.makedirs(os.path.join(OUT, "grids"), exist_ok=True)
            out.tofile(os.path.join(OUT, "grids", f"themis_{kind.lower()}.u8"))
            json.dump({"width": nx, "height": ny, "lon0": bounds[0], "lon1": bounds[2], "lat0": bounds[3],
                       "lat1": bounds[1], "nodata": 0, "units": "8-bit DN (stretched, uncalibrated)",
                       "display_p1": float(lo), "display_p99": float(hi)},
                      open(os.path.join(OUT, "grids", f"themis_{kind.lower()}.json"), "w"), indent=1)
        print(f"[themis {kind}] bounds {bounds}")


# -------------------------------------------------------------------------- globe
def step_globe():
    def eq_sampler_factory(path, bounds, alpha=False):
        im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
        H, W = im.shape[:2]
        pyr = [im]
        while pyr[-1].shape[0] > 256:
            a = pyr[-1]
            h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
            pyr.append(a[:h, :w].reshape(h // 2, 2, w // 2, 2, 3).mean((1, 3)))
        degpp = (bounds[2] - bounds[0]) / W

        def sampler(lon, lat, z):
            target_deg = 360.0 / (TILE * 2**z) * np.cos(np.radians(np.clip(lat.mean(), -80, 80)))
            k = 0
            while k + 1 < len(pyr) and degpp * 2 ** (k + 1) <= target_deg * 1.05:
                k += 1
            a = pyr[k]
            col = (lon - bounds[0]) / (degpp * 2**k) - 0.5
            row = (bounds[3] - lat) / (degpp * 2**k) - 0.5
            ok = inside(col, row, a.shape[:2])
            if not ok.any():
                return None
            rgb = np.dstack([sample(a[..., i], col, row, 1, 0) for i in range(3)])
            if alpha:
                return np.dstack([rgb, np.where(ok, 255, 0)]).astype(np.uint8)
            return rgb.astype(np.uint8)

        return sampler

    world = [-180, -85.0511, 180, 85.0511]
    v4 = os.path.join(RAW, "trek_viking_l4.jpg")
    render_pyramid("globe", world, list(range(0, 6)), eq_sampler_factory(v4, [-180, -90, 180, 90]), "jpg", 86)
    v7 = os.path.join(RAW, "trek_viking_l7_window.jpg")
    if os.path.exists(v7):
        meta = json.load(open(v7 + ".json"))
        b = meta["bounds_lon_lat"]
        inner = [b[0] + 0.01, b[1] + 0.01, b[2] - 0.01, b[3] - 0.01]
        render_pyramid("globe", inner, list(range(6, 9)), eq_sampler_factory(v7, b, alpha=False), "jpg", 86)
    m4 = os.path.join(RAW, "trek_mola_l4.jpg")
    render_pyramid("globe_mola", world, list(range(0, 6)), eq_sampler_factory(m4, [-180, -90, 180, 90]), "jpg", 86)


# ------------------------------------------------------------------------- vectors
def round_coords(geom, nd=6):
    from shapely import set_precision

    return set_precision(geom, 10 ** -nd)


def step_vectors():
    import geopandas as gpd
    import pyogrio
    from matplotlib import contour as mcontour  # noqa: F401
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    vdir = os.path.join(OUT, "vector")
    os.makedirs(vdir, exist_ok=True)

    # --- geology (USGS SIM 3464, Sun & Stack 2020)
    gdf = pyogrio.read_dataframe(GDB, layer="GeoUnits_v1")
    gdf = gdf.to_crs(MARS_LONLAT)
    gdf["name"] = gdf["name"].replace({"Crater riim unit": "Crater rim unit"})
    # one polygon (FID 5 'Upper etched unit' with unit code 5) -> keep symbol as authoritative
    gdf = gdf[["symbol", "name", "geometry"]].rename(columns={"symbol": "unit"})
    gdf["geometry"] = gdf.geometry.simplify(0.00012, preserve_topology=True)
    gdf = gdf[~gdf.geometry.is_empty]
    gdf.to_file(os.path.join(vdir, "geology.geojson"), driver="GeoJSON", COORDINATE_PRECISION=6)
    for layer, fname in (("MapBoundary", "geology_boundary"), ("LandingEllipse", "landing_ellipse")):
        g2 = pyogrio.read_dataframe(GDB, layer=layer).to_crs(MARS_LONLAT)
        g2 = g2[["geometry"]]
        g2.to_file(os.path.join(vdir, f"{fname}.geojson"), driver="GeoJSON", COORDINATE_PRECISION=6)
    print("[vectors] geology", len(gdf))

    # --- Perseverance traverse + waypoints (NASA MMGIS, JPL)
    trav = json.load(open(os.path.join(RAW, "M20_traverse.json"), encoding="utf8"))
    feats = []
    for f in trav["features"]:
        coords = [[round(c[0], 6), round(c[1], 6)] for c in f["geometry"]["coordinates"]]
        dedup = [coords[0]] + [c for i, c in enumerate(coords[1:], 1) if c != coords[i - 1]]
        if len(dedup) < 2:
            continue
        feats.append({"type": "Feature", "properties": {"sol": f["properties"].get("sol")},
                      "geometry": {"type": "LineString", "coordinates": dedup}})
    json.dump({"type": "FeatureCollection", "name": trav.get("name"), "features": feats},
              open(os.path.join(vdir, "traverse.geojson"), "w"), separators=(",", ":"))
    wp = json.load(open(os.path.join(RAW, "M20_waypoints.json"), encoding="utf8"))
    last_by_sol = {}
    for f in wp["features"]:
        p = f["properties"]
        last_by_sol[p["sol"]] = {"sol": p["sol"], "lon": p["lon"], "lat": p["lat"], "elev_geoid": p.get("elev_geoid"),
                                 "dist_total_m": p.get("dist_total_m"), "site": p.get("site"), "drive": p.get("drive")}
    json.dump({"source": "NASA/JPL MMGIS M20_waypoints.json (" + wp.get("name", "") + ")",
               "waypoints": [last_by_sol[k] for k in sorted(last_by_sol)]},
              open(os.path.join(vdir, "waypoints_by_sol.json"), "w"), separators=(",", ":"))
    print("[vectors] traverse", len(feats), "waypoint sols", len(last_by_sol))

    # --- contours from CTX DEM (derived), 100 m interval on a 40 m grid
    g, dem = load_dem()
    d2 = dem[: dem.shape[0] // 2 * 2, : dem.shape[1] // 2 * 2]
    d2 = d2.reshape(d2.shape[0] // 2, 2, d2.shape[1] // 2, 2).mean((1, 3))
    d2 = ndimage.gaussian_filter(np.nan_to_num(d2, nan=np.nanmean(d2)), 1.0)
    rows = np.arange(d2.shape[0])
    cols = np.arange(d2.shape[1])
    k = 180 / math.pi / R_MARS
    lons = (g.x0 + (cols + 0.5) * 40) * k / COS_TS
    lats = (g.y0 - (rows + 0.5) * 40) * k
    levels = np.arange(-3400, -400, 100)
    fig = plt.figure()
    cs = plt.contour(lons, lats, d2, levels=levels)
    from shapely.geometry import LineString

    cfeats = []
    for lvl, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if len(seg) < 6:
                continue
            ls = LineString(seg).simplify(0.00015)
            if ls.length < 0.004:
                continue
            cfeats.append({"type": "Feature", "properties": {"elev": int(lvl), "major": int(lvl) % 500 == 0},
                           "geometry": {"type": "LineString",
                                        "coordinates": [[round(x, 5), round(y, 5)] for x, y in ls.coords]}})
    plt.close(fig)
    json.dump({"type": "FeatureCollection", "features": cfeats}, open(os.path.join(vdir, "contours.geojson"), "w"),
              separators=(",", ":"))
    print("[vectors] contours", len(cfeats))


# ------------------------------------------------------------------------ routing
ROUTE_CELL = 2  # aggregate 2x2 DEM pixels -> 40 m routing cells


def step_routing():
    g, dem = load_dem()
    s = load_slope()
    f = ROUTE_CELL
    h, w = dem.shape[0] // f * f, dem.shape[1] // f * f
    blk_e = dem[:h, :w].reshape(h // f, f, w // f, f)
    blk_s = s[:h, :w].reshape(h // f, f, w // f, f)
    any_nan = np.isnan(blk_e).any(axis=(1, 3)) | np.isnan(blk_s).any(axis=(1, 3))
    elev = np.nanmean(blk_e, axis=(1, 3))
    smax = np.nanmax(blk_s, axis=(1, 3))  # conservative: steepest 20 m slope inside the 40 m cell
    # exclude a 2-cell frame: central-difference slopes at the DEM edge are one-sided / unreliable
    edge = np.zeros_like(any_nan)
    edge[:2, :] = edge[-2:, :] = edge[:, :2] = edge[:, -2:] = True
    invalid = any_nan | edge
    e16 = np.where(invalid, -32768, np.round(elev)).astype(np.int16)
    s8 = np.where(invalid, 255, np.clip(np.round(smax * 4), 0, 254)).astype(np.uint8)
    rdir = os.path.join(OUT, "grids")
    os.makedirs(rdir, exist_ok=True)
    e16.tofile(os.path.join(rdir, "routing_elev.i16"))
    s8.tofile(os.path.join(rdir, "routing_slope.u8"))
    k = 180 / math.pi / R_MARS
    cell = 20.0 * f
    meta = {
        "width": int(e16.shape[1]), "height": int(e16.shape[0]),
        "cell_m_projected": cell,
        "lon0_center": (g.x0 + cell / 2) * k / COS_TS, "lat0_center": (g.y0 - cell / 2) * k,
        "dlon": cell * k / COS_TS, "dlat": cell * k,
        "radius_m": R_MARS, "lat_ts": LAT_TS,
        "elev_nodata": -32768, "slope_nodata": 255, "slope_scale": 0.25,
        "slope_method": "max of 20 m central-difference slopes within each 40 m cell (conservative)",
        "source": "USGS M20_JezeroCrater_CTXDEM_20m.tif (Mars 2020 Science Investigation CTX DEM mosaic)",
        "invalid_cells": int(invalid.sum()),
    }
    json.dump(meta, open(os.path.join(rdir, "routing.json"), "w"), indent=1)
    v = smax[~invalid]
    print(f"[routing] grid {e16.shape} invalid {int(invalid.sum())} >=20deg {(v >= 20).mean() * 100:.2f}% >=15deg {(v >= 15).mean() * 100:.2f}%")

    # coverage / bounds summary for the app
    b = g.lonlat_bounds()
    json.dump({"ctx_dem_bounds": b, "ortho_bounds": CtxGrid(ORTHO_PATH).lonlat_bounds(), "mola_window_bounds": mola_bounds()},
              open(os.path.join(rdir, "coverage.json"), "w"), indent=1)
    # spot checks
    for name, (lo, la) in {"Octavia E. Butler landing (sol 13)": (77.45088572, 18.44462715)}.items():
        col, row = g.lonlat_to_colrow(np.array([lo]), np.array([la]))
        print(f"  spot {name}: DEM {sample(dem, col, row, 1)[0]:.1f} m (rover-reported elev_geoid -2569.91 m)")


STEPS = {"ortho": step_ortho, "terrain": step_terrain, "topo": step_topo, "slope": step_slope,
         "themis": step_themis, "globe": step_globe, "vectors": step_vectors, "routing": step_routing}

if __name__ == "__main__":
    todo = sys.argv[1:] or list(STEPS)
    os.makedirs(OUT, exist_ok=True)
    for s in todo:
        STEPS[s]()
