/* Solunar + sun + tides for Breakline.
 *
 * Moon/sun positions use the standard low-precision formulas (Meeus / "SunCalc"-style, good to about a minute,
 * which is plenty for fishing windows). Solunar theory (John Alden Knight):
 *   major periods ≈ 2 h centred on the moon's upper transit (overhead) and lower transit (underfoot)
 *   minor periods ≈ 1 h centred on moonrise and moonset
 * Windows that line up with sunrise/sunset or a tide change are flagged as the best of the day.
 */
(() => {
'use strict';
const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = (t) => t / dayMs - 0.5 + J1970 - J2000;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d), C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  return { ra: ra(L, 0), dec: dec(L, 0) };
}
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d);
  const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F);
  return { ra: ra(l, b), dec: dec(l, b), dist: 385001 - 20905 * Math.cos(M) };
}
// altitude (deg) and hour angle (rad, -pi..pi; 0 = due south/overhead transit) of a body
function pos(body, t, lat, lon) {
  const d = toDays(t), c = body === 'moon' ? moonCoords(d) : sunCoords(d), phi = lat * rad;
  let H = sidereal(d, -lon * rad) - c.ra; H = Math.atan2(Math.sin(H), Math.cos(H));
  return { alt: Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H)) / rad, H };
}
function illumination(t) {
  const d = toDays(t), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI };
}
function phaseName(p) {
  const n = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return n[Math.round(p * 8) % 8];
}

// Events for one local day [t0, t0+24h): scan every 2 minutes for crossings, then refine linearly.
function dayEvents(t0, lat, lon) {
  const step = 2 * 60e3, ev = [];
  let pm = pos('moon', t0, lat, lon), ps = pos('sun', t0, lat, lon);
  for (let t = t0 + step; t <= t0 + dayMs; t += step) {
    const m = pos('moon', t, lat, lon), s = pos('sun', t, lat, lon);
    const at = (a, b) => t - step + step * a / (a - b);      // linear interpolate the zero crossing
    const hM = 0.133, hS = -0.833;
    if ((pm.alt - hM) * (m.alt - hM) < 0) ev.push({ t: at(pm.alt - hM, m.alt - hM), k: m.alt > pm.alt ? 'moonrise' : 'moonset' });
    if ((ps.alt - hS) * (s.alt - hS) < 0) ev.push({ t: at(ps.alt - hS, s.alt - hS), k: s.alt > ps.alt ? 'sunrise' : 'sunset' });
    if (pm.H < 0 && m.H >= 0 && m.H - pm.H < 1) ev.push({ t: at(pm.H, m.H), k: 'overhead' });          // upper transit
    if (pm.H > 2 && m.H < -2) ev.push({ t: t - step / 2, k: 'underfoot' });                            // lower transit (H wraps pi -> -pi)
    pm = m; ps = s;
  }
  return ev.sort((a, b) => a.t - b.t);
}

// Tide highs/lows from an hourly series [{t, h}] (parabolic peak refinement)
function tideTurns(series) {
  const out = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1].h, b = series[i].h, c = series[i + 1].h;
    if (a == null || b == null || c == null) continue;
    if ((b > a && b >= c) || (b < a && b <= c)) {
      const den = a - 2 * b + c, off = den ? 0.5 * (a - c) / den : 0;
      out.push({ t: series[i].t + off * 3600e3, k: b > a ? 'high' : 'low', h: b - 0.25 * (a - c) * off });
    }
  }
  return out;
}

// Build the fishing-times summary for a local day.
function summary(t0, lat, lon, tides) {
  const ev = dayEvents(t0, lat, lon), wins = [];
  const sunEv = ev.filter((x) => x.k === 'sunrise' || x.k === 'sunset'), tideEv = (tides || []).filter((x) => x.t >= t0 - 3 * 3600e3 && x.t <= t0 + dayMs + 3 * 3600e3);
  for (const x of ev) {
    const major = x.k === 'overhead' || x.k === 'underfoot', minor = x.k === 'moonrise' || x.k === 'moonset';
    if (!major && !minor) continue;
    const half = (major ? 60 : 30) * 60e3, w = { a: x.t - half, b: x.t + half, kind: major ? 'major' : 'minor', why: x.k, score: major ? 3 : 2, tags: [] };
    const near = (y, mins) => Math.abs(y.t - x.t) <= mins * 60e3 + half;
    const sun = sunEv.find((y) => near(y, 60)); if (sun) { w.score += 1.5; w.tags.push(sun.k); }
    const tide = tideEv.find((y) => near(y, 60)); if (tide) { w.score += 1; w.tags.push(`${tide.k} tide turning`); }
    wins.push(w);
  }
  const ill = illumination(t0 + dayMs / 2), d = Math.min(ill.phase, Math.abs(ill.phase - 0.5), 1 - ill.phase);   // distance to new/full
  const moonScore = 1 - d / 0.25;                // 1 at new/full moon, 0 at the quarters
  const stars = 1 + Math.round(3 * moonScore);   // 1-4
  return { events: ev, windows: wins.sort((a, b) => a.a - b.a), tides: tideEv, ill, phase: phaseName(ill.phase), stars, moonScore };
}

window.Solunar = { summary, tideTurns, illumination, phaseName };
})();
