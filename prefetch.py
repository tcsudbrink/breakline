"""Breakline hourly prefetch.

Pulls the slow NOAA charts for each zone once an hour and saves each one as a small 8-bit
grayscale PNG (value-encoded) plus live/manifest.json, so the app and the chart picker load them
from the Netlify CDN in about a second instead of waiting on NOAA.

    python prefetch.py [out_dir]          (default: live/)

Only fetches what isn't already in out_dir, and prunes anything older than the keep windows.
Runs on GitHub Actions every hour (.github/workflows/prefetch.yml); also works locally.
"""
import concurrent.futures as cf
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "live"
# Zones prefetched every hour (keep in sync with ZONES in app.js)
ZONES = {
    "east": dict(s=23.0, n=46.0, w=-98.0, e=-60.0),   # Texas to Nova Scotia
    "fl": dict(s=20.0, n=28.5, w=-85.0, e=-72.0),     # Florida Keys, Straits, Bahamas
    "cr": dict(s=-1.0, n=13.0, w=-96.0, e=-78.0),     # Pacific Costa Rica + Panama, out past Cocos
    "cabo": dict(s=21.0, n=27.5, w=-117.0, e=-106.5), # Cabo San Lucas, East Cape, Mag Bay
    "chiapas": dict(s=11.5, n=17.5, w=-98.0, e=-90.0),
    "cancun": dict(s=18.5, n=23.5, w=-89.0, e=-84.0),
    "puntacana": dict(s=16.5, n=21.0, w=-71.5, e=-66.0),
    "stlucia": dict(s=11.5, n=16.0, w=-63.0, e=-59.0),
}
CELL = 0.04                                           # ~4 km: plenty for overview + thumbnails
# (GOES-19 hourly covers every zone; NOAA-21's US sector reaches 142W-52W, 0-60N, so it covers them too)
HOSTS = {
    "pfeg": "https://coastwatch.pfeg.noaa.gov/erddap/",
    "cw": "https://coastwatch.noaa.gov/erddap/",
    "aoml": "https://cwcgom.aoml.noaa.gov/erddap/",
}
# key: (family, host, dataset, variable, native res, lat ascending, has altitude dim, time-of-day)
SOURCES = {
    "sst/mur": ("sst", "pfeg", "jplMURSST41", "analysed_sst", 0.01, True, False, "09:00:00Z"),
    "sst/geopolar": ("sst", "pfeg", "nesdisBLENDEDsstDNDaily", "analysed_sst", 0.05, True, False, "12:00:00Z"),
    "sst/pmday": ("sst", "cw", "noaacwLEOACSPOSSTL3SnrtPMDay", "sea_surface_temperature", 0.02, False, False, "12:00:00Z"),
    "sst/amday": ("sst", "cw", "noaacwLEOACSPOSSTL3SnrtAMDay", "sea_surface_temperature", 0.02, False, False, "12:00:00Z"),
    "sst/pmnight": ("sst", "cw", "noaacwLEOACSPOSSTL3SnrtPMNight", "sea_surface_temperature", 0.02, False, False, "12:00:00Z"),
    "sst/amnight": ("sst", "cw", "noaacwLEOACSPOSSTL3SnrtAMNight", "sea_surface_temperature", 0.02, False, False, "12:00:00Z"),
    "chl/dineof": ("chl", "pfeg", "noaacwNPPN20S3ASCIDINEOF2kmDaily", "chlor_a", 0.02083, False, True, "12:00:00Z"),
    "chl/s3a": ("chl", "cw", "noaacwS3AOLCIchlaDaily", "chlor_a", 0.0375, False, True, "12:00:00Z"),
    "chl/s3b": ("chl", "cw", "noaacwS3BOLCIchlaDaily", "chlor_a", 0.0375, False, True, "12:00:00Z"),
    "chl/n21": ("chl", "cw", "noaacwN21VIIRSchlaSectorUSDaily", "chlor_a", 0.0075, False, True, "18:00:00Z"),
    "chl/n20": ("chl", "cw", "noaacwN20VIIRSchlaDaily", "chlor_a", 0.0375, False, True, "12:00:00Z"),
    "goes": ("sst", "aoml", "goes19SSThourly", "sst", 0.02, True, False, None),
}
DAYS = {"sst": 4, "chl": 7}
GOES_HOURS = 24
# 8-bit encodings (0 = no data): SST in deg C, chlorophyll as log10(mg/m3). Mirrored in app.js (PRE_ENC).
ENC = {"sst": (-2.0, 34.0, False), "chl": (0.01, 50.0, True)}


def get(url, timeout=150):
    req = urllib.request.Request(url, headers={"User-Agent": "Breakline-prefetch/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_asc(text, var):
    sec, key = {}, None
    for line in text.split("\n"):
        m = re.match(r"^(\w+\.\w+)((?:\[\d+\])+)\s*$", line)
        if m:
            key = m.group(1); sec[key] = []; continue
        if not key:
            continue
        if not line.strip():
            key = None; continue
        sec[key].append(re.sub(r"^(\[\d+\])+,\s*", "", line))
    nums = lambda k: [x.strip() for x in ",".join(sec[k]).split(",")]  # noqa: E731
    lat = np.array([float(x) for x in nums(f"{var}.latitude")])
    lon = np.array([float(x) for x in nums(f"{var}.longitude")])
    t = float(nums(f"{var}.time")[-1])
    v = np.array([float(x) if x not in ("", "NaN") else np.nan for x in nums(f"{var}.{var}")], dtype=np.float32)
    v = v[-len(lat) * len(lon):].reshape(len(lat), len(lon))
    if lat[0] < lat[-1]:                 # store north row first (image top)
        lat, v = lat[::-1], v[::-1]
    return lat, lon, v, dt.datetime.fromtimestamp(t, dt.timezone.utc)


def encode(enc, v):
    lo, hi, log = ENC[enc]
    with np.errstate(invalid="ignore", divide="ignore"):
        if log:
            v = np.log10(np.clip(v, lo, hi)); lo, hi = math.log10(lo), math.log10(hi)
        q = np.round(1 + (np.clip(v, lo, hi) - lo) / (hi - lo) * 254)
    q[~np.isfinite(v)] = 0
    return q.astype(np.uint8)


def fetch(zone, key, when, time_str):
    """One chart for one zone. Returns a manifest entry, or {'none': True} when there was no pass."""
    fam, host, ds, var, res, asc, alt, _ = SOURCES[key]
    box = ZONES[zone]
    stride = max(1, round(CELL / res))
    la = f"({box['s']}):{stride}:({box['n']})" if asc else f"({box['n']}):{stride}:({box['s']})"
    q = f"{var}[({time_str})]{'[(0.0)]' if alt else ''}[{la}][({box['w']}):{stride}:({box['e']})]"
    lat, lon, v, t = parse_asc(get(f"{HOSTS[host]}griddap/{ds}.asc?{urllib.parse.quote(q, safe='')}"), var)
    if key == "goes":
        if t.strftime("%Y-%m-%dT%H:00:00Z") != when:
            return {"none": True}
    elif when != "latest" and t.date().isoformat() != when:   # ERDDAP snapped to another day: no pass that day
        return {"none": True}
    if not np.isfinite(v).any():
        return {"none": True, "cloud": True}
    fn = f"{zone}_{key.replace('/', '_')}_{when.replace(':', '').replace('-', '')}.png"
    Image.fromarray(encode(fam, v), "L").save(os.path.join(OUT, fn), optimize=True)
    return {
        "file": fn, "enc": fam, "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lat0": round(float(lat[0]), 5), "dlat": round(float(lat[1] - lat[0]), 6),
        "lon0": round(float(lon[0]), 5), "dlon": round(float(lon[1] - lon[0]), 6),
        "nx": int(len(lon)), "ny": int(len(lat)),
    }


def seed(base):
    """Start from what's already published (each GitHub run starts empty)."""
    try:
        man = json.loads(get(base.rstrip("/") + "/manifest.json", 60))
    except Exception as ex:  # noqa: BLE001
        print("no published manifest to seed from:", str(ex)[:60]); return
    files = [e["file"] for e in man.get("items", {}).values() if e.get("file")]

    def dl(fn):
        try:
            req = urllib.request.Request(base.rstrip("/") + "/" + fn, headers={"User-Agent": "Breakline-prefetch/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                open(os.path.join(OUT, fn), "wb").write(r.read())
            return True
        except Exception:  # noqa: BLE001
            return False
    with cf.ThreadPoolExecutor(16) as ex:
        ok = dict(zip(files, ex.map(dl, files)))
    man["items"] = {k: e for k, e in man["items"].items() if not e.get("file") or ok.get(e["file"])}
    json.dump(man, open(os.path.join(OUT, "manifest.json"), "w"), separators=(",", ":"))
    print(f"seeded {sum(ok.values())} files from {base}")


def main():
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, "manifest.json")
    if not os.path.exists(mpath) and os.environ.get("LIVE_SEED"):
        seed(os.environ["LIVE_SEED"])
    man = json.load(open(mpath)) if os.path.exists(mpath) else {"items": {}}
    items = man["items"]
    now = dt.datetime.now(dt.timezone.utc)
    today = now.date()

    jobs = []
    for zone in ZONES:
        for key, s in SOURCES.items():
            fam = s[0]
            if key == "goes":
                for h in range(3, GOES_HOURS + 3):       # GOES data lags ~4-5 h
                    hs = (now - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z")
                    e = items.get(f"{zone}/goes/{hs}")
                    if not e or (e.get("none") and h <= 8):
                        jobs.append((zone, key, hs, hs))
                continue
            if key == "chl/dineof":                      # gap-filled blend: keep the newest, refresh twice a day
                if f"{zone}/{key}/latest" not in items or now.hour % 12 == 0:
                    jobs.append((zone, key, "latest", "last"))
                continue
            for d in range(1, DAYS[fam] + 1):
                day = (today - dt.timedelta(days=d)).isoformat()
                e = items.get(f"{zone}/{key}/{day}")
                # re-check the last 2 days while missing or empty (late passes arrive)
                if e and not (d <= 2 and e.get("none")):
                    continue
                jobs.append((zone, key, day, f"{day}T{s[7]}"))

    # Fail fast: after 4 failures in a row on one NOAA server, skip it for the rest of this run
    # (it gets retried next hour) instead of waiting ~20 s on every request to a server that's down.
    fails = {h: 0 for h in HOSTS}

    def run(job):
        zone, key, when, tstr = job
        host = SOURCES[key][1]
        if fails[host] >= 4:
            return f"{zone}/{key}/{when}", None, f"skipped: {host} down this run"
        t0, err = time.time(), ""
        for _ in range(2):
            try:
                e = fetch(zone, key, when, tstr)
                fails[host] = 0
                return f"{zone}/{key}/{when}", e, round(time.time() - t0, 1)
            except Exception as ex:  # noqa: BLE001
                err = str(ex)[:90]
                if "502" in err or "503" in err or "timed out" in err:
                    fails[host] += 1
                    if fails[host] >= 4:
                        break
                time.sleep(3)
        return f"{zone}/{key}/{when}", None, err

    print(f"{len(jobs)} charts to fetch", flush=True)
    deadline = time.time() + float(os.environ.get("PREFETCH_BUDGET_S", "2400"))
    # NOAA asks for gentle clients: 4 at a time, and stop at the time budget (the rest waits for next hour)
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(run, j) for j in jobs]
        for f in cf.as_completed(futs):
            ident, e, info = f.result()
            if e is not None:
                items[ident] = e
            print(("OK  " if e and not e.get("none") else "none" if e else "FAIL"), ident, info, flush=True)
            if time.time() > deadline:
                print("time budget reached; the rest waits for the next run", flush=True)
                for g in futs:
                    g.cancel()
                break

    keep_day = (today - dt.timedelta(days=max(DAYS.values()) + 1)).isoformat()
    keep_hr = (now - dt.timedelta(hours=GOES_HOURS + 6)).strftime("%Y-%m-%dT%H")
    for ident in list(items):
        parts = ident.split("/"); when = parts[-1]
        old = (parts[1] == "goes" and when[:13] < keep_hr) or (parts[1] != "goes" and when != "latest" and when < keep_day)
        if old:
            fn = items[ident].get("file")
            if fn and os.path.exists(os.path.join(OUT, fn)):
                os.remove(os.path.join(OUT, fn))
            del items[ident]
    man.update(updated=now.strftime("%Y-%m-%dT%H:%M:%SZ"), zones=ZONES, enc=ENC)
    json.dump(man, open(mpath, "w"), separators=(",", ":"))
    ok = sum(1 for e in items.values() if not e.get("none"))
    print(f"manifest: {len(items)} entries, {ok} with data", flush=True)


if __name__ == "__main__":
    main()
