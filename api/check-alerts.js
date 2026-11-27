// POST /api/check-alerts: checks every active water alert against Breakline's newest saved charts and emails
// the owner when the water they saved shows up inside their run. The prefetch Action calls this after each
// publish (up to every 10 minutes). No secret needed: each alert is checked at most every 4 minutes, and an
// email only goes out when the water first appears, or once a day while it's still there.
// Matching mirrors Find your water in app.js (same grids, same cutoffs).
import zlib from 'node:zlib';
import { env, json, sbAdmin, sendEmail } from './_lib.js';

const LIVE = 'https://tcsudbrink.github.io/breakline/live/';
const SITE = 'https://www.breaklinefishing.com';
const CELL = 0.04, FATHOM = 1.8288;
const BRK = { hourly: { on: 0.27, strong: 0.4, off: 0.1 }, blend: { on: 0.15, strong: 0.21, off: 0.06 } };
const BATHY = ['2m', 'fl', 'cr', 'cabo', 'chiapas', 'cancun', 'puntacana', 'stlucia'];

// ---- 8-bit grayscale PNG (what prefetch.py writes) ----
function decodePng(buf) {
  let p = 8, w = 0, h = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[9] !== 0 || d[12] !== 0) throw new Error('unexpected PNG format'); }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)], src = y * (w + 1) + 1, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = x ? out[row + x - 1] : 0, b = y ? out[row - w + x] : 0, c = x && y ? out[row - w + x - 1] : 0, v = raw[src + x];
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[row + x] = r & 255;
    }
  }
  return { w, h, px: out };
}
const cache = new Map();
async function getBuf(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(async (r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()); }));
  return cache.get(url);
}
async function grid(man, e, conv) {
  const key = `g:${e.file}`;
  if (cache.has(key)) return cache.get(key);
  const pr = (async () => {
    const { px } = decodePng(await getBuf(LIVE + e.file)), [lo0, hi0, log] = man.enc[e.enc];
    const lo = log ? Math.log10(lo0) : lo0, hi = log ? Math.log10(hi0) : hi0, v = new Float32Array(e.nx * e.ny);
    for (let k = 0; k < v.length; k++) { const q = px[k]; if (q <= 1) { v[k] = NaN; continue; } const x = lo + (q - 1) / 254 * (hi - lo); v[k] = conv(log ? 10 ** x : x); }
    return { nx: e.nx, ny: e.ny, lat0: e.lat0, dlat: e.dlat, lon0: e.lon0, dlon: e.dlon, v, time: e.time };   // row 0 = north
  })();
  cache.set(key, pr); return pr;
}
function sample(g, lat, lon, vals) {
  if (!g) return NaN;
  const fy = (lat - g.lat0) / g.dlat, fx = (lon - g.lon0) / g.dlon, j = Math.round(fy), i = Math.round(fx);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return NaN;
  return (vals || g.v)[j * g.nx + i];
}
function gradNm(g) {
  const out = new Float32Array(g.nx * g.ny).fill(NaN), dy = Math.abs(g.dlat) * 60;
  for (let j = 1; j < g.ny - 1; j++) {
    const dx = g.dlon * 60 * Math.cos((g.lat0 + j * g.dlat) * Math.PI / 180);
    for (let i = 1; i < g.nx - 1; i++) { const k = j * g.nx + i, m = Math.hypot((g.v[k + 1] - g.v[k - 1]) / (2 * dx), (g.v[k + g.nx] - g.v[k - g.nx]) / (2 * dy)); if (m === m) out[k] = m; }
  }
  return { ...g, v: out };
}
function rangeBearing(a, b) {
  const R = 3440.065, f1 = a[0] * Math.PI / 180, f2 = b[0] * Math.PI / 180, dl = (b[1] - a[1]) * Math.PI / 180;
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2));
  const brg = (Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)) * 180 / Math.PI + 360) % 360;
  return [d, brg];
}
async function bathyFor(box) {
  for (const n of BATHY) {
    const m = JSON.parse((await getBuf(`${SITE}/data/bathy_${n}.json`)).toString());
    if (box.s >= m.lat0 && box.w >= m.lon0 && box.n <= m.lat0 + (m.ny - 1) * m.dlat && box.e <= m.lon0 + (m.nx - 1) * m.dlon) {
      const b = await getBuf(`${SITE}/data/bathy_${n}.bin`), z = new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
      return { nx: m.nx, ny: m.ny, lat0: m.lat0, dlat: m.dlat, lon0: m.lon0, dlon: m.dlon, v: z };   // row 0 = south
    }
  }
  return null;
}
const SST_C = (c) => (c > -2.5 && c < 40 ? c * 9 / 5 + 32 : NaN), CHL = (x) => (x > 0 && x < 200 ? x : NaN), OK = (x) => (Math.abs(x) < 2.4 ? x : NaN);
const inR = (x, lo, hi) => x === x && (lo == null || x >= lo) && (hi == null || x <= hi);

async function matchAlert(man, c) {
  const R = Math.max(5, Math.min(400, +c.run || 60)), pla = +c.portLat, plo = +c.portLon;
  if (!(pla === pla && plo === plo)) throw new Error('alert has no port position');
  const dLa = R / 60, dLo = R / (60 * Math.cos(pla * Math.PI / 180));
  let box = { s: pla - dLa, n: pla + dLa, w: plo - dLo, e: plo + dLo };
  const zs = Object.entries(man.zones).map(([k, b]) => [k, b, Math.max(0, Math.min(b.n, box.n) - Math.max(b.s, box.s)) * Math.max(0, Math.min(b.e, box.e) - Math.max(b.w, box.w)), (b.n - b.s) * (b.e - b.w)])
    .filter((z) => z[2] > 0).sort((a, b) => b[2] - a[2] || a[3] - b[3]);
  if (!zs.length) return { none: 'no saved charts there' };
  const [zone, zb] = zs[0];
  box = { s: Math.max(box.s, zb.s), n: Math.min(box.n, zb.n), w: Math.max(box.w, zb.w), e: Math.min(box.e, zb.e) };
  const on = (k) => c[k]?.on, items = man.items, latest = (key) => items[`${zone}/${key}/latest`]?.file ? items[`${zone}/${key}/latest`] : null;
  const src = c.tempSrc === 'blend' ? 'blend' : 'hourly';
  let T = null;
  if (on('temp') || on('front')) {
    if (src === 'hourly') {
      const hrs = Object.keys(items).filter((k) => k.startsWith(`${zone}/goes/`) && items[k].file).sort().slice(-24);
      if (hrs.length) {
        const gs = await Promise.all(hrs.map((k) => grid(man, items[k], SST_C))), last = gs[gs.length - 1], v = last.v.slice();
        for (let k = gs.length - 2; k >= 0; k--) for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) v[i] = gs[k].v[i];
        T = { ...last, v };
      }
    } else {
      const ks = Object.keys(items).filter((k) => (k.startsWith(`${zone}/sst/mur/`) || k.startsWith(`${zone}/sst/geopolar/`)) && items[k].file).sort((a, b) => a.split('/').pop().localeCompare(b.split('/').pop()));
      if (ks.length) T = await grid(man, items[ks[ks.length - 1]], SST_C);
    }
  }
  // color: newest clear pass from the last 3 days at each spot, NOAA's gap-filled DINEOF under it (same as the app)
  let chl = null;
  if (on('chl')) {
    const base = latest('chl/dineof') ? await grid(man, latest('chl/dineof'), CHL) : null;
    const cut = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
    const keys = Object.keys(items).filter((k) => k.startsWith(`${zone}/chl/`) && /\/chl\/(n21|n20|s3a|s3b)\//.test(k) && items[k].file && k.split('/').pop() >= cut)
      .sort((a, b) => b.split('/').pop().localeCompare(a.split('/').pop()));
    const passes = await Promise.all(keys.map((k) => grid(man, items[k], CHL))), g0 = base || passes[0];
    if (g0) {
      const v = new Float32Array(g0.nx * g0.ny);
      for (let j = 0; j < g0.ny; j++) for (let i = 0; i < g0.nx; i++) {
        const la = g0.lat0 + j * g0.dlat, lo = g0.lon0 + i * g0.dlon; let x = NaN;
        for (const p of passes) { x = sample(p, la, lo); if (x === x) break; }
        v[j * g0.nx + i] = x === x ? x : base ? base.v[j * g0.nx + i] : NaN;
      }
      chl = { ...g0, v, time: passes.length ? passes[0].time : base.time };
    }
  }
  const cs = c.curSrc && c.curSrc !== 'sat' ? c.curSrc : null, ue = on('cur') && latest(cs ? `cur/${cs}_u` : 'cur/u'), ve = on('cur') && latest(cs ? `cur/${cs}_v` : 'cur/v');
  const cu = ue && ve ? await grid(man, ue, OK) : null, cv = ue && ve ? await grid(man, ve, OK) : null;
  const mld = on('mld') && latest('mld/ohc') ? await grid(man, latest('mld/ohc'), (m) => (m > 0 && m < 3000 ? m * 3.28084 : NaN)) : null;
  const sal = on('sal') && latest('sss/smap') ? await grid(man, latest('sss/smap'), (x) => (x > 20 && x < 42 ? x : NaN)) : null;
  const dep = await bathyFor(box);                    // also tells water from land
  const tg = on('front') && T ? gradNm(T) : null, sg = on('sal') && c.sal.mode === 'edge' && sal ? gradNm(sal) : null;
  let salCut = Infinity;
  if (sg) { const xs = Array.from(sg.v).filter((x) => x === x).sort((a, b) => a - b); if (xs.length) salCut = Math.max(0.004, xs[Math.floor(xs.length * 0.8)]); }
  const use = { depth: on('depth') && dep, temp: on('temp') && T, front: tg, chl, cur: cu, mld, sal };
  if (!Object.values(use).some(Boolean)) return { none: 'no data for the settings' };
  const nx = Math.round((box.e - box.w) / CELL) + 1, ny = Math.round((box.n - box.s) / CELL) + 1, hit = new Uint8Array(nx * ny);
  const depAt = (la, lo) => { if (!dep) return NaN; const j = Math.round((la - dep.lat0) / dep.dlat), i = Math.round((lo - dep.lon0) / dep.dlon); return i < 0 || j < 0 || i >= dep.nx || j >= dep.ny ? NaN : dep.v[j * dep.nx + i]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const la = box.s + j * CELL, lo = box.w + i * CELL;
    if (rangeBearing([pla, plo], [la, lo])[0] > R) continue;
    const z = depAt(la, lo), t = T ? sample(T, la, lo) : NaN;
    if (dep ? !(z < 0) : t !== t) continue;
    if (use.depth && !inR(-z / FATHOM, c.depth.lo, c.depth.hi)) continue;
    if (use.temp && !inR(t, c.temp.lo, c.temp.hi)) continue;
    if (tg) { const g = sample(tg, la, lo), cut = BRK[src]; if (!(c.front.mode === 'off' ? g < cut.off : g >= cut[c.front.mode])) continue; }
    if (chl && !inR(sample(chl, la, lo), c.chl.lo, c.chl.hi)) continue;
    if (cu && !inR(Math.hypot(sample(cu, la, lo), sample(cv, la, lo)) * 1.94384, c.cur.lo, c.cur.hi)) continue;
    if (mld && !inR(sample(mld, la, lo), c.mld.lo, c.mld.hi)) continue;
    if (sal && !(c.sal.mode === 'edge' ? sample(sg, la, lo) >= salCut : inR(sample(sal, la, lo), c.sal.lo, c.sal.hi))) continue;
    hit[j * nx + i] = 1;
  }
  // patches: total area, and the biggest one's middle
  const lab = new Int32Array(nx * ny).fill(-1); let total = 0, best = null, patches = 0;
  for (let k0 = 0; k0 < hit.length; k0++) {
    if (!hit[k0] || lab[k0] >= 0) continue;
    const st = [k0], cells = []; lab[k0] = patches;
    while (st.length) { const k = st.pop(), j = Math.floor(k / nx), i = k % nx; cells.push(k);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj, ii = i + di, kk = jj * nx + ii; if (jj >= 0 && jj < ny && ii >= 0 && ii < nx && hit[kk] && lab[kk] < 0) { lab[kk] = patches; st.push(kk); } } }
    patches++;
    let a = 0, sla = 0, slo = 0;
    for (const k of cells) { const la = box.s + Math.floor(k / nx) * CELL, lo = box.w + (k % nx) * CELL; a += (CELL * 60) ** 2 * Math.cos(la * Math.PI / 180); sla += la; slo += lo; }
    total += a;
    if (!best || a > best.a) {
      const cla = sla / cells.length, clo = slo / cells.length; let bk = cells[0], bd = Infinity;
      for (const k of cells) { const d = (box.s + Math.floor(k / nx) * CELL - cla) ** 2 + (box.w + (k % nx) * CELL - clo) ** 2; if (d < bd) { bd = d; bk = k; } }
      best = { a, lat: box.s + Math.floor(bk / nx) * CELL, lon: box.w + (bk % nx) * CELL };
    }
  }
  const asof = [T && `${src === 'hourly' ? 'hourly temp' : 'temp blend'} ${T.time}`, chl && `color ${chl.time}`, cu && `currents ${cu.time}`].filter(Boolean).join(', ');
  if (!best) return { match: null, asof };
  const [dist, brg] = rangeBearing([pla, plo], [best.lat, best.lon]);
  return { match: { nm2: Math.round(total), patches, biggest: Math.round(best.a), lat: +best.lat.toFixed(4), lon: +best.lon.toFixed(4), dist: Math.round(dist), brg: Math.round(brg), asof } };
}

export async function POST() {
  if (!env.SUPABASE_SECRET_KEY) return json({ error: 'not_configured' }, 503);
  const since = new Date(Date.now() - 4 * 60e3).toISOString();
  const alerts = await sbAdmin(`water_alerts?active=eq.true&or=(last_checked.is.null,last_checked.lt.${since})&order=last_checked.asc.nullsfirst&limit=40&select=*`);
  if (!alerts.length) return json({ checked: 0 });
  const man = await (await fetch(`${LIVE}manifest.json?t=${Date.now()}`)).json();
  let sent = 0; const out = [];
  for (const a of alerts) {
    try {
      const r = await matchAlert(man, a.criteria), m = r.match && r.match.nm2 >= (a.min_nm2 || 5) ? r.match : null, now = new Date().toISOString();
      const due = m && a.notify_email && (!a.last_match || !a.last_notified_at || Date.now() - Date.parse(a.last_notified_at) > 24 * 3600e3);
      let notified = a.last_notified_at;
      if (due && env.RESEND_API_KEY) {
        const owner = (await sbAdmin(`profiles?id=eq.${a.user_id}&select=email,first_name`))?.[0];
        if (owner?.email) {
          const port = a.criteria.port || 'your port', link = `${SITE}/app?alert=${a.id}`;
          await sendEmail({
            to: [owner.email], subject: `Your water is back: ${a.name}`,
            html: `<p style="font-family:Arial,sans-serif;font-size:16px">${owner.first_name ? `${owner.first_name}, the` : 'The'} water you saved as <b>${esc(a.name)}</b> is showing up inside your ${Math.round(a.criteria.run)} nm run from ${esc(port)}.</p>
              <p style="font-family:Arial,sans-serif;font-size:16px"><b>${m.nm2.toLocaleString()} sq nm</b> in ${m.patches} patch${m.patches === 1 ? '' : 'es'}. The biggest is ${m.dist} nm at ${m.brg}°T (${m.lat.toFixed(3)}, ${m.lon.toFixed(3)}).</p>
              <p><a href="${link}" style="display:inline-block;background:#35c2ff;color:#04121d;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:8px;font-family:Arial,sans-serif">Show me on the chart</a></p>
              <p style="font-family:Arial,sans-serif;font-size:12px;color:#777">Data: ${esc(m.asof)}. Turn this alert off in Breakline > Find water. Not for navigation.</p>`,
            text: `The water you saved as "${a.name}" is inside your ${Math.round(a.criteria.run)} nm run from ${port}: ${m.nm2} sq nm, biggest patch ${m.dist} nm at ${m.brg}°T. ${link}`,
          });
          notified = now; sent++;
        }
      }
      await sbAdmin(`water_alerts?id=eq.${a.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_checked: now, last_match: m, last_notified_at: notified }) });
      out.push({ id: a.id, match: !!m });
    } catch (e) {
      console.error('alert', a.id, e);
      await sbAdmin(`water_alerts?id=eq.${a.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_checked: new Date().toISOString() }) }).catch(() => {});
    }
  }
  return json({ checked: alerts.length, sent, results: out });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
export { matchAlert, decodePng };
