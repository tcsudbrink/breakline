"""Ocean-model surface currents for the Breakline prefetch: HYCOM (ESPC-D) and NOAA RTOFS.

Neither is on a NOAA ERDDAP any more, so the GitHub Action pulls them straight from the source:
  HYCOM  - ncss.hycom.org subsetting service, one small netCDF4 per zone (water_u / water_v at the surface)
  RTOFS  - the global surface file on NOMADS (~150 MB, hourly forecasts), cut into each zone here
Both are regridded to a regular 0.08-degree lat/lon grid and saved like every other chart (8-bit PNG +
manifest entry), so the app reads them the same way. Needs: numpy, pillow, h5py.
"""
import datetime as dt
import io
import os
import urllib.request

import numpy as np

GRID = 0.08          # degrees; both models are ~1/12 to 1/25 degree
UA = {"User-Agent": "Breakline-prefetch/1.0"}


def _get(url, timeout=300):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def _h5(data):
    import h5py  # only the model step needs it
    return h5py.File(io.BytesIO(data), "r")


def _clean(a):
    a = np.asarray(a, dtype=np.float32)
    a[~np.isfinite(a) | (np.abs(a) > 10)] = np.nan
    return a


def hycom(box):
    """Surface u, v (m/s) on a regular grid, north row first. Returns lat, lon, u, v, time."""
    q = (f"var=water_u&var=water_v&north={box['n']}&south={box['s']}&west={box['w']}&east={box['e']}"
         f"&horizStride=2&time=present&vertCoord=0&accept=netcdf4")
    f = _h5(_get("https://ncss.hycom.org/thredds/ncss/FMRC_ESPC-D-V02_uv3z/FMRC_ESPC-D-V02_uv3z_best.ncd?" + q))
    lat, lon = f["lat"][:].astype(float), f["lon"][:].astype(float)
    lon = np.where(lon > 180, lon - 360, lon)
    u, v = _clean(f["water_u"][0, 0]), _clean(f["water_v"][0, 0])
    units = f["time"].attrs["units"]; units = units.decode() if isinstance(units, bytes) else units
    t0 = dt.datetime.strptime(units.split("since ")[1][:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=dt.timezone.utc)
    t = t0 + dt.timedelta(hours=float(f["time"][0]))
    return _regular(lat, lon, u, v, box) + (t,)


class Rtofs:
    """Downloads the global RTOFS surface file once per run, then cuts zones from it."""

    def __init__(self):
        now = dt.datetime.now(dt.timezone.utc)
        self.err, self.f = None, None
        # newest cycle that has the forecast hour closest to now (today's 00z appears ~09z)
        for back in (0, 1):
            day = now.date() - dt.timedelta(days=back)
            fh = now.hour + 24 * back
            url = f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/rtofs.{day:%Y%m%d}/rtofs_glo_2ds_f{fh:03d}_prog.nc"
            try:
                self.f = _h5(_get(url, 600))
                self.t = dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc) + dt.timedelta(hours=fh)
                break
            except Exception as ex:  # noqa: BLE001
                self.err = str(ex)[:90]
        if self.f is not None:
            self.lat_rows = self.f["Latitude"][:, 0].astype(float)       # regular Mercator rows south of ~47N
            self.lon_cols = self.f["Longitude"][0, :].astype(float)
            self.lon_cols = (self.lon_cols + 180) % 360 - 180

    def cut(self, box):
        if self.f is None:
            raise RuntimeError(f"RTOFS not available: {self.err}")
        r = np.where((self.lat_rows >= box["s"] - 0.2) & (self.lat_rows <= box["n"] + 0.2))[0]
        c = np.where((self.lon_cols >= box["w"] - 0.2) & (self.lon_cols <= box["e"] + 0.2))[0]
        r0, r1, c0, c1 = r.min(), r.max() + 1, c.min(), c.max() + 1
        u = _clean(self.f["u_velocity"][0, 0, r0:r1, c0:c1]); v = _clean(self.f["v_velocity"][0, 0, r0:r1, c0:c1])
        return _regular(self.lat_rows[r0:r1], self.lon_cols[c0:c1], u, v, box) + (self.t,)


def _regular(lat, lon, u, v, box):
    """Nearest-neighbour onto a regular GRID-degree box, north row first."""
    if lat[0] > lat[-1]:
        lat, u, v = lat[::-1], u[::-1], v[::-1]
    order = np.argsort(lon); lon, u, v = lon[order], u[:, order], v[:, order]
    tl = np.arange(box["n"], box["s"] - 1e-9, -GRID)
    tg = np.arange(box["w"], box["e"] + 1e-9, GRID)
    ri = np.clip(np.searchsorted(lat, tl), 1, len(lat) - 1); ri -= (tl - lat[ri - 1]) < (lat[ri] - tl)
    ci = np.clip(np.searchsorted(lon, tg), 1, len(lon) - 1); ci -= (tg - lon[ci - 1]) < (lon[ci] - tg)
    far = (np.abs(lat[ri] - tl) > 0.2)[:, None] | (np.abs(lon[ci] - tg) > 0.2)[None, :]
    U, V = u[np.ix_(ri, ci)], v[np.ix_(ri, ci)]
    U[far] = np.nan; V[far] = np.nan
    return tl, tg, U, V


def entry(out, zone, name, part, lat, lon, a, t, encode, now_iso):
    """Save one component as a PNG and return its manifest entry."""
    from PIL import Image
    fn = f"{zone}_cur_{name}{part}_{t:%Y%m%d%H}L.png"
    Image.fromarray(encode("cur", a), "L").save(os.path.join(out, fn), optimize=True)
    return {"file": fn, "enc": "cur", "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "lat0": round(float(lat[0]), 5), "dlat": round(float(lat[1] - lat[0]), 6),
            "lon0": round(float(lon[0]), 5), "dlon": round(float(lon[1] - lon[0]), 6),
            "nx": int(len(lon)), "ny": int(len(lat)), "got": now_iso()}
