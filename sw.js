// Offline + speed:
//  - app files: network first (so updates land), cache when offline
//  - NOAA data for a specific date never changes: cache first, instant
//  - "latest" NOAA data: use a copy under 2 hours old instantly and refresh it in the background
//  - wrecks / depth files shipped with the app: cache first
const APP = 'breakline-app-v47', DATA = 'breakline-data-v2';
const SHELL = ['app', 'app.html', 'track.js', 'vendor/supabase.js', 'style.css', 'app.js', 'loran.js', 'solunar.js', 'manifest.webmanifest', 'icon.svg',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/d3-array.min.js', 'vendor/d3-contour.min.js',
  'data/wrecks.json', 'data/spots.json', 'data/tide_stations.json', 'data/places.json', 'data/bathy_2m.json', 'data/bathy_2m.bin', 'data/bathy_fl.json', 'data/bathy_fl.bin', 'data/bathy_cr.json', 'data/bathy_cr.bin'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function putData(req, res) {
  if (!res.ok) return;
  const c = await caches.open(DATA);
  const h = new Headers(res.headers); h.set('x-bl-saved', String(Date.now()));
  await c.put(req, new Response(await res.clone().blob(), { status: res.status, headers: h }));
}
async function erddap(req) {
  const url = decodeURIComponent(req.url), pinned = !/last|latest_obs/.test(url);
  const c = await caches.open(DATA), hit = await c.match(req);
  if (hit) {
    const age = Date.now() - +(hit.headers.get('x-bl-saved') || 0);
    if (pinned) return hit;
    if (age < 2 * 3600 * 1000 && !/latest_obs/.test(url)) { fetch(req).then((r) => putData(req, r)).catch(() => {}); return hit; }
  }
  try { const r = await fetch(req); putData(req, r.clone()); return r; }
  catch (e) { return hit || new Response('offline', { status: 504 }); }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // hourly snapshots on GitHub Pages: each file name is unique per chart, so cache first
  if (e.request.method === 'GET' && url.hostname.endsWith('github.io') && url.pathname.endsWith('.png')) {
    e.respondWith(caches.open(DATA).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/erddap/')) { e.respondWith(erddap(e.request)); return; }
  if (url.pathname.startsWith('/data/') || url.pathname.startsWith('/vendor/') || /^\/live\/.+\.png$/.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(APP).then((c) => c.put(e.request, cp)); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(APP).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
