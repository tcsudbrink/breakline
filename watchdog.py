"""Watchdog for Breakline's saved data. Runs on its own GitHub schedule (independent of the prefetch chain).

- Newest hourly GOES-19 water temp older than STALE_H hours, or the manifest not updated for MANIFEST_H hours:
  open a GitHub issue (GitHub emails the repo owner) and restart the prefetch chain if nothing is queued.
- Back to normal: comment and close the issue (that email says it recovered).
Needs GH_TOKEN (issues: write, actions: write) and GITHUB_REPOSITORY.
"""
import datetime as dt
import json
import os
import urllib.request

LIVE = "https://tcsudbrink.github.io/breakline/live/manifest.json"
STALE_H, MANIFEST_H = 3.0, 1.5
TITLE = "Breakline data is stale"
API = f"https://api.github.com/repos/{os.environ.get('GITHUB_REPOSITORY', 'tcsudbrink/breakline')}"
TOKEN = os.environ.get("GH_TOKEN", "")


def gh(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json", "User-Agent": "breakline-watchdog"})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read()
        return json.loads(t) if t else None


def hours_since(iso, now):
    return (now - dt.datetime.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)).total_seconds() / 3600


def main():
    now = dt.datetime.now(dt.timezone.utc)
    problems = []
    try:
        man = json.loads(urllib.request.urlopen(urllib.request.Request(LIVE + "?nc=" + now.strftime("%H%M%S"), headers={"User-Agent": "breakline-watchdog"}), timeout=60).read())
        hours = sorted(k.split("/")[2] for k, e in man["items"].items() if k.startswith("east/goes/") and e.get("file"))
        newest = hours[-1] if hours else None
        age = hours_since(newest, now) if newest else 999
        mage = hours_since(man.get("updated", "2000-01-01T00:00:00Z"), now)
        print(f"newest hourly temp {newest} ({age:.1f} h old); manifest updated {mage:.1f} h ago")
        if age > STALE_H:
            problems.append(f"The newest hourly water temp is **{age:.1f} hours old** ({newest}). Normally it is 1-2 hours old.")
        if mage > MANIFEST_H:
            problems.append(f"The saved charts haven't been updated for **{mage:.1f} hours** (the prefetch normally runs every 10 minutes).")
    except Exception as ex:  # noqa: BLE001
        problems.append(f"Couldn't read the saved-chart manifest at all: `{str(ex)[:120]}`")

    open_issues = [i for i in gh("GET", "/issues?state=open&per_page=50") if i["title"] == TITLE and "pull_request" not in i]
    if problems:
        restarted = ""
        try:
            busy = sum(gh("GET", f"/actions/workflows/prefetch.yml/runs?status={s}&per_page=1")["total_count"] for s in ("queued", "in_progress", "pending", "waiting"))
            if not busy:
                gh("POST", "/actions/workflows/prefetch.yml/dispatches", {"ref": "main"})
                restarted = "\n\nNo prefetch run was queued or running, so the watchdog **restarted it**."
        except Exception as ex:  # noqa: BLE001
            restarted = f"\n\nCouldn't restart the prefetch: `{str(ex)[:100]}`"
        body = "\n\n".join(problems) + restarted + f"\n\nChecked {now:%Y-%m-%d %H:%M} UTC. This issue closes by itself when the data is fresh again."
        if open_issues:
            print("still stale; issue already open:", open_issues[0]["html_url"])
        else:
            i = gh("POST", "/issues", {"title": TITLE, "body": body})
            print("opened", i["html_url"])
    else:
        for i in open_issues:
            gh("POST", f"/issues/{i['number']}/comments", {"body": f"Back to normal at {now:%Y-%m-%d %H:%M} UTC: hourly water temps and the saved charts are fresh again."})
            gh("PATCH", f"/issues/{i['number']}", {"state": "closed"})
            print("closed", i["html_url"])
        print("all fresh")


if __name__ == "__main__":
    main()
