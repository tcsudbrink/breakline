"""Breakline prefetch: our own copy of NOAA's charts.

Checks NOAA every 10 minutes for new charts in each zone and saves each one as a small 8-bit
grayscale PNG (value-encoded) plus live/manifest.json, so the app and the chart picker load them
from the Netlify CDN in about a second instead of waiting on NOAA.

    python prefetch.py [out_dir]          (default: live/)

Only fetches what isn't already in out_dir, and prunes anything older than the keep windows.
Runs on GitHub Actions every 10 minutes (.github/workflows/prefetch.yml); also works locally.
If NOAA is down, the app falls back to these copies, and Find your water searches them.
Sets changed=true|false in $GITHUB_OUTPUT so the workflow only republishes when something is new.
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
    "pr": dict(s=16.5, n=20.0, w=-68.5, e=-63.5),      # Puerto Rico, USVI, BVI
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
    # Daily products kept as "latest" only (refreshed when older than LATEST_MAX_AGE_H)
    "ssh/blend": ("sla", "cw", "noaacwBLENDEDsshDaily", "sla", 0.25, True, False, None),
    "mld/ohc": ("mld", "cw", "noaacwOHC14na", "omld", 0.25, True, False, None),
    "sss/smap": ("sss", "cw", "noaacwSMAPsssDaily", "sss", 0.25, True, True, None),
    "cur/u": ("cur", "cw", "noaacwBLENDEDNRTcurrentsDaily", "u_current", 0.25, True, False, None),
    "cur/v": ("cur", "cw", "noaacwBLENDEDNRTcurrentsDaily", "v_current", 0.25, True, False, None),
}
LATEST = {"chl/dineof", "ssh/blend", "mld/ohc", "sss/smap", "cur/u", "cur/v"}
LATEST_MAX_AGE_H = 3
NOT_IN = {"mld/ohc": {"cr", "cabo"}}                   # NOAA's mixed-layer product stops short of the Pacific boxes
MODELS = ("hycom", "rtofs")                           # ocean-model currents, see models.py
MODEL_MAX_AGE_H = 3
DAYS = {"sst": 4, "chl": 7}
GOES_HOURS = 72                                       # 3 days of hourly scans: feeds the 3-day composite and the offshore pack
# 8-bit encodings (0 = no data): SST in deg C, chlorophyll as log10(mg/m3). Mirrored in app.js (PRE_ENC).
ENC = {"sst": (-2.0, 34.0, False), "chl": (0.01, 50.0, True),
       "sla": (-1.5, 1.5, False), "mld": (1.0, 1000.0, True), "sss": (20.0, 42.0, False), "cur": (-2.5, 2.5, False)}


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
    # "latest" files carry the data date, so a refreshed copy never hides behind a cached old one
    tag = t.strftime("%Y%m%d") + "L" if when == "latest" else when.replace(':', '').replace('-', '')
    fn = f"{zone}_{key.replace('/', '_')}_{tag}.png"
    Image.fromarray(encode(fam, v), "L").save(os.path.join(OUT, fn), optimize=True)
    return {
        "file": fn, "enc": fam, "time": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "lat0": round(float(lat[0]), 5), "dlat": round(float(lat[1] - lat[0]), 6),
        "lon0": round(float(lon[0]), 5), "dlon": round(float(lon[1] - lon[0]), 6),
        "nx": int(len(lon)), "ny": int(len(lat)), "got": now_iso(),
    }


def now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def age_h(e):
    """Hours since we last asked NOAA for this entry (old entries without a stamp count as old)."""
    try:
        return (dt.datetime.now(dt.timezone.utc) - dt.datetime.strptime(e["got"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)).total_seconds() / 3600
    except Exception:  # noqa: BLE001
        return 99.0


def run_goes(items, now, deadline, per_run=30):
    """Cut each missing hour of the last GOES_HOURS into every zone. Newest hours first; a slow run picks up the rest."""
    import goes
    changed, n = False, 0
    for h in range(1, GOES_HOURS + 2):                   # the files land about an hour after the scan
        hour = (now - dt.timedelta(hours=h)).replace(minute=0, second=0, microsecond=0)
        hs = hour.strftime("%Y-%m-%dT%H:00:00Z")
        ents = [items.get(f"{z}/goes/{hs}") for z in ZONES]
        # done when every zone has it; an hour NOAA hadn't posted yet is asked again after 20 minutes
        if all(e and (not e.get("none") or e.get("cloud") or age_h(e) < 0.33 or h > 8) for e in ents):
            continue
        if n >= per_run or time.time() > deadline:
            print("GOES: more hours left for the next run", flush=True); break
        n += 1
        try:
            key = goes.file_for(hour)
            if not key:
                for z in ZONES:
                    if not (items.get(f"{z}/goes/{hs}") or {}).get("file"):
                        items[f"{z}/goes/{hs}"] = {"none": True, "got": now_iso()}
                changed = True; print("none", "goes", hs, flush=True); continue
            sc = goes.Scene(key)
            for z, box in ZONES.items():
                lat, lon, v = sc.cut(box)
                if not np.isfinite(v).any():
                    items[f"{z}/goes/{hs}"] = {"none": True, "cloud": True, "got": now_iso()}; continue
                fn = f"{z}_goes_{hs.replace(':', '').replace('-', '')}.png"
                Image.fromarray(encode("sst", v), "L").save(os.path.join(OUT, fn), optimize=True)
                items[f"{z}/goes/{hs}"] = {"file": fn, "enc": "sst", "time": sc.hour.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                           "lat0": round(float(lat[0]), 5), "dlat": round(float(lat[1] - lat[0]), 6),
                                           "lon0": round(float(lon[0]), 5), "dlon": round(float(lon[1] - lon[0]), 6),
                                           "nx": int(len(lon)), "ny": int(len(lat)), "got": now_iso()}
            changed = True; print("OK  ", "goes", hs, flush=True)
        except Exception as ex:  # noqa: BLE001
            print("FAIL", "goes", hs, str(ex)[:100], flush=True)
    return changed


def run_models(items, deadline):
    import models
    due = [(z, m) for z in ZONES for m in MODELS if age_h(items.get(f"{z}/cur/{m}_u/latest") or {}) >= MODEL_MAX_AGE_H]
    if not due:
        return False
    changed, rt = False, None
    for zone, m in due:
        if time.time() > deadline:
            print("time budget reached before all model currents", flush=True); break
        try:
            if m == "rtofs":
                rt = rt or models.Rtofs()
                lat, lon, u, v, t = rt.cut(ZONES[zone])
            else:
                lat, lon, u, v, t = models.hycom(ZONES[zone])
            if not np.isfinite(u).any():
                raise RuntimeError("all empty")
            for part, a in (("_u", u), ("_v", v)):
                ident = f"{zone}/cur/{m}{part}/latest"
                old = items.get(ident)
                e = models.entry(OUT, zone, m, part, lat, lon, a, t, encode, now_iso)
                if old and old.get("file") and old["file"] != e["file"] and os.path.exists(os.path.join(OUT, old["file"])):
                    os.remove(os.path.join(OUT, old["file"]))
                items[ident] = e
            changed = True
            print("OK  ", f"{zone}/cur/{m}", t.isoformat(), flush=True)
        except Exception as ex:  # noqa: BLE001
            print("FAIL", f"{zone}/cur/{m}", str(ex)[:100], flush=True)
    return changed


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
                continue                                 # hourly GOES comes from NOAA's AWS bucket now: run_goes()
            if zone in NOT_IN.get(key, ()):
                continue
            if key in LATEST:                            # newest copy only, refreshed every few hours
                e = items.get(f"{zone}/{key}/latest")
                if not e or age_h(e) >= LATEST_MAX_AGE_H:
                    jobs.append((zone, key, "latest", "last"))
                continue
            for d in range(1, DAYS[fam] + 1):
                day = (today - dt.timedelta(days=d)).isoformat()
                e = items.get(f"{zone}/{key}/{day}")
                # re-check the last 2 days while missing or empty (late passes arrive)
                if e and not (d <= 2 and e.get("none") and age_h(e) >= 1):
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
                e.setdefault("got", now_iso())
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

    only = os.environ.get("PREFETCH_ONLY")                # testing: e.g. PREFETCH_ONLY=ssh,cur
    if only:
        jobs = [j for j in jobs if any(j[1].startswith(o) for o in only.split(","))]
    print(f"{len(jobs)} charts to fetch", flush=True)
    changed = False
    deadline = time.time() + float(os.environ.get("PREFETCH_BUDGET_S", "2400"))
    # NOAA asks for gentle clients: 4 at a time, and stop at the time budget (the rest waits for next hour)
    with cf.ThreadPoolExecutor(4) as ex:
        futs = [ex.submit(run, j) for j in jobs]
        for f in cf.as_completed(futs):
            ident, e, info = f.result()
            if e is not None:
                old = items.get(ident)
                if old and old.get("file") and e.get("file") and old["file"] != e["file"] and os.path.exists(os.path.join(OUT, old["file"])):
                    os.remove(os.path.join(OUT, old["file"]))      # replaced "latest" copy
                if old and old.get("file") and not e.get("file"):
                    continue                                       # NOAA came back empty: keep the copy we have
                items[ident] = e
                changed = True
            print(("OK  " if e and not e.get("none") else "none" if e else "FAIL"), ident, info, flush=True)
            if time.time() > deadline:
                print("time budget reached; the rest waits for the next run", flush=True)
                for g in futs:
                    g.cancel()
                break

    # Hourly GOES-19 water temp from the satellite's own files (NOAA dropped it from ERDDAP in Nov 2026)
    if not only or "goes" in only:
        changed |= run_goes(items, now, deadline + 120)
    # Ocean-model currents (HYCOM, RTOFS): every few hours, straight from the modelling centres
    if not only or "model" in only:
        changed |= run_models(items, deadline + 180)

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
            changed = True
    man.update(updated=now.strftime("%Y-%m-%dT%H:%M:%SZ"), zones=ZONES, enc=ENC)
    json.dump(man, open(mpath, "w"), separators=(",", ":"))
    ok = sum(1 for e in items.values() if not e.get("none"))
    print(f"manifest: {len(items)} entries, {ok} with data; changed={changed}", flush=True)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write("changed=" + ("true" if changed else "false") + chr(10))


if __name__ == "__main__":
    main()
