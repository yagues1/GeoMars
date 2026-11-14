"""Download NASA Mars Trek WMTS (equirectangular, "EQ") tiles and stitch them into an
equirectangular mosaic for local, offline use.

Source: NASA Solar System Treks WMTS (https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)
Layers:
  viking: Mars_Viking_MDIM21_ClrMosaic_global_232m  (Viking MDIM 2.1 colour mosaic, 232 m/px)
  mola:   Mars_MGS_MOLA_ClrShade_merge_global_463m  (MGS MOLA colour shaded relief, 463 m/px)

Usage:
  python fetch_trek_global.py <layer> <level> <out.jpg>                      # whole globe
  python fetch_trek_global.py <layer> <level> <out.jpg> lon0 lat0 lon1 lat1  # window
A JSON sidecar with the exact geographic bounds of the stitched mosaic is written next to it.
Tile matrix: level L has 2*2^L columns x 2^L rows of 256 px, origin (-180, 90), 180/2^L deg/tile.
"""
import sys, io, json, math, concurrent.futures as cf, urllib.request
from PIL import Image

LAYERS = {
    "viking": "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{r}/{c}.jpg",
    "mola": "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{r}/{c}.jpg",
}


def fetch(url):
    err = None
    for _ in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "GeoMars-dataprep/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception as e:  # noqa: BLE001
            err = e
    print("FAIL", url, err)
    return None


def main(layer, z, out, window=None):
    deg = 180.0 / 2**z
    cols, rows = 2 * 2**z, 2**z
    if window:
        lon0, lat0, lon1, lat1 = window
        c0, c1 = int(math.floor((lon0 + 180) / deg)), int(math.ceil((lon1 + 180) / deg))
        r0, r1 = int(math.floor((90 - lat1) / deg)), int(math.ceil((90 - lat0) / deg))
    else:
        c0, c1, r0, r1 = 0, cols, 0, rows
    mosaic = Image.new("RGB", ((c1 - c0) * 256, (r1 - r0) * 256))
    jobs = {}
    with cf.ThreadPoolExecutor(8) as ex:
        for r in range(r0, r1):
            for c in range(c0, c1):
                jobs[ex.submit(fetch, LAYERS[layer].format(z=z, r=r, c=c))] = (r, c)
        for f in cf.as_completed(jobs):
            r, c = jobs[f]
            im = f.result()
            if im:
                mosaic.paste(im, ((c - c0) * 256, (r - r0) * 256))
    mosaic.save(out, quality=93)
    bounds = [-180 + c0 * deg, 90 - r1 * deg, -180 + c1 * deg, 90 - r0 * deg]
    json.dump({"layer": layer, "level": z, "bounds_lon_lat": bounds, "size": mosaic.size,
               "source": LAYERS[layer]}, open(out + ".json", "w"), indent=1)
    print("saved", out, mosaic.size, bounds)


if __name__ == "__main__":
    w = tuple(float(v) for v in sys.argv[4:8]) if len(sys.argv) >= 8 else None
    main(sys.argv[1], int(sys.argv[2]), sys.argv[3], w)
