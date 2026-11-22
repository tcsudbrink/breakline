/* Loran-C time differences for GRI 9960 (Northeast US chain).
 *
 * TD = emission delay + (secondary path time - master path time), with ellipsoidal (Vincenty)
 * distances, the standard 299.69162 m/us propagation speed and the all-seawater secondary
 * phase factor. Land-path corrections (ASF) are not modeled, so expect a small constant
 * offset in any one area; the calibration offsets in Layers take care of that.
 */
(() => {
'use strict';
const dms = (d, m, s) => d + m / 60 + s / 3600;
const STATIONS = {
  M: { name: 'Seneca', lat: dms(42, 42, 50.716), lon: -dms(76, 49, 33.308) },
  W: { name: 'Caribou', lat: dms(46, 48, 27.305), lon: -dms(67, 55, 37.159), ed: 13797.20 },
  X: { name: 'Nantucket', lat: dms(41, 15, 11.996), lon: -dms(69, 58, 38.541), ed: 26969.93 },
  Y: { name: 'Carolina Beach', lat: dms(34, 3, 46.208), lon: -dms(77, 54, 46.100), ed: 42221.65 },
  Z: { name: 'Dana', lat: dms(39, 51, 7.658), lon: -dms(87, 29, 12.086), ed: 52541.27 },
};
const V = 299.69162;   // m per microsecond

// Vincenty inverse on WGS84, meters
function dist(lat1, lon1, lat2, lon2) {
  const a = 6378137, f = 1 / 298.257223563, b = a * (1 - f), r = Math.PI / 180;
  const L = (lon2 - lon1) * r, U1 = Math.atan((1 - f) * Math.tan(lat1 * r)), U2 = Math.atan((1 - f) * Math.tan(lat2 * r));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lam = L, it = 0, sS, cS, sig, cA2, c2m;
  do {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (sS === 0) return 0;
    cS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sS, cS);
    const sA = cU1 * cU2 * sl / sS; cA2 = 1 - sA * sA;
    c2m = cA2 ? cS - 2 * sU1 * sU2 / cA2 : 0;
    const C = f / 16 * cA2 * (4 + f * (4 - 3 * cA2)), prev = lam;
    lam = L + (1 - C) * f * sA * (sig + C * sS * (c2m + C * cS * (-1 + 2 * c2m * c2m)));
    if (Math.abs(lam - prev) < 1e-12) break;
  } while (++it < 100);
  const u2 = cA2 * (a * a - b * b) / (b * b);
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dS = B * sS * (c2m + B / 4 * (cS * (-1 + 2 * c2m * c2m) - B / 6 * c2m * (-3 + 4 * sS * sS) * (-3 + 4 * c2m * c2m)));
  return b * A * (sig - dS);
}

// Secondary phase factor over seawater, microseconds (Brunavs); ramped in below 537 km
function sf(m) {
  const d = m / 1000;
  const at = (x) => 129.04398 / x - 0.40758 + 0.00064576438 * x;
  return d >= 537 ? at(d) : at(537) * d / 537;
}
const pathTime = (m) => m / V + sf(m);

function td(lat, lon, s) {
  const st = STATIONS[s], M = STATIONS.M;
  return st.ed + pathTime(dist(lat, lon, st.lat, st.lon)) - pathTime(dist(lat, lon, M.lat, M.lon));
}

// TDs -> lat/lon by Newton iteration from a starting guess
function fromTd(a, sa, b, sb, guess) {
  let [lat, lon] = guess;
  for (let i = 0; i < 30; i++) {
    const f1 = td(lat, lon, sa) - a, f2 = td(lat, lon, sb) - b, h = 1e-4;
    const j11 = (td(lat + h, lon, sa) - td(lat, lon, sa)) / h, j12 = (td(lat, lon + h, sa) - td(lat, lon, sa)) / h;
    const j21 = (td(lat + h, lon, sb) - td(lat, lon, sb)) / h, j22 = (td(lat, lon + h, sb) - td(lat, lon, sb)) / h;
    const det = j11 * j22 - j12 * j21; if (!det) return null;
    const dlat = (f1 * j22 - f2 * j12) / det, dlon = (j11 * f2 - j21 * f1) / det;
    lat -= dlat; lon -= dlon;
    if (Math.abs(dlat) + Math.abs(dlon) < 1e-9) return [lat, lon];
  }
  return Number.isFinite(lat) ? [lat, lon] : null;
}

window.Loran = { STATIONS, td, fromTd };
})();
