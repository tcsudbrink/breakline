"""Build the static 2-arc-minute depth files (data/bathy_<zone>.json + .bin) for zones that don't have one yet.

Same format the app and api/check-alerts.js read: int16 little-endian meters, rows south -> north, cell centers.
Source: NOAA NCEI DEM_global_mosaic ImageServer (ETOPO 2022 plus higher-res coastal DEMs), raw float32.

    python build_bathy.py haw cal zaf ...     (no args: every zone in ZONES below that is missing a file)
"""
import io
import json
import os
import sys
import urllib.parse
import urllib.request

import numpy as np

SVC = "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage"
CELL = 1 / 30
ZONES = {   # keep in sync with PRE_BOX in app.js and ZONES in prefetch.py
    "haw": dict(s=17.5, n=23.5, w=-161.5, e=-153.5),
    "cal": dict(s=29.5, n=35.0, w=-122.0, e=-116.0),
    "zaf": dict(s=-36.5, n=-27.0, w=16.0, e=33.5),
    "ken": dict(s=-11.0, n=-1.5, w=38.5, e=45.0),
    "moz": dict(s=-27.0, n=-18.5, w=32.5, e=38.5),
    "qld": dict(s=-28.5, n=-14.0, w=144.5, e=156.0),
    "nsw": dict(s=-38.5, n=-28.0, w=148.5, e=155.5),
    "vic": dict(s=-44.5, n=-37.0, w=137.0, e=150.5),
    "wa": dict(s=-33.0, n=-20.0, w=111.0, e=116.5),
}


def build(name, b):
    nx, ny = round((b["e"] - b["w"]) / CELL), round((b["n"] - b["s"]) / CELL)
    q = {"bbox": f"{b['w']},{b['s']},{b['e']},{b['n']}", "bboxSR": 4326, "imageSR": 4326, "size": f"{nx},{ny}",
         "format": "tiff", "pixelType": "F32", "interpolation": "RSP_BilinearInterpolation", "f": "json"}
    ua = {"User-Agent": "Breakline-build/1.0"}
    info = json.loads(urllib.request.urlopen(urllib.request.Request(SVC + "?" + urllib.parse.urlencode(q), headers=ua), timeout=300).read())
    W, H, ext = info["width"], info["height"], info["extent"]      # the service may adjust the size and edges
    raw = urllib.request.urlopen(urllib.request.Request(info["href"], headers=ua), timeout=300).read()
    from PIL import Image
    z = np.array(Image.open(io.BytesIO(raw)), dtype=np.float32)
    assert z.shape == (H, W), (name, z.shape, W, H)
    z = z[::-1]                         # service rows run north -> south; files run south -> north
    dlon, dlat = (ext["xmax"] - ext["xmin"]) / W, (ext["ymax"] - ext["ymin"]) / H
    nx, ny = W, H
    z = np.where(np.isfinite(z) & (np.abs(z) < 12000), z, 0).round().astype("<i2")
    open(f"data/bathy_{name}.bin", "wb").write(z.tobytes())
    meta = {"nx": nx, "ny": ny, "lat0": ext["ymin"] + dlat / 2, "lon0": ext["xmin"] + dlon / 2, "dlat": dlat, "dlon": dlon,
            "src": "NOAA NCEI DEM global mosaic (ETOPO 2022 + coastal DEMs), 2 arc-min", "format": "int16 LE meters, rows south->north"}
    json.dump(meta, open(f"data/bathy_{name}.json", "w"))
    print(name, nx, "x", ny, f"{os.path.getsize(f'data/bathy_{name}.bin') // 1024} KB", "deepest", int(z.min()), "m")


if __name__ == "__main__":
    names = sys.argv[1:] or [k for k in ZONES if not os.path.exists(f"data/bathy_{k}.bin")]
    for k in names:
        build(k, ZONES[k])
