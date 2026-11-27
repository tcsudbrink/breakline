"""Hourly GOES-19 water temperature for the Breakline prefetch, straight from NOAA's public AWS bucket.

NOAA took the hourly GOES-19 SST off ERDDAP (AOML's goes19SSThourly, gone Nov 25 2026), so the Action reads the
satellite's own Level-2 product instead: ABI-L2-SSTF, one full-disk file per hour (~25 MB, about an hour after the
scan). Each file is cut into every zone on a regular 0.04-degree grid (nearest pixel, good-quality pixels only)
and saved exactly like the old hourly charts, so the app needs no change. Needs: numpy, h5py.
"""
import datetime as dt
import io
import re
import urllib.request

import numpy as np

BUCKET = "https://noaa-goes19.s3.amazonaws.com"   # GOES-East; GOES-West (Hawaii, the eastern Pacific) is noaa-goes18
bucket = lambda sat=19: f"https://noaa-goes{sat}.s3.amazonaws.com"  # noqa: E731
UA = {"User-Agent": "Breakline-prefetch/1.0"}
CELL = 0.04


def _get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def file_for(hour, sat=19):
    """S3 key of the full-disk SST file whose scan starts in this UTC hour, or None."""
    lst = _get(f"{bucket(sat)}/?list-type=2&prefix=ABI-L2-SSTF/{hour:%Y}/{hour:%j}/{hour:%H}/", 60).decode()
    keys = re.findall(r"<Key>([^<]+\.nc)</Key>", lst)
    return keys[0] if keys else None


class Scene:
    def __init__(self, key, sat=19):
        import h5py
        self.f = h5py.File(io.BytesIO(_get(f"{bucket(sat)}/{key}", 300)), "r")
        p = self.f["goes_imager_projection"].attrs
        g = lambda k: float(np.ravel(p[k])[0])  # noqa: E731
        self.req, self.rpol = g("semi_major_axis"), g("semi_minor_axis")
        self.H = g("perspective_point_height") + self.req
        self.lon0 = np.radians(g("longitude_of_projection_origin"))
        xa, ya = self.f["x"].attrs, self.f["y"].attrs
        self.xs, self.xo = float(np.ravel(xa["scale_factor"])[0]), float(np.ravel(xa["add_offset"])[0])
        self.ys, self.yo = float(np.ravel(ya["scale_factor"])[0]), float(np.ravel(ya["add_offset"])[0])
        self.nx, self.ny = self.f["x"].shape[0], self.f["y"].shape[0]
        m = re.search(r"_s(\d{4})(\d{3})(\d{2})", key)
        self.hour = dt.datetime(int(m.group(1)), 1, 1, int(m.group(3)), tzinfo=dt.timezone.utc) + dt.timedelta(days=int(m.group(2)) - 1)

    def _index(self, lat, lon):
        """Fixed-grid column/row for lat/lon arrays (GOES-R PUG inverse projection); -1 where not visible."""
        phi, lam = np.radians(lat), np.radians(lon)
        e2 = (self.req ** 2 - self.rpol ** 2) / self.req ** 2
        pc = np.arctan(self.rpol ** 2 / self.req ** 2 * np.tan(phi))
        rc = self.rpol / np.sqrt(1 - e2 * np.cos(pc) ** 2)
        sx = self.H - rc * np.cos(pc) * np.cos(lam - self.lon0)
        sy = -rc * np.cos(pc) * np.sin(lam - self.lon0)
        sz = rc * np.sin(pc)
        vis = self.H * (self.H - sx) >= sy ** 2 + (self.req ** 2 / self.rpol ** 2) * sz ** 2
        x = np.arcsin(-sy / np.sqrt(sx ** 2 + sy ** 2 + sz ** 2)); y = np.arctan(sz / sx)
        i = np.rint((x - self.xo) / self.xs).astype(int); j = np.rint((y - self.yo) / self.ys).astype(int)
        ok = vis & (i >= 0) & (i < self.nx) & (j >= 0) & (j < self.ny)
        return np.where(ok, i, -1), np.where(ok, j, -1)

    def cut(self, box):
        """SST in deg C on a regular CELL grid, north row first: lat, lon, v."""
        lat = np.arange(box["n"], box["s"] - 1e-9, -CELL); lon = np.arange(box["w"], box["e"] + 1e-9, CELL)
        LA, LO = np.meshgrid(lat, lon, indexing="ij")
        i, j = self._index(LA, LO)
        out = np.full(LA.shape, np.nan, np.float32)
        ok = i >= 0
        if not ok.any():
            return lat, lon, out
        i0, i1, j0, j1 = i[ok].min(), i[ok].max() + 1, j[ok].min(), j[ok].max() + 1
        sst = self.f["SST"]; a = sst.attrs
        raw = sst[j0:j1, i0:i1]
        if str(np.ravel(a.get("_Unsigned", [b"false"]))[0]).lower().find("true") >= 0:
            raw = raw.view(np.uint16)
        fill = np.ravel(a.get("_FillValue", [None]))[0]
        k = raw.astype(np.float32) * float(np.ravel(a["scale_factor"])[0]) + float(np.ravel(a["add_offset"])[0]) - 273.15
        bad = (self.f["DQF"][j0:j1, i0:i1] != 0)
        if fill is not None:
            bad |= raw == (np.uint16(fill) if raw.dtype == np.uint16 else fill)
        k[bad | (k < -2.5) | (k > 40)] = np.nan
        out[ok] = k[j[ok] - j0, i[ok] - i0]
        return lat, lon, out
