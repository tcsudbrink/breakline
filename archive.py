"""Permanent daily archive of Breakline's hourly GOES-19 water temps.

The live copy (GitHub Pages, live/) only keeps ~3 days of hours. This copies every finished UTC day that is
still in that window into the repo's `archive` branch:

    goes/<YYYY-MM-DD>/<zone>_goes_<...>.png     (same 8-bit PNGs as live/)
    goes/<YYYY-MM-DD>/index.json                 {"items": {"<zone>/goes/<hour>": entry, ...}, "enc": ...}
    goes/days.json                               ["2026-11-24", ...]  (every archived day)

The app reads it from raw.githubusercontent.com when you step the hourly chart back past the live copy.
Run inside a checkout of the archive branch:  python archive.py <archive checkout dir>
A day is (re)written only when the live copy has more hours for it than the archive does, so a day that was
partly cut off (late files, an outage) fills in on a later run while its hours are still live.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

LIVE = "https://tcsudbrink.github.io/breakline/live/"
UA = {"User-Agent": "Breakline-archive/1.0"}


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    base = os.path.join(root, "goes")
    os.makedirs(base, exist_ok=True)
    man = json.loads(get(LIVE + "manifest.json?nc=" + dt.datetime.utcnow().strftime("%H%M%S")))
    items, today = man["items"], dt.datetime.now(dt.timezone.utc).date().isoformat()
    by_day = {}
    for k, e in items.items():
        parts = k.split("/")
        if len(parts) == 3 and parts[1] == "goes":
            by_day.setdefault(parts[2][:10], {})[k] = e
    wrote = []
    for day, ents in sorted(by_day.items()):
        if day >= today:
            continue                                     # only finished days
        ddir = os.path.join(base, day)
        ipath = os.path.join(ddir, "index.json")
        old = json.load(open(ipath))["items"] if os.path.exists(ipath) else {}
        have = sum(1 for e in old.values() if e.get("file"))
        new = sum(1 for e in ents.values() if e.get("file"))
        if new <= have:
            continue
        os.makedirs(ddir, exist_ok=True)
        merged = dict(old)
        for k, e in ents.items():
            if not e.get("file"):
                merged.setdefault(k, e); continue
            dst = os.path.join(ddir, e["file"])
            if not os.path.exists(dst):
                try:
                    open(dst, "wb").write(get(LIVE + e["file"]))
                except Exception as ex:  # noqa: BLE001
                    print("skip", e["file"], str(ex)[:60]); continue
            merged[k] = e
        json.dump({"items": merged, "enc": man.get("enc"), "zones": man.get("zones")}, open(ipath, "w"), separators=(",", ":"))
        wrote.append(f"{day} ({sum(1 for e in merged.values() if e.get('file'))} hours x zones)")
    days = sorted(d for d in os.listdir(base) if os.path.exists(os.path.join(base, d, "index.json")))
    json.dump(days, open(os.path.join(base, "days.json"), "w"))
    print("archived:", ", ".join(wrote) if wrote else "nothing new", f"| {len(days)} days in the archive")


if __name__ == "__main__":
    main()
