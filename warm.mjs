// Pre-load the CDN with NOAA tiles for the main fishing grounds, so even a first look at that water
// comes from Vercel's copy (~0.1 s) instead of NOAA (3-20 s).
//
//   node warm.mjs [mur|depth|all] [budget seconds]
//
// Builds exactly the tile URLs app.js asks for (same tile grid, same number formatting), reading the
// fishing-ground boxes straight from app.js so the two never drift apart. Tiles already on the CDN come
// back as HITs in a fraction of a second; only missing ones touch NOAA, 4 at a time.
import { readFileSync } from 'node:fs';

const SITE = 'https://www.breaklinefishing.com';
const what = process.argv[2] || 'all', budget = +(process.argv[3] || 900) * 1000, t0 = Date.now();

// ---- same as app.js ----
const q = (s) => encodeURIComponent(s);
const latRange = (w, asc) => (asc ? `(${w.s}):${w.stride}:(${w.n})` : `(${w.n}):${w.stride}:(${w.s})`);
const lonRange = (w) => `(${w.w}):${w.stride}:(${w.e})`;
const TILE_CELLS = 128, TILE_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
const r4 = (x) => +x.toFixed(4);
function tileSize(res, stride) { const want = res * stride * TILE_CELLS; return [...TILE_SIZES].reverse().find((t) => t <= want) || TILE_SIZES[0]; }
function tileWins(win, res) {
  const T = tileSize(res, win.stride), pad = res * win.stride, out = [];
  for (let a = Math.floor(win.s / T); a * T < win.n; a++) for (let b = Math.floor(win.w / T); b * T < win.e; b++) {
    out.push({ a, b, T, s: r4(Math.max(a * T - pad, -89.99)), n: r4(Math.min((a + 1) * T + pad, 89.99)), w: r4(b * T - pad), e: r4((b + 1) * T + pad), stride: win.stride });
  }
  return out;
}
const MUR = { host: 'pfeg', id: 'jplMURSST41', v: 'analysed_sst', res: 0.01, asc: true };
const murUrl = (w) => `/erddap/${MUR.host}/griddap/${MUR.id}.asc?${q(`${MUR.v}[(last)][${latRange(w, MUR.asc)}][${lonRange(w)}]`)}`;
const depthUrl = (t) => `/erddap/pfeg/griddap/ETOPO_2022_v1_15s.asc?${q(`z[${latRange(t, true)}][${lonRange(t)}]`)}`;

// ---- fishing grounds from app.js (quick-jump views), widened half a degree ----
const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const views = [...app.matchAll(/view: \[\[(-?[\d.]+), (-?[\d.]+)\], \[(-?[\d.]+), (-?[\d.]+)\]\]/g)]
  .map((m) => ({ s: +m[1] - 0.5, w: +m[2] - 0.5, n: +m[3] + 0.5, e: +m[4] + 0.5 }));

const jobs = new Map();
const add = (urlFor, res, strides) => { for (const v of views) for (const stride of strides) for (const t of tileWins({ ...v, stride }, res)) jobs.set(urlFor(t), 1); };
// strides the app picks when zoomed in past 8 (phone and desktop screens); zoomed out uses the hourly saved copy
if (what === 'mur' || what === 'all') add(murUrl, MUR.res, [1, 2]);
if (what === 'depth' || what === 'all') add(depthUrl, 1 / 240, [1, 2, 3]);
const urls = [...jobs.keys()];
console.log(`${views.length} fishing grounds, ${urls.length} tiles to check`);

const tally = { HIT: 0, STALE: 0, MISS: 0, fail: 0 };
let next = 0, stopped = false;
async function worker() {
  while (next < urls.length) {
    if (Date.now() - t0 > budget) { stopped = true; return; }
    const u = urls[next++];
    try {
      const r = await fetch(SITE + u, { headers: { 'User-Agent': 'Breakline-warm/1.0' }, signal: AbortSignal.timeout(60000) });
      await r.arrayBuffer();
      const c = (r.headers.get('x-vercel-cache') || 'MISS').toUpperCase();
      if (!r.ok && r.status !== 404) tally.fail++; else tally[c in tally ? c : 'MISS']++;
    } catch (e) { tally.fail++; }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(tally), stopped ? `(time budget hit at ${next}/${urls.length}; the rest next run)` : '');
