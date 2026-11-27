"""Build data/overlays.json: marine protected areas, offshore wind leases + turbines, Gulf oil & gas platforms.

Shipped with the app (and cached for offline) instead of queried live, so these layers work offshore with no
signal and don't depend on outside servers. Re-run now and then (python build_overlays.py) to pick up changes.

Sources (all public, no key):
  MPAs        NOAA MPA Inventory 2024 (MPA_noaa)          only sites that restrict fishing
  Wind leases BOEM Offshore Wind Lease Outlines (BOEM_GeoSEAS)
  Turbines    USGS US Wind Turbine Database, offshore only
  Platforms   BOEM OCS oil & gas platforms, Gulf, 2024 Q4 (Esri US Federal Data), still standing
"""
import json
import urllib.parse
import urllib.request

BOX = (-5.0, 50.0, -120.0, -50.0)       # app WORLD: s, n, w, e
UA = {"User-Agent": "Breakline-build/1.0"}


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read())


def features(base, where="1=1", fields="*", offset=0.003):
    out, start = [], 0
    while True:
        q = {"where": where, "outFields": fields, "f": "geojson", "outSR": 4326, "geometryPrecision": 4,
             "maxAllowableOffset": offset, "resultOffset": start, "resultRecordCount": 1000,
             "geometry": f"{BOX[2]},{BOX[0]},{BOX[3]},{BOX[1]}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
             "spatialRel": "esriSpatialRelIntersects"}
        d = get(base + "/query?" + urllib.parse.urlencode(q))
        fs = d.get("features", [])
        out += fs
        if len(fs) < 1000:
            return out
        start += len(fs)


def rdp(pts, tol):
    """Douglas-Peucker: drop points closer than tol (degrees) to the line they sit on."""
    if len(pts) < 3:
        return pts
    keep, stack = [0, len(pts) - 1], [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy, best, bi = x2 - x1, y2 - y1, -1.0, -1
        n2 = dx * dx + dy * dy
        for i in range(a + 1, b):
            x, y = pts[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / n2 ** 0.5 if n2 else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            if d > best:
                best, bi = d, i
        if best > tol:
            keep.append(bi); stack += [(a, bi), (bi, b)]
    return [pts[i] for i in sorted(keep)]


def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


def simple(geom, tol, min_area):
    out = []
    for ring in rings(geom):
        r = rdp(ring, tol)
        if len(r) >= 4 and area(r) >= min_area:
            out.append([[round(x, 3), round(y, 3)] for x, y in r])
    return out


def rings(geom):
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        return [r for p in geom["coordinates"] for r in p]
    return []


def main():
    out = {"built": __import__("datetime").date.today().isoformat()}

    mpa = features("https://services2.arcgis.com/C8EMgrsFcRFL6LrL/arcgis/rest/services/NOAA_MPA_Inventory_2023/FeatureServer/0",
                   where="Fish_Rstr <> 'No Site Restrictions'",
                   fields="Site_Name,Fish_Rstr,Prot_Lvl,Mgmt_Agen,URL,Constancy", offset=0.01)
    out["mpa"] = [{"n": f["properties"].get("Site_Name"), "f": f["properties"].get("Fish_Rstr"), "p": f["properties"].get("Prot_Lvl"),
                   "a": f["properties"].get("Mgmt_Agen"), "u": f["properties"].get("URL"), "c": f["properties"].get("Constancy"),
                   "r": simple(f.get("geometry"), 0.004, 0.00002)}
                  for f in mpa if rings(f.get("geometry"))]
    out["mpa"] = [m for m in out["mpa"] if m["r"]]

    wind = features("https://services7.arcgis.com/G5Ma95RzqJRPKsWL/arcgis/rest/services/Wind_Lease_Boundaries__BOEM_/FeatureServer/8", fields="*")
    def wname(p):
        for k in ("LEASE_NUMBER_COMPANY", "COMPANY", "LEASE_NAME", "Lease_Number_Company", "PROJECT_NAME"):
            if p.get(k):
                return p[k]
        return next((v for v in p.values() if isinstance(v, str) and v.strip()), "Wind lease")
    out["wind"] = [{"n": wname(f["properties"]), "r": simple(f.get("geometry"), 0.001, 0)}
                   for f in wind if rings(f.get("geometry"))]

    t = get("https://energy.usgs.gov/api/uswtdb/v1/turbines?t_offshore=eq.1&select=xlong,ylat,p_name&limit=5000")
    out["turbines"] = [[round(x["xlong"], 5), round(x["ylat"], 5), x.get("p_name") or ""] for x in t]

    plat = features("https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/OCS_Oil_And_Natural_Gas_Platforms_Gulf_2024Q4/FeatureServer/0",
                    where="REMOVAL_DATE IS NULL", fields="COMPLEX_ID_NUM", offset=0)
    out["platforms"] = [[round(f["geometry"]["coordinates"][0], 5), round(f["geometry"]["coordinates"][1], 5), f["properties"].get("COMPLEX_ID_NUM")]
                        for f in plat if f.get("geometry")]

    json.dump(out, open("data/overlays.json", "w"), separators=(",", ":"))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
