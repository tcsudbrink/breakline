// /erddap/<host>/<path>?<query>  ->  NOAA ERDDAP (and NDBC), with Vercel's CDN keeping a shared copy.
// Only good answers are cached: a NOAA "busy" (503) or timeout is passed through uncached, so one bad
// moment at NOAA never sticks. Tiles from app.js repeat exactly, so after the first look (or the warm.mjs
// pre-load) everyone gets that water from the CDN in ~0.1 s and NOAA isn't asked again.
export const config = { runtime: 'edge' };

const HOSTS = {
  pfeg: 'https://coastwatch.pfeg.noaa.gov/erddap/',
  cw: 'https://coastwatch.noaa.gov/erddap/',
  upwell: 'https://upwell.pfeg.noaa.gov/erddap/',
  aoml: 'https://cwcgom.aoml.noaa.gov/erddap/',
  ndbc: 'https://www.ndbc.noaa.gov/',
};

export default async function handler(req) {
  const u = new URL(req.url);
  // the rewrite keeps the original path; drop the path=... it may append to the query
  const m = u.pathname.match(/^\/erddap\/(\w+)\/(.*)$/), host = m && HOSTS[m[1]];
  if (!host) return new Response('unknown source', { status: 404 });
  const query = u.search.replace(/[?&]path=[^&]*$/, '');
  const pinned = !/last|latest_obs/.test(decodeURIComponent(query + m[2]));
  let up;
  try {
    up = await fetch(host + m[2] + query, { headers: { 'User-Agent': 'Breakline/1.0 (+https://www.breaklinefishing.com)' }, signal: AbortSignal.timeout(55000) });
  } catch (e) {
    return new Response('NOAA not responding', { status: 504, headers: { 'Cache-Control': 'no-store' } });
  }
  const h = new Headers({ 'Content-Type': up.headers.get('content-type') || 'text/plain', 'Access-Control-Allow-Origin': '*' });
  if (up.ok) {
    // a fixed date (or the seafloor) never changes; "latest" is kept 6 h and refreshed in the background after that
    h.set('Cache-Control', 'public, max-age=0, must-revalidate');
    h.set('CDN-Cache-Control', pinned ? 'public, s-maxage=31536000' : 'public, s-maxage=21600, stale-while-revalidate=604800');
  } else if (up.status === 404) {
    h.set('Cache-Control', 'public, max-age=0, must-revalidate');
    h.set('CDN-Cache-Control', 'public, s-maxage=600');       // "not published yet": ask again in 10 minutes
  } else {
    h.set('Cache-Control', 'no-store'); h.set('CDN-Cache-Control', 'no-store');
  }
  return new Response(up.body, { status: up.status, headers: h });
}
