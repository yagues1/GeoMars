"""Download the static EVA-layer source products into data/raw/ (gitignored).

Products (all public domain / CC-BY, retrieved for GeoMars EVA routing):

  1. SWIM4IM combined ice consistency (0-30 m depth, ~5 m sensing)  — PSI/JPL
     https://swim.psi.edu/SWIM4MIMProducts.php
  2. MGS MAG/ER quicklook crustal magnetization map (1 deg x 1 deg)  — NASA GSFC
     https://mgs-mager.gsfc.nasa.gov/publications/mgsmap2.html
  3. THEMIS nighttime thermal inertia (1 km browse GeoTIFF)          — Zenodo (Huang 2026)
     https://zenodo.org/records/23527756   (full 100 m product: doi 10.57760/sciencedb.016s5)
     The USGS/Astropedia 100 m tile (THEMIS_TI_Mosaic_Quant_00N060E) is currently
     unreachable (astropedia host down), so the peer-reviewed 1 km browse version is used;
     the native resolution is recorded in provenance and never upscaled into new detail.
  4. MEDA environmental time series (CSV) for the Jezero constants   — PDS Atmospheres
     https://pds-atmospheres.nmsu.edu/.../PERSEVERANCE/meda.html

Run:  .venv-geo/bin/python -I scripts/fetch_eva_data.py
Idempotent: existing files are skipped. A manifest with URLs, dates and SHA-256 is
written to data/raw/manifest.json for provenance.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")

JEZERO = (77.4509, 18.4447)  # lon, lat — Perseverance landing site (Octavia E. Butler)
MARS_LONLAT = "+proj=longlat +R=3396190 +no_defs +type=crs"  # planetocentric, positive east

SWIM_URL = "https://swim.psi.edu/output/SWIM4MIM/Global/Composite/SWIM4MIM_OriginalCi.tif"
MAG_URL = "https://mgs-mager.gsfc.nasa.gov/publications/mgsmag2.zip"
ZENODO_API = "https://zenodo.org/api/records/23527756/files/THEMIS_TI_2026_MC{:02d}_ti_1km.tif/content"
# MC charts most likely to contain 0-30 N / 60-120 E under either numbering scheme.
THEMIS_MC_CANDIDATES = [13, 14, 8, 9, 10, 11, 12, 7]

MEDA_BASE = "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda"
# (collection, product code, sol) — representative sols across the early mission
MEDA_FILES = [
    ("data_derived_env", "DER_PS", 1),
    ("data_derived_env", "DER_PS", 120),
    ("data_derived_env", "DER_PS", 240),
    ("data_derived_env", "DER_WS", 1),
    ("data_derived_env", "DER_WS", 60),
    ("data_derived_env", "DER_WS", 120),
    ("data_derived_env", "DER_WS", 240),
    ("data_derived_env", "DER_TIRS", 1),
    ("data_derived_env", "DER_TIRS", 60),
    ("data_derived_env", "DER_TIRS", 120),
    ("data_derived_env", "DER_TIRS", 240),
    ("data_calibrated_env", "CAL_ATS", 1),
    ("data_calibrated_env", "CAL_ATS", 60),
    ("data_calibrated_env", "CAL_ATS", 120),
    ("data_calibrated_env", "CAL_ATS", 240),
    ("data_calibrated_env", "CAL_RDS", 1),
    ("data_calibrated_env", "CAL_RDS", 120),
    ("data_calibrated_env", "CAL_RDS", 240),
]

manifest: dict[str, dict] = {}


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url: str, dest: str) -> bool:
    """Download url to dest unless it already exists. Returns True if downloaded now."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        print(f"  skip (exists) {os.path.basename(dest)}")
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GeoMars-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    b = r.read(1 << 20)
                    if not b:
                        break
                    f.write(b)
            os.replace(tmp, dest)
            print(f"  ok {os.path.basename(dest)} ({os.path.getsize(dest) / 1e6:.1f} MB)")
            return True
        except Exception as e:  # noqa: BLE001 — network retries, report and retry
            last = e
            time.sleep(2 + attempt * 3)
    if os.path.exists(tmp):
        os.unlink(tmp)
    print(f"  FAIL {url}: {last}")
    return False


def record(url: str, dest: str) -> None:
    if os.path.exists(dest):
        manifest[os.path.relpath(dest, ROOT)] = {
            "url": url,
            "retrieved": time.strftime("%Y-%m-%d"),
            "bytes": os.path.getsize(dest),
            "sha256": sha256(dest),
        }


def fetch_swim() -> None:
    print("[1/4] SWIM4IM ice consistency")
    dest = os.path.join(RAW, "swim", "SWIM4MIM_OriginalCi.tif")
    fetch(SWIM_URL, dest)
    record(SWIM_URL, dest)


def fetch_mag() -> None:
    print("[2/4] MGS MAG/ER crustal magnetization")
    dest = os.path.join(RAW, "mag", "mgsmag2.zip")
    fetch(MAG_URL, dest)
    record(MAG_URL, dest)


def fetch_themis_ti() -> None:
    """Download candidate 1 km THEMIS TI charts until one contains the landing site."""
    print("[3/4] THEMIS thermal inertia (Zenodo 1 km browse)")
    import rasterio  # deferred: only needed to identify the tile
    from rasterio.warp import transform as rio_transform

    out = os.path.join(RAW, "themis_ti")
    for mc in THEMIS_MC_CANDIDATES:
        url = ZENODO_API.format(mc)
        dest = os.path.join(out, f"THEMIS_TI_2026_MC{mc:02d}_ti_1km.tif")
        fetch(url, dest)
        if not os.path.exists(dest):
            continue
        with rasterio.open(dest) as ds:
            b = ds.bounds
            lon, lat = JEZERO
            # the tiles are plate-carrée in *metres* — project the point into the
            # raster CRS instead of comparing degrees against metre bounds
            if ds.crs is not None:
                xs, ys = rio_transform(MARS_LONLAT, ds.crs, [lon], [lat])
                x, y = xs[0], ys[0]
            else:
                x, y = R_MARS * math.radians(lon), R_MARS * math.radians(lat)
            inside = b.left <= x <= b.right and b.bottom <= y <= b.top
        if inside:
            print(f"  -> tile MC-{mc:02d} covers the landing site {b}")
            for mc2 in THEMIS_MC_CANDIDATES:
                if mc2 != mc:
                    other = os.path.join(out, f"THEMIS_TI_2026_MC{mc2:02d}_ti_1km.tif")
                    if os.path.exists(other):
                        os.unlink(other)
            record(url, dest)
            return
        print(f"  tile MC-{mc:02d} bounds {b} — no overlap, discarding")
        os.unlink(dest)
    print("  FAIL: no candidate tile contains the landing site")


def meda_bucket(sol: int) -> tuple[int, int]:
    """SOL bucket range of the PDS MEDA archive: 90-sol buckets to sol 179,
    then 120-sol buckets (verified against the directory listing)."""
    if sol < 180:
        b0 = (sol // 90) * 90
        return b0, b0 + 89
    b0 = 180 + ((sol - 180) // 120) * 120
    return b0, b0 + 119


def fetch_meda() -> None:
    print("[4/4] MEDA environmental CSVs")
    for coll, prod, sol in MEDA_FILES:
        lo, hi = meda_bucket(sol)
        base = f"{MEDA_BASE}/{coll}/sol_{lo:04d}_{hi:04d}/sol_{sol:04d}/"
        # find the exact file name by listing the sol directory
        try:
            req = urllib.request.Request(base, headers={"User-Agent": "GeoMars-fetch/1.0"})
            html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            print(f"  list FAIL {base}: {e}")
            continue
        names = [h for h in html.split('"') if h.endswith(".CSV") and f"_{prod}_" in h.upper()]
        if not names:
            # sol bucket boundaries differ per range — try the canonical 90-sol buckets
            print(f"  no {prod} in {base}")
            continue
        url = base + names[0]
        dest = os.path.join(RAW, "meda", f"{prod}_sol{sol:04d}.CSV")
        fetch(url, dest)
        record(url, dest)


def main() -> int:
    os.makedirs(RAW, exist_ok=True)
    fetch_swim()
    fetch_mag()
    fetch_themis_ti()
    fetch_meda()
    mpath = os.path.join(RAW, "manifest.json")
    old = {}
    if os.path.exists(mpath):
        old = json.load(open(mpath))
    old.update(manifest)
    json.dump(old, open(mpath, "w"), indent=1)
    print(f"manifest -> {mpath} ({len(old)} entries)")
    missing = [k for k, v in manifest.items() if not os.path.exists(os.path.join(ROOT, k))]
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
