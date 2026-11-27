// GET /api/warm: pre-load Vercel's CDN with NOAA tiles for the main fishing grounds, so even a first look at
// that water comes from the CDN (~0.1 s) instead of NOAA (5-25 s). Runs here (Vercel's East Coast region)
// rather than on GitHub, because the CDN cache is per region and this is the one East Coast boats hit.
// The prefetch Action calls it every ~10 minutes; each call works through the next slice of the tile list for
// up to ~50 s, so the whole list cycles every few hours. Tiles already on the CDN come back in a blink; only
// missing or expired ones touch NOAA, 6 at a time. Builds exactly the tile URLs app.js asks for.
const SITE = 'https://www.breaklinefishing.com';
const PER_CALL = 90, BUDGET_MS = 50000;

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
    out.push({ s: r4(Math.max(a * T - pad, -89.99)), n: r4(Math.min((a + 1) * T + pad, 89.99)), w: r4(b * T - pad), e: r4((b + 1) * T + pad), stride: win.stride });
  }
  return out;
}
const murUrl = (w) => `/erddap/pfeg/griddap/jplMURSST41.asc?${q(`analysed_sst[(last)][${latRange(w, true)}][${lonRange(w)}]`)}`;
const depthUrl = (t) => `/erddap/pfeg/griddap/ETOPO_2022_v1_15s.asc?${q(`z[${latRange(t, true)}][${lonRange(t)}]`)}`;

let LIST = null;
async function tileList() {
  if (LIST) return LIST;
  // the fishing grounds are the quick-jump views in app.js, widened half a degree
  const app = await (await fetch(`${SITE}/app.js`)).text();
  const views = [...app.matchAll(/view: \[\[(-?[\d.]+), (-?[\d.]+)\], \[(-?[\d.]+), (-?[\d.]+)\]\]/g)]
    .map((m) => ({ s: +m[1] - 0.5, w: +m[2] - 0.5, n: +m[3] + 0.5, e: +m[4] + 0.5 }));
  const urls = new Set();
  // strides the app picks zoomed in past 8 on phones and desktops (zoomed out uses the hourly saved copy)
  for (const stride of [1, 2]) for (const v of views) for (const t of tileWins({ ...v, stride }, 0.01)) urls.add(murUrl(t));
  for (const stride of [1, 2, 3]) for (const v of views) for (const t of tileWins({ ...v, stride }, 1 / 240)) urls.add(depthUrl(t));
  LIST = [...urls];
  return LIST;
}

export async function GET() {
  const t0 = Date.now(), list = await tileList();
  // a fixed rotation by clock: water temp tiles first, then the never-changing seafloor (~6.5 h per lap)
  const slots = Math.ceil(list.length / PER_CALL), slot = Math.floor(Date.now() / 600000) % slots;
  const mine = list.slice(slot * PER_CALL, slot * PER_CALL + PER_CALL);
  const tally = { HIT: 0, STALE: 0, MISS: 0, fail: 0, skipped: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < mine.length) {
      const u = mine[next++];
      if (Date.now() - t0 > BUDGET_MS) { tally.skipped++; continue; }
      try {
        const r = await fetch(SITE + u, { headers: { 'User-Agent': 'Breakline-warm/1.0' }, signal: AbortSignal.timeout(Math.max(5000, BUDGET_MS - (Date.now() - t0))) });
        await r.arrayBuffer();
        const c = (r.headers.get('x-vercel-cache') || 'MISS').toUpperCase();
        if (!r.ok && r.status !== 404) tally.fail++; else tally[c in tally ? c : 'MISS']++;
      } catch (e) { tally.fail++; }
    }
  }));
  return Response.json({ slot, of: slots, tiles: mine.length, total: list.length, ms: Date.now() - t0, region: process.env.VERCEL_REGION || null, ...tally },
    { headers: { 'Cache-Control': 'no-store' } });
}
