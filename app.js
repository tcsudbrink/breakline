/* Breakline v0.3 — RipCharts-style offshore chart on free NOAA/NASA data.
 *
 * Data is fetched for whatever part of the ocean is on screen (padded), at a resolution
 * that matches the zoom. Rasters are image overlays; land, coast, depth lines, breaks,
 * eddy rings, currents and the lat/lon or Loran grid are drawn on one screen-space canvas.
 */
(() => {
'use strict';

// ---------- Config ----------
const WORLD = { s: -5, n: 50, w: -120, e: -50 };   // Gulf of Maine to the Caribbean + Gulf of Mexico + Pacific Central America
// Fishing zones: quick-jump views, a default home port, and the boxes the hourly prefetch covers (keep in sync with prefetch.py)
const ZONES = {
  ne: { label: 'Northeast canyons', view: [[39.0, -74.5], [41.6, -68.5]], home: 'Montauk', box: 'east' },
  ng: { label: 'New England: Cape Cod, Nantucket, the Vineyard', view: [[40.2, -71.8], [42.4, -68.6]], home: 'Nantucket', box: 'east' },
  ma: { label: 'Mid-Atlantic', view: [[35.6, -76.4], [39.6, -71.8]], home: 'Ocean City Inlet', box: 'east' },
  se: { label: 'Carolinas & Georgia', view: [[31.0, -81.5], [36.0, -74.5]], home: 'Oregon Inlet', box: 'east' },
  fl: { label: 'Florida & Bahamas', view: [[23.6, -83.2], [27.6, -76.0]], home: 'Palm Beach Inlet', box: 'fl' },
  flg: { label: 'Florida Gulf: Clearwater to Naples', view: [[24.8, -85.0], [28.4, -81.6]], home: 'Clearwater Pass', box: 'fl' },
  gulf: { label: 'Northern Gulf: Venice, Orange Beach, Destin', view: [[27.0, -91.0], [30.6, -85.2]], home: 'Orange Beach (Perdido Pass)', box: 'east' },
  tx: { label: 'Texas: Galveston to South Padre', view: [[25.8, -97.6], [29.6, -93.2]], home: 'Port Aransas', box: 'east' },
  bda: { label: 'Bermuda', view: [[31.4, -65.6], [33.2, -63.8]], home: "St. George's", box: 'east' },
  tci: { label: 'Turks & Caicos', view: [[20.9, -72.9], [22.3, -71.0]], home: 'Providenciales', box: 'fl' },
  pr: { label: 'Puerto Rico & Virgin Islands', view: [[17.4, -67.6], [19.2, -64.2]], home: 'Fajardo', box: 'pr' },
  cr: { label: 'Costa Rica (Pacific)', view: [[7.6, -87.6], [11.2, -83.4]], home: 'Los Sueños', box: 'cr' },
  crs: { label: 'Costa Rica offshore / Cocos', view: [[3.0, -90.5], [10.5, -82.5]], home: 'Quepos (Pez Vela)', box: 'cr' },
  cabo: { label: 'Cabo San Lucas & Mag Bay', view: [[22.3, -113.2], [25.4, -108.9]], home: 'Cabo San Lucas', box: 'cabo' },
  chiapas: { label: 'Chiapas (Puerto Chiapas)', view: [[13.0, -95.0], [15.8, -91.6]], home: 'Puerto Chiapas', box: 'chiapas' },
  guat: { label: 'Guatemala (Puerto San José)', view: [[12.6, -92.4], [14.4, -89.8]], home: 'Puerto San José (Iztapa)', box: 'chiapas' },
  pan: { label: 'Panama (Piñas Bay, Pedasí)', view: [[6.4, -80.9], [8.8, -77.8]], home: 'Piñas Bay', box: 'cr' },
  cancun: { label: 'Cancún, Isla Mujeres, Cozumel', view: [[19.9, -87.6], [22.3, -85.4]], home: 'Isla Mujeres', box: 'cancun' },
  puntacana: { label: 'Punta Cana / Cap Cana (DR)', view: [[17.5, -69.8], [19.4, -67.4]], home: 'Cap Cana', box: 'puntacana' },
  stlucia: { label: 'St. Lucia', view: [[13.3, -61.6], [14.5, -60.4]], home: 'Rodney Bay', box: 'stlucia' },
};
const PRE_BOX = {
  east: { s: 23.0, n: 46.0, w: -98.0, e: -60.0 }, fl: { s: 20.0, n: 28.5, w: -85.0, e: -72.0 }, cr: { s: -1.0, n: 13.0, w: -96.0, e: -78.0 },
  cabo: { s: 21.0, n: 27.5, w: -117.0, e: -106.5 }, chiapas: { s: 11.5, n: 17.5, w: -98.0, e: -90.0 }, cancun: { s: 18.5, n: 23.5, w: -89.0, e: -84.0 },
  puntacana: { s: 16.5, n: 21.0, w: -71.5, e: -66.0 }, stlucia: { s: 11.5, n: 16.0, w: -63.0, e: -59.0 },
  pr: { s: 16.5, n: 20.0, w: -68.5, e: -63.5 },
};
const FATHOM = 1.8288;
const DEPTHS_MAJOR = [50, 100, 500, 1000];
const DEPTHS_MINOR = [10, 20, 30, 40, 200, 300, 1500, 2000];
// Inshore lines, in fathoms (labelled in feet like an inshore chart): 6, 12, 18, 30 ft
const DEPTHS_INSHORE = [1, 2, 3, 5];
const depthTxt = (m) => { const fm = -m / FATHOM; return fm < 10 ? `${Math.round(fm * 6)} ft` : `${Math.round(fm).toLocaleString()} fm`; };

// Inlet positions are approximate (within ~0.5 nm), for range/bearing only.
const PORTS = [
  ['Gloucester', 42.580, -70.660], ['Chatham', 41.672, -69.940], ['Nantucket', 41.300, -70.095], ["Edgartown (Martha's Vineyard)", 41.390, -70.505],
  ['Point Judith', 41.360, -71.485], ['Montauk', 41.073, -71.936], ['Shinnecock Inlet', 40.840, -72.477], ['Manasquan Inlet', 40.103, -74.030],
  ['Barnegat Inlet', 39.760, -74.095], ['Absecon Inlet', 39.373, -74.410], ['Cape May Inlet', 38.947, -74.868],
  ['Indian River Inlet', 38.610, -75.065], ['Ocean City Inlet', 38.324, -75.085], ['Chincoteague Inlet', 37.860, -75.400],
  ['Wachapreague Inlet', 37.585, -75.600], ['Lynnhaven Inlet', 36.912, -76.090], ['Rudee Inlet', 36.830, -75.965],
  ['Oregon Inlet', 35.770, -75.530], ['Hatteras Inlet', 35.198, -75.760], ['Beaufort Inlet', 34.690, -76.670],
  ['Masonboro Inlet', 34.183, -77.815], ['Charleston', 32.750, -79.870], ['Port Canaveral', 28.410, -80.590],
  ['Fort Pierce Inlet', 27.471, -80.290], ['Jupiter Inlet', 26.944, -80.070], ['Palm Beach Inlet', 26.772, -80.037],
  ['Boca Raton Inlet', 26.336, -80.070], ['Port Everglades', 26.092, -80.110], ['Miami (Government Cut)', 25.763, -80.130],
  ['Islamorada (Whale Harbor)', 24.940, -80.610], ['Marathon', 24.700, -81.100], ['Key West', 24.552, -81.800],
  ['Naples (Gordon Pass)', 26.093, -81.805], ['Boca Grande Pass', 26.710, -82.255], ["John's Pass", 27.780, -82.785], ['Clearwater Pass', 27.965, -82.830],
  ['Venice, LA', 29.270, -89.355], ['Pensacola Pass', 30.320, -87.310], ['Orange Beach (Perdido Pass)', 30.272, -87.555], ['Destin (East Pass)', 30.390, -86.513], ['Panama City (St. Andrew Pass)', 30.120, -85.730],
  ['Galveston', 29.340, -94.700], ['Freeport', 28.935, -95.300], ["Port O'Connor", 28.400, -96.390], ['Port Aransas', 27.835, -97.045], ['South Padre Island', 26.070, -97.155],
  ["St. George's", 32.380, -64.670], ['Providenciales', 21.790, -72.280],
  ['San Juan', 18.465, -66.115], ['Fajardo', 18.330, -65.630], ['Red Hook (St. Thomas)', 18.320, -64.845], ['Road Town (Tortola)', 18.420, -64.610],
  ['Bimini', 25.730, -79.300], ['Chub Cay', 25.410, -77.900], ['Nassau', 25.080, -77.350], ['Marsh Harbour', 26.545, -77.060],
  ['Marina Papagayo', 10.640, -85.660], ['Flamingo', 10.430, -85.790], ['Los Sueños', 9.645, -84.670],
  ['Quepos (Pez Vela)', 9.420, -84.170], ['Golfito', 8.620, -83.180],
  ['Cabo San Lucas', 22.880, -109.910], ['San José del Cabo', 23.050, -109.680], ['Buena Vista (East Cape)', 23.650, -109.640],
  ['Puerto San Carlos (Mag Bay)', 24.790, -112.110], ['Puerto Magdalena', 24.630, -112.150],
  ['Puerto Chiapas', 14.700, -92.400], ['Puerto San José (Iztapa)', 13.920, -90.790],
  ['Piñas Bay', 7.570, -78.190], ['Pedasí', 7.530, -80.020],
  ['Isla Mujeres', 21.250, -86.740], ['Cancún (Puerto Juárez)', 21.180, -86.800], ['Cozumel', 20.510, -86.950], ['Puerto Aventuras', 20.500, -87.230],
  ['Cap Cana', 18.430, -68.400], ['Punta Cana (Marina)', 18.500, -68.370],
  ['Rodney Bay', 14.080, -60.950], ['Marigot Bay', 13.970, -61.030], ['Vieux Fort', 13.730, -60.950],
];

const q = (s) => encodeURIComponent(s);
const latRange = (w, asc) => (asc ? `(${w.s}):${w.stride}:(${w.n})` : `(${w.n}):${w.stride}:(${w.s})`);
const lonRange = (w) => `(${w.w}):${w.stride}:(${w.e})`;
const C2F = (c) => c * 9 / 5 + 32;

// Satellite sources you can pick between (in the chart picker) for the two main charts.
// gap: true = cloud-free analysis; false = real passes with cloud holes.
const SST_C = (c) => (c > -2.5 && c < 40 ? C2F(c) : NaN), CHL = (x) => (x > 0 && x < 200 ? x : NaN);
const SRC = {
  sst: {
    mur: { label: 'MUR cloud-free', who: 'NASA JPL, 1 km', host: 'pfeg', id: 'jplMURSST41', v: 'analysed_sst', res: 0.01, asc: true, gap: true, t: '09:00:00Z' },
    geopolar: { label: 'Geo-polar blended', who: 'NOAA, 5 km', host: 'cw', id: 'noaacwBLENDEDsstDNDaily', v: 'analysed_sst', res: 0.05, asc: true, gap: true, t: '12:00:00Z' },
    pmday: { label: 'Afternoon passes', who: 'NOAA ACSPO, 2 km, clouds', host: 'cw', id: 'noaacwLEOACSPOSSTL3SnrtPMDay', v: 'sea_surface_temperature', res: 0.02, asc: false, t: '12:00:00Z' },
    amday: { label: 'Morning passes', who: 'NOAA ACSPO, 2 km, clouds', host: 'cw', id: 'noaacwLEOACSPOSSTL3SnrtAMDay', v: 'sea_surface_temperature', res: 0.02, asc: false, t: '12:00:00Z' },
    pmnight: { label: 'Night passes (PM)', who: 'NOAA ACSPO, 2 km, clouds', host: 'cw', id: 'noaacwLEOACSPOSSTL3SnrtPMNight', v: 'sea_surface_temperature', res: 0.02, asc: false, t: '12:00:00Z' },
    amnight: { label: 'Night passes (AM)', who: 'NOAA ACSPO, 2 km, clouds', host: 'cw', id: 'noaacwLEOACSPOSSTL3SnrtAMNight', v: 'sea_surface_temperature', res: 0.02, asc: false, t: '12:00:00Z' },
    comp1: { label: '1-day composite', who: 'GOES-19 hourly + polar passes, last 24 h', comp: 1, v: 'sst', res: 0.02, cells: 300 },
    comp3: { label: '3-day composite', who: 'GOES-19 hourly + polar passes, last 72 h', comp: 3, v: 'sst', res: 0.02, cells: 300 },
  },
  chl: {
    cm_l4: { label: 'Gap-free (Copernicus)', who: 'EU Copernicus multi-sensor, 4 km, cloud-filled', cm: 'chl_l4', res: 0.0417, gap: true },
    cm_l3: { label: 'Daily pass (Copernicus)', who: 'EU Copernicus multi-sensor, 4 km, clouds', cm: 'chl_l3', res: 0.0417 },
    dineof: { label: 'Gap-filled + newest clear', who: 'NOAA VIIRS/OLCI, 2 km', host: 'cw', id: 'noaacwNPPN20S3ASCIDINEOF2kmDaily', v: 'chlor_a', alt: true, res: 0.02083, asc: false, gap: true, nrt: true, t: '12:00:00Z' },
    s3a: { label: 'Sentinel-3A pass', who: 'Copernicus OLCI, 4 km, clouds', host: 'cw', id: 'noaacwS3AOLCIchlaDaily', v: 'chlor_a', alt: true, res: 0.0375, asc: false, t: '12:00:00Z' },
    s3b: { label: 'Sentinel-3B pass', who: 'Copernicus OLCI, 4 km, clouds', host: 'cw', id: 'noaacwS3BOLCIchlaDaily', v: 'chlor_a', alt: true, res: 0.0375, asc: false, t: '12:00:00Z' },
    n21: { label: 'NOAA-21 pass', who: 'NOAA VIIRS, 750 m, clouds', host: 'cw', id: 'noaacwN21VIIRSchlaSectorUSDaily', v: 'chlor_a', alt: true, res: 0.0075, asc: false, t: '18:00:00Z' },
    n20: { label: 'NOAA-20 pass', who: 'NOAA VIIRS, 4 km, clouds', host: 'cw', id: 'noaacwN20VIIRSchlaDaily', v: 'chlor_a', alt: true, res: 0.0375, asc: false, t: '12:00:00Z' },
    comp1: { label: '1-day composite', who: 'VIIRS + OLCI passes, newest day', comp: 1, v: 'chlor_a', res: 0.02 },
    comp3: { label: '3-day composite', who: 'VIIRS + OLCI passes, last 3 days', comp: 3, v: 'chlor_a', res: 0.02 },
  },
};
// Depth levels for salinity and oxygen (the Copernicus model's own levels, in meters below the surface)
const ZLEV = [{ l: 'Surface', e: null }, { l: '~50 ft', e: -15.81 }, { l: '~100 ft', e: -29.445 }, { l: '~150 ft', e: -47.374 }, { l: '~215 ft', e: -65.807 },
  { l: '~300 ft', e: -92.326 }, { l: '~510 ft', e: -155.851 }, { l: '~1,045 ft', e: -318.127 }];
const zlevTxt = () => (S.zlev ? ` at ${ZLEV[S.zlev].l}` : '');
const CUR_SRC = { sat: 'Satellite', hycom: 'HYCOM', rtofs: 'RTOFS' };
const srcUrl = (s, w, t) => `/erddap/${s.host}/griddap/${s.id}.asc?${q(`${s.v}[(${t || 'last'})]${s.alt ? '[(0.0)]' : ''}[${latRange(w, s.asc)}][${lonRange(w)}]`)}`;
const curSrc = (fam) => SRC[fam][S.src[fam]] || Object.values(SRC[fam])[0];

// Every product: where its data lives, native resolution, how many cells to aim for across the window
const PRODUCTS = {
  sst: {
    get name() { return `Water temp · ${curSrc('sst').label}`; }, unit: '°F', step: 0.5, get cells() { return curSrc('sst').cells || 520; }, sst: true, family: 'sst',
    get res() { return curSrc('sst').res; },
    url: (w, t) => srcUrl(curSrc('sst'), w, t),
    get v() { return curSrc('sst').v; }, conv: SST_C, fmt: (v) => v.toFixed(1) + '°F', day: (d) => `${d}T${curSrc('sst').t}`,
    stops: ['#2a0a4a', '#3b1f9e', '#1d5fd6', '#14a6e0', '#1fd1b0', '#7ddc3a', '#f2e030', '#f8a22a', '#e9472a', '#b5122f', '#6e0a1e'],
  },
  goes: {
    // Each frame is filled with the newest clear pixel from the previous 24 hours (clouds block GOES).
    // Fetched as four 6-hour chunks (k = 0 newest) so no single request is slow.
    name: 'Water temp (hourly, GOES-19)', unit: '°F', step: 0.5, res: 0.02, cells: 240, sst: true, hourly: true,
    url: (w, t, k = 0) => {
      const a = 6 * k + 5, b = 6 * k;
      const tq = t ? `(${hourAdd(t, -a)}):1:(${hourAdd(t, -b)})` : `last-${a}:1:${b ? `last-${b}` : 'last'}`;
      return `/erddap/aoml/griddap/goes19SSThourly.asc?${q(`sst[${tq}][${latRange(w, true)}][${lonRange(w)}]`)}`;
    },
    v: 'sst', conv: (c) => (c > -2.5 && c < 40 ? C2F(c) : NaN), fmt: (v) => v.toFixed(1) + '°F',
    stops: ['#2a0a4a', '#3b1f9e', '#1d5fd6', '#14a6e0', '#1fd1b0', '#7ddc3a', '#f2e030', '#f8a22a', '#e9472a', '#b5122f', '#6e0a1e'],
  },
  chl: {
    get name() { return `Chlorophyll · ${curSrc('chl').label}`; }, unit: 'mg/m³', step: 0.05, cells: 450, log: true, family: 'chl',
    get res() { return curSrc('chl').res; },
    url: (w, t) => srcUrl(curSrc('chl'), w, t),
    get nrt() { return curSrc('chl').nrt ? (w, t0, t1) => `/erddap/cw/griddap/noaacwN20VIIRSchlaDaily.asc?${q(`chlor_a[(${t0}):1:(${t1})][(0.0)][${latRange({ ...w, stride: Math.max(1, Math.round(w.stride * 0.5556)) }, false)}][${lonRange({ ...w, stride: Math.max(1, Math.round(w.stride * 0.5556)) })}]`)}` : null; },
    v: 'chlor_a', conv: CHL, fmt: (v) => (v < 1 ? v.toFixed(2) : v.toFixed(1)) + ' mg/m³', day: (d) => `${d}T${curSrc('chl').t}`,
    stops: ['#160d4f', '#1b3fa8', '#1b7fcf', '#1fb3b8', '#35c47a', '#9bd83a', '#f0dc34', '#f39a2c', '#d8432a', '#8e1626'],
  },
  sss: {
    get name() { return `Salinity${zlevTxt()}`; }, zlev: true, unit: 'PSU', step: 0.1, res: 0.083, cells: 360, cm: 'so',
    url: (w, t) => `/erddap/cw/griddap/noaacwSMAPsssDaily.asc?${q(`sss[(${t || 'last'})][(0.0)][${latRange(w, true)}][${lonRange(w)}]`)}`,
    v: 'sss', conv: (x) => (x > 20 && x < 42 ? x : NaN), fmt: (v) => `${v.toFixed(2)} PSU`, day: (d) => `${d}T12:00:00Z`,
    stops: ['#3b2a1a', '#7a5a2b', '#b89a4e', '#d9d79a', '#9fd3c7', '#4fb0c6', '#2b7bba', '#1f4a8f', '#1a2766'],
  },
  o2: {
    get name() { return `Dissolved oxygen${zlevTxt()}`; }, zlev: true, unit: 'mg/L', step: 0.1, res: 0.25, cells: 300, cm: 'o2',
    conv: (x) => (x >= 0 && x < 500 ? x * 0.032 : NaN), fmt: (v) => `${v.toFixed(1)} mg/L`,   // model gives mmol/m³; ×0.032 = mg/L
    stops: ['#4a0c2e', '#8e1b3a', '#d0453a', '#f08a3c', '#f6c95a', '#c9e27a', '#6fcf9b', '#2fa6b5', '#1f6fa8', '#1b3f7a'],
  },
  cur: {
    get name() { return S.fc ? 'Currents (ocean-model forecast)' : S.curSrc !== 'sat' ? `Currents (${CUR_SRC[S.curSrc]} ocean model)` : 'Currents (HF radar + satellite)'; }, unit: 'kt', step: 0.1, res: 0.25, computed: true,
    fmt: (v) => `${v.toFixed(2)} kt`,
    stops: ['#0b1a2e', '#16345e', '#1f5f9a', '#2a93c4', '#4fc3c9', '#a6dd8a', '#f2e04a', '#f6a23a', '#e5533b', '#b3123a'],
  },
  wx: {
    get name() { return S.wxMode === 'waves' ? 'Waves (forecast)' : 'Wind (forecast)'; }, get unit() { return S.wxMode === 'waves' ? 'ft' : 'kt'; },
    step: 1, res: 0.25, computed: true,
    fmt: (v) => (S.wxMode === 'waves' ? `${v.toFixed(1)} ft` : `${Math.round(v)} kt`),
    get stops() { return S.wxMode === 'waves' ? ['#0d2a4a', '#1d5a8a', '#2e95b8', '#4fc3a1', '#b9dc5a', '#f4d03f', '#f39c34', '#e0533a', '#a51d4a'] : ['#16304f', '#1f5c8f', '#2a93b8', '#45c29a', '#a5d65a', '#f2d23e', '#f39a35', '#e0503a', '#a01f56', '#5e1470']; },
  },
  fish: {
    name: 'Where to fish (hot-spot score)', unit: '/100', step: 5, res: 0.01, computed: true,
    fmt: (v) => `${Math.round(v)}/100`,
    stops: ['#0b1622', '#1b2f52', '#3b3d8a', '#7b3f9e', '#c14f8a', '#f0745f', '#f9a54a', '#fbe36a'],
  },
  ana: {
    name: 'Ocean analysis · water temp (hourly where clear)', unit: '°F', step: 0.5, res: 0.01, computed: true, sst: true,
    fmt: (v) => v.toFixed(1) + '°F',
    stops: ['#2a0a4a', '#3b1f9e', '#1d5fd6', '#14a6e0', '#1fd1b0', '#7ddc3a', '#f2e030', '#f8a22a', '#e9472a', '#b5122f', '#6e0a1e'],
  },
  ssh: {
    name: 'Altimetry (sea height)', unit: 'cm', step: 1, res: 0.125, cells: 360, diverging: true, cm: 'sla',
    url: (w, t) => `/erddap/cw/griddap/noaacwBLENDEDsshDaily.asc?${q(`sla[(${t || 'last'})][${latRange(w, true)}][${lonRange(w)}]`)}`,
    v: 'sla', conv: (m) => (Math.abs(m) < 1.5 ? m * 100 : NaN), fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(0) + ' cm', day: (d) => `${d}T12:00:00Z`,
    stops: ['#1b2a8a', '#2f63c9', '#6fa8e6', '#c4def3', '#f2f2ee', '#f6c9a3', '#ea8a5a', '#cf4630', '#8c1520'],
  },
  mld: {
    name: 'Mixed layer depth', unit: 'ft', step: 10, res: 0.083, cells: 360, cm: 'mld',
    url: (w, t) => `/erddap/cw/griddap/noaacwOHC14na.asc?${q(`omld[(${t || 'last'})][${latRange(w, true)}][${lonRange(w)}]`)}`,
    v: 'omld', conv: (m) => (m > 0 && m < 3000 ? m * 3.28084 : NaN), fmt: (v) => `${Math.round(v)} ft`, day: (d) => `${d}T12:00:00Z`,
    stops: ['#fff7d6', '#fde08a', '#f6b04a', '#e8743b', '#c9443c', '#952a5a', '#5b1f6e', '#2b1650'],
  },
  ftle: {
    name: 'Fronts (FSLE-style, from currents)', unit: '1/day', step: 0.02, res: 0.25, computed: true,
    fmt: (v) => v.toFixed(2) + ' /day',
    stops: ['#08111b', '#10263d', '#1d4a6b', '#3f7fa6', '#8fc3dc', '#e9f4f7', '#ffe38a', '#ffb13b'],
  },
  bottom: {
    name: 'Bottom (shaded relief)', unit: 'fm', step: 10, computed: true, noLegendRange: true,
    fmt: (v) => `${Math.round(v).toLocaleString()} fm`,
    stops: ['#b9f0ec', '#6fd0dd', '#2f9cc6', '#1c64a2', '#123e73', '#0a2148'],
  },
};

// ---------- State ----------
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem('breakline.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { localStorage.setItem('breakline.' + k, JSON.stringify(v)); if (SYNC_KEYS.includes(k)) ACCT_HOOK.settings?.(); },
};
// Settings saved to the signed-in account (everything else stays on this device)
const SYNC_KEYS = ['home', 'grid', 'tdPair', 'tdOff', 'species', 'maxRun', 'fishDepth', 'fw'];
const ACCT_HOOK = {};
const S = {
  prod: store.get('prod', 'sst'),
  date: null, hour: null,         // null = latest
  latest: null, latestHour: null,
  data: {},                       // key -> grid (window-tagged)
  range: {}, auto: true,
  ov: { breaks: true, iso: false, rings: true, cur: false, relief: false, depth: true, ports: true, wrecks: true, buoys: true, places: true, spots: true, enc: true, drop: true, ...store.get('ov', {}) },
  src: { sst: 'mur', chl: 'cm_l4', ...store.get('src2', {}) },
  species: store.get('species', 'yellowfin'), anaView: 'now', maxRun: store.get('maxRun', 90), fishDepth: store.get('fishDepth', [null, null]),
  grid: store.get('grid', 'll'), tdPair: store.get('tdPair', 'XY'), tdOff: store.get('tdOff', [0, 0]),
  brk: store.get('brk2', 0.3),   // °F per nm; MUR is smooth, so its strongest fronts run ~0.5-1
  home: store.get('home', 'Ocean City Inlet'),
  wpts: store.get('wpts', []).map((w) => (w.id ? w : { ...w, id: newId(), u: Date.parse(w.t) || Date.now() })),
  geo: { land: [], depth: [], iso: [], breaks: [], rings: [], td: [] },
};
if (!PRODUCTS[S.prod]) S.prod = 'sst';
store.set('wpts', S.wpts); if (!store.get('wptsIds', null)) store.set('wptsIds', S.wpts.map((w) => w.id));   // pin the ids given to older spots
S.fc = 0;   // forecast hours ahead of now (0 = now)
S.wxMode = store.get('wxMode', 'wind'); S.wxH = 0;
S.curSrc = CUR_SRC[store.get('curSrc', 'sat')] ? store.get('curSrc', 'sat') : 'sat';   // currents: satellite, HYCOM or RTOFS
S.zlev = Math.min(ZLEV.length - 1, Math.max(0, store.get('zlev', 0) | 0));          // depth level for salinity / oxygen   // weather: wind or waves, hours ahead
// the grid on screen: the temp-drift forecast when one is showing, otherwise the loaded data
const PG = () => (S.fc > 0 && PRODUCTS[S.prod].sst && S.data.drift ? S.data.drift : S.data[S.prod]);

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const status = (msg, err) => { const el = $('status'); el.hidden = !msg; el.textContent = msg || ''; el.classList.toggle('err', !!err); };
const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
const imerc = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
const isoDate = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
function hourAdd(iso, h) { const d = new Date(iso); d.setUTCHours(d.getUTCHours() + h); return d.toISOString().slice(0, 13) + ':00:00Z'; }
const nice = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const niceHour = (iso) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', timeZone: 'America/New_York' }) + ' ET';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function ddm(v, pos, neg) {
  const h = v >= 0 ? pos : neg; v = Math.abs(v);
  let d = Math.floor(v), m = (v - d) * 60;
  if (m >= 59.995) { d += 1; m = 0; }
  return `${d}°${m.toFixed(2).padStart(5, '0')}'${h}`;
}
const fmtLL = (lat, lon) => `${ddm(lat, 'N', 'S')}  ${ddm(lon, 'E', 'W')}`;

function rangeBearing(a, b) {
  const R = 3440.065, r = Math.PI / 180;
  const p1 = a[0] * r, p2 = b[0] * r, dp = (b[0] - a[0]) * r, dl = (b[1] - a[1]) * r;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const d = 2 * R * Math.asin(Math.sqrt(h));
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return [d, (Math.atan2(y, x) / r + 360) % 360];
}

// Loran TDs with the user's calibration offsets
const pair = () => [S.tdPair[0], S.tdPair[1]];
function tds(lat, lon) {
  const [a, b] = pair();
  return [Loran.td(lat, lon, a) + (+S.tdOff[0] || 0), Loran.td(lat, lon, b) + (+S.tdOff[1] || 0)];
}
const fmtTd = (lat, lon) => { const [a, b] = tds(lat, lon); return `${a.toFixed(1)} / ${b.toFixed(1)}`; };
// 9960 chain TDs only mean something off the US East Coast
const inLoran = (lat, lon) => lat > 28 && lat < 47 && lon > -82 && lon < -62;

// ---------- ERDDAP .asc ----------
function parseAsc(text) {
  const out = {}; let key = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^([A-Za-z_]\w*\.[A-Za-z_]\w*)((?:\[\d+\])+)\s*$/);
    if (h) { key = h[1]; out[key] = []; continue; }
    if (!key) continue;
    if (!line.trim()) { key = null; continue; }
    const body = line.replace(/^(\[\d+\])+,\s*/, '');
    for (const s of body.split(',')) out[key].push(s.trim() === '' ? NaN : parseFloat(s));
  }
  return out;
}

// Returns a grid with rows south->north. With `all`, also returns every time slice.
function toGrid(sec, v, conv, all) {
  const lat = sec[`${v}.latitude`], lon = sec[`${v}.longitude`], raw = sec[`${v}.${v}`], t = sec[`${v}.time`];
  if (!lat || !lon || !raw) throw new Error('no data in that area');
  const ny = lat.length, nx = lon.length, n = ny * nx, nt = Math.round(raw.length / n), flip = lat[0] > lat[ny - 1];
  const slice = (k) => {
    const vals = new Float32Array(n), off = k * n;
    for (let j = 0; j < ny; j++) {
      const src = flip ? ny - 1 - j : j;
      for (let i = 0; i < nx; i++) { const x = raw[off + src * nx + i]; vals[j * nx + i] = conv ? conv(x) : x; }
    }
    return vals;
  };
  const la = flip ? lat.slice().reverse() : lat;
  const g = {
    nx, ny, lat0: la[0], dlat: ny > 1 ? (la[ny - 1] - la[0]) / (ny - 1) : 0.01, lon0: lon[0], dlon: nx > 1 ? (lon[nx - 1] - lon[0]) / (nx - 1) : 0.01,
    v: slice(nt - 1), times: t ? t.map((s) => new Date(s * 1000).toISOString()) : [],
  };
  g.date = g.times.length ? g.times[g.times.length - 1].slice(0, 10) : null;
  if (all) g.slices = Array.from({ length: nt }, (_, k) => slice(k));
  return g;
}

function sample(g, lat, lon, vals) {
  if (!g) return NaN;
  const v = vals || g.v;
  const fy = (lat - g.lat0) / g.dlat, fx = (lon - g.lon0) / g.dlon;
  if (fx < -0.5 || fy < -0.5 || fx > g.nx - 0.5 || fy > g.ny - 0.5) return NaN;
  const x0 = clamp(Math.floor(fx), 0, g.nx - 1), y0 = clamp(Math.floor(fy), 0, g.ny - 1);
  const x1 = Math.min(x0 + 1, g.nx - 1), y1 = Math.min(y0 + 1, g.ny - 1);
  const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
  const a = v[y0 * g.nx + x0], b = v[y0 * g.nx + x1], c = v[y1 * g.nx + x0], d = v[y1 * g.nx + x1];
  let s = 0, w = 0, wt;
  if (a === a) { wt = (1 - tx) * (1 - ty); s += a * wt; w += wt; }
  if (b === b) { wt = tx * (1 - ty); s += b * wt; w += wt; }
  if (c === c) { wt = (1 - tx) * ty; s += c * wt; w += wt; }
  if (d === d) { wt = tx * ty; s += d * wt; w += wt; }
  return w > 0.25 ? s / w : NaN;
}

// Faster/backup copies of the same NOAA dataset on another server (pfeg answers in ~1 s; coastwatch.noaa.gov is often slow or down)
const MIRRORS = {
  'cw/noaacwNPPN20S3ASCIDINEOF2kmDaily': ['pfeg/noaacwNPPN20S3ASCIDINEOF2kmDaily'],
  'cw/noaacwN20VIIRSchlaDaily': ['pfeg/nesdisVHNnoaa20chlaDaily'],
  'cw/noaacwBLENDEDsstDNDaily': ['pfeg/nesdisBLENDEDsstDNDaily'],
};
const HOST_NAME = { cw: 'NOAA CoastWatch (coastwatch.noaa.gov)', pfeg: 'NOAA CoastWatch West', aoml: 'NOAA AOML', ndbc: 'NDBC' };
// Circuit breaker, per dataset: one that fails twice is skipped for 3 minutes so nothing else waits on it.
// If 3 different datasets on the same server are down, the whole server is treated as down.
const BREAK = {};
const isDown = (k) => (BREAK[k]?.until || 0) > Date.now();
const hostDown = (key) => isDown(key) || isDown(key.split('/')[0]);
function hostFail(key) {
  const s = (BREAK[key] ||= { n: 0, until: 0 }); s.n++;
  if (s.n >= 2) { s.until = Date.now() + 3 * 60 * 1000; s.n = 0; }
  const host = key.split('/')[0];
  const downIds = Object.keys(BREAK).filter((k) => k.startsWith(host + '/') && isDown(k)).length;
  if (downIds >= 3) BREAK[host] = { n: 0, until: Date.now() + 3 * 60 * 1000 };
}
const hostOk = (key) => { BREAK[key] = { n: 0, until: 0 }; BREAK[key.split('/')[0]] = { n: 0, until: 0 }; };

async function fetchOnce(url, ms) {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); } finally { clearTimeout(timer); }
}
async function getText(url) {
  const m = url.match(/^\/erddap\/(\w+)\/griddap\/(\w+)(\..*)$/);
  const cands = [url];
  if (m && MIRRORS[`${m[1]}/${m[2]}`]) cands.unshift(...MIRRORS[`${m[1]}/${m[2]}`].map((x) => `/erddap/${x.split('/')[0]}/griddap/${x.split('/')[1]}${m[3]}`));
  let last = null;
  for (const u of cands) {
    const parts = u.split('/'), name = parts[2], host = `${name}/${(parts[4] || parts[3] || '').split(/[.?]/)[0]}`;
    if (hostDown(host)) { last = new Error(`${HOST_NAME[name] || name} is down right now`); continue; }
    // Old dates: NOAA has to pull the file from cold storage the first time (often 20-40 s), then it's quick.
    // So for dated requests wait longer, retry, and don't count the slowness as the server being down.
    const pinned = !/last/.test(decodeURIComponent(u));
    for (let i = 0; i < (pinned ? 3 : 2); i++) {
      let r;
      try { r = await fetchOnce(u, pinned ? 45000 : name === 'cw' || /nesdis/.test(host) ? 18000 : 25000); }
      catch (e) {
        last = new Error(`${HOST_NAME[name] || name} not responding`);
        if (pinned && i < 2) { status('Pulling an older date from NOAA\'s archive (first load can take ~30 s)…'); continue; }
        hostFail(host); break;
      }
      if (r.ok) {
        const t = await r.text();
        // ERDDAP writes the lat/lon axes last, so a proxy that cuts a slow response short leaves them off
        if (!t.includes('Dataset {') || /\.longitude\[\d+\]\s*\n[^\n]*\d/.test(t)) { hostOk(host); return t; }
        last = new Error('response cut short (server slow)'); continue;
      }
      if (r.status === 404) { last = new Error('not published for that date/area'); break; }   // try the next copy
      if (![502, 503, 504].includes(r.status)) { last = new Error(`${r.status}`); break; }
      hostFail(host); last = new Error(`${HOST_NAME[name] || name} is ${r.status === 503 ? 'busy' : 'down'} right now`);
      if (hostDown(host)) break;
      await new Promise((z) => setTimeout(z, 1500));
    }
  }
  throw last || new Error('NOAA server busy');
}

// ---------- Windows: fetch what is on screen, at a resolution that fits the zoom ----------
function windowFor(res, cells, pad = 0.35) {
  const b = map.getBounds().pad(pad), snap = res >= 0.25 ? 0.25 : 0.1;
  const w = {
    s: clamp(Math.floor(b.getSouth() / snap) * snap, WORLD.s, WORLD.n), n: clamp(Math.ceil(b.getNorth() / snap) * snap, WORLD.s, WORLD.n),
    w: clamp(Math.floor(b.getWest() / snap) * snap, WORLD.w, WORLD.e), e: clamp(Math.ceil(b.getEast() / snap) * snap, WORLD.w, WORLD.e),
  };
  const span = Math.max(w.n - w.s, w.e - w.w);
  w.stride = Math.max(1, Math.ceil(span / res / cells));
  // round stride to a power-of-two-ish ladder so nearby zooms share the cache
  const ladder = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  w.stride = ladder.find((x) => x >= w.stride) || w.stride;
  for (const k of ['s', 'n', 'w', 'e']) w[k] = +w[k].toFixed(2);
  return w;
}
function covers(g, res, cells) {
  if (!g?.win) return false;
  const b = map.getBounds(), w = g.win, want = windowFor(res, cells, 0);
  if (w.static && map.getZoom() >= 9) return false;     // zoomed in: swap the coarse built-in depth for full resolution
  const inside = (b.getSouth() >= w.s || w.s <= WORLD.s) && (b.getNorth() <= w.n || w.n >= WORLD.n) &&
    (b.getWest() >= w.w || w.w <= WORLD.w) && (b.getEast() <= w.e || w.e >= WORLD.e);
  // not too coarse for this zoom, and not wastefully fine after zooming way out
  if (w.static) return inside;
  if (w.pre) return inside && map.getZoom() <= 8;       // prefetched snapshot: good until you zoom in past 8
  return inside && w.stride <= Math.max(1, want.stride * 1.5) && w.stride * 4 >= want.stride;
}

// ---------- Contours ----------
function contourRings(g, values, thresholds) {
  const gen = d3.contours().size([g.nx, g.ny]).thresholds(thresholds);
  return gen(values).map((c) => {
    const rings = [];
    for (const poly of c.coordinates) for (const ring of poly) {
      rings.push(ring.map(([x, y]) => {
        const edge = x <= 0.5 || y <= 0.5 || x >= g.nx - 0.5 || y >= g.ny - 0.5;
        return [g.lat0 + (y - 0.5) * g.dlat, g.lon0 + (x - 0.5) * g.dlon, edge];
      }));
    }
    return { value: c.value, rings };
  });
}

function fillNaN(g, vals = g.v) {
  const v = Float64Array.from(vals); const { nx, ny } = g;
  let missing = true, pass = 0;
  while (missing && pass++ < 80) {
    missing = false; const nv = v.slice();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (v[k] === v[k]) continue;
      let s = 0, n = 0;
      if (i > 0 && v[k - 1] === v[k - 1]) { s += v[k - 1]; n++; }
      if (i < nx - 1 && v[k + 1] === v[k + 1]) { s += v[k + 1]; n++; }
      if (j > 0 && v[k - nx] === v[k - nx]) { s += v[k - nx]; n++; }
      if (j < ny - 1 && v[k + nx] === v[k + nx]) { s += v[k + nx]; n++; }
      if (n) nv[k] = s / n; else missing = true;
    }
    v.set(nv);
  }
  for (let k = 0; k < v.length; k++) if (v[k] !== v[k]) v[k] = 0;
  return v;
}

// Upsample a coarse grid (bilinear) so 25 km fields contour into smooth rings
function upsample(g, f) {
  const nx = (g.nx - 1) * f + 1, ny = (g.ny - 1) * f + 1, v = new Float32Array(nx * ny);
  const out = { nx, ny, lat0: g.lat0, lon0: g.lon0, dlat: g.dlat / f, dlon: g.dlon / f, v };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = sample(g, g.lat0 + j * out.dlat, g.lon0 + i * out.dlon);
  return out;
}

// SST gradient in °F per nautical mile on a smoothed field, plus its direction (unit vector, in cells).
// NaN where there's no water/data.
function gradient(g) {
  const { nx, ny } = g, n = nx * ny, R = 2;
  let sm = Float32Array.from(g.v);
  for (let pass = 0; pass < 2; pass++) {          // two box passes ~ gaussian
    const nxt = new Float32Array(n).fill(NaN);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; if (g.v[k] !== g.v[k]) continue;
      let s = 0, c = 0;
      for (let dj = -R; dj <= R; dj++) { const jj = j + dj; if (jj < 0 || jj >= ny) continue;
        for (let di = -R; di <= R; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; const x = sm[jj * nx + ii]; if (x === x) { s += x; c++; } } }
      nxt[k] = s / c;
    }
    sm = nxt;
  }
  const mag = new Float32Array(n).fill(NaN), ux = new Float32Array(n), uy = new Float32Array(n);
  for (let j = 1; j < ny - 1; j++) {
    const lat = g.lat0 + j * g.dlat, dxn = g.dlon * 60 * Math.cos(lat * Math.PI / 180), dyn = g.dlat * 60;
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i, gx = (sm[k + 1] - sm[k - 1]) / (2 * dxn), gy = (sm[k + nx] - sm[k - nx]) / (2 * dyn);
      const m = Math.hypot(gx, gy); if (m !== m) continue;
      mag[k] = m;
      // direction in grid cells (account for the cell aspect so "across the front" is right)
      const cx = gx * dxn, cy = gy * dyn, cl = Math.hypot(cx, cy) || 1; ux[k] = cx / cl; uy[k] = cy / cl;
    }
  }
  return { ...g, v: mag, ux, uy };
}

// Is this point on the crest of the gradient, i.e. the middle of the front, not its shoulders?
function onCrest(gr, lat, lon, m) {
  const fx = Math.round((lon - gr.lon0) / gr.dlon), fy = Math.round((lat - gr.lat0) / gr.dlat);
  if (fx < 1 || fy < 1 || fx >= gr.nx - 1 || fy >= gr.ny - 1) return false;
  const k = fy * gr.nx + fx, ox = gr.ux[k] * 1.5, oy = gr.uy[k] * 1.5;
  const a = sample(gr, lat + oy * gr.dlat, lon + ox * gr.dlon), b = sample(gr, lat - oy * gr.dlat, lon - ox * gr.dlon);
  return !(a > m * 1.04) && !(b > m * 1.04);
}

// ---------- Colors ----------
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function lut(stops) {
  const c = stops.map(hex), out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (c.length - 1), k = Math.min(c.length - 2, Math.floor(t)), f = t - k;
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = Math.round(c[k][ch] + (c[k + 1][ch] - c[k][ch]) * f);
  }
  return out;
}
const LUTS = Object.fromEntries(Object.entries(PRODUCTS).filter(([k]) => k !== 'wx').map(([k, p]) => [k, lut(p.stops)]));
{ // weather has two palettes (wind / waves)
  const keep = S.wxMode, mk = (m) => { S.wxMode = m; return lut(PRODUCTS.wx.stops); };
  const WXL = { wind: mk('wind'), waves: mk('waves') }; S.wxMode = keep;
  Object.defineProperty(LUTS, 'wx', { get: () => WXL[S.wxMode] || WXL.wind });
}
const tOf = (p, v, [lo, hi]) => (p.log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo));
const vOf = (p, t, [lo, hi]) => (p.log ? 10 ** (Math.log10(lo) + t * (Math.log10(hi) - Math.log10(lo))) : lo + t * (hi - lo));

// ---------- Map ----------
// Popups stay clear of the buttons on the right edge and the date bar / Jump to at the top
const POP_OPTS = (w = 330) => ({ maxWidth: Math.min(w, window.innerWidth - 110), keepInView: true,
  autoPanPaddingTopLeft: L.point(16, window.innerWidth <= 640 ? 140 : 100), autoPanPaddingBottomRight: L.point(70, 24) });
const map = L.map('map', {
  zoomControl: true, attributionControl: true, minZoom: 4, maxZoom: 16, zoomSnap: 0.5, wheelPxPerZoomLevel: 90,
  maxBounds: [[WORLD.s, WORLD.w], [WORLD.n, WORLD.e]], maxBoundsViscosity: 0.8, preferCanvas: true,
}).setView(store.get('view', [38.1, -74.3]), store.get('zoom', 7.5));
map.zoomControl.setPosition('topright');
map.attributionControl.setPrefix('').addAttribution('NASA JPL MUR, NOAA CoastWatch/AOML/STAR/ENC, NOAA ETOPO 2022 + NCEI coastal DEMs, EU Copernicus Marine, place names © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Not for navigation.');
map.createPane('data').style.zIndex = 300;
const reliefPane = map.createPane('relief'); reliefPane.style.zIndex = 320; reliefPane.style.mixBlendMode = 'multiply'; reliefPane.style.pointerEvents = 'none';
const chartPane = map.createPane('chart'); chartPane.style.zIndex = 450; chartPane.style.pointerEvents = 'none';
let dataLayer = null, reliefLayer = null;
// ---------- Inshore: NOAA chart overlay, high-res bottom, drop-offs, inshore picks ----------
// NOAA's official electronic chart (ENC): channels, buoys and lights, soundings in feet, shoal shading.
// Multiply blend: the chart's white water drops out and the temps show through.
const encPane = map.createPane('enc'); encPane.style.zIndex = 400; encPane.style.mixBlendMode = 'multiply'; encPane.style.pointerEvents = 'none';
const ENC_PARAMS = { ECDISParameters: { version: '10.6', DynamicParameters: { Parameter: [
  { name: 'DisplayDepthUnits', value: 2 }, { name: 'TwoDepthShades', value: 2 },
  { name: 'ShallowContour', value: 1.8 }, { name: 'SafetyContour', value: 3.7 }, { name: 'DeepContour', value: 9.1 },
  { name: 'DisplayCategory', value: '1,2,4' } ] } } };
const encLayer = L.tileLayer.wms('https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/WMSServer', {
  layers: '0,1,2,3,4,5,6,7', format: 'image/png', transparent: true, version: '1.3.0', tileSize: 512, minZoom: 11, maxZoom: 16,
  pane: 'enc', opacity: 0.85, display_params: JSON.stringify(ENC_PARAMS),
});
function syncEnc() {
  if (S.ov.enc && !map.hasLayer(encLayer)) encLayer.addTo(map); if (!S.ov.enc && map.hasLayer(encLayer)) map.removeLayer(encLayer);
  // fade the color map under the chart so buoys, channel lines and soundings read (like a boating app)
  map.getPane('data').style.opacity = encOn() ? 0.5 : 1;
}
map.on('zoomend', syncEnc);
const encOn = () => S.ov.enc && map.getZoom() >= 11;

// High-res bottom (NOAA NCEI coastal DEMs, ~3-10 m inside the inlets and sounds) for the view, once zoomed in past 12
const DEM_URL = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage';
let hiTok = 0, hiTimer = null;
function queueHiDem() { clearTimeout(hiTimer); hiTimer = setTimeout(loadHiDem, 350); }
async function loadHiDem() {
  if (map.getZoom() < 12 || !(S.ov.drop || (S.prod === 'fish' && SPECIES[S.species]?.inshore))) { if (S.data.hidem) { S.data.hidem = null; S.geo.drop = null; chart.draw(); } return; }
  const b = map.getBounds().pad(0.1), sz = map.getSize();
  const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
  const H0 = S.data.hidem;
  if (H0 && s >= H0.bb[0] && n <= H0.bb[1] && w >= H0.bb[2] && e <= H0.bb[3] && Math.abs(H0.z - map.getZoom()) < 0.6) return;
  const W = Math.min(800, Math.round(sz.x * 1.2 / 1.6)), H = Math.min(800, Math.round(sz.y * 1.2 / 1.6));
  const my = ++hiTok;
  try {
    const url = `${DEM_URL}?bbox=${w.toFixed(5)},${s.toFixed(5)},${e.toFixed(5)},${n.toFixed(5)}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=bsq&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
    const buf = await (await fetch(url)).arrayBuffer();
    if (my !== hiTok || buf.byteLength < W * H * 4) return;
    const raw = new Float32Array(buf.slice(0, W * H * 4)), v = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const x = raw[(H - 1 - j) * W + i]; v[j * W + i] = x === x && Math.abs(x) < 12000 ? x : NaN; }
    const dlat = (n - s) / H, dlon = (e - w) / W;
    S.data.hidem = { nx: W, ny: H, lat0: s + dlat / 2, lon0: w + dlon / 2, dlat, dlon, v, bb: [s, n, w, e], z: map.getZoom() };
    buildDrops();
    if (S.prod === 'fish' && SPECIES[S.species]?.inshore) buildFish();
    chart.draw();
  } catch (err) { console.warn('hi-res depth', err); }
}
// Drop-offs: where the bottom falls 6+ ft per 100 ft, between 2 and 80 ft of water
function buildDrops() {
  const g = S.data.hidem; if (!g) return;
  const { nx, ny, v } = g, img = new ImageData(nx, ny), slope = new Float32Array(nx * ny).fill(NaN);
  const dy = g.dlat * 111320;
  for (let j = 2; j < ny - 2; j++) {
    const dx = g.dlon * 111320 * Math.cos((g.lat0 + j * g.dlat) * Math.PI / 180);
    for (let i = 2; i < nx - 2; i++) {
      const k = j * nx + i, z = v[k]; if (!(z < -0.6 && z > -25)) continue;
      const gx = (v[k + 2] - v[k - 2]) / (4 * dx), gy = (v[k + 2 * nx] - v[k - 2 * nx]) / (4 * dy);
      const m = Math.hypot(gx, gy); if (m !== m) continue;
      slope[k] = m;
      if (m < 0.06) continue;
      const a = Math.min(1, (m - 0.06) / 0.18), o = k * 4;
      img.data[o] = 255; img.data[o + 1] = Math.round(120 - 80 * a); img.data[o + 2] = 20; img.data[o + 3] = Math.round(70 + 150 * a);
    }
  }
  const cv = document.createElement('canvas'); cv.width = nx; cv.height = ny;
  const cx = cv.getContext('2d'); cx.putImageData(img, 0, 0);
  // flip so north is up (rows run south -> north)
  const up = document.createElement('canvas'); up.width = nx; up.height = ny;
  const ux = up.getContext('2d'); ux.translate(0, ny); ux.scale(1, -1); ux.drawImage(cv, 0, 0);
  // the steepest edge in each ~block, with its top and bottom depths, for the inshore picks
  const blk = Math.max(6, Math.round(nx / 20)), pts = [];
  for (let J = 0; J < ny; J += blk) for (let I = 0; I < nx; I += blk) {
    let best = -1, bk = -1;
    for (let j = J; j < Math.min(ny, J + blk); j++) for (let i = I; i < Math.min(nx, I + blk); i++) { const k = j * nx + i; if (slope[k] > best) { best = slope[k]; bk = k; } }
    if (best < 0.07) continue;
    const j = Math.floor(bk / nx), i = bk % nx; let lo = 0, hi = -1e9;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const x = v[(j + dj) * nx + i + di]; if (x === x && x < -0.3) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
    if (hi < -1e8) continue;
    pts.push({ lat: g.lat0 + j * g.dlat, lon: g.lon0 + i * g.dlon, top: -hi * 3.28084, bot: -lo * 3.28084, slope: best });
  }
  S.geo.drop = { img: up, bb: g.bb, pts };
}
function drawDrops(ctx) {
  const D = S.geo.drop; if (!D || !S.ov.drop || map.getZoom() < 12) return;
  const [s, n, w, e] = D.bb, [x0, y0] = project(n, w), [x1, y1] = project(s, e);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9; ctx.drawImage(D.img, x0, y0, x1 - x0, y1 - y0); ctx.restore();
}
function depthAt(lat, lon) { const h = sample(S.data.hidem, lat, lon); return h === h ? h : sample(S.data.bathy, lat, lon); }

// ---------- Inshore species: rank the structure on screen ----------
const INSHORE_WHY = {
  inlet: 'inlet: moving water funnels bait through on both tides',
  jetty: 'rocks along the jetty hold bait and break the current',
  pier: 'pilings hold bait and shade; fish the up-current side',
  bridge: 'bridge pilings and shadow lines; best on moving tide',
  rock: 'hard bottom / rocks',
  shoal: 'shoal or bar: fish the edges where it drops to the channel',
  reef: 'reef or oyster bottom holds bait',
  drop: 'drop-off: fish sit at the base and ambush bait washing off the edge',
};
const INSHORE_LBL = { inlet: 'Inlet', jetty: 'Jetty', pier: 'Pier', bridge: 'Bridge', rock: 'Rocks', shoal: 'Shoal', reef: 'Reef', drop: 'Drop-off' };
function inshoreCandidates() {
  const b = map.getBounds().pad(-0.04), out = [];
  const inV = (la, lo) => la > b.getSouth() && la < b.getNorth() && lo > b.getWest() && lo < b.getEast();
  for (const [name, la, lo] of PORTS) if (inV(la, lo)) out.push({ lat: la, lon: lo, kind: 'inlet', name });
  for (const r of SPOTS || []) {
    if (!inV(r[0], r[1])) continue;
    const k = r[3] === 'reef' ? 'reef' : r[3] === 'pier' ? (/bridge/i.test(r[2]) ? 'bridge' : 'pier') : r[3] === 'jetty' ? 'jetty' : r[3] === 'rock' ? 'rock'
      : r[3] === 'shoal/bar' ? 'shoal' : r[3] === 'inshore' ? (/bridge/i.test(r[2]) ? 'bridge' : 'shoal') : null;
    if (k) out.push({ lat: r[0], lon: r[1], kind: k, name: r[2] });
  }
  for (const [la, lo, name, kind] of PLACES || []) {
    if (kind !== 'sea' || !inV(la, lo)) continue;
    const k = /inlet|pass\b|cut\b|narrows|gut\b/i.test(name) ? 'inlet' : /shoal|bar\b|flats?\b|lump|point/i.test(name) ? 'shoal' : /channel/i.test(name) ? 'drop' : null;
    if (k) out.push({ lat: la, lon: lo, kind: k, name });
  }
  for (const p of S.geo.drop?.pts || []) if (inV(p.lat, p.lon)) out.push({ ...p, kind: 'drop', name: null });
  return out;
}
function tempNear(la, lo) {
  const g = S.fishT || S.data.sst; let t = sample(g, la, lo); if (t === t) return t;
  for (const r of [0.02, 0.04, 0.07, 0.1]) for (let a = 0; a < 8; a++) { t = sample(g, la + r * Math.sin(a * Math.PI / 4), lo + r * Math.cos(a * Math.PI / 4)); if (t === t) return t; }
  return NaN;
}
function inshoreSpots(sp) {
  const cand = inshoreCandidates(), res = [];
  for (const c of cand) {
    const t = tempNear(c.lat, c.lon), tf = t === t ? tempFit(t, sp.t) : 0.5;
    const z = depthAt(c.lat, c.lon), ft = z < 0 ? -z * 3.28084 : NaN;
    let df;
    if (c.kind === 'drop') { const lo = Math.max(c.top, sp.ft[0]), hi = Math.min(c.bot, sp.ft[1]); df = hi > lo ? 1 : 0.35; }
    else if (ft !== ft) df = ['pier', 'jetty', 'inlet', 'bridge'].includes(c.kind) ? 0.75 : 0.4;
    else df = ft >= sp.ft[0] && ft <= sp.ft[1] ? 1 : ft < sp.ft[0] ? 0.5 : Math.max(0.25, 1 - (ft - sp.ft[1]) / (sp.ft[1] * 2));
    const like = sp.like[c.kind] || 0.3;
    const sc = Math.round(100 * tf * like * (0.4 + 0.6 * df));
    if (sc < 15) continue;
    const why = [];
    why.push(`${c.name ? `${c.name} · ` : ''}${INSHORE_LBL[c.kind]}`);
    if (c.kind === 'drop') { if (c.bot - c.top < 3) continue; why.push(`${Math.round(c.top)} → ${Math.round(c.bot)} ft`); } else if (ft === ft) why.push(`${Math.round(ft)} ft`);
    if (t === t) why.push(`${t.toFixed(1)}°F${tf >= 1 ? '' : tf > 0 ? ` (${sp.t[1]}-${sp.t[2]}° is best)` : ' (outside their range)'}`);
    why.push(INSHORE_WHY[c.kind]);
    res.push({ lat: c.lat, lon: c.lon, score: sc, why, kind: c.kind, name: c.name, ft: c.kind === 'drop' ? c.top : ft });
  }
  res.sort((a, b) => b.score - a.score);
  const out = [], per = {};
  for (const r of res) {
    if (out.some((o) => rangeBearing([o.lat, o.lon], [r.lat, r.lon])[0] < 0.35 || (r.name && o.name === r.name))) continue;
    if ((per[r.kind] = (per[r.kind] || 0) + 1) > 3) continue;     // keep the list varied
    out.push(r); if (out.length >= 8) break;
  }
  return out;
}

const Chart = L.Layer.extend({
  onAdd(m) {
    this._c = L.DomUtil.create('canvas', '', m.getPane('chart'));
    m.on('moveend zoomend resize viewreset', this.draw, this);
    m.on('zoomstart', () => { this._c.style.opacity = 0; });
    this.draw();
  },
  draw() {
    const size = map.getSize(), dpr = window.devicePixelRatio || 1, c = this._c;
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]));
    c.width = size.x * dpr; c.height = size.y * dpr; c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
    c.style.opacity = 1;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawChart(ctx, size);
  },
});
function project(lat, lon) { const p = map.latLngToContainerPoint([lat, lon]); return [p.x, p.y]; }
let chart;   // created at the bottom, once everything it draws is defined

function strokeRings(ctx, rings, minLen = 0) {
  const spots = [];
  for (const ring of rings) {
    ctx.beginPath(); let len = 0, prev = null; const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const [la, lo, edge] = ring[i], p = project(la, lo);
      if (i === 0 || (edge && ring[i - 1][2])) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      if (prev) len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      pts.push([p[0], p[1], len, edge]); prev = p;
    }
    ctx.stroke();
    if (len > minLen) spots.push(pts);
  }
  return spots;
}
function fillRings(ctx, rings) {
  ctx.beginPath();
  for (const ring of rings) ring.forEach(([la, lo], i) => { const p = project(la, lo); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
  ctx.fill('evenodd');
}
function haloText(ctx, txt, x, y, fg = '#111', bg = 'rgba(255,255,255,.9)') {
  ctx.lineWidth = 3.5; ctx.strokeStyle = bg; ctx.strokeText(txt, x, y); ctx.fillStyle = fg; ctx.fillText(txt, x, y);
}
function placeLabels(ctx, spots, txt, boxes, size, every = 260, fg, bg) {
  const w = ctx.measureText(txt).width + 6, h = 14;
  for (const pts of spots) {
    for (let target = every / 2; target < pts[pts.length - 1][2]; target += every) {
      const p = pts.find((q2) => q2[2] >= target);
      if (!p || p[3]) continue;
      const [x, y] = p;
      if (x < 80 || y < 80 || x > size.x - 40 || y > size.y - 110) continue;
      const b = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]))) continue;
      boxes.push(b); haloText(ctx, txt, x, y, fg, bg);
    }
  }
}

function drawChart(ctx, size) {
  const z = map.getZoom(), boxes = [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const sstProd = PRODUCTS[S.prod].sst;

  if (S.ov.iso && sstProd) {
    for (const c of S.geo.iso) {
      if (Math.abs(c.value - Math.round(c.value)) > 1e-6) continue;
      const major = c.value % 5 === 0;
      ctx.strokeStyle = major ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.28)'; ctx.lineWidth = major ? 1 : 0.7;
      const spots = strokeRings(ctx, c.rings, 220);
      if (major) { ctx.font = '600 10.5px system-ui, sans-serif'; placeLabels(ctx, spots, `${c.value}°`, boxes, size, 600); }
    }
  }

  // Altimetry rings: solid = high (warm eddy), dashed = low (cold eddy)
  if ((S.ov.rings || S.prod === 'ana') && S.geo.rings.length) {
    const step = z >= 8 ? 5 : 10;
    for (const c of S.geo.rings) {
      if (c.value % step !== 0) continue;
      const strong = c.value % 20 === 0;
      ctx.setLineDash(c.value < 0 ? [7, 5] : []);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = strong ? 3.4 : 2.6; strokeRings(ctx, c.rings);
      ctx.strokeStyle = c.value === 0 ? 'rgba(20,20,20,.8)' : c.value > 0 ? '#7a0f1c' : '#0f2a7a'; ctx.lineWidth = strong ? 1.6 : 1;
      const spots = strokeRings(ctx, c.rings, 160);
      ctx.setLineDash([]);
      ctx.font = '700 10.5px system-ui, sans-serif';
      placeLabels(ctx, spots, `${c.value > 0 ? '+' : ''}${c.value}`, boxes, size, 340, c.value > 0 ? '#7a0f1c' : '#0f2a7a');
    }
  }

  // Temperature breaks: isotherm segments where the gradient is strong
  if ((S.ov.breaks || S.prod === 'ana') && sstProd && S.geo.breaks.length) {
    for (const [w, segs] of [[1, S.geo.breaks.filter((s) => s.k === 1)], [2, S.geo.breaks.filter((s) => s.k === 2)]]) {
      for (const [col, lw] of [['rgba(0,0,0,.9)', w === 2 ? 5.5 : 4.4], ['#fff', w === 2 ? 2.8 : 1.9]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
        for (const s of segs) {
          const p0 = project(s.a[0], s.a[1]), p1 = project(s.b[0], s.b[1]);
          ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
        }
        ctx.stroke();
      }
    }
  }

  drawDrops(ctx);
  if (S.ov.depth && S.geo.depth.length) {
    const show = new Set(z >= 8.5 ? [...DEPTHS_MAJOR, ...DEPTHS_MINOR] : z >= 7.5 ? [...DEPTHS_MAJOR, 20, 30, 200] : z >= 6 ? DEPTHS_MAJOR : [100, 1000]);
    // inshore lines once you're zoomed in on the sounds, bays and beaches (6 ft only when closer still)
    if (z >= 9) [2, 3, 5].forEach((f) => show.add(f));
    if (z >= 10) show.add(1);
    for (const c of S.geo.depth) {
      if (!show.has(c.fm)) continue;
      const major = DEPTHS_MAJOR.includes(c.fm), inshore = DEPTHS_INSHORE.includes(c.fm);
      if (inshore && encOn()) continue;          // NOAA chart has the real shoal lines
      if (inshore) {
        ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2; strokeRings(ctx, c.rings);
        ctx.strokeStyle = 'rgba(10,30,60,.9)'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]);
        const spots = strokeRings(ctx, c.rings, 140); ctx.setLineDash([]);
        ctx.font = 'italic 600 10.5px system-ui, sans-serif';
        placeLabels(ctx, spots, `${c.fm * 6}'`, boxes, size, 420);
        continue;
      }
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = major ? 3.4 : 2.4; strokeRings(ctx, c.rings);
      ctx.strokeStyle = 'rgba(10,10,10,.95)'; ctx.lineWidth = major ? 1.4 : 0.9;
      const spots = strokeRings(ctx, c.rings, 180);
      ctx.font = `${major ? 700 : 600} 11px system-ui, sans-serif`;
      placeLabels(ctx, spots, `${c.fm}`, boxes, size, major ? 300 : 380);
    }
  }

  if (S.geo.land.length && !encOn()) {            // zoomed in, NOAA's chart has the real shoreline
    ctx.fillStyle = S.prod === 'bottom' ? '#6b6352' : '#2b2f33'; fillRings(ctx, S.geo.land);
    ctx.strokeStyle = '#c9d1d9'; ctx.lineWidth = 1; strokeRings(ctx, S.geo.land);
  }

  if ((S.ov.cur || S.prod === 'cur') && (S.data.curb || S.data.hf)) drawCurrents(ctx, size);
  if (S.ov.wrecks) drawWrecks(ctx, size, z);
  if (S.prod === 'ana') drawAnalysis(ctx, size, boxes);
  if (S.prod === 'fish' || S.prod === 'ana') drawHotspots(ctx);
  if (S.fwHits) drawFindWater(ctx);
  if (S.prod === 'wx') drawWx(ctx);

  if (S.ov.ports) {
    ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'left';
    for (const [name, la, lo] of PORTS) {
      const [x, y] = project(la, lo);
      if (x < -50 || y < -20 || x > size.x + 50 || y > size.y + 20) continue;
      const home = name === S.home, label = name;
      ctx.beginPath(); ctx.arc(x, y, home ? 5 : 3.5, 0, 7); ctx.fillStyle = home ? '#35c2ff' : '#fff'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
      if (z >= 7.5 || home) {
        const lw = ctx.measureText(label).width;
        haloText(ctx, label, x - lw - 8, y, '#fff', 'rgba(0,0,0,.75)');
        boxes.push([x - lw - 11, y - 8, x + 6, y + 8]);
      }
    }
    ctx.textAlign = 'center';
  }
  if (S.ov.spots) drawSpots(ctx, size, z, boxes);
  if (S.ov.places) drawPlaces(ctx, size, z, boxes);

  const cc = map.getCenter(), tdHere = inLoran(cc.lat, cc.lng);
  if ((S.grid === 'td' || S.grid === 'both') && tdHere) drawTdGrid(ctx, size, z);
  if (S.grid === 'td' && !tdHere) drawGrid(ctx, size, z);       // no Loran coverage here: fall back to lat/lon
  if (S.grid === 'll' || S.grid === 'both') drawGrid(ctx, size, z);
}

function drawGrid(ctx, size, z) {
  const stepMin = z >= 10 ? 5 : z >= 8.5 ? 10 : z >= 7.5 ? 15 : z >= 6.5 ? 30 : 60;
  const b = map.getBounds(), st = stepMin / 60;
  const lat0 = Math.floor(b.getSouth() / st) * st, lon0 = Math.floor(b.getWest() / st) * st, lab = [];
  ctx.save();
  for (let la = lat0; la <= b.getNorth() + st; la += st) {
    const whole = Math.abs(la - Math.round(la)) < 1e-6, y = project(la, b.getWest())[1];
    ctx.strokeStyle = whole ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = whole ? 1.2 : 0.8;
    ctx.setLineDash(whole ? [] : [6, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size.x, y); ctx.stroke();
    lab.push(['lat', la, y]);
  }
  for (let lo = lon0; lo <= b.getEast() + st; lo += st) {
    const whole = Math.abs(lo - Math.round(lo)) < 1e-6, x = project(b.getSouth(), lo)[0];
    ctx.strokeStyle = whole ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)'; ctx.lineWidth = whole ? 1.2 : 0.8;
    ctx.setLineDash(whole ? [] : [6, 4]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size.y); ctx.stroke();
    lab.push(['lon', lo, x]);
  }
  ctx.setLineDash([]);
  ctx.font = '700 11px system-ui, sans-serif';
  const pxLon = Math.abs(project(b.getSouth(), lon0 + st)[0] - project(b.getSouth(), lon0)[0]);
  const pxLat = Math.abs(project(lat0 + st, b.getWest())[1] - project(lat0, b.getWest())[1]);
  const eLon = Math.max(1, Math.ceil(78 / pxLon)), eLat = Math.max(1, Math.ceil(24 / pxLat));
  const nth = (v, e) => Math.round(v / st) % e === 0;
  const fmt = (v, h) => { const a = Math.abs(v), d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60); return `${d}°${String(m).padStart(2, '0')}'${h}`; };
  for (const [k, v, p] of lab) {
    if (k === 'lat' && nth(v, eLat) && p > 60 && p < size.y - 110) tag(ctx, fmt(v, v >= 0 ? 'N' : 'S'), 4, p, 'left');
    if (k === 'lon' && nth(v, eLon) && p > 90 && p < size.x - 60) tag(ctx, fmt(v, v >= 0 ? 'E' : 'W'), p, 60, 'center');
  }
  ctx.restore();
}
function tag(ctx, txt, x, y, align, bg = 'rgba(8,17,27,.85)', fg = '#fff') {
  const w = ctx.measureText(txt).width + 10, h = 17, bx = align === 'left' ? x : x - w / 2;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(bx, y - h / 2, w, h, 4); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.fillText(txt, bx + w / 2, y + 0.5);
}

// Loran TD lines: hyperbolas computed for the current view, contoured, labeled in yellow/green
let tdCache = { key: '' };
function drawTdGrid(ctx, size, z) {
  const b = map.getBounds().pad(0.1), key = `${b.toBBoxString()}|${S.tdPair}|${S.tdOff}`;
  if (tdCache.key !== key) {
    const nx = 90, ny = 70, g = { nx, ny, lat0: b.getSouth(), lon0: b.getWest(), dlat: (b.getNorth() - b.getSouth()) / (ny - 1), dlon: (b.getEast() - b.getWest()) / (nx - 1) };
    const A = new Float64Array(nx * ny), B = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const [a, c] = tds(g.lat0 + j * g.dlat, g.lon0 + i * g.dlon); A[j * nx + i] = a; B[j * nx + i] = c; }
    const pick = (arr) => {
      const span = d3.max(arr) - d3.min(arr), steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
      const st = steps.find((s) => span / s <= 14) || 1000;
      const th = []; for (let t = Math.ceil(d3.min(arr) / st) * st; t <= d3.max(arr); t += st) th.push(t);
      return { st, c: contourRings({ ...g, nx, ny }, arr, th) };
    };
    tdCache = { key, a: pick(A), b: pick(B) };
  }
  const boxes = [];
  for (const [set, col] of [[tdCache.a, '#ffd23f'], [tdCache.b, '#7dff9a']]) {
    for (const c of set.c) {
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 2.6; strokeRings(ctx, c.rings);
      ctx.strokeStyle = col; ctx.lineWidth = 1.1;
      const spots = strokeRings(ctx, c.rings, 120);
      ctx.font = '700 10.5px system-ui, sans-serif';
      placeLabels(ctx, spots, `${c.value}`, boxes, size, 420, col, 'rgba(0,0,0,.85)');
    }
  }
}

// Current at a point: HF radar (hourly, 2-6 km) where it reaches, satellite geostrophic (daily, 25 km) beyond.
function curAt(lat, lon) {
  if (S.fc > 0) {     // forecast mode: the ocean model only (radar and satellite can't see the future)
    const f = S.data.curfc; if (!f) return null;
    const u = sample(f, lat, lon, f.u), v = sample(f, lat, lon, f.vv);
    return u === u && v === v ? [u, v, 'model forecast'] : null;
  }
  for (const [h, lbl] of S.curSrc !== 'sat' ? [] : [[map.getZoom() >= 9 && S.data.hf1, 'HF radar 1 km'], [S.data.hf, 'HF radar 6 km']]) {
    if (h) { const u = sample(h, lat, lon, h.u), v = sample(h, lat, lon, h.vv); if (u === u && v === v) return [u, v, lbl]; }
  }
  const b = S.data.curb;
  if (b) { const u = sample(b, lat, lon, b.u), v = sample(b, lat, lon, b.vv); if (u === u && v === v) return [u, v, b.model ? `${CUR_SRC[b.model]} model ${niceHour(b.time)}` : 'satellite']; }
  return null;
}
// Arrows on a fixed screen spacing, so detail scales with zoom; length and color by speed
function drawCurrents(ctx, size) {
  const sp = S.prod === 'cur' ? 34 : 46;
  for (let y = sp / 2; y < size.y; y += sp) for (let x = sp / 2; x < size.x; x += sp) {
    const ll = map.containerPointToLatLng([x, y]), c = curAt(ll.lat, ll.lng); if (!c) continue;
    const z = sample(S.data.bathy, ll.lat, ll.lng); if (z === z && z > 0) continue;
    const [u, v] = c, kt = Math.hypot(u, v) * 1.94384; if (kt < 0.05) continue;
    const L0 = Math.min(sp * 0.95, 7 + kt * 16), a = Math.atan2(-v, u), x0 = x - Math.cos(a) * L0 / 2, y0 = y - Math.sin(a) * L0 / 2;
    const x2 = x0 + Math.cos(a) * L0, y2 = y0 + Math.sin(a) * L0;
    const col = S.prod === 'cur' ? 'rgba(255,255,255,.95)' : kt >= 1.5 ? '#ff5ad1' : kt >= 0.75 ? '#fff' : 'rgba(255,255,255,.75)';
    for (const [cc, w] of [['rgba(0,0,0,.75)', 3.4], [col, 1.5]]) {
      ctx.strokeStyle = cc; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(a - 0.45) * 6, y2 - Math.sin(a - 0.45) * 6); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - Math.cos(a + 0.45) * 6, y2 - Math.sin(a + 0.45) * 6); ctx.stroke();
    }
  }
}

// ---------- Wrecks, fish havens, obstructions (NOAA ENC, shipped with the app) ----------
let WRECKS = null;
fetch('data/wrecks.json').then((r) => r.json()).then((d) => { WRECKS = d.rows; chart?.draw(); }).catch(() => {});
function drawWrecks(ctx, size, z) {
  if (!WRECKS || z < 8) return;
  const b = map.getBounds().pad(0.05);
  ctx.save(); ctx.lineWidth = 1.4;
  for (const [la, lo, t] of WRECKS) {
    if (la < b.getSouth() || la > b.getNorth() || lo < b.getWest() || lo > b.getEast()) continue;
    if ((t === 'O' && z < 9.5) || (t === 'W' && z < 8.5)) continue;
    const [x, y] = project(la, lo);
    if (t === 'W') {      // chart-style wreck: hull line with three masts
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3.6; wreckGlyph(ctx, x, y); ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 1.6; wreckGlyph(ctx, x, y);
    } else if (t === 'F') {   // fish haven / artificial reef
      ctx.fillStyle = '#39d98a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.rect(x - 4.5, y - 4.5, 9, 9); ctx.fill(); ctx.stroke();
    } else {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#e6e6e6'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
}
function wreckGlyph(ctx, x, y) {
  ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y);
  for (const dx of [-3.5, 0, 3.5]) { ctx.moveTo(x + dx, y - 4); ctx.lineTo(x + dx, y + 4); }
  ctx.stroke();
}
function wrecksNear(lat, lon, nm = 0.75) {
  if (!WRECKS) return [];
  const out = [];
  for (const r of WRECKS) {
    if (Math.abs(r[0] - lat) > 0.02 || Math.abs(r[1] - lon) > 0.025) continue;
    const d = rangeBearing([lat, lon], [r[0], r[1]])[0]; if (d <= nm) out.push([d, r]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, 4);
}

// ---------- Place names (NOAA chart names in US waters, OpenStreetMap elsewhere; shipped with the app) ----------
let PLACES = null;
fetch('data/places.json').then((r) => r.json()).then((d) => { PLACES = d.rows; chart?.draw(); }).catch(() => {});
// minimum zoom by kind + rank (rank 1 = major: canyons/banks/seamounts, cities)
const PLACE_Z = { sea: [6.5, 8.5], land: [8, 9], island: [7.5, 9.5], town: [7, 8.5, 10] };
const PLACE_STYLE = {
  sea: { font: 'italic 600 11.5px Georgia, "Times New Roman", serif', fg: '#bfe6ff', bg: 'rgba(3,18,34,.85)' },
  land: { font: 'italic 600 11px Georgia, "Times New Roman", serif', fg: '#f1f1e6', bg: 'rgba(0,0,0,.75)' },
  island: { font: '700 11px system-ui, sans-serif', fg: '#ffffff', bg: 'rgba(0,0,0,.75)' },
  town: { font: '500 10.5px system-ui, sans-serif', fg: '#e9e4d6', bg: 'rgba(0,0,0,.7)' },
};
function drawPlaces(ctx, size, z, boxes) {
  if (!PLACES) return;
  const b = map.getBounds().pad(0.02), seen = new Set();
  // sea features first (what matters offshore), then islands, capes, towns
  const order = ['sea', 'island', 'land', 'town'];
  ctx.save(); ctx.textBaseline = 'middle';
  let drawn = 0;
  for (const kind of order) {
    const st = PLACE_STYLE[kind]; ctx.font = st.font;
    for (const [la, lo, name, k, rank] of PLACES) {
      if (k !== kind || drawn > 160) continue;
      const minZ = PLACE_Z[k][Math.min(rank, PLACE_Z[k].length) - 1]; if (z < minZ) continue;
      if (la < b.getSouth() || la > b.getNorth() || lo < b.getWest() || lo > b.getEast()) continue;
      if (seen.has(name)) continue;                      // big features have several chart labels; show one
      const [x, y] = project(la, lo), w = ctx.measureText(name).width;
      const dx = kind === 'town' ? 6 : -w / 2, bx = [x + dx - 3, y - 8, x + dx + w + 3, y + 8];
      if (bx[0] < 60 || bx[1] < 74 || bx[2] > size.x - 50 || bx[3] > size.y - 100) continue;
      if (boxes.some((o) => !(bx[2] < o[0] || bx[0] > o[2] || bx[3] < o[1] || bx[1] > o[3]))) continue;
      boxes.push(bx); seen.add(name); drawn++;
      if (kind === 'town') { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fillStyle = st.fg; ctx.fill(); }
      ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = st.bg; ctx.strokeText(name, x + dx, y); ctx.fillStyle = st.fg; ctx.fillText(name, x + dx, y);
    }
  }
  ctx.restore(); ctx.textAlign = 'center';
}

// ---------- Named fishing spots: fishermen's names (vetted, sourced) + official state artificial reefs ----------
let SPOTS = null;
fetch('data/spots.json').then((r) => r.json()).then((d) => { SPOTS = d.rows; chart?.draw(); }).catch(() => {});
const INSHORE_KINDS = new Set(['pier', 'jetty', 'rock', 'shoal/bar', 'inshore']);
const spotPass = (r) => (r[3] === 'reef' ? 'reef' : INSHORE_KINDS.has(r[3]) ? 'inshore' : 'named');
const isNamedSpot = (r) => spotPass(r) === 'named';   // lumps, holes, canyons, towers, grounds vs. reefs and inshore marks
function drawSpots(ctx, size, z, boxes) {
  if (!SPOTS || z < 7) return;
  const b = map.getBounds().pad(0.02);
  ctx.save(); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  let n = 0;
  // fishermen's named spots first (bigger, orange), then reefs (green, only when zoomed in)
  for (const pass of ['named', 'reef', 'inshore']) {
    if (pass === 'reef' && z < 9) continue;
    if (pass === 'inshore' && z < 10) continue;
    if (pass === 'named' && z < 7.5) continue;
    ctx.font = pass === 'named' ? 'italic 700 11.5px system-ui, sans-serif' : '600 10.5px system-ui, sans-serif';
    for (const r of SPOTS) {
      if (n > 260) break;
      const [la, lo, name] = r, named = pass === 'named';
      if (spotPass(r) !== pass) continue;
      if (la < b.getSouth() || la > b.getNorth() || lo < b.getWest() || lo > b.getEast()) continue;
      const [x, y] = project(la, lo);
      // zoomed out, a spot shows only where its name fits (no piles of unlabeled diamonds); zoomed in, every spot shows
      const w = ctx.measureText(name).width, bx = [x + 8, y - 8, x + 12 + w, y + 8];
      const fits = !(bx[0] < 60 || bx[1] < 74 || bx[2] > size.x - 50 || bx[3] > size.y - 100) && !boxes.some((o) => !(bx[2] < o[0] || bx[0] > o[2] || bx[3] < o[1] || bx[1] > o[3]));
      if (!fits && (z < 9 || (pass === 'inshore' && z < 11))) continue;
      if (pass === 'inshore') { ctx.fillStyle = '#5fd3ff'; ctx.fillRect(x - 3.5, y - 3.5, 7, 7); ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); }
      else if (named) { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fillStyle = '#ffb347'; ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = '#000'; ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 7); ctx.fillStyle = '#2ecc71'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#000'; ctx.stroke(); }
      if (!fits) continue;
      boxes.push(bx); n++;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(name, x + 9, y);
      ctx.fillStyle = named ? '#ffd28a' : pass === 'inshore' ? '#bfeeff' : '#b8f5cf'; ctx.fillText(name, x + 9, y);
    }
  }
  ctx.restore(); ctx.textAlign = 'center';
}
function spotsNear(lat, lon, nm = 1.5) {
  if (!SPOTS) return [];
  const out = [];
  for (const r of SPOTS) {
    if (Math.abs(r[0] - lat) > 0.03 || Math.abs(r[1] - lon) > 0.035) continue;
    const d = rangeBearing([lat, lon], [r[0], r[1]]); if (d[0] <= nm) out.push([d[0], d[1], r]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, 3);
}

// ---------- Live NDBC buoys ----------
let buoyLayer = null, BUOYS = [];
async function loadBuoys() {
  try {
    const txt = await (await fetch('/erddap/ndbc/data/latest_obs/latest_obs.txt')).text();
    const rows = txt.split('\n').filter((l) => l && l[0] !== '#').map((l) => l.trim().split(/\s+/));
    const n = (x) => (x === 'MM' || x === undefined ? null : +x);
    BUOYS = rows.map((c) => ({
      id: c[0], lat: +c[1], lon: +c[2], t: `${c[3]}-${c[4]}-${c[5]}T${c[6]}:${c[7]}:00Z`, wdir: n(c[8]), wspd: n(c[9]), gst: n(c[10]),
      wvht: n(c[11]), dpd: n(c[12]), mwd: n(c[14]), pres: n(c[15]), atmp: n(c[17]), wtmp: n(c[18]),
    })).filter((b) => b.lat > WORLD.s && b.lat < WORLD.n && b.lon > WORLD.w && b.lon < WORLD.e);
    drawBuoys();
  } catch (e) { console.warn('buoys', e); }
}
function buoyHtml(b) {
  const kt = (ms) => (ms == null ? '–' : `${Math.round(ms * 1.94384)} kt`), ft = (m) => (m == null ? '–' : `${(m * 3.28084).toFixed(1)} ft`);
  const age = Math.round((Date.now() - new Date(b.t)) / 60000);
  return `<div class="pp"><div class="coord">NDBC ${b.id} <a href="https://www.ndbc.noaa.gov/station_page.php?station=${b.id}" target="_blank" rel="noopener">station page</a></div><table>
    <tr><td>Water temp</td><td>${b.wtmp == null ? '–' : C2F(b.wtmp).toFixed(1) + '°F'}</td></tr>
    <tr><td>Wind</td><td>${b.wdir == null ? '' : Math.round(b.wdir) + '° '}${kt(b.wspd)} g ${kt(b.gst)}</td></tr>
    <tr><td>Waves</td><td>${ft(b.wvht)}${b.dpd ? ` @ ${b.dpd} s` : ''}${b.mwd != null ? ` from ${Math.round(b.mwd)}°` : ''}</td></tr>
    <tr><td>Air / pressure</td><td>${b.atmp == null ? '–' : C2F(b.atmp).toFixed(0) + '°F'} / ${b.pres ?? '–'} hPa</td></tr>
    <tr><td>Updated</td><td>${age < 120 ? `${age} min ago` : `${Math.round(age / 60)} h ago`}</td></tr></table></div>`;
}
function drawBuoys() {
  if (buoyLayer) { map.removeLayer(buoyLayer); buoyLayer = null; }
  if (!S.ov.buoys || !BUOYS.length) return;
  // offshore NDBC buoys (5-digit ids) always; shore stations (C-MAN, NOS) only when zoomed in
  const z = map.getZoom(), list = BUOYS.filter((b) => /^\d{5}$/.test(b.id) || z >= 9);
  buoyLayer = L.layerGroup(list.map((b) => {
    const label = b.wtmp != null ? `${Math.round(C2F(b.wtmp))}°` : b.wvht != null ? `${(b.wvht * 3.28084).toFixed(0)}'` : '';
    return L.marker([b.lat, b.lon], { icon: L.divIcon({ className: '', html: `<div class="buoy"><i></i>${label ? `<span>${label}</span>` : ''}</div>`, iconSize: [10, 10], iconAnchor: [5, 5] }) })
      .bindPopup(() => buoyHtml(b), POP_OPTS(300));
  })).addTo(map);
}
loadBuoys(); setInterval(loadBuoys, 10 * 60 * 1000);
let lastBuoyZoomBand = null;
map.on('zoomend', () => { const band = map.getZoom() >= 9; if (band !== lastBuoyZoomBand) { lastBuoyZoomBand = band; drawBuoys(); } });

// ---------- Raster ----------
function rasterize(g, pixel) {   // pixel(lat, lon, out[4]) -> sets rgba; returns {url, bounds}
  const s = g.lat0 - g.dlat / 2, n = g.lat0 + (g.ny - 0.5) * g.dlat, w = g.lon0 - g.dlon / 2, e = g.lon0 + (g.nx - 0.5) * g.dlon;
  // draw at about the data's own resolution; the browser's GPU scaling does the smoothing
  const W = clamp(Math.round(g.nx * 1.25), 360, 1100), y0 = merc(s), y1 = merc(n);
  const H = clamp(Math.round(W * (y1 - y0) / ((e - w) * Math.PI / 180)), 50, 2400);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data, px = [0, 0, 0, 0];
  for (let py = 0; py < H; py++) {
    const lat = imerc(y1 - (py + 0.5) / H * (y1 - y0));
    for (let qx = 0; qx < W; qx++) {
      px[3] = 0; pixel(lat, w + (qx + 0.5) / W * (e - w), px);
      const o = (py * W + qx) * 4; d[o] = px[0]; d[o + 1] = px[1]; d[o + 2] = px[2]; d[o + 3] = px[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL('image/png'), bounds: [[s, w], [n, e]] };
}

function renderRaster() {
  const p = PRODUCTS[S.prod], g = PG();
  if (!g) { if (dataLayer) { map.removeLayer(dataLayer); dataLayer = null; } return; }
  let r;
  if (S.prod === 'bottom') {
    const lt = LUTS.bottom, rng = S.range.bottom || [0, 2500];
    r = rasterize(g, (lat, lon, o) => {
      const z = sample(g, lat, lon); if (z !== z) return;
      const sh = sample(S.data.shade, lat, lon), f = sh === sh ? 0.28 + 0.9 * sh : 1;
      if (z >= 0) { o[0] = 160 * f; o[1] = 150 * f; o[2] = 125 * f; o[3] = 255; return; }
      const t = clamp(Math.sqrt(clamp(-z / FATHOM / rng[1], 0, 1)), 0, 1), i = Math.round(t * 255) * 3;
      o[0] = Math.min(255, lt[i] * f); o[1] = Math.min(255, lt[i + 1] * f); o[2] = Math.min(255, lt[i + 2] * f); o[3] = 255;
    });
  } else {
    const lt = LUTS[S.prod], rng = S.range[S.prod];
    if (!rng) { if (dataLayer) { map.removeLayer(dataLayer); dataLayer = null; } return; }
    r = rasterize(g, (lat, lon, o) => {
      const v = sample(g, lat, lon); if (v !== v) return;
      const i = Math.round(clamp(tOf(p, v, rng), 0, 1) * 255) * 3;
      o[0] = lt[i]; o[1] = lt[i + 1]; o[2] = lt[i + 2]; o[3] = 255;
    });
  }
  if (dataLayer) { dataLayer.setUrl(r.url); dataLayer.setBounds(L.latLngBounds(r.bounds)); }
  else dataLayer = L.imageOverlay(r.url, r.bounds, { pane: 'data', className: 'smooth' }).addTo(map);
}

function renderRelief() {
  const want = S.ov.relief && S.prod !== 'bottom' && S.data.shade;
  if (!want) { if (reliefLayer) { map.removeLayer(reliefLayer); reliefLayer = null; } return; }
  const g = S.data.shade, dg = PG();
  const r = rasterize(g, (lat, lon, o) => {
    if (!dg || sample(dg, lat, lon) !== sample(dg, lat, lon)) return;   // only shade where the chart has data
    const sh = sample(g, lat, lon); if (sh !== sh) return;
    const v = Math.round(clamp(110 + 160 * sh, 0, 255)); o[0] = o[1] = o[2] = v; o[3] = 255;
  });
  if (reliefLayer) { reliefLayer.setUrl(r.url); reliefLayer.setBounds(L.latLngBounds(r.bounds)); }
  else reliefLayer = L.imageOverlay(r.url, r.bounds, { pane: 'relief', className: 'smooth', opacity: 0.75 }).addTo(map);
}

function viewValues(g) {
  const b = map.getBounds(), out = [];
  for (let j = 0; j < g.ny; j++) {
    const la = g.lat0 + j * g.dlat; if (la < b.getSouth() || la > b.getNorth()) continue;
    for (let i = 0; i < g.nx; i++) {
      const lo = g.lon0 + i * g.dlon; if (lo < b.getWest() || lo > b.getEast()) continue;
      const v = g.v[j * g.nx + i]; if (v === v) out.push(v);
    }
  }
  return out.sort((a, b2) => a - b2);
}

// Domain = what's on screen (the slider's full travel); range = what the colors stretch across
function autoRange(force) {
  const p = PRODUCTS[S.prod], g = PG(); if (!g) return;
  if (S.prod === 'wx') { S.domain = S.wxMode === 'waves' ? [0, 15] : [0, 40]; if (S.auto || force || !S.range.wx) S.range.wx = S.wxMode === 'waves' ? [0, 10] : [0, 30]; return; }
  if (S.prod === 'bottom') {
    const vals = viewValues(g).filter((z) => z < 0).map((z) => -z / FATHOM).sort((a, b) => a - b);
    const hi = vals.length ? Math.max(50, vals[Math.floor(vals.length * 0.98)]) : 2500;
    S.domain = [0, hi]; S.range.bottom = [0, hi]; return;
  }
  const vals = viewValues(g); if (vals.length < 10) { delete S.range[S.prod]; S.domain = null; return; }
  let dlo = vals[0], dhi = vals[vals.length - 1];
  let lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)];
  if (p.diverging) { const m = Math.max(Math.abs(lo), Math.abs(hi), 5); lo = -m; hi = m; dlo = Math.min(dlo, lo); dhi = Math.max(dhi, hi); }
  if (p.log) { dlo = Math.max(0.01, dlo); lo = Math.max(dlo, lo); hi = Math.max(lo * 2, hi); dhi = Math.max(dhi, hi); }
  else { lo = Math.floor(lo / p.step) * p.step; hi = Math.ceil(hi / p.step) * p.step; if (hi - lo < p.step * 4) hi = lo + p.step * 4; dlo = Math.min(dlo, lo); dhi = Math.max(dhi, hi); }
  S.domain = [dlo, dhi];
  if (S.auto || force || !S.range[S.prod]) S.range[S.prod] = [lo, hi];
}

// ---------- Legend + dual-handle slider ----------
function fmtTick(p, v) { return p.log ? (v < 1 ? v.toFixed(2) : v.toFixed(1)) : Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1); }
function domT(v) { const p = PRODUCTS[S.prod]; return clamp(tOf(p, v, S.domain), 0, 1); }
function drawLegend() {
  const p = PRODUCTS[S.prod], g = PG(), rng = S.range[S.prod];
  let when = '';
  if ((p.hourly || S.prod === 'fish' || S.prod === 'ana') && g?.times?.length) when = `${S.prod === 'fish' || S.prod === 'ana' ? 'Now · temps ' : ''}${niceHour(g.times[g.times.length - 1])}`;
  else if (g?.comp && p.family) when = `${g.comp === 1 ? '24 h' : '3 days'} to ${niceHour(g.times[0])} · ${g.looks} looks`;
  else if (g?.date) when = g.baseDate ? `${nice(g.date)} · gaps from ${nice(g.baseDate).replace(/^\w+, /, '')}` : nice(g.date);
  if (S.fc > 0) when = `${niceHour(fcTime(S.fc))} (+${S.fc} h forecast)`;
  const via = g?.via && !p.family ? ' · Copernicus' : (!g?.via && ['ssh', 'mld', 'sss'].includes(S.prod) ? ' · NOAA' : '');
  if (S.prod === 'cur' && S.data.curb?.model) when = niceHour(S.data.curb.time);
  const bk = g?.backup ? ' · <b title="NOAA is not answering right now, so this is the Breakline saved copy (checked every 10 minutes)">saved copy</b>' : '';
  $('lgTitle').innerHTML = `<span>${p.name}${p.unit ? ` (${p.unit})` : ''}</span><span>${when}${via}${bk}</span>`;
  $('legend').classList.toggle('fixed', !!p.noLegendRange);
  if (!rng || !S.domain) { $('lgBar').style.background = `linear-gradient(90deg, ${p.stops.join(',')})`; return; }
  const a = domT(rng[0]) * 100, b = domT(rng[1]) * 100, n = p.stops.length - 1;
  const stops = p.stops.map((c, i) => `${c} ${(a + (b - a) * i / n).toFixed(2)}%`);
  $('lgBar').style.background = `linear-gradient(90deg, ${p.stops[0]} 0%, ${stops.join(',')}, ${p.stops[n]} 100%)`;
  $('thLo').style.left = `${a}%`; $('thHi').style.left = `${b}%`;
  $('thLo').firstChild.textContent = fmtTick(p, rng[0]); $('thHi').firstChild.textContent = fmtTick(p, rng[1]);
  $('lgMin').textContent = fmtTick(p, S.domain[0]); $('lgMax').textContent = fmtTick(p, S.domain[1]);
  $('lgAuto').classList.toggle('on', S.auto);
}
let rafPending = false;
function dragThumb(which, ev) {
  ev.preventDefault();
  const track = $('lgTrack').getBoundingClientRect(), p = PRODUCTS[S.prod];
  const move = (e) => {
    const t = clamp((e.clientX - track.left) / track.width, 0, 1), rng = S.range[S.prod].slice();
    let v = vOf(p, t, S.domain); if (!p.log) v = Math.round(v / p.step) * p.step;
    if (which === 0) rng[0] = Math.min(v, rng[1] - (p.log ? rng[1] * 0.1 : p.step)); else rng[1] = Math.max(v, rng[0] + (p.log ? rng[0] * 0.1 : p.step));
    S.auto = false; S.range[S.prod] = rng; drawLegend();
    if (!rafPending) { rafPending = true; setTimeout(() => { rafPending = false; renderRaster(); }, 60); }
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); renderRaster(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
$('thLo').addEventListener('pointerdown', (e) => dragThumb(0, e));
$('thHi').addEventListener('pointerdown', (e) => dragThumb(1, e));
for (const [id, k] of [['thLo', 0], ['thHi', 1]]) {
  $(id).addEventListener('keydown', (e) => {
    const p = PRODUCTS[S.prod], d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!d || !S.range[S.prod]) return; e.preventDefault();
    const rng = S.range[S.prod].slice(); rng[k] = p.log ? rng[k] * (d > 0 ? 1.1 : 1 / 1.1) : rng[k] + d * p.step;
    if (rng[1] <= rng[0]) return; S.auto = false; S.range[S.prod] = rng; drawLegend(); renderRaster();
  });
}
$('lgAuto').onclick = () => { S.auto = true; autoRange(true); renderRaster(); drawLegend(); };

// ---------- Loading ----------
const dayArg = (p) => (S.date ? p.day(S.date) : null);

// ---------- Copernicus Marine (EU) backup/primary source ----------
// Their public map-tile service (no account, CORS open, CDN-cached 30 days). We ask for tiles drawn in a gray
// color scale over a known range, then turn each pixel back into a number with their exact 256-step color table.
const CMEMS = 'https://wmts.marine.copernicus.eu/teroWmts';
const CM = {
  chl_l4: { layer: 'OCEANCOLOUR_GLO_BGC_L4_NRT_009_102/cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D_202311/CHL', min: 0.01, max: 50, log: true, res: 0.0417 },
  chl_l3: { layer: 'OCEANCOLOUR_GLO_BGC_L3_NRT_009_101/cmems_obs-oc_glo_bgc-plankton_nrt_l3-multi-4km_P1D_202411/CHL', min: 0.01, max: 50, log: true, res: 0.0417 },
  sla: { layer: 'SEALEVEL_GLO_PHY_L4_NRT_008_046/cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D_202506/sla', min: -1.5, max: 1.5, res: 0.125 },
  ugos: { layer: 'SEALEVEL_GLO_PHY_L4_NRT_008_046/cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D_202506/ugos', min: -3, max: 3, res: 0.125 },
  vgos: { layer: 'SEALEVEL_GLO_PHY_L4_NRT_008_046/cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D_202506/vgos', min: -3, max: 3, res: 0.125 },
  mld: { layer: 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy_anfc_0.083deg_P1D-m_202406/mlotst', min: 0, max: 400, res: 0.083, model: true },
  so: { layer: 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-so_anfc_0.083deg_P1D-m_202406/so', min: 28, max: 38, res: 0.083, model: true },
  // dissolved oxygen, mmol/m³ (Copernicus global biogeochemistry model, daily, 1/4°)
  o2: { layer: 'GLOBAL_ANALYSISFORECAST_BGC_001_028/cmems_mod_glo_bgc-bio_anfc_0.25deg_P1D-m_202311/o2', min: 0, max: 350, res: 0.25, model: true },
  // ocean-model surface currents every 6 h, analysis + ~9-day forecast (for the current and temp-drift forecasts)
  uo6: { layer: 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406/uo', min: -3, max: 3, res: 0.083, model: true },
  vo6: { layer: 'GLOBAL_ANALYSISFORECAST_PHY_001_024/cmems_mod_glo_phy-cur_anfc_0.083deg_PT6H-i_202406/vo', min: -3, max: 3, res: 0.083, model: true },
};
// Archive ("multi-year") layers for dates older than each live layer keeps. nrtDays = rolling window the live
// layer holds; nrtFrom = fixed first date of the live layer.
const CM_HIST = {
  chl_l4: { nrtDays: 7, layer: 'OCEANCOLOUR_GLO_BGC_L4_MY_009_104/cmems_obs-oc_glo_bgc-plankton_my_l4-gapfree-multi-4km_P1D_202611/CHL', from: '1997-09-06' },
  chl_l3: { nrtDays: 17, layer: 'OCEANCOLOUR_GLO_BGC_L3_MY_009_103/cmems_obs-oc_glo_bgc-plankton_my_l3-multi-4km_P1D_202611/CHL', from: '1997-09-04' },
  sla: { nrtFrom: '2024-07-01', layer: 'SEALEVEL_GLO_PHY_L4_MY_008_047/cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D_202411/sla', from: '1993-01-01' },
  ugos: { nrtFrom: '2024-07-01', layer: 'SEALEVEL_GLO_PHY_L4_MY_008_047/cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D_202411/ugos', from: '1993-01-01' },
  vgos: { nrtFrom: '2024-07-01', layer: 'SEALEVEL_GLO_PHY_L4_MY_008_047/cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D_202411/vgos', from: '1993-01-01' },
  mld: { nrtFrom: '2022-06-01', layer: 'GLOBAL_MULTIYEAR_PHY_001_030/cmems_mod_glo_phy_my_0.083deg_P1D-m_202311/mlotst', from: '1993-01-01' },
  so: { nrtFrom: '2022-06-01', layer: 'GLOBAL_MULTIYEAR_PHY_001_030/cmems_mod_glo_phy_my_0.083deg_P1D-m_202311/so', from: '1993-01-01' },
};
function cmLayerFor(s, day) {
  const key = Object.keys(CM).find((k) => CM[k] === s || CM[k].layer === s.layer), h = key && CM_HIST[key];
  if (!h || !day) return s.layer;
  const d = day.slice(0, 10), liveFrom = h.nrtFrom || addDays(isoDate(new Date()), -h.nrtDays);
  if (d >= liveFrom) return s.layer;
  if (d < h.from) throw new Error(`no data before ${h.from}`);
  return h.layer;
}
const cmStyle = (s) => `cmap:gray,range:${s.min}/${s.max}${s.log ? ',logScale' : ''}`;
const cmTile = (s, z, x, y, day) => `${CMEMS}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(s.layer)}&STYLE=${encodeURIComponent(cmStyle(s))}` +
  `&TILEMATRIXSET=EPSG:3857&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/png&TIME=${day.includes('T') ? day : `${day}T00:00:00Z`}${s.elev != null ? `&ELEVATION=${s.elev}` : ''}`;
let CM_INV = null;      // gray level -> color-table index
async function cmInverse() {
  if (CM_INV) return CM_INV;
  const s = CM.sla;
  const d = await (await fetch(`${CMEMS}?SERVICE=WMTS&REQUEST=GetLegend&LAYER=${encodeURIComponent(s.layer)}&STYLE=${encodeURIComponent(cmStyle(s))}&FORMAT=application/json`)).json();
  const lut = d.continuous.cmap.colorMap, inv = new Uint8Array(256);
  for (let g = 0; g < 256; g++) { let best = 0, bd = 1e9; lut.forEach((c, k) => { const dd = Math.abs(c[0] - g); if (dd < bd) { bd = dd; best = k; } }); inv[g] = Math.round(best * 255 / (lut.length - 1)); }
  return (CM_INV = inv);
}
async function cmImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 400 ? 'not published for that date' : `Copernicus ${r.status}`);
  const bmp = await createImageBitmap(await r.blob());
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, 256, 256).data;
}
// Newest day each layer has (cached for an hour). Model layers run ahead, so "today" works for them.
const CM_LATEST = {};
async function cmLatest(s) {
  if (s.model) return isoDate(new Date());
  const hit = CM_LATEST[s.layer]; if (hit && Date.now() - hit.t < 3600e3) return hit.day;
  for (let d = 0; d <= 6; d++) {
    const day = addDays(isoDate(new Date()), -d);
    try { await cmImage(cmTile(s, 3, 2, 3, day)); CM_LATEST[s.layer] = { day, t: Date.now() }; return day; } catch (e) { /* try the day before */ }
  }
  throw new Error('Copernicus has no recent data');
}
// Fetch + decode the tiles covering a window into a regular lat/lon grid
async function loadCmems(s, win, day, target = 360) {
  const inv = await cmInverse();
  day = day || await cmLatest(s);
  s = { ...s, layer: cmLayerFor(s, day) };     // older dates come from the archive layer
  const spanLon = win.e - win.w;
  let z = clamp(Math.ceil(Math.log2(360 * target / (256 * spanLon))), 2, 10);
  z = Math.min(z, clamp(Math.ceil(Math.log2(360 / (256 * s.res / 1.5))), 2, 10));   // no finer than the data
  const tx = (lon, zz) => Math.floor((lon + 180) / 360 * 2 ** zz), ty = (lat, zz) => Math.floor((1 - merc(lat) / Math.PI) / 2 * 2 ** zz);
  while (z > 2 && (tx(win.e, z) - tx(win.w, z) + 1) * (ty(win.s, z) - ty(win.n, z) + 1) > 36) z--;
  const x0 = tx(win.w, z), x1 = tx(win.e, z), y0 = ty(win.n, z), y1 = ty(win.s, z), W = (x1 - x0 + 1) * 256, H = (y1 - y0 + 1) * 256;
  const mos = new Float32Array(W * H).fill(NaN);
  const lo = s.log ? Math.log10(s.min) : s.min, hi = s.log ? Math.log10(s.max) : s.max;
  let ok = 0, lastErr;
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++];
      try {
        const px = await cmImage(cmTile(s, z, x, y, day)); ok++;
        for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
          const o = (j * 256 + i) * 4; if (px[o + 3] < 128) continue;
          const t = inv[px[o]] / 255, v = lo + t * (hi - lo);
          mos[((y - y0) * 256 + j) * W + (x - x0) * 256 + i] = s.log ? 10 ** v : v;
        }
      } catch (e) { lastErr = e; }
    }
  }));
  if (!ok) throw lastErr || new Error('Copernicus tiles failed');
  // mosaic is Mercator; resample rows onto even latitude steps
  const pxDeg = 360 / (256 * 2 ** z), lonW = x0 * 256 * pxDeg - 180;
  const latTop = imerc(Math.PI * (1 - 2 * y0 / 2 ** z)), latBot = imerc(Math.PI * (1 - 2 * (y1 + 1) / 2 ** z));
  const dlat = pxDeg * Math.cos((latTop + latBot) / 2 * Math.PI / 180), ny = Math.floor((latTop - latBot) / dlat), v = new Float32Array(W * ny);
  for (let j = 0; j < ny; j++) {
    const lat = latBot + (j + 0.5) * dlat, row = Math.floor(((1 - merc(lat) / Math.PI) / 2 * 2 ** z - y0) * 256);
    if (row < 0 || row >= H) continue;
    v.set(mos.subarray(row * W, row * W + W), j * W);
  }
  return { nx: W, ny, lat0: latBot + dlat / 2, dlat, lon0: lonW + pxDeg / 2, dlon: pxDeg, v, times: [day.includes('T') ? day : `${day}T00:00:00Z`], date: day.slice(0, 10), src: 'cmems' };
}

// NOAA (or Copernicus) not answering: fall back to Breakline's own copy, refreshed every 10 minutes
async function loadGrid(prod) {
  try { return await loadGridLive(prod); }
  catch (e) {
    let g = null;
    try { g = await preForView(prod, true); } catch (e2) { console.warn('saved copy', e2); }
    if (!g) throw e;
    console.warn(`${prod}: live source failed (${e.message}); using the saved copy`);
    g.backup = prod !== 'goes'; return g;              // hourly GOES is always our own copy, so it's not a backup
  }
}
async function loadGridLive(prod) {
  const p = PRODUCTS[prod], win = windowFor(p.res, p.cells);
  let text;
  // zoomed out over a prefetched zone: the hourly snapshot on our own CDN (about a second)
  try { const pg = await preForView(prod); if (pg) return pg; } catch (e) { console.warn('prefetch', e); }
  if (p.family && curSrc(p.family).comp) { const g = await loadComposite(p.family, curSrc(p.family).comp, win, null); g.src = S.src[p.family]; return g; }
  // Copernicus first where it's the better/more reliable source; NOAA if it fails
  const cmKey = p.family ? curSrc(p.family).cm : p.cm;
  if (cmKey) {
    try {
      const cs = p.zlev && S.zlev ? { ...CM[cmKey], elev: ZLEV[S.zlev].e } : CM[cmKey];
      const g = await loadCmems(cs, win, S.date && !CM[cmKey].model ? S.date : (S.date || null));
      const out = { ...g, win, v: g.v.map((x) => (x === x && p.conv ? p.conv(x) : x)), src: p.family ? S.src[p.family] : 'cmems', via: 'Copernicus' };
      return out;
    } catch (e) {
      if (p.family || !p.url || (p.zlev && S.zlev)) throw e;   // a chosen Copernicus source, or nothing else has it: report it
      console.warn('Copernicus failed, trying NOAA', e);
    }
  }
  if (p.hourly) {
    // newest chunk must load; older ones are best-effort gap fill
    const parts = await Promise.allSettled([0, 1, 2, 3].map((k) => getText(p.url(win, S.hour, k)).then((t) => toGrid(parseAsc(t), p.v, p.conv, true))));
    if (parts[0].status === 'rejected') throw parts[0].reason;
    const g = parts[0].value, older = parts.slice(1).filter((x) => x.status === 'fulfilled').map((x) => x.value);
    const slices = [...older.reverse().flatMap((o) => o.slices), ...g.slices];   // oldest -> newest
    const v = slices[slices.length - 1].slice(), last = slices[slices.length - 1];
    for (let k = slices.length - 2; k >= 0; k--) { const sl = slices[k]; for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) v[i] = sl[i]; }
    let fresh = 0, any = 0; for (let i = 0; i < v.length; i++) { if (last[i] === last[i]) fresh++; if (v[i] === v[i]) any++; }
    g.clearPct = Math.round(100 * fresh / v.length); g.anyPct = Math.round(100 * any / v.length);
    g.v = v; delete g.slices; g.win = win;
    if (!S.hour) S.latestHour = g.times[g.times.length - 1];
    return g;
  }
  try { text = await getText(p.url(win, dayArg(p))); }
  catch (e) { if (!S.date) throw e; text = await getText(p.url(win, null)); }
  const g = toGrid(parseAsc(text), p.v, p.conv); g.win = win; g.src = p.family ? S.src[p.family] : null;
  if (p.nrt) await overlayNrt(g, p, win).catch((e) => console.warn('NRT chlorophyll skipped', e));
  return g;
}

async function overlayNrt(g, p, win) {
  const start = addDays(g.date, 1);
  if (S.date && S.date < start) return;
  const sec = parseAsc(await getText(p.nrt(win, `${start}T12:00:00Z`, S.date ? `${S.date}T12:00:00Z` : 'last')));
  const n = toGrid(sec, p.v, p.conv, true);
  const best = n.slices[n.slices.length - 1].slice();
  for (let k = n.slices.length - 2; k >= 0; k--) { const sl = n.slices[k]; for (let i = 0; i < best.length; i++) if (best[i] !== best[i]) best[i] = sl[i]; }
  const cg = { ...n, v: best }; let painted = 0;
  for (let j = 0; j < g.ny; j++) {
    const la = g.lat0 + j * g.dlat;
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i; if (g.v[k] !== g.v[k]) continue;
      const v = sample(cg, la, g.lon0 + i * g.dlon); if (v === v) { g.v[k] = v; painted++; }
    }
  }
  if (painted) { g.baseDate = g.date; g.date = n.date; }
}

// ---------- Composites: every clear look in the last 1 or 3 days, stacked per pixel ----------
// Water temp: GOES-19 hourly scans + the four NOAA polar passes. Keeps the warm end of each pixel's readings
// (clouds and cloud edges read cold): the 2nd-warmest when there are 3+ looks, else the warmest. Same idea as the
// classic "warmest pixel" composites, minus the single hottest reading so one calm afternoon can't paint a fake warm spot.
// Chlorophyll: VIIRS NOAA-20/21 + OLCI Sentinel-3A/3B passes, geometric mean of the clear readings.
const COMP_PARTS = { sst: ['pmday', 'amday', 'pmnight', 'amnight'], chl: ['n21', 'n20', 's3a', 's3b'] };
function stackComposite(fam, base, layers) {
  const n = base.nx * base.ny, cnt = new Uint16Array(n), sst = fam === 'sst';
  const a = new Float32Array(n).fill(-Infinity), b = new Float32Array(n).fill(-Infinity), sum = new Float32Array(n);
  const add = (k, x) => { cnt[k]++; if (!sst) sum[k] += Math.log10(Math.max(x, 0.001)); else if (x > a[k]) { b[k] = a[k]; a[k] = x; } else if (x > b[k]) b[k] = x; };
  let looks = 0;
  for (const g of layers) {
    const same = g.nx === base.nx && g.ny === base.ny && Math.abs(g.lat0 - base.lat0) < 1e-6 && Math.abs(g.dlat - base.dlat) < 1e-9 && Math.abs(g.lon0 - base.lon0) < 1e-6 && Math.abs(g.dlon - base.dlon) < 1e-9;
    for (const sl of g.slices || [g.v]) {
      let hit = 0;
      if (same) { for (let k = 0; k < n; k++) { const x = sl[k]; if (x === x) { add(k, x); hit++; } } }
      else {
        for (let j = 0; j < base.ny; j++) {
          const la = base.lat0 + j * base.dlat;
          for (let i = 0; i < base.nx; i++) { const x = sample(g, la, base.lon0 + i * base.dlon, sl); if (x === x) { add(j * base.nx + i, x); hit++; } }
        }
      }
      if (hit) looks++;
    }
  }
  const v = new Float32Array(n); let cov = 0;
  for (let k = 0; k < n; k++) {
    if (!cnt[k]) { v[k] = NaN; continue; }
    cov++; v[k] = sst ? (cnt[k] >= 3 ? b[k] : a[k]) : 10 ** (sum[k] / cnt[k]);
  }
  return { v, looks, coverPct: Math.round(100 * cov / n) };
}
// zone = a prefetched zone (zoomed out: stack the hourly snapshots on our CDN); otherwise fetch the window from NOAA
async function loadComposite(fam, days, win, zone) {
  const conv = fam === 'sst' ? SST_C : CHL, end = S.date ? `${S.date}T23:00:00Z` : null;
  let layers = [], base = null, polarN = 0;
  if (zone) {
    await preReady; if (!PRE) return null;
    const keys = Object.keys(PRE.items).filter((k) => k.startsWith(`${zone}/`) && !PRE.items[k].none);
    let pick = [];
    if (fam === 'sst') {
      const hrs = keys.filter((k) => k.split('/')[1] === 'goes').sort(), last = hrs[hrs.length - 1];
      if (last) { const from = hourAdd(last.split('/')[2], -(24 * days - 1)); pick = hrs.filter((k) => k.split('/')[2] >= from); }
    }
    const passes = keys.filter((k) => { const [, f, src] = k.split('/'); return f === fam && COMP_PARTS[fam].includes(src); });
    const lastDay = passes.map((k) => k.split('/')[3]).sort().pop();
    if (lastDay) pick.push(...passes.filter((k) => k.split('/')[3] > addDays(lastDay, -days)));
    if (!pick.length) return null;
    layers = await Promise.all(pick.map((k) => preGrid(PRE.items[k], conv))); polarN = pick.filter((k) => !k.includes('/goes/')).length;
    base = layers[0];
  } else {
    const jobs = [], res = SRC[fam][`comp${days}`].res;
    const sw = (r) => ({ ...win, stride: Math.max(1, Math.round(win.stride * res / r)) });
    if (fam === 'sst') for (let k = 0; k < 4 * days; k++) jobs.push(getText(PRODUCTS.goes.url(sw(0.02), end, k)).then((t) => toGrid(parseAsc(t), 'sst', SST_C, true)));
    const tq = end ? `(${addDays(S.date, 1 - days)}T00:00:00Z):1:(${end})` : days > 1 ? `last-${days - 1}:1:last` : 'last';
    // polar passes live on coastwatch.noaa.gov, which is often slow or down: give them 15 s, then stack what we have
    const cap = (pr) => Promise.race([pr, new Promise((_, no) => setTimeout(() => no(new Error('polar passes timed out')), 15000))]);
    for (const key of COMP_PARTS[fam]) {
      const s = SRC[fam][key], w = sw(s.res);
      jobs.push(cap(getText(`/erddap/${s.host}/griddap/${s.id}.asc?${q(`${s.v}[${tq}]${s.alt ? '[(0.0)]' : ''}[${latRange(w, s.asc)}][${lonRange(w)}]`)}`).then((t) => toGrid(parseAsc(t), s.v, conv, true))).then((g) => { g.polar = true; return g; }));
    }
    const got = await Promise.allSettled(jobs);
    layers = got.filter((x) => x.status === 'fulfilled').map((x) => x.value); polarN = layers.filter((g) => g.polar).length;
    if (!layers.length) throw got[0].reason;
    const d = res * win.stride;
    base = { nx: Math.floor((win.e - win.w) / d) + 1, ny: Math.floor((win.n - win.s) / d) + 1, lat0: win.s, dlat: d, lon0: win.w, dlon: d };
  }
  const times = layers.flatMap((g) => g.times || []).sort(), t1 = times[times.length - 1];
  const r = stackComposite(fam, base, layers);
  return {
    nx: base.nx, ny: base.ny, lat0: base.lat0, dlat: base.dlat, lon0: base.lon0, dlon: base.dlon, v: r.v, times: [t1], date: t1.slice(0, 10),
    comp: days, looks: r.looks, coverPct: r.coverPct, win, noPolar: !polarN,
  };
}

// Depth: zoomed out, cut it from the 2-arc-minute grid shipped with the app (instant, offline);
// zoomed in (or outside it), fetch full-resolution ETOPO for the view.
// One file per zone: East Coast + Gulf, Florida/Bahamas, Pacific Costa Rica
const BATHY2 = [];
const bathy2Ready = Promise.all(['2m', 'fl', 'cr', 'cabo', 'chiapas', 'cancun', 'puntacana', 'stlucia'].map((n) => Promise.all([fetch(`data/bathy_${n}.json`).then((r) => r.json()), fetch(`data/bathy_${n}.bin`).then((r) => r.arrayBuffer())])
  .then(([m, b]) => { BATHY2.push({ ...m, z: new Int16Array(b) }); }).catch((e) => console.warn('static bathy', n, e))));
function bathyFromStatic(win) {
  const B = BATHY2.find((b) => win.s >= b.lat0 && win.w >= b.lon0 && win.n <= b.lat0 + (b.ny - 1) * b.dlat && win.e <= b.lon0 + (b.nx - 1) * b.dlon);
  if (!B) return null;
  const st = Math.max(1, Math.round((win.n - win.s) / B.dlat / 620) || 1);
  const j0 = Math.floor((win.s - B.lat0) / B.dlat), j1 = Math.ceil((win.n - B.lat0) / B.dlat);
  const i0 = Math.floor((win.w - B.lon0) / B.dlon), i1 = Math.ceil((win.e - B.lon0) / B.dlon);
  const ny = Math.floor((j1 - j0) / st) + 1, nx = Math.floor((i1 - i0) / st) + 1, v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = B.z[(j0 + j * st) * B.nx + i0 + i * st];
  return { nx, ny, v, lat0: B.lat0 + j0 * B.dlat, lon0: B.lon0 + i0 * B.dlon, dlat: B.dlat * st, dlon: B.dlon * st, times: [], date: null, win: { ...win, stride: Math.round((B.dlat * st) * 240), static: true } };
}
async function loadBathy() {
  const win = windowFor(1 / 240, 620, 0.5);
  let g = null;
  if (map.getZoom() < 9) { await bathy2Ready; g = bathyFromStatic(win); }
  if (!g) {
    const url = `/erddap/pfeg/griddap/ETOPO_2022_v1_15s.asc?${q(`z[${latRange(win, true)}][${lonRange(win)}]`)}`;
    g = toGrid(parseAsc(await getText(url)), 'z'); g.win = win;
  }
  const vals = Float64Array.from(g.v, (x) => (x !== x ? 0 : x));
  S.geo.land = contourRings(g, vals, [0])[0].rings;
  const fms = [...DEPTHS_INSHORE, ...DEPTHS_MAJOR, ...DEPTHS_MINOR];
  S.geo.depth = contourRings(g, vals, fms.map((f) => -f * FATHOM)).map((c) => ({ fm: Math.round(-c.value / FATHOM), rings: c.rings }));
  // Hillshade (sun from the northwest, exaggerated so the seafloor reads)
  const sh = new Float32Array(g.nx * g.ny).fill(NaN), az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180;
  for (let j = 1; j < g.ny - 1; j++) {
    const lat = g.lat0 + j * g.dlat, dx = g.dlon * 111320 * Math.cos(lat * Math.PI / 180), dy = g.dlat * 111320;
    for (let i = 1; i < g.nx - 1; i++) {
      const k = j * g.nx + i, ex = g.v[k] < 0 ? 12 : 3;
      const zx = (vals[k + 1] - vals[k - 1]) / (2 * dx) * ex, zy = (vals[k + g.nx] - vals[k - g.nx]) / (2 * dy) * ex;
      const slope = Math.atan(Math.hypot(zx, zy)), aspect = Math.atan2(zy, -zx);
      sh[k] = clamp(Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect), 0, 1);
    }
  }
  S.data.bathy = g; S.data.shade = { ...g, v: sh };
  S.data.bottom = g;
}

// Satellite geostrophic currents: Copernicus DUACS (daily, ~14 km, current to today) first, NOAA blended as backup
async function loadCurrents(days = 1, latest = false) {
  // HYCOM / RTOFS: the newest model run, from Breakline's saved copy (refreshed every 3 h)
  if (S.curSrc !== 'sat' && days === 1 && !S.date) {
    const m = await preModelCurrents(S.curSrc).catch((e) => { console.warn(S.curSrc, e); return null; });
    if (m) return m;
    status(`${CUR_SRC[S.curSrc]} isn't saved for this area yet; showing satellite currents.`, true);
  }
  try {
    const win = windowFor(0.125, 360), end = S.date && !latest ? S.date : await cmLatest(CM.ugos);
    const dates = Array.from({ length: days }, (_, k) => addDays(end, k - days + 1));
    const ok = (x) => (Math.abs(x) < 3 ? x : NaN);
    const pairs = await Promise.all(dates.map((d) => Promise.all([loadCmems(CM.ugos, win, d), loadCmems(CM.vgos, win, d)])));
    const us = pairs.map((pp) => pp[0].v.map(ok)), vs = pairs.map((pp) => pp[1].v.map(ok)), g = pairs[pairs.length - 1][0];
    return { ...g, win: { ...win, stride: 1 }, u: us[us.length - 1], vv: vs[vs.length - 1], us, vs, date: end, via: 'Copernicus' };
  } catch (e) { console.warn('Copernicus currents failed, trying NOAA', e); }
  try { return await loadCurrentsNoaa(days, latest); }
  catch (e) { const c = await preCurrents().catch(() => null); if (c) return c; throw e; }
}
async function preModelCurrents(src, zone = preZoneAt(map.getCenter())) {
  await preReady; if (!PRE || !zone) return null;
  const eu = preEntry(`${zone}/cur/${src}_u/latest`), ev = preEntry(`${zone}/cur/${src}_v/latest`);
  if (!eu?.file || !ev?.file) return null;
  const ok = (x) => (Math.abs(x) < 2.4 ? x : NaN), [gu, gv] = await Promise.all([preGrid(eu, ok), preGrid(ev, ok)]);
  return { ...gu, win: { ...PRE_BOX[zone], pre: true, stride: 1 }, u: gu.v, vv: gv.v, us: [gu.v], vs: [gv.v], src, model: src, date: eu.time.slice(0, 10), time: eu.time };
}
// Satellite currents from Breakline's saved copy (one day, ~15 nm): used when both live sources are down, and by Find your water
async function preCurrents(zone = preZoneAt(map.getCenter())) {
  await preReady; if (!PRE || !zone) return null;
  const eu = preEntry(`${zone}/cur/u/latest`), ev = preEntry(`${zone}/cur/v/latest`);
  if (!eu?.file || !ev?.file) return null;
  const ok = (x) => (Math.abs(x) < 2.4 ? x : NaN), [gu, gv] = await Promise.all([preGrid(eu, ok), preGrid(ev, ok)]);
  return { ...gu, win: { ...PRE_BOX[zone], pre: true, stride: 1 }, u: gu.v, vv: gv.v, us: [gu.v], vs: [gv.v], backup: true };
}
async function loadCurrentsNoaa(days = 1, latest = false) {
  const win = windowFor(0.25, 999), day = latest ? null : S.date, t = day ? `${day}T12:00:00Z` : null;
  const tq = days > 1 ? (t ? `(${addDays(day, -days + 1)}T00:00:00Z):1:(${t})` : `last-${days - 1}:1:last`) : `(${t || 'last'})`;
  const ok = (x) => (Math.abs(x) < 3 ? x : NaN);
  const qv = (v) => `${v}[${tq}][${latRange(win, true)}][${lonRange(win)}]`;
  let text;
  try { text = await getText(`/erddap/cw/griddap/noaacwBLENDEDNRTcurrentsDaily.asc?${q(`${qv('u_current')},${qv('v_current')}`)}`); }
  catch (e) { if (!day) throw e; return loadCurrentsNoaa(days, true); }
  const sec = parseAsc(text), u = toGrid(sec, 'u_current', ok, true), v = toGrid(sec, 'v_current', ok, true);
  return { ...u, win, u: u.v, vv: v.v, us: u.slices, vs: v.slices };
}

// Backward finite-time Lyapunov exponent from the last 6 days of geostrophic currents.
// Ridges = attracting fronts where water (and bait, weed, temperature breaks) converge.
function computeFtle(c) {
  const days = c.us.length, T = (days - 1) * 86400; if (days < 2) throw new Error('need several days of currents');
  const b = map.getBounds().pad(0.15), N = 220;
  const s = Math.max(c.lat0, b.getSouth()), n = Math.min(c.lat0 + (c.ny - 1) * c.dlat, b.getNorth());
  const w = Math.max(c.lon0, b.getWest()), e = Math.min(c.lon0 + (c.nx - 1) * c.dlon, b.getEast());
  const step = Math.max((n - s), (e - w)) / N, ny = Math.max(2, Math.round((n - s) / step)), nx = Math.max(2, Math.round((e - w) / step));
  const X = new Float64Array(nx * ny), Y = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { Y[j * nx + i] = s + j * step; X[j * nx + i] = w + i * step; }
  const vel = (lat, lon, tt) => {   // tt in seconds from the first frame
    const f = clamp(tt / 86400, 0, days - 1), k = Math.min(days - 2, Math.floor(f)), a = f - k;
    const u0 = sample(c, lat, lon, c.us[k]), u1 = sample(c, lat, lon, c.us[k + 1]);
    const v0 = sample(c, lat, lon, c.vs[k]), v1 = sample(c, lat, lon, c.vs[k + 1]);
    const u = u0 + (u1 - u0) * a, v = v0 + (v1 - v0) * a;
    if (u !== u || v !== v) return null;
    return [v / 111320, u / (111320 * Math.cos(lat * Math.PI / 180))];
  };
  const dt = -3 * 3600, steps = Math.round(T / -dt);
  for (let p = 0; p < X.length; p++) {
    let la = Y[p], lo = X[p], tt = T;
    for (let k = 0; k < steps; k++) {
      const k1 = vel(la, lo, tt); if (!k1) break;
      const k2 = vel(la + k1[0] * dt / 2, lo + k1[1] * dt / 2, tt + dt / 2); if (!k2) break;
      const k3 = vel(la + k2[0] * dt / 2, lo + k2[1] * dt / 2, tt + dt / 2); if (!k3) break;
      const k4 = vel(la + k3[0] * dt, lo + k3[1] * dt, tt + dt); if (!k4) break;
      la += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); lo += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]); tt += dt;
    }
    Y[p] = la; X[p] = lo;
  }
  const out = new Float32Array(nx * ny).fill(NaN), d0 = 2 * step, Td = T / 86400;
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, cl = Math.cos((s + j * step) * Math.PI / 180);
    if (sample(c, s + j * step, w + i * step, c.us[days - 1]) !== sample(c, s + j * step, w + i * step, c.us[days - 1])) continue;
    const a = (X[k + 1] - X[k - 1]) * cl / d0 / cl, bb = (X[k + nx] - X[k - nx]) * cl / d0;
    const cc = (Y[k + 1] - Y[k - 1]) / d0 / cl, dd = (Y[k + nx] - Y[k - nx]) / d0;
    // Cauchy-Green tensor C = F^T F, largest eigenvalue
    const c11 = a * a + cc * cc, c12 = a * bb + cc * dd, c22 = bb * bb + dd * dd;
    const tr = c11 + c22, det = c11 * c22 - c12 * c12, lmax = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
    if (lmax > 0) out[k] = Math.log(Math.sqrt(lmax)) / Td;
  }
  return { nx, ny, lat0: s, lon0: w, dlat: step, dlon: step, v: out, date: c.date, win: c.win };
}

// HF radar surface currents (IOOS, hourly). 6 km normally, 1 km when zoomed in. Newest of the last 3 hours per cell.
const HF = { lat: [21.74, 46.49], lon: [-97.88, -57.2] };
async function loadHF(hi = false) {
  const id = hi ? 'ucsdHfrE1' : 'ucsdHfrE6', res = hi ? 0.009 : 0.055;
  const w = windowFor(res, 320);
  const s = Math.max(w.s, HF.lat[0]), n = Math.min(w.n, HF.lat[1]), we = Math.max(w.w, HF.lon[0]), ee = Math.min(w.e, HF.lon[1]);
  if (s >= n || we >= ee) return null;
  const tq = S.date ? `(${S.date}T10:00:00Z):1:(${S.date}T12:00:00Z)` : 'last-2:1:last';
  const box = `[(${s}):${w.stride}:(${n})][(${we}):${w.stride}:(${ee})]`;
  const sec = parseAsc(await getText(`/erddap/pfeg/griddap/${id}.asc?${q(`water_u[${tq}]${box},water_v[${tq}]${box}`)}`));
  const ok = (x) => (Math.abs(x) < 4 ? x : NaN);
  const u = toGrid(sec, 'water_u', ok, true), v = toGrid(sec, 'water_v', ok, true);
  const newest = (g) => { const out = g.slices[g.slices.length - 1].slice(); for (let k = g.slices.length - 2; k >= 0; k--) for (let i = 0; i < out.length; i++) if (out[i] !== out[i]) out[i] = g.slices[k][i]; return out; };
  return { ...u, u: newest(u), vv: newest(v), slices: null, win: { ...w, hi }, time: u.times[u.times.length - 1] };
}
function hfCovers() {
  const ok = (h, res) => h !== undefined && (h === null || covers(h, res, 320));
  return ok(S.data.hf, 0.055) && (map.getZoom() < 9 || ok(S.data.hf1, 0.009));
}

// Currents chart: speed (knots) on a fine grid over the view, from curAt()
function buildCurGrid() {
  const b = map.getBounds().pad(0.2), step = Math.max((b.getNorth() - b.getSouth()) / 260, S.data.hf1 && map.getZoom() >= 9 ? 0.006 : S.data.hf ? 0.02 : 0.04);
  const ny = Math.max(2, Math.round((b.getNorth() - b.getSouth()) / step)), nx = Math.max(2, Math.round((b.getEast() - b.getWest()) / step));
  const v = new Float32Array(nx * ny).fill(NaN), g = { nx, ny, lat0: b.getSouth(), lon0: b.getWest(), dlat: step, dlon: step, v };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const la = g.lat0 + j * step, lo = g.lon0 + i * step, z = sample(S.data.bathy, la, lo);
    if (z === z && z > 0) continue;
    const c = curAt(la, lo); if (c) v[j * nx + i] = Math.hypot(c[0], c[1]) * 1.94384;
  }
  g.date = S.data.hf?.time?.slice(0, 10) || S.data.curb?.date; g.time = S.data.hf?.time;
  S.data.cur = g;
}

// ---------- Where to fish ----------
// Temperature windows (°F): [hard min, ideal min, ideal max, hard max], plus minimum depth (fm) and what structure matters most
// ocean: 'atl' (Atlantic, Gulf, Caribbean), 'pac' (Eastern Pacific), or both
const SPECIES = {
  yellowfin: { label: 'Yellowfin tuna', ocean: 'both', t: [68, 72, 79, 84], fm: 40, w: { brk: 0.35, chl: 0.2, bot: 0.25, eddy: 0.2 } },
  bigeye: { label: 'Bigeye tuna', ocean: 'both', t: [63, 66, 75, 80], fm: 100, w: { brk: 0.3, chl: 0.1, bot: 0.4, eddy: 0.2 } },
  bluefin: { label: 'Bluefin tuna', ocean: 'atl', t: [52, 58, 68, 74], fm: 15, w: { brk: 0.35, chl: 0.3, bot: 0.2, eddy: 0.15 } },
  mahi: { label: 'Mahi', ocean: 'atl', t: [70, 74, 82, 86], fm: 20, w: { brk: 0.45, chl: 0.2, bot: 0.1, eddy: 0.25 } },
  white: { label: 'White marlin', ocean: 'atl', t: [68, 71, 78, 83], fm: 40, w: { brk: 0.35, chl: 0.25, bot: 0.25, eddy: 0.15 } },
  blue: { label: 'Blue marlin', ocean: 'atl', t: [72, 75, 84, 88], fm: 100, w: { brk: 0.35, chl: 0.1, bot: 0.25, eddy: 0.3 } },
  sailA: { label: 'Sailfish', ocean: 'atl', t: [72, 75, 82, 86], fm: 15, w: { brk: 0.4, chl: 0.25, bot: 0.25, eddy: 0.1 } },
  blackfin: { label: 'Blackfin tuna', ocean: 'atl', t: [68, 72, 80, 84], fm: 20, w: { brk: 0.35, chl: 0.2, bot: 0.35, eddy: 0.1 } },
  wahoo: { label: 'Wahoo', ocean: 'both', t: [70, 73, 80, 85], fm: 30, w: { brk: 0.35, chl: 0.15, bot: 0.35, eddy: 0.15 } },
  // Eastern Pacific (Cabo, Mexico Pacific, Central America)
  dorado: { label: 'Dorado', ocean: 'pac', t: [72, 76, 84, 88], fm: 20, w: { brk: 0.45, chl: 0.2, bot: 0.1, eddy: 0.25 } },
  striped: { label: 'Striped marlin', ocean: 'pac', t: [66, 69, 77, 81], fm: 50, w: { brk: 0.4, chl: 0.25, bot: 0.25, eddy: 0.1 } },
  blueP: { label: 'Blue marlin', ocean: 'pac', t: [76, 79, 86, 90], fm: 100, w: { brk: 0.35, chl: 0.1, bot: 0.25, eddy: 0.3 } },
  black: { label: 'Black marlin', ocean: 'pac', t: [75, 78, 85, 89], fm: 30, w: { brk: 0.3, chl: 0.2, bot: 0.4, eddy: 0.1 } },
  sailP: { label: 'Sailfish', ocean: 'pac', t: [77, 80, 86, 90], fm: 20, w: { brk: 0.4, chl: 0.3, bot: 0.2, eddy: 0.1 } },
  // Inshore (sounds, bays, inlets, beaches). ft = depth window; like = how much each kind of structure matters.
  // region: fl = Florida only, north = Outer Banks and north, south = Chesapeake and south
  flounder: { label: 'Flounder', ocean: 'atl', inshore: true, t: [50, 58, 76, 84], ft: [4, 45], like: { drop: 1, inlet: 0.9, reef: 0.85, shoal: 0.7, bridge: 0.65, pier: 0.6, jetty: 0.65, rock: 0.55 } },
  striper: { label: 'Striped bass', ocean: 'atl', inshore: true, region: 'north', t: [45, 52, 66, 74], ft: [3, 60], like: { inlet: 1, jetty: 1, bridge: 0.95, rock: 0.9, drop: 0.8, shoal: 0.8, pier: 0.6, reef: 0.5 } },
  reddrum: { label: 'Red drum', ocean: 'atl', inshore: true, t: [52, 62, 82, 88], ft: [1, 20], like: { shoal: 1, inlet: 0.9, jetty: 0.9, reef: 0.75, drop: 0.65, rock: 0.6, pier: 0.6, bridge: 0.6 } },
  trout: { label: 'Speckled trout', ocean: 'atl', inshore: true, region: 'south', t: [55, 64, 80, 86], ft: [2, 15], like: { drop: 1, shoal: 0.9, reef: 0.85, bridge: 0.7, inlet: 0.6, rock: 0.6, pier: 0.6, jetty: 0.6 } },
  snook: { label: 'Snook', ocean: 'atl', inshore: true, region: 'fl', t: [64, 72, 86, 90], ft: [2, 25], like: { bridge: 1, jetty: 1, inlet: 1, pier: 0.9, drop: 0.6, rock: 0.6, shoal: 0.5, reef: 0.4 } },
  tarpon: { label: 'Tarpon', ocean: 'atl', inshore: true, region: 'fl', t: [72, 77, 88, 92], ft: [4, 40], like: { inlet: 1, bridge: 0.9, drop: 0.8, jetty: 0.7, pier: 0.6, shoal: 0.5, reef: 0.4, rock: 0.4 } },
};
for (const v of Object.values(SPECIES)) if (v.inshore) { v.fm = 0; v.w = { brk: 0.2, chl: 0.2, bot: 0.6, eddy: 0 }; }
const REGION_OK = { fl: (la, lo) => la < 30.8 && lo > -87.7, north: (la) => la > 34.5, south: (la) => la < 39.8 };
// Which ocean a point is in. The Central American isthmus divide, roughly, from Mexico to Panama.
function oceanAt(lat, lon) {
  if (lon < -98) return 'pac';
  if (lat < 16.2 && lon < -90.5) return 'pac';     // Chiapas, Guatemala
  if (lat < 13.5 && lon < -87.5) return 'pac';     // El Salvador, Gulf of Fonseca, Nicaragua
  if (lat < 11.2 && lon < -84.2) return 'pac';     // Guanacaste, Nicoya, central Pacific Costa Rica
  if (lat < 9.6 && lon < -82.8) return 'pac';      // Osa, Golfito
  if (lat < 8.6 && lon < -77.5) return 'pac';      // Pacific Panama
  if (lat < 7.5) return 'pac';                      // south of the isthmus: Gulf of Panama and beyond
  return 'atl';
}
function speciesFor(ocean, la, lo) {
  return Object.entries(SPECIES).filter(([, v]) => (v.ocean === ocean || v.ocean === 'both') && (!v.region || la == null || REGION_OK[v.region](la, lo)));
}
function tempFit(t, [a, b, c, d]) { return t < a || t > d ? 0 : t < b ? (t - a) / (b - a) : t > c ? (d - t) / (d - c) : 1; }
function pctNorm(arr, p = 0.95) { const v = Array.from(arr).filter((x) => x === x && x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length * p)] || 1 : 1; }
function maxFilter(g, vals, r) {
  const out = new Float32Array(vals.length).fill(NaN);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    let m = NaN;
    for (let dj = -r; dj <= r; dj++) { const jj = j + dj; if (jj < 0 || jj >= g.ny) continue;
      for (let di = -r; di <= r; di++) { const ii = i + di; if (ii < 0 || ii >= g.nx) continue; const x = vals[jj * g.nx + ii]; if (x === x && !(x <= m)) m = x; } }
    out[j * g.nx + i] = m;
  }
  return out;
}
function buildFish() {
  const sst = S.data.sst, sp = tunedSpecies(SPECIES[S.species] || SPECIES.yellowfin, S.species);   // nudged by your logged catches
  if (!sst) return;
  // work on a ~2-3 km grid over the SST window
  const f = Math.max(1, Math.round(0.025 / sst.dlat));
  const g = { nx: Math.floor(sst.nx / f), ny: Math.floor(sst.ny / f), lat0: sst.lat0, lon0: sst.lon0, dlat: sst.dlat * f, dlon: sst.dlon * f };
  const n = g.nx * g.ny, T = new Float32Array(n).fill(NaN), Td = new Float32Array(n).fill(NaN), hourly = new Uint8Array(n);
  const dep = new Float32Array(n).fill(NaN), lchl = new Float32Array(n).fill(NaN), cur = new Float32Array(n).fill(NaN);
  // Water temp: the hourly GOES reading (newest clear pixel, last 24 h) where it has one, the daily cloud-free map elsewhere
  let nh = 0, nw = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const la = g.lat0 + j * g.dlat, lo = g.lon0 + i * g.dlon, k = j * g.nx + i;
    Td[k] = sample(sst, la, lo); dep[k] = sample(S.data.bathy, la, lo);
    const h = S.date ? NaN : sample(S.data.goes, la, lo);
    if (h === h) { T[k] = h; hourly[k] = 1; if (dep[k] < 0) nh++; } else T[k] = Td[k];
    if (dep[k] < 0) nw++;
    const c = sample(S.data.chl, la, lo); if (c > 0) lchl[k] = Math.log10(c);
    const cu = curAt(la, lo); if (cu) cur[k] = Math.hypot(cu[0], cu[1]) * 1.94384;
  }
  S.fishInfo = { hourlyPct: nw ? Math.round(100 * nh / nw) : 0, hour: S.data.goes?.times?.slice(-1)[0], cur: !!(S.data.curb || S.data.hf) };
  const grad = (vals, perNm) => {
    const out = new Float32Array(n).fill(NaN);
    for (let j = 1; j < g.ny - 1; j++) {
      const dx = g.dlon * 60 * Math.cos((g.lat0 + j * g.dlat) * Math.PI / 180), dy = g.dlat * 60;
      for (let i = 1; i < g.nx - 1; i++) {
        const k = j * g.nx + i, gx = (vals[k + 1] - vals[k - 1]) / (2 * dx), gy = (vals[k + g.nx] - vals[k - g.nx]) / (2 * dy);
        const m = Math.hypot(gx, gy); if (m === m) out[k] = perNm ? m : m;
      }
    }
    return out;
  };
  const sshUp = S.data.ssh ? (() => { const v = new Float32Array(n).fill(NaN); for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) v[j * g.nx + i] = sample(S.data.ssh, g.lat0 + j * g.dlat, g.lon0 + i * g.dlon); return v; })() : null;
  // spread each structure signal ~4 nm so "near a break" counts, then scale 0-1 by its 95th percentile
  const r = Math.max(1, Math.round(4 / (g.dlat * 60)));
  // Temp breaks from the hourly field, except across the seam where hourly meets the daily fill (that edge isn't a real break)
  const gH = grad(T), gD = grad(Td), gT = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const mixed = hourly[k - 1] !== hourly[k + 1] || hourly[k - g.nx] !== hourly[k + g.nx];
    gT[k] = mixed || !hourly[k] ? gD[k] : gH[k];
  }
  const brk = maxFilter(g, gT, r), chlE = maxFilter(g, grad(lchl), r), bot = maxFilter(g, grad(dep.map((z) => (z < 0 ? -z / FATHOM : NaN))), r);
  const eddy = sshUp ? maxFilter(g, grad(sshUp), r) : null;
  const nb = pctNorm(brk), nc = pctNorm(chlE), nbo = pctNorm(bot), ne = eddy ? pctNorm(eddy) : 1;
  const score = new Float32Array(n).fill(NaN), parts = new Float32Array(n * 4);
  const home = PORTS.find((x) => x[0] === S.home);
  for (let k = 0; k < n; k++) {
    if (!(dep[k] < 0) || T[k] !== T[k]) continue;
    const fm = -dep[k] / FATHOM, tf = tempFit(T[k], sp.t);
    const pb = Math.min(1, (brk[k] || 0) / nb), pc = Math.min(1, (chlE[k] || 0) / nc), po = Math.min(1, (bot[k] || 0) / nbo), pe = eddy ? Math.min(1, (eddy[k] || 0) / ne) : 0;
    const struct = sp.w.brk * pb + sp.w.chl * pc + sp.w.bot * po + sp.w.eddy * pe;
    let s = 100 * tf * (0.3 + 0.7 * struct);
    if (sp.inshore) { const ftd = fm * 6; if (ftd < sp.ft[0] || ftd > sp.ft[1] * 1.5) s *= 0.3; score[k] = s; parts.set([pb, pc, po, pe], k * 4); continue; }
    if (fm < sp.fm) s *= 0.25;
    // Strong current is hard to fish (lines blow out, drift too fast): full credit to 1.2 kt, tapering hard after that.
    // Edges of the Stream still score; the middle of it doesn't.
    const kt = cur[k];
    if (kt === kt) s *= kt <= 1.2 ? 1 : kt <= 2.5 ? 1 - 0.85 * (kt - 1.2) / 1.3 : 0.05;
    score[k] = s; parts.set([pb, pc, po, pe], k * 4);
  }
  // top spots: best cells at least 8 nm apart, within the run limit from the home inlet
  const order = Array.from(score.keys()).filter((k) => score[k] > 25).sort((a, b) => score[b] - score[a]);
  const spots = [];
  for (const k of order) {
    const j = Math.floor(k / g.nx), i = k % g.nx, la = g.lat0 + j * g.dlat, lo = g.lon0 + i * g.dlon;
    if (home && rangeBearing([home[1], home[2]], [la, lo])[0] > S.maxRun) continue;
    if (spots.some((s) => rangeBearing([s.lat, s.lon], [la, lo])[0] < 8)) continue;
    if (cur[k] > 2.0) continue;                               // never send you into the middle of the Stream
    const fmK = -dep[k] / FATHOM, [dMin, dMax] = S.fishDepth;  // your depth range, if set
    if ((dMin != null && fmK < dMin) || (dMax != null && fmK > dMax)) continue;
    const [pb, pc, po, pe] = parts.subarray(k * 4, k * 4 + 4);
    const why = [`${T[k].toFixed(1)}°F${hourly[k] ? '' : ' (daily)'}`];
    if (cur[k] === cur[k]) why.push(`${cur[k].toFixed(1)} kt current`);
    if (pb > 0.6) why.push('on a temp break'); if (pc > 0.6) why.push('color edge'); if (po > 0.6) why.push('steep bottom / canyon wall'); if (pe > 0.6) why.push('eddy edge');
    why.push(`${Math.round(-dep[k] / FATHOM).toLocaleString()} fm`);
    spots.push({ lat: la, lon: lo, score: Math.round(score[k]), why });
    if (spots.length >= 8) break;
  }
  S.data.fish = { ...g, v: score, date: (S.data.goes?.date || sst.date), times: S.data.goes?.times?.slice(-1) };
  S.fishT = { ...g, v: T, mask: hourly, date: S.data.fish.date, times: S.data.fish.times };
  S.fishCur = { ...g, v: cur };
  S.fishSpots = sp.inshore ? inshoreSpots(sp) : spots;
  renderSpots();
}
function drawHotspots(ctx) {
  ctx.save(); ctx.font = '800 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  (S.fishSpots || []).forEach((s, i) => {
    const [x, y] = project(s.lat, s.lon);
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.fillStyle = '#fbe36a'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), x, y + 0.5);
  });
  ctx.restore();
}
// ---------- Inshore tides: NOAA CO-OPS predictions at the nearest station to each pick ----------
let TSTA = null;
const tstaReady = fetch('data/tide_stations.json').then((r) => r.json()).then((d) => { TSTA = d.rows; }).catch(() => {});
function nearestStation(lat, lon) {
  let best = null;
  for (const r of TSTA || []) {
    if (Math.abs(r[1] - lat) > 0.4 || Math.abs(r[2] - lon) > 0.5) continue;
    const d = rangeBearing([lat, lon], [r[1], r[2]])[0];
    if (!best || d < best.d) best = { id: r[0], name: r[3], d };
  }
  return best && best.d <= 20 ? best : null;
}
const HILO = new Map();
function hiloFor(id) {
  if (HILO.has(id)) return HILO.get(id);
  const t = new Date(Date.now() - 12 * 3600e3), ymd = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}`;
  const p = fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=${id}&product=predictions&datum=MLLW&interval=hilo&units=english&time_zone=gmt&format=json&begin_date=${ymd}&range=72&application=breakline`)
    .then((r) => r.json()).then((d) => (d.predictions || []).map((x) => ({ t: Date.parse(x.t.replace(' ', 'T') + ':00Z'), ft: +x.v, k: x.type === 'H' ? 'high' : 'low' })))
    .then((v) => { if (!v.length) throw new Error('no tides'); return v; })
    .catch(() => { HILO.delete(id); return null; });          // don't remember a failure; the next look retries
  HILO.set(id, p);
  return p;
}
const hmT = (t) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayT = (t) => { const d = new Date(t), n = new Date(); return d.toDateString() === n.toDateString() ? '' : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' '; };
// Which stage of the tide to fish, by spot type and species
function tidePlan(kind, sp, ft) {
  const flats = (kind === 'shoal' || kind === 'reef') && !(ft > 10);
  if (flats && (sp === 'reddrum' || sp === 'trout')) return { want: 'rising', why: 'rising water pushes fish up onto the flat and the oyster edges' };
  if (kind === 'drop') return { want: 'falling', why: 'falling water pulls bait off the shallows and over the edge' };
  if (kind === 'reef' && ft > 10) return { want: 'moving', why: 'either direction; the reef holds fish best when it runs, and slack is slow' };
  if (sp === 'tarpon' || sp === 'snook') return { want: 'falling', why: 'the outgoing pulls bait out through the pass and past the structure' };
  return { want: 'falling', why: 'the first hours of the outgoing flush bait out; the incoming brings clean water' };
}
// Moving water: the middle of each stage (1-3.5 h after the turn) runs hardest
function tideHtml(pts, kind, spKey, ft) {
  const now = Date.now(), plan = tidePlan(kind, spKey, ft), wins = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], stage = a.k === 'high' ? 'falling' : 'rising';
    const w0 = a.t + Math.min(3600e3, (b.t - a.t) * 0.15), w1 = Math.min(b.t - 3600e3, a.t + 3.5 * 3600e3);
    if (w1 < now || w0 > now + 36 * 3600e3 || w1 <= w0) continue;
    wins.push({ stage, a: Math.max(w0, now), b: w1, best: stage === plan.want || plan.want === 'moving' });
  }
  const turns = pts.filter((x) => x.t > now - 3600e3).slice(0, 4).map((x) => `${x.k === 'high' ? 'High' : 'Low'} ${dayT(x.t)}${hmT(x.t)} (${x.ft.toFixed(1)} ft)`).join(' · ');
  const cur = pts.findIndex((x) => x.t > now), stageNow = cur > 0 ? (pts[cur - 1].k === 'high' ? 'falling' : 'rising') : null;
  const best = wins.filter((w) => w.best)
    .slice(0, plan.want === 'moving' ? 3 : 2).map((w) => (w.a === now ? `now–${hmT(w.b)}` : `${dayT(w.a)}${hmT(w.a)}–${hmT(w.b)}`)).join(', ');
  tideHtml.wins = wins.filter((w) => w.best); tideHtml.stageNow = stageNow;
  return `${stageNow ? `<b>Now ${stageNow}</b> · ` : ''}${turns}${best ? `<br><b>Fish the ${plan.want} tide:</b> ${best} <span class="dim">(${plan.why})</span>` : ''}`;
}
// ---------- Inshore solunar: the next majors/minors at this spot, and whether they line up with the tide to fish ----------
const SOL_LBL = { overhead: 'moon overhead', underfoot: 'moon underfoot', moonrise: 'moonrise', moonset: 'moonset' };
function solunarHtml(lat, lon, pts, tideWins) {
  const now = Date.now(), d = new Date(), t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const turns = (pts || []).map((x) => ({ t: x.t, k: x.k }));
  const days = [Solunar.summary(t0, lat, lon, turns), Solunar.summary(t0 + 864e5, lat, lon, turns)];
  const wins = days.flatMap((x) => x.windows).filter((w) => w.b > now && w.a < now + 30 * 3600e3).slice(0, 3);
  if (!wins.length) return '';
  const items = wins.map((w) => {
    const tags = w.tags.filter((x) => !/tide/.test(x));
    const lines = (tideWins || []).find((tw) => Math.min(tw.b, w.b) - Math.max(tw.a, w.a, now) >= 30 * 60e3);
    const txt = `${w.kind === 'major' ? 'Major' : 'Minor'} ${w.a <= now ? `now–${hmT(w.b)}` : `${dayT(w.a)}${hmT(w.a)}–${hmT(w.b)}`} <span class="dim">${SOL_LBL[w.why]}${tags.length ? ` + ${tags.join(', ')}` : ''}</span>`;
    return lines ? `<b class="star">★ ${txt} · lines up with your ${lines.stage} tide</b>` : txt;
  });
  const p = days[0];
  return `<br><b>Solunar:</b> ${items.join(' · ')} <span class="dim">(${p.phase}, ${'★'.repeat(p.stars)}${'☆'.repeat(4 - p.stars)})</span>`;
}
// ---------- Inshore wind (Open-Meteo hourly, knots) ----------
const WIND = new Map();
function windFor(lat, lon) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (!WIND.has(k)) WIND.set(k, omJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn&timeformat=unixtime&forecast_days=3`)
    .then((d) => d.hourly.time.map((t, i) => ({ t: t * 1000, kt: d.hourly.wind_speed_10m[i], dir: d.hourly.wind_direction_10m[i], g: d.hourly.wind_gusts_10m[i] })).filter((x) => x.kt != null))
    .catch(() => null));
  return WIND.get(k);
}
const windAt = (hrs, t) => hrs.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
const windTxt = (w) => `${card(w.dir)} ${Math.round(w.kt)} kt${w.g > w.kt + 4 ? `, gusts ${Math.round(w.g)}` : ''}`;
// Which way is open water from here: the deepest direction ~1.5 nm out
function seaward(lat, lon) {
  let best = null;
  for (let a = 0; a < 360; a += 30) {
    const r = 1.5 / 60, z = depthAt(lat + r * Math.cos(a * Math.PI / 180), lon + r * Math.sin(a * Math.PI / 180) / Math.cos(lat * Math.PI / 180));
    if (z === z && (!best || z < best.z)) best = { a, z };
  }
  return best ? best.a : null;
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function windNotes(w, kind, sp, lat, lon, stage) {
  const n = [], sea = seaward(lat, lon), onshore = sea != null && angDiff(w.dir, sea) <= 60, offshore = sea != null && angDiff(w.dir, sea) >= 120;
  if (w.kt >= 20) n.push('too much wind for most inshore spots; look for a lee shore');
  else if (kind === 'inlet' && onshore && w.kt >= 12 && stage === 'falling') n.push('wind against the outgoing tide: the inlet stacks up and gets rough');
  else if ((kind === 'shoal' || (kind === 'reef' && sp !== 'flounder')) && w.kt >= 12) n.push('choppy and muddy on the flats; fish the lee side or the wind-blown edge where bait piles up');
  else if (onshore && w.kt >= 8 && ['reddrum', 'trout', 'striper'].includes(sp)) n.push('onshore wind pushes bait against this shoreline: good');
  else if (offshore && w.kt >= 8) n.push('offshore wind: flatter water here, and it lowers the tide a bit');
  else if (w.kt < 6) n.push('light wind: easy to fish and sight fish');
  return n.join('; ');
}
async function addWind(box, s, stageNow) {
  const hrs = await windFor(s.lat, s.lon); if (!hrs?.length || !box.isConnected) return;
  const now = windAt(hrs, Date.now()), win = (tideHtml.winsFor?.get(box) || []).find((w) => w.a > Date.now() + 3600e3);
  let h = `<br><b>Wind now:</b> ${windTxt(now)}`;
  const note = windNotes(now, s.kind, S.species, s.lat, s.lon, stageNow);
  if (win) { const w2 = windAt(hrs, (win.a + win.b) / 2); h += ` · <b>during the ${hmT(win.a)} window:</b> ${windTxt(w2)}`; }
  h += note ? ` <span class="dim">(${note})</span>` : '';
  box.insertAdjacentHTML('beforeend', h);
}
let tideTok = 0;
async function fillTides(el) {
  const my = ++tideTok; await tstaReady;
  for (const li of el.querySelectorAll('li[data-i]')) {
    const s = S.fishSpots[+li.dataset.i], box = li.querySelector('.tides'); if (!s || !box) continue;
    const st = nearestStation(s.lat, s.lon);
    if (!st) { box.innerHTML = 'No NOAA tide station within 20 nm.' + solunarHtml(s.lat, s.lon, null, []); addWind(box, s, null); continue; }
    hiloFor(st.id).then((pts) => {
      if (my !== tideTok) return;
      box.innerHTML = pts?.length ? `<span class="dim">Tides · ${st.name} (${st.d.toFixed(1)} nm)</span><br>${tideHtml(pts, s.kind, S.species, s.ft)}` : 'Tide forecast unavailable right now.';
      (tideHtml.winsFor ||= new WeakMap()).set(box, pts?.length ? tideHtml.wins : []);
      box.insertAdjacentHTML('beforeend', solunarHtml(s.lat, s.lon, pts, pts?.length ? tideHtml.wins : []));
      addWind(box, s, pts?.length ? tideHtml.stageNow : null);
    });
  }
}
function renderSpots() {
  const el = $('spotList'); if (!el) return;
  const home = PORTS.find((x) => x[0] === S.home);
  el.innerHTML = (S.fishSpots || []).map((s, i) => {
    const [d, b] = home ? rangeBearing([home[1], home[2]], [s.lat, s.lon]) : [0, 0];
    return `<li data-i="${i}"><b>${i + 1}. ${s.score}/100</b><small>${s.why.join(' · ')}<br>${fmtLL(s.lat, s.lon)}${inLoran(s.lat, s.lon) ? ` · TD ${fmtTd(s.lat, s.lon)}` : ''}<br>${d.toFixed(0)} nm @ ${Math.round(b)}°T from ${S.home}</small>${SPECIES[S.species]?.inshore ? '<small class="tides">Loading tides…</small>' : ''}</li>`;
  }).join('') || '<li><small>Nothing scores well in range. Try another species or a longer run.</small></li>';
  const fi = S.fishInfo;
  const ins = !!SPECIES[S.species]?.inshore;
  if (ins) fillTides(el);
  for (const id of ['maxRun', 'depMin']) $(id).closest('.row2').hidden = ins;
  document.querySelector('#fishPanel .hint.long').hidden = ins;
  if (ins) {
    $('fishBasis').textContent = `Inshore picks: inlets, jetties, piers, reefs, shoals${map.getZoom() >= 12 ? ' and drop-offs (NOAA high-res bottom)' : ''} on screen, scored on water temp and depth for ${SPECIES[S.species].label.toLowerCase()}.${map.getZoom() < 12 ? ' Zoom in closer to add drop-offs.' : ''} Each pick lists the tides at the nearest NOAA station and when to fish them, the solunar periods (★ = lines up with that tide), and the wind.`;
  } else $('fishBasis').textContent = (learned(S.species) ? `Tuned to your ${learned(S.species).n} logged catches. ` : '') + (fi ? `Water temp: hourly GOES${fi.hour ? ` (${niceHour(fi.hour)})` : ''} for ${fi.hourlyPct}% of the area, daily cloud-free for the rest. ${fi.cur ? 'Strong current (over ~1.2 kt) counts against a spot; nothing over 2 kt is listed.' : 'Currents not loaded.'}` : '');
  el.querySelectorAll('li[data-i]').forEach((li) => { li.onclick = () => { const s = S.fishSpots[+li.dataset.i]; map.setView([s.lat, s.lon], Math.max(map.getZoom(), SPECIES[S.species]?.inshore ? 13 : 9)); openReading(L.latLng(s.lat, s.lon), `Hot spot ${+li.dataset.i + 1}`); }; });
}

// ---------- Ocean analysis: outline the features, then write up the water and where to go ----------
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const card = (b) => COMPASS[Math.round(((b % 360) + 360) % 360 / 45) % 8];
let ANA = null;
// one contour level on a grid no wider than ~240 cells; segments over holes/land are flagged so they don't draw
function contourAt(g, level, mask) {
  const step = Math.max(1, Math.ceil(g.nx / 240)), nx = Math.floor((g.nx - 1) / step) + 1, ny = Math.floor((g.ny - 1) / step) + 1;
  const r = { nx, ny, lat0: g.lat0, lon0: g.lon0, dlat: g.dlat * step, dlon: g.dlon * step, v: new Float32Array(nx * ny) };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = g.v[j * step * g.nx + i * step]; r.v[j * nx + i] = mask ? mask(x) : x; }
  const bad = (la, lo) => { const x = sample(r, la, lo); return x !== x || !(sample(S.data.bathy, la, lo) < -15); };
  return contourRings(r, meanFill(r.v), [level]).flatMap((c) => c.rings.map((ring) => ring.map(([la, lo, e]) => [la, lo, e || bad(la, lo)]))
    .filter((ring) => ring.some((p) => !p[2])));
}
function nameNear(lat, lon, nm = 10) {
  let best = null;
  const look = (la, lo, name) => {
    if (Math.abs(la - lat) > 0.2 || Math.abs(lo - lon) > 0.25) return;
    const [d, b] = rangeBearing([la, lo], [lat, lon]); if (d <= nm && (!best || d < best.d)) best = { d, b, name };
  };
  for (const r of SPOTS || []) if (r[3] !== 'reef') look(r[0], r[1], r[2]);
  for (const r of PLACES || []) if (r[3] === 'sea' || r[3] === 'island') look(r[0], r[1], r[2]);
  return best ? (best.d < 1 ? `at ${best.name}` : `${best.d.toFixed(0)} nm ${card(best.b)} of ${best.name}`) : '';
}
function inView(la, lo, pad = 0) { const b = map.getBounds().pad(pad); return la > b.getSouth() && la < b.getNorth() && lo > b.getWest() && lo < b.getEast(); }
function buildAnalysis() {
  const T = S.fishT; if (!T) { ANA = null; return; }
  S.data.ana = T;
  sstGeoFor = null; buildSstGeo(T);                 // breaks on the hourly-where-clear field, seam ignored
  const home = PORTS.find((x) => x[0] === S.home), sp = SPECIES[S.species] || SPECIES.yellowfin;
  const run = (la, lo) => (home ? rangeBearing([home[1], home[2]], [la, lo]) : null);
  const A = { home, sp, run };
  // water temp across what's on screen
  const tv = []; let warm = null;
  for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
    const k = j * T.nx + i, t = T.v[k]; if (t !== t) continue;
    const la = T.lat0 + j * T.dlat, lo = T.lon0 + i * T.dlon; if (!inView(la, lo)) continue;
    tv.push(t);
    if (home && t >= sp.t[1] && t <= sp.t[2]) { const d = run(la, lo)[0]; if (!warm || d < warm.d) warm = { d, b: run(la, lo)[1], lat: la, lon: lo, t }; }
  }
  tv.sort((a, b) => a - b);
  A.temps = tv.length ? { lo: tv[Math.floor(tv.length * 0.05)], mid: tv[Math.floor(tv.length / 2)], hi: tv[Math.floor(tv.length * 0.95)] } : null;
  A.warm = warm;
  // temperature breaks: biggest connected fronts on screen, temps on each side
  const gr = S.geo.grad, brks = [];
  for (const cells of S.geo.brkComps || []) {
    let n = 0, sum = 0, best = -1, bm = 0;
    for (const k of cells) {
      const i = k % gr.nx, j = (k - i) / gr.nx, la = gr.lat0 + j * gr.dlat, lo = gr.lon0 + i * gr.dlon;
      if (!inView(la, lo)) continue;
      n++; sum += gr.v[k]; if (gr.v[k] > bm) { bm = gr.v[k]; best = k; }
    }
    if (n < 6) continue;
    const i = best % gr.nx, j = (best - i) / gr.nx, la = gr.lat0 + j * gr.dlat, lo = gr.lon0 + i * gr.dlon;
    const off = 3 / (gr.dlat * 60), ux = gr.ux[best], uy = gr.uy[best];
    const tw = sample(T, la + uy * off * gr.dlat, lo + ux * off * gr.dlon), tc = sample(T, la - uy * off * gr.dlat, lo - ux * off * gr.dlon);
    const east = ux * gr.dlon * Math.cos(la * Math.PI / 180), north = uy * gr.dlat;
    const z = sample(S.data.bathy, la, lo);
    brks.push({ lat: la, lon: lo, len: n * gr.dlat * 60 * 0.85, str: bm, score: n * sum / n * Math.sqrt(n), tw, tc,
      warmSide: card(Math.atan2(east, north) * 180 / Math.PI), fm: z < 0 ? -z / FATHOM : NaN });
  }
  brks.sort((a, b) => b.score - a.score);
  A.breaks = brks.slice(0, 5).map((b, i) => ({ ...b, id: `B${i + 1}` }));
  // eddies: altimetry highs (warm core) and lows (cold core) over deep water
  const ed = [], g = S.data.ssh;
  if (g) {
    const R = Math.max(2, Math.round(0.35 / g.dlat));
    for (let j = R; j < g.ny - R; j++) for (let i = R; i < g.nx - R; i++) {
      const v = g.v[j * g.nx + i]; if (!(Math.abs(v) >= 12)) continue;
      let ext = true;
      for (let dj = -R; dj <= R && ext; dj++) for (let di = -R; di <= R; di++) { const x = g.v[(j + dj) * g.nx + i + di]; if (x === x && (v > 0 ? x > v : x < v)) { ext = false; break; } }
      if (!ext) continue;
      const la = g.lat0 + j * g.dlat, lo = g.lon0 + i * g.dlon;
      if (!inView(la, lo, 0.05) || !(sample(S.data.bathy, la, lo) < -200)) continue;
      if (ed.some((e) => rangeBearing([e.lat, e.lon], [la, lo])[0] < 35)) continue;
      ed.push({ lat: la, lon: lo, v, warm: v > 0, t: sample(T, la, lo) });
    }
  }
  A.eddies = ed.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
  // color: blue/green edge (0.25 mg/m3 where both exist, else the median of the view)
  const c = S.data.chl; A.chl = null; A.colorLines = [];
  if (c) {
    const cv = [];
    for (let j = 0; j < c.ny; j++) for (let i = 0; i < c.nx; i++) { const x = c.v[j * c.nx + i]; if (x > 0 && inView(c.lat0 + j * c.dlat, c.lon0 + i * c.dlon)) cv.push(x); }
    if (cv.length > 50) {
      cv.sort((a, b) => a - b);
      const frac = cv.filter((x) => x < 0.25).length / cv.length, lvl = frac > 0.05 && frac < 0.95 ? 0.25 : cv[Math.floor(cv.length / 2)];
      A.colorLines = contourAt(c, Math.log10(lvl), (x) => (x > 0 ? Math.log10(x) : NaN));
      let blue = null;
      if (home) for (let j = 0; j < c.ny; j += 2) for (let i = 0; i < c.nx; i += 2) {
        const x = c.v[j * c.nx + i], la = c.lat0 + j * c.dlat, lo = c.lon0 + i * c.dlon;
        if (!(x > 0 && x < lvl) || !inView(la, lo) || !(sample(S.data.bathy, la, lo) < -20)) continue;
        const [d, b] = run(la, lo); if (!blue || d < blue.d) blue = { d, b, lat: la, lon: lo, x };
      }
      A.chl = { lvl, blueFrac: cv.filter((x) => x < lvl).length / cv.length, blue, date: c.date };
    }
  }
  // current: strongest flow on screen and the 1.5 kt edge (the wall you fish along, not into)
  const cu = S.fishCur; A.cur = null; A.curLines = [];
  if (cu && S.fishInfo?.cur) {
    let mx = null;
    for (let j = 0; j < cu.ny; j += 2) for (let i = 0; i < cu.nx; i += 2) {
      const v = cu.v[j * cu.nx + i], la = cu.lat0 + j * cu.dlat, lo = cu.lon0 + i * cu.dlon;
      if (v === v && inView(la, lo) && (!mx || v > mx.v)) mx = { v, lat: la, lon: lo };
    }
    if (mx) { const uv = curAt(mx.lat, mx.lon); mx.dir = uv ? (Math.atan2(uv[0], uv[1]) * 180 / Math.PI + 360) % 360 : NaN; }
    A.cur = mx;
    if (mx && mx.v > 1.6) A.curLines = contourAt(cu, 1.5);
  }
  A.asOf = S.date ? nice(S.date) : S.fishInfo?.hour ? niceHour(S.fishInfo.hour) : (T.date ? nice(T.date) : 'latest');
  ANA = A;
}
function drawAnalysis(ctx, size, boxes) {
  if (!ANA) return;
  ctx.save(); ctx.font = '700 10.5px system-ui, sans-serif';
  const line = (rings, col, dash, label) => {
    if (!rings.length) return;
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = 4.2; strokeRings(ctx, rings);
    ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = 2.2; const spots = strokeRings(ctx, rings, 200);
    ctx.setLineDash([]); placeLabels(ctx, spots, label, boxes, size, 520, col, 'rgba(0,0,0,.85)');
  };
  line(ANA.colorLines, '#5dff9e', [9, 6], 'color edge');
  line(ANA.curLines, '#ff6ad5', [3, 5], '1.5 kt current');
  ctx.font = '800 11px system-ui, sans-serif';
  for (const e of ANA.eddies) {
    const [x, y] = project(e.lat, e.lon), col = e.warm ? '#c0392b' : '#2457c5';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.font = '800 11px system-ui, sans-serif'; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(e.warm ? 'W' : 'C', x, y + 0.5);
    const txt = `${e.warm ? 'WARM' : 'COLD'} EDDY ${e.v > 0 ? '+' : ''}${Math.round(e.v)} cm`;
    tag(ctx, txt, x + 13, y, 'left', col, '#fff'); boxes.push([x - 10, y - 10, x + 20 + ctx.measureText(txt).width, y + 10]);
  }
  for (const b of ANA.breaks) {
    const [x, y] = project(b.lat, b.lon);
    const txt = `${b.id} ${b.tc === b.tc ? `${b.tc.toFixed(0)}→${b.tw.toFixed(0)}°` : ''}`;
    ctx.font = '800 11px system-ui, sans-serif';
    tag(ctx, txt, x, y - 16, 'center', '#fff', '#000'); boxes.push([x - 30, y - 26, x + 30, y - 6]);
  }
  ctx.restore(); ctx.textAlign = 'center';
  drawTomorrow(ctx);
}
function renderAnalysis() {
  const el = $('anaBody'); if (!el) return;
  const A = ANA;
  if (!A) { el.innerHTML = '<p class="hint">Loading the water…</p>'; return; }
  const port = A.home ? A.home[0] : 'port';
  const where = (la, lo) => {
    const r = A.run(la, lo), nm = nameNear(la, lo);
    return `${r ? `${r[0].toFixed(0)} nm @ ${Math.round(r[1])}°T from ${port}` : ''}${nm ? `, ${nm}` : ''}`;
  };
  const pos = (la, lo) => `<span class="ll" data-ll="${la},${lo}">${fmtLL(la, lo)}${inLoran(la, lo) ? ` · TD ${fmtTd(la, lo)}` : ''}</span>`;
  const f1 = (x) => (x === x ? x.toFixed(1) : '?');
  const h = [];
  h.push(`<p class="hint">As of ${A.asOf}. Water temp is hourly GOES where it's clear (${S.fishInfo?.hourlyPct ?? 0}% of the area), daily cloud-free elsewhere. Covers what's on your screen.</p>`);
  // The big picture
  const big = [];
  if (A.temps) big.push(`Surface water on the chart runs ${f1(A.temps.lo)} to ${f1(A.temps.hi)}°F, middle of the pack ${f1(A.temps.mid)}°F.`);
  if (A.warm) big.push(`The closest ${A.sp.label.toLowerCase()} water (${A.sp.t[1]}-${A.sp.t[2]}°F) is ${A.warm.d.toFixed(0)} nm @ ${Math.round(A.warm.b)}°T from ${port}${nameNear(A.warm.lat, A.warm.lon) ? `, ${nameNear(A.warm.lat, A.warm.lon)}` : ''}.`);
  else if (A.temps) big.push(`Nothing on the chart sits in the ${A.sp.t[1]}-${A.sp.t[2]}°F band ${A.sp.label.toLowerCase()} like; zoom out or check another species.`);
  if (A.chl) big.push(A.chl.blue ? `Blue water (under ${A.chl.lvl.toFixed(2)} mg/m³ chlorophyll) is ${Math.round(A.chl.blueFrac * 100)}% of the chart; the nearest is ${A.chl.blue.d.toFixed(0)} nm @ ${Math.round(A.chl.blue.b)}°T.` : `Color is mostly green inshore of the chart edge; no clean blue water in view.`);
  if (A.cur) big.push(`Strongest current on screen is ${A.cur.v.toFixed(1)} kt${A.cur.dir === A.cur.dir ? ` setting ${card(A.cur.dir)}` : ''}${A.cur.v > 1.6 ? ' (the pink dotted line is the 1.5 kt edge: fish along it, not in it)' : ''}.`);
  h.push(`<h4>The water</h4><p>${big.join(' ')}</p>`);
  // Breaks
  if (A.breaks.length) {
    h.push(`<h4>Temperature breaks</h4><ul>${A.breaks.map((b) => `<li data-ll="${b.lat},${b.lon}"><b>${b.id}</b> ${b.tc === b.tc ? `${f1(b.tc)}→${f1(b.tw)}°F, warm side to the ${b.warmSide}` : ''}, ${b.str.toFixed(1)}°F/nm, about ${b.len.toFixed(0)} nm long${b.fm === b.fm ? `, ${Math.round(b.fm).toLocaleString()} fm` : ''}.<br><small>${where(b.lat, b.lon)} · ${pos(b.lat, b.lon)}</small></li>`).join('')}</ul>`);
  } else h.push(`<h4>Temperature breaks</h4><p>No clean breaks on screen at the current sensitivity (Layers → Sensitivity).</p>`);
  // Eddies
  if (A.eddies.length) h.push(`<h4>Eddies</h4><ul>${A.eddies.map((e) => `<li data-ll="${e.lat},${e.lon}"><b>${e.warm ? 'Warm' : 'Cold'} eddy</b> ${e.v > 0 ? '+' : ''}${Math.round(e.v)} cm${e.t === e.t ? `, ${f1(e.t)}°F at the center` : ''}. ${e.warm ? 'Bait and fish stack on the edges, mostly where it meets cooler water.' : 'Upwelling: look for the color and temp edge on its rim.'}<br><small>${where(e.lat, e.lon)}</small></li>`).join('')}</ul>`);
  // Where to go
  const sp = S.fishSpots || [];
  if (sp.length) {
    const s1 = sp[0], s2 = sp[1], s3 = sp[2];
    const near = (s) => { const b = A.breaks.find((x) => rangeBearing([x.lat, x.lon], [s.lat, s.lon])[0] < 8); return b ? ` It sits on ${b.id}.` : ''; };
    let plan = `Start at <b>#1</b> (${s1.score}/100): ${where(s1.lat, s1.lon)}. ${s1.why.join(', ')}.${near(s1)}`;
    if (s2) { const [d, b] = rangeBearing([s1.lat, s1.lon], [s2.lat, s2.lon]); plan += ` If it's quiet, slide ${d.toFixed(0)} nm ${card(b)} to <b>#2</b> (${s2.why.slice(0, 3).join(', ')}).${near(s2)}`; }
    if (s3) { const [d, b] = rangeBearing([(s2 || s1).lat, (s2 || s1).lon], [s3.lat, s3.lon]); plan += ` Then <b>#3</b> is ${d.toFixed(0)} nm ${card(b)} of that.`; }
    h.push(`<h4>Where I'd go · ${A.sp.label}</h4><p>${plan}</p><ul>${sp.slice(0, 3).map((s, i) => `<li data-ll="${s.lat},${s.lon}"><b>#${i + 1}</b> ${pos(s.lat, s.lon)}</li>`).join('')}</ul><p class="hint">Max run ${S.maxRun} nm from ${port}; species, run and depth are set in Where to fish.</p>`);
  } else h.push(`<h4>Where I'd go</h4><p>Nothing scores well inside ${S.maxRun} nm for ${A.sp.label.toLowerCase()}. Try a longer run or another species in Where to fish.</p>`);
  h.push(`<p class="hint">Chart key: white lines = temp breaks (B1…), green dashed = color edge, pink dotted = 1.5 kt current, red/blue rings = altimetry highs/lows. Computer-drawn from satellite data, not a human analyst: check it against what you see.</p>`);
  el.innerHTML = h.join('');
  el.querySelectorAll('[data-ll]').forEach((li) => {
    if (li.tagName !== 'LI') return;
    li.onclick = () => { const [la, lo] = li.dataset.ll.split(',').map(Number); map.setView([la, lo], Math.max(map.getZoom(), 9)); openReading(L.latLng(la, lo), 'Analysis'); };
  });
  buildTomorrow();
}

// ---------- Analysis: tomorrow (prediction) ----------
// Today's features carried 24 h forward by the forecast currents (forward trajectories, 2-hour steps).
// The water keeps its temperature; only its position changes. Eddies themselves crawl a few miles a day.
function makeVel(frames) {
  return (la, lo, t) => {
    const f = clamp(t / 6, 0, frames.length - 1), k = Math.min(frames.length - 2, Math.floor(f)), a = f - k, A = frames[k], B = frames[k + 1] || A;
    const u = (1 - a) * sample(A, la, lo, A.u) + a * sample(B, la, lo, B.u), v = (1 - a) * sample(A, la, lo, A.vv) + a * sample(B, la, lo, B.vv);
    return u === u && v === v ? [v * 3600 / 111320, u * 3600 / (111320 * Math.cos(la * Math.PI / 180))] : null;   // deg per hour
  };
}
function advect(vel, la, lo, H = 24) {
  for (let t = 0; t < H; t += 2) {
    const v1 = vel(la, lo, t); if (!v1) return null;
    const v2 = vel(la + v1[0], lo + v1[1], t + 1) || v1;
    la += v2[0] * 2; lo += v2[1] * 2;
  }
  return [la, lo];
}
let TOM = null, tomToken = 0;
async function buildTomorrow() {
  const my = ++tomToken, A = ANA, el = $('anaTom');
  if (!A || !el) return;
  if (S.date) { TOM = null; el.innerHTML = '<p class="hint">The tomorrow prediction runs off today\'s data. Tap Latest to go back to today.</p>'; return; }
  el.innerHTML = '<p class="hint">Working out tomorrow…</p>';
  let frames;
  try {
    const win = windowFor(0.083, 300);
    frames = await Promise.all([0, 6, 12, 18, 24].map((h) => fcFrame(h, win)));
  } catch (e) { if (my === tomToken) el.innerHTML = '<p class="hint">The current forecast didn\'t load, so there is no prediction right now. Try again in a minute.</p>'; return; }
  if (my !== tomToken) return;
  const vel = makeVel(frames), cache = new Map();
  const mv = (la, lo) => { const k = `${la.toFixed(4)},${lo.toFixed(4)}`; if (!cache.has(k)) cache.set(k, advect(vel, la, lo)); return cache.get(k); };
  // breaks: move every on-screen segment
  const segs = [];
  for (const s of S.geo.breaks) {
    if (!inView(s.a[0], s.a[1], 0.1)) continue;
    const a = mv(s.a[0], s.a[1]), b = mv(s.b[0], s.b[1]); if (a && b) segs.push({ a, b, k: s.k });
    if (segs.length > 4000) break;
  }
  const shift = (la, lo) => { const p = mv(la, lo); if (!p) return null; const [d, b] = rangeBearing([la, lo], p); return { lat: p[0], lon: p[1], d, b }; };
  const brks = A.breaks.map((b) => ({ ...b, to: shift(b.lat, b.lon) }));
  const spots = (S.fishSpots || []).slice(0, 3).map((s, i) => ({ ...s, n: i + 1, to: shift(s.lat, s.lon) }));
  // strongest current tomorrow on screen
  const F = frames[frames.length - 1]; let mx = null;
  for (let j = 0; j < F.ny; j += 2) for (let i = 0; i < F.nx; i += 2) {
    const k = j * F.nx + i, u = F.u[k], v = F.vv[k]; if (u !== u || v !== v) continue;
    const la = F.lat0 + j * F.dlat, lo = F.lon0 + i * F.dlon; if (!inView(la, lo)) continue;
    const kt = Math.hypot(u, v) * 1.94384; if (!mx || kt > mx.kt) mx = { kt, lat: la, lon: lo, dir: (Math.atan2(u, v) * 180 / Math.PI + 360) % 360 };
  }
  TOM = { segs, brks, spots, cur: mx, when: fcTime(24) };
  chart.draw();
  renderTomorrow();
  // tomorrow's wind/seas where you'd start, and the best times from your port
  const s1 = spots[0]?.to || spots[0];
  if (s1) tomWeather(s1.lat, s1.lon).then((h) => { if (my === tomToken && $('tomWx')) $('tomWx').innerHTML = h; }).catch(() => { if ($('tomWx')) $('tomWx').textContent = 'Weather forecast unavailable right now.'; });
  if (A.home) bestTimesHtml(A.home[1], A.home[2], 1).then((h) => { if (my === tomToken && $('tomBt')) $('tomBt').innerHTML = h; }).catch(() => {});
}
async function tomWeather(lat, lon) {
  const qs = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&forecast_days=3&timezone=auto`;
  const [w, m] = await Promise.all([
    omJson(`https://api.open-meteo.com/v1/forecast?${qs}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`),
    omJson(`https://marine-api.open-meteo.com/v1/marine?${qs}&hourly=wave_height,wave_period`).catch(() => null),
  ]);
  const t = w.hourly.time, day = t.find((x) => x.slice(0, 10) > t[0].slice(0, 10))?.slice(0, 10);
  const idx = t.map((x, i) => [x, i]).filter(([x]) => x.slice(0, 10) === day && +x.slice(11, 13) >= 6 && +x.slice(11, 13) <= 14).map(([, i]) => i);
  if (!idx.length) return 'No forecast for tomorrow here.';
  const pick = (arr) => idx.map((i) => arr[i]).filter((x) => x != null);
  const ws = pick(w.hourly.wind_speed_10m), gs = pick(w.hourly.wind_gusts_10m), wd = pick(w.hourly.wind_direction_10m);
  const dirAvg = (Math.atan2(wd.reduce((s, d) => s + Math.sin(d * Math.PI / 180), 0), wd.reduce((s, d) => s + Math.cos(d * Math.PI / 180), 0)) * 180 / Math.PI + 360) % 360;
  let seas = '';
  if (m?.hourly) { const hs = pick(m.hourly.wave_height).map((x) => x * 3.28084), ps = pick(m.hourly.wave_period); if (hs.length) seas = `, seas ${Math.min(...hs).toFixed(0)}-${Math.max(...hs).toFixed(0)} ft${ps.length ? ` @ ${Math.round(ps.reduce((a, b) => a + b) / ps.length)} s` : ''}`; }
  const hi = Math.max(...ws), rough = hi >= 20 || (m?.hourly && Math.max(...pick(m.hourly.wave_height)) * 3.28084 >= 6);
  return `${new Date(day + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' })} 6 AM-2 PM at #1: wind ${card(dirAvg)} ${Math.round(Math.min(...ws))}-${Math.round(hi)} kt, gusts ${Math.round(Math.max(...gs))}${seas}.${rough ? ' <b>Sporty: check it again in the morning.</b>' : ''}`;
}
function renderTomorrow() {
  const el = $('anaTom'), T = TOM, A = ANA; if (!el || !T || !A) return;
  const port = A.home ? A.home[0] : 'port';
  const run = (p) => { const r = A.run(p.lat, p.lon); return r ? `${r[0].toFixed(0)} nm @ ${Math.round(r[1])}°T from ${port}` : ''; };
  const mvTxt = (to) => (!to ? 'no current data there' : to.d < 1 ? 'stays about where it is' : `moves ${to.d.toFixed(0)} nm ${card(to.b)}`);
  const h = [];
  h.push(`<p class="hint">Prediction for ${niceHour(T.when)}: today's water pushed 24 h by the Copernicus current forecast. Temps don't change in this, only where the water goes. Purple dashed lines on the chart are tomorrow's breaks; arrows show where the top spots' water drifts.</p>`);
  const s = T.spots;
  if (s.length) {
    const s1 = s[0], p1 = s1.to || s1;
    let plan = `The water at today's #1 ${mvTxt(s1.to)}. Tomorrow, start around ${run(p1)}${nameNear(p1.lat, p1.lon) ? `, ${nameNear(p1.lat, p1.lon)}` : ''}.`;
    for (const x of s.slice(1)) plan += ` #${x.n} ${mvTxt(x.to)}${x.to ? ` (${run(x.to)})` : ''}.`;
    h.push(`<h4>Where I'd go tomorrow · ${A.sp.label}</h4><p>${plan}</p><ul>${s.map((x) => { const p = x.to || x; return `<li data-ll="${p.lat},${p.lon}"><b>#${x.n} tomorrow</b> <small>${fmtLL(p.lat, p.lon)}${inLoran(p.lat, p.lon) ? ` · TD ${fmtTd(p.lat, p.lon)}` : ''}</small></li>`; }).join('')}</ul>`);
  }
  if (T.brks.length) h.push(`<h4>Breaks tomorrow</h4><ul>${T.brks.map((b) => `<li data-ll="${(b.to || b).lat},${(b.to || b).lon}"><b>${b.id}</b> ${mvTxt(b.to)}${b.to ? ` (${run(b.to)})` : ''}.</li>`).join('')}</ul>`);
  if (T.cur) h.push(`<h4>Current tomorrow</h4><p>Strongest on screen ${T.cur.kt.toFixed(1)} kt setting ${card(T.cur.dir)}${A.cur ? ` (today ${A.cur.v.toFixed(1)} kt)` : ''}.</p>`);
  if (A.eddies.length) h.push(`<p class="hint">Eddies crawl a few miles a day, so expect them close to where they are today.</p>`);
  h.push(`<h4>Weather tomorrow</h4><p id="tomWx">Loading…</p><h4>Best times tomorrow · ${port}</h4><div id="tomBt" class="hint">Loading…</div>`);
  const keepWx = $('tomWx')?.innerHTML, keepBt = $('tomBt')?.innerHTML;
  el.innerHTML = h.join('');
  if (keepWx && keepWx !== 'Loading…') $('tomWx').innerHTML = keepWx;
  if (keepBt && keepBt !== 'Loading…') $('tomBt').innerHTML = keepBt;
  el.querySelectorAll('li[data-ll]').forEach((li) => { li.onclick = () => { const [la, lo] = li.dataset.ll.split(',').map(Number); map.setView([la, lo], Math.max(map.getZoom(), 9)); openReading(L.latLng(la, lo), 'Tomorrow'); }; });
}
function drawTomorrow(ctx) {
  const T = TOM; if (!T || S.anaView !== 'tom') return;
  ctx.save();
  for (const [col, lw, dash] of [['rgba(0,0,0,.85)', 4.6, []], ['#c39bff', 2.4, [6, 4]]]) {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash(dash); ctx.beginPath();
    for (const s of T.segs) { const p0 = project(s.a[0], s.a[1]), p1 = project(s.b[0], s.b[1]); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); }
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of T.spots) {
    if (!s.to) continue;
    const [x0, y0] = project(s.lat, s.lon), [x1, y1] = project(s.to.lat, s.to.lon);
    ctx.strokeStyle = '#c39bff'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1, y1, 11, 0, 7); ctx.fillStyle = '#c39bff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.fillText(`${s.n}'`, x1, y1 + 0.5);
  }
  ctx.restore();
}

// Fast stand-in for fillNaN when the filled cells are never drawn: put the mean in the holes.
// Contour segments that cross a hole get flagged by the caller, so the fill value never shows.
function meanFill(vals) {
  let s = 0, n = 0; for (const x of vals) if (x === x) { s += x; n++; }
  const m = n ? s / n : 0, out = new Float64Array(vals.length);
  for (let i = 0; i < vals.length; i++) out[i] = vals[i] === vals[i] ? vals[i] : m;
  return out;
}
let sstGeoFor = null;
function buildSstGeo(g) {
  // the gradient/breaks are cheap and always shown; isotherms only when that overlay is on (1 °F steps)
  if (sstGeoFor !== g) { S.geo.grad = gradient(g); buildBreaks(); sstGeoFor = g; S.geo.iso = []; }
  if (S.ov.iso && !S.geo.iso.length) {
    let lo = Infinity, hi = -Infinity; for (const x of g.v) if (x === x) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (lo === Infinity) return;
    const th = []; for (let t = Math.floor(lo); t <= Math.ceil(hi); t += 1) th.push(t);
    S.geo.iso = contourRings(g, meanFill(g.v), th).map((c) => ({ value: c.value, rings: c.rings.map((r) => r.map(([la, lo2, e]) => [la, lo2, e || sample(g, la, lo2) !== sample(g, la, lo2)])) }));
  }
}
// Breaks, Canny-style: keep cells where the gradient is strong AND is the peak across the front
// (non-maximum suppression), link neighboring edge cells into line segments, drop tiny specks.
function buildBreaks() {
  const gr = S.geo.grad, thr = S.brk, segs = [];
  if (!gr) { S.geo.breaks = []; return; }
  const { nx, ny } = gr, edge = new Uint8Array(nx * ny);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const k = j * nx + i, m = gr.v[k]; if (!(m >= thr)) continue;
    if (gr.mask) {   // where hourly temps meet the daily fill, the step between them is not a real break
      let seam = false;
      for (let d = -2; d <= 2 && !seam; d++) { const a = gr.mask[k + d], b = gr.mask[k + d * nx]; if ((a !== undefined && a !== gr.mask[k]) || (b !== undefined && b !== gr.mask[k])) seam = true; }
      if (seam) continue;
    }
    const la = gr.lat0 + j * gr.dlat, lo = gr.lon0 + i * gr.dlon, ox = gr.ux[k], oy = gr.uy[k];
    const a = sample(gr, la + oy * gr.dlat, lo + ox * gr.dlon), b = sample(gr, la - oy * gr.dlat, lo - ox * gr.dlon);
    if (!(a > m) && !(b >= m)) edge[k] = m >= thr * 2 ? 2 : 1;
  }
  // connected components, so isolated specks (< 4 cells) can be dropped
  const comp = new Int32Array(nx * ny).fill(-1), size = [];
  for (let k0 = 0; k0 < edge.length; k0++) {
    if (!edge[k0] || comp[k0] >= 0) continue;
    const id = size.length, stack = [k0]; let n = 0; comp[k0] = id;
    while (stack.length) {
      const k = stack.pop(); n++; const i = k % nx, j = (k - i) / nx;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const kk = jj * nx + ii; if (edge[kk] && comp[kk] < 0) { comp[kk] = id; stack.push(kk); }
      }
    }
    size.push(n);
  }
  const pt = (k) => { const i = k % nx, j = (k - i) / nx; return [gr.lat0 + j * gr.dlat, gr.lon0 + i * gr.dlon]; };
  const comps = new Map();
  for (let k = 0; k < edge.length; k++) if (edge[k] && size[comp[k]] >= 6) { if (!comps.has(comp[k])) comps.set(comp[k], []); comps.get(comp[k]).push(k); }
  S.geo.brkComps = [...comps.values()];
  for (let k = 0; k < edge.length; k++) {
    if (!edge[k] || size[comp[k]] < 4) continue;
    const i = k % nx;
    for (const d of [1, nx, nx + 1, nx - 1]) {
      const kk = k + d; if (kk >= edge.length || !edge[kk]) continue;
      if ((d === 1 || d === nx + 1) && i === nx - 1) continue; if (d === nx - 1 && i === 0) continue;
      // skip the diagonal when an orthogonal link already covers it (keeps lines 1 cell wide)
      if (d === nx + 1 && (edge[k + 1] || edge[k + nx])) continue;
      if (d === nx - 1 && (edge[k - 1] || edge[k + nx])) continue;
      segs.push({ a: pt(k), b: pt(kk), k: Math.max(edge[k], edge[kk]) });
    }
  }
  S.geo.breaks = segs;
}
function buildRings(g) {
  // contour on a ~240-wide grid: enough for smooth rings, and the same cost whatever the source resolution
  const f = (g.nx - 1) / 240, rg = f > 1 || g.nx < 120
    ? (() => { const step = g.dlon * Math.max(f, (g.nx - 1) / 240), nx = Math.max(2, Math.round((g.nx - 1) * g.dlon / step) + 1), ny = Math.max(2, Math.round((g.ny - 1) * g.dlat / step) + 1);
      const out = { nx, ny, lat0: g.lat0, lon0: g.lon0, dlat: (g.ny - 1) * g.dlat / (ny - 1), dlon: (g.nx - 1) * g.dlon / (nx - 1), v: new Float32Array(nx * ny) };
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.v[j * nx + i] = sample(g, out.lat0 + j * out.dlat, out.lon0 + i * out.dlon);
      return out; })()
    : g;
  const up = rg, vals = meanFill(up.v);
  let lo = Infinity, hi = -Infinity; for (const x of g.v) if (x === x) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (lo === Infinity) { S.geo.rings = []; return; }
  const th = []; for (let t = Math.floor(lo / 5) * 5; t <= hi; t += 5) th.push(t);
  // hide the parts that run over land/bays (fillNaN invented values there) by flagging them like grid edges
  S.geo.rings = contourRings(up, vals, th).map((c) => ({
    value: c.value,
    rings: c.rings.map((r) => r.map(([la, lo, edge]) => {
      const z = sample(S.data.bathy, la, lo);
      return [la, lo, edge || sample(g, la, lo) !== sample(g, la, lo) || !(z < -20)];
    })).filter((r) => r.some((pt) => !pt[2])),
  }));
}

// ---------- Best times to fish: solunar majors/minors + sun + tides (solunar.js; tides from Open-Meteo, global) ----------
const TIDE_CACHE = new Map();
async function tidesFor(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  if (TIDE_CACHE.has(key)) return TIDE_CACHE.get(key);
  const p = omJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=sea_level_height_msl&past_days=1&forecast_days=5&timezone=auto`)
    .then((d) => {
      const off = d.utc_offset_seconds * 1000;
      const series = d.hourly.time.map((t, i) => ({ t: Date.parse(`${t}:00Z`) - off, h: d.hourly.sea_level_height_msl[i] }));
      return { off, tz: d.timezone, turns: Solunar.tideTurns(series) };
    })
    .catch(() => ({ off: Math.round(lon / 15) * 3600e3, tz: null, turns: [] }));    // no tides: still show moon + sun
  TIDE_CACHE.set(key, p);
  return p;
}
async function bestTimesHtml(lat, lon, dayOff = 0) {
  const T = await tidesFor(lat, lon);
  const nowLocal = new Date(Date.now() + T.off);
  const t0 = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate() + dayOff) - T.off;   // local midnight
  const s = Solunar.summary(t0, lat, lon, T.turns);
  const hm = (t) => { const d = new Date(t + T.off); let h = d.getUTCHours(); const m = String(d.getUTCMinutes()).padStart(2, '0'), ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return `${h}:${m}${ap}`; };
  const pct = (t) => clamp((t - t0) / 864e5 * 100, 0, 100);
  const rise = s.events.find((x) => x.k === 'sunrise'), set = s.events.find((x) => x.k === 'sunset');
  const best = s.windows.length ? Math.max(...s.windows.map((w) => w.score)) : 0;
  let bar = '';
  if (rise) bar += `<i class="night" style="left:0;width:${pct(rise.t)}%"></i>`;
  if (set) bar += `<i class="night" style="left:${pct(set.t)}%;right:0"></i>`;
  for (const w of s.windows) bar += `<i class="${w.kind}${w.score === best ? ' best' : ''}" style="left:${pct(w.a)}%;width:${pct(w.b) - pct(w.a)}%"></i>`;
  for (const x of s.tides) if (x.t >= t0 && x.t < t0 + 864e5) bar += `<b class="tide" style="left:${pct(x.t)}%">${x.k === 'high' ? '▲' : '▼'}</b>`;
  if (dayOff === 0 && Date.now() > t0 && Date.now() < t0 + 864e5) bar += `<u style="left:${pct(Date.now())}%"></u>`;
  const label = { overhead: 'moon overhead', underfoot: 'moon underfoot', moonrise: 'moonrise', moonset: 'moonset' };
  const list = s.windows.map((w) => `<li class="${w.score === best ? 'best' : ''}">${w.score === best ? '★ ' : ''}<b>${w.kind === 'major' ? 'Major' : 'Minor'}</b> ${hm(w.a)}–${hm(w.b)} <small>${label[w.why]}${w.tags.length ? ` + ${w.tags.join(', ')}` : ''}</small></li>`).join('');
  const tides = s.tides.filter((x) => x.t >= t0 && x.t < t0 + 864e5).map((x) => `${x.k === 'high' ? 'High' : 'Low'} ${hm(x.t)}`).join(' · ');
  const dayName = dayOff === 0 ? 'Today' : dayOff === 1 ? 'Tomorrow' : new Date(t0 + T.off + 6e7).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `<div class="bt"><div class="bt-h"><span>${dayName}</span><span>${s.phase} ${Math.round(s.ill.fraction * 100)}% · ${'★'.repeat(s.stars)}${'☆'.repeat(4 - s.stars)}</span></div>
    <div class="bt-bar">${bar}</div><div class="bt-axis"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>
    <ol class="bt-list">${list || '<li>No solunar periods today</li>'}</ol>
    <div class="hint">${rise ? `Sunrise ${hm(rise.t)}` : ''}${set ? ` · Sunset ${hm(set.t)}` : ''}${tides ? `<br>Tides: ${tides}` : ''}<br>★ = best window (lines up with dawn/dusk or a tide change). Stars: new/full moon days rate highest.</div></div>`;
}
// A best-times card with Today / Tomorrow / +2 tabs, rendered into an element
function mountBestTimes(el, lat, lon) {
  let day = 0;
  const draw = async () => {
    el.innerHTML = `<div class="bt-tabs">${['Today', 'Tomorrow', '+2 days'].map((t, i) => `<button data-d="${i}" class="${i === day ? 'on' : ''}">${t}</button>`).join('')}</div><div class="bt-body">Loading…</div>`;
    el.querySelectorAll('.bt-tabs button').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); day = +b.dataset.d; draw(); }; });
    try { el.querySelector('.bt-body').innerHTML = await bestTimesHtml(lat, lon, day); } catch (e) { el.querySelector('.bt-body').textContent = 'Couldn\'t work out times right now.'; }
  };
  draw();
}

// ---------- Weather forecast (Open-Meteo: free, no key; GFS/ECMWF-style wind + wave models) ----------
const WX = { grid: null, key: '' };
// Open-Meteo answers {"error":true,"reason":...} when busy; retry twice, then report it plainly
async function omJson(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchOnce(url, 15000), j = await r.json();
      if (r.ok && !j.error) return j;
      last = new Error(j.reason ? `weather service: ${j.reason.toLowerCase()}` : `weather service ${r.status}`);
    } catch (e) { last = new Error('weather service not responding'); }
    await new Promise((z) => setTimeout(z, 1500 * (i + 1)));
  }
  throw last;
}
async function loadWx() {
  const b = map.getBounds().pad(0.15), cols = clamp(Math.round(map.getSize().x / 75), 5, 13), rows = clamp(Math.round(cols * (b.getNorth() - b.getSouth()) / (b.getEast() - b.getWest())), 4, 13);
  const lats = [], lons = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    lats.push((b.getSouth() + j * (b.getNorth() - b.getSouth()) / (rows - 1)).toFixed(3));
    lons.push((b.getWest() + i * (b.getEast() - b.getWest()) / (cols - 1)).toFixed(3));
  }
  const key = `${lats[0]},${lons[0]},${lats[lats.length - 1]},${lons[lons.length - 1]},${new Date().toISOString().slice(0, 13)}`;
  if (WX.key === key && WX.grid) return;
  const qs = `latitude=${lats.join(',')}&longitude=${lons.join(',')}&forecast_days=7&timezone=GMT`;
  const [w, m] = await Promise.all([
    omJson(`https://api.open-meteo.com/v1/forecast?${qs}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`),
    omJson(`https://marine-api.open-meteo.com/v1/marine?${qs}&hourly=wave_height,wave_direction,wave_period`).catch(() => null),
  ]);
  const W = Array.isArray(w) ? w : [w], M = m ? (Array.isArray(m) ? m : [m]) : [];
  WX.grid = { cols, rows, lat0: b.getSouth(), lon0: b.getWest(), dlat: (b.getNorth() - b.getSouth()) / (rows - 1), dlon: (b.getEast() - b.getWest()) / (cols - 1),
    t0: W[0].hourly.time[0] + ':00Z', n: W[0].hourly.time.length, W, M };
  WX.key = key;
}
// hours from the model's first time step to "now"
const wxNowIdx = () => (WX.grid ? Math.max(0, Math.round((Date.now() - new Date(WX.grid.t0)) / 3600e3)) : 0);
function buildWx() {
  const G = WX.grid; if (!G) return;
  const h = clamp(wxNowIdx() + S.wxH, 0, G.n - 1), nx = G.cols, ny = G.rows, v = new Float32Array(nx * ny).fill(NaN), dir = new Float32Array(nx * ny).fill(NaN), gust = new Float32Array(nx * ny).fill(NaN), per = new Float32Array(nx * ny).fill(NaN);
  for (let k = 0; k < nx * ny; k++) {
    if (S.wxMode === 'waves') {
      const mm = G.M[k]?.hourly; if (!mm) continue;
      const ht = mm.wave_height[h]; if (ht == null) continue;
      v[k] = ht * 3.28084; dir[k] = mm.wave_direction[h]; per[k] = mm.wave_period[h];
    } else {
      const ww = G.W[k]?.hourly; if (!ww) continue;
      v[k] = ww.wind_speed_10m[h]; dir[k] = ww.wind_direction_10m[h]; gust[k] = ww.wind_gusts_10m[h];
    }
  }
  S.data.wx = { nx, ny, lat0: G.lat0, lon0: G.lon0, dlat: G.dlat, dlon: G.dlon, v, dir, gust, per, date: new Date(new Date(G.t0).getTime() + h * 3600e3).toISOString().slice(0, 10), times: [new Date(new Date(G.t0).getTime() + h * 3600e3).toISOString()] };
}
// wind barbs-lite: an arrow pointing the way the wind/waves are GOING, with the number
function drawWx(ctx) {
  const g = S.data.wx; if (!g) return;
  ctx.save(); ctx.font = '700 10.5px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // keep arrows ~70 px apart on screen whatever the zoom: zoomed out, skip points instead of piling them up
  const p0 = project(g.lat0, g.lon0), px = project(g.lat0, g.lon0 + g.dlon), py = project(g.lat0 + g.dlat, g.lon0);
  const si = Math.max(1, Math.ceil(70 / Math.max(1, Math.abs(px[0] - p0[0])))), sj = Math.max(1, Math.ceil(60 / Math.max(1, Math.abs(py[1] - p0[1]))));
  for (let j = 0; j < g.ny; j += sj) for (let i = 0; i < g.nx; i += si) {
    const k = j * g.nx + i, val = g.v[k]; if (val !== val) continue;
    const [x, y] = project(g.lat0 + j * g.dlat, g.lon0 + i * g.dlon), to = (g.dir[k] + 180) * Math.PI / 180;   // "from" -> "toward"
    const L0 = 22, dx = Math.sin(to) * L0 / 2, dy = -Math.cos(to) * L0 / 2;
    for (const [c, lw] of [['rgba(0,0,0,.8)', 3.6], ['#fff', 1.6]]) {
      ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
      const a = Math.atan2(dy, dx); ctx.lineTo(x + dx - Math.cos(a - 0.5) * 6, y + dy - Math.sin(a - 0.5) * 6); ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx - Math.cos(a + 0.5) * 6, y + dy - Math.sin(a + 0.5) * 6); ctx.stroke();
    }
    const lbl = S.wxMode === 'waves' ? `${val.toFixed(1)}'${g.per[k] ? `@${Math.round(g.per[k])}s` : ''}` : `${Math.round(val)}${g.gust[k] ? `g${Math.round(g.gust[k])}` : ''}`;
    haloText(ctx, lbl, x, y + 16, '#fff', 'rgba(0,0,0,.8)');
  }
  ctx.restore();
}
// Point forecast for "Forecast here": next 48 h every 3 h, colored for fishability
async function spotForecast(lat, lon) {
  const qs = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&forecast_days=4&timezone=America%2FNew_York`;
  const [w, m] = await Promise.all([
    omJson(`https://api.open-meteo.com/v1/forecast?${qs}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability&wind_speed_unit=kn`),
    omJson(`https://marine-api.open-meteo.com/v1/marine?${qs}&hourly=wave_height,wave_direction,wave_period`).catch(() => null),
  ]);
  const t = w.hourly.time, now = Date.now(), dirTxt = (d) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((d % 360) + 360) % 360 / 45) % 8];
  let rows = '', lastDay = '';
  for (let i = 0; i < t.length; i += 3) {
    const tt = new Date(t[i] + (t[i].length === 16 ? ':00' : '')); if (tt < now - 3 * 3600e3) continue;
    if (rows.split('<tr').length > 17) break;
    const ws = w.hourly.wind_speed_10m[i], gs = w.hourly.wind_gusts_10m[i], wd = w.hourly.wind_direction_10m[i];
    const wh = m?.hourly?.wave_height?.[i], wp = m?.hourly?.wave_period?.[i];
    const ft = wh != null ? wh * 3.28084 : null, rain = w.hourly.precipitation_probability?.[i];
    const cls = ws > 20 || (ft != null && ft > 6) ? 'bad' : ws > 14 || (ft != null && ft > 4) ? 'meh' : 'good';
    const day = t[i].slice(0, 10), dayLbl = day !== lastDay ? new Date(t[i]).toLocaleDateString('en-US', { weekday: 'short' }) : ''; lastDay = day;
    rows += `<tr class="${cls}"><td>${dayLbl}</td><td>${new Date(t[i]).toLocaleTimeString('en-US', { hour: 'numeric' })}</td><td>${dirTxt(wd)} ${Math.round(ws)}<small> g${Math.round(gs)}</small></td><td>${ft != null ? `${ft.toFixed(1)}'<small> ${Math.round(wp)}s</small>` : '–'}</td><td>${rain != null ? `${rain}%` : ''}</td></tr>`;
  }
  return `<table class="wxt"><tr><th></th><th>ET</th><th>Wind kt</th><th>Seas</th><th>Rain</th></tr>${rows}</table><div class="hint">Green: under 15 kt and 4 ft. Open-Meteo wind and wave models.</div>`;
}

// ---------- Forecasts: currents (Copernicus ocean model, 6-hourly, ~9 days) + where today's temp features drift ----------
const FC_MAX = { cur: 168, sst: 72, goes: 72 };   // how far ahead each chart can go (hours)
const fcBase = () => { const d = new Date(); d.setUTCMinutes(0, 0, 0); d.setUTCHours(Math.floor(d.getUTCHours() / 6) * 6); return d; };
const fcTime = (h) => new Date(fcBase().getTime() + h * 3600e3).toISOString().slice(0, 13) + ':00:00Z';
const FC_CACHE = new Map();
async function fcFrame(h, win) {
  const t = fcTime(h), key = `${t}|${win.s},${win.n},${win.w},${win.e}`;
  if (FC_CACHE.has(key)) return FC_CACHE.get(key);
  const ok = (x) => (Math.abs(x) < 3 ? x : NaN);
  const p = Promise.all([loadCmems(CM.uo6, win, t, 260), loadCmems(CM.vo6, win, t, 260)]).then(([u, v]) => ({ ...u, u: u.v.map(ok), vv: v.v.map(ok), time: t }));
  FC_CACHE.set(key, p); p.catch(() => FC_CACHE.delete(key));
  return p;
}
// Carry today's temps forward with the forecast currents (backward trajectories, 2-hour steps). The water keeps its
// temperature; only its position changes. So breaks, eddy edges and warm tongues move; nothing warms or cools.
function computeDrift(base, frames, H) {
  const stepDeg = Math.max(base.dlon, (base.nx - 1) * base.dlon / 200);
  const nx = Math.max(2, Math.round((base.nx - 1) * base.dlon / stepDeg) + 1), ny = Math.max(2, Math.round((base.ny - 1) * base.dlat / stepDeg) + 1);
  const g = { nx, ny, lat0: base.lat0, lon0: base.lon0, dlat: (base.ny - 1) * base.dlat / (ny - 1), dlon: (base.nx - 1) * base.dlon / (nx - 1), v: new Float32Array(nx * ny).fill(NaN) };
  const vel = (la, lo, t) => {
    const f = clamp(t / 6, 0, frames.length - 1), k = Math.min(frames.length - 2, Math.floor(f)), a = f - k, A = frames[k], B = frames[Math.max(k + 1, 0)] || A;
    const u = (1 - a) * sample(A, la, lo, A.u) + a * sample(B, la, lo, B.u), v = (1 - a) * sample(A, la, lo, A.vv) + a * sample(B, la, lo, B.vv);
    return u === u && v === v ? [v * 3600 / 111320, u * 3600 / (111320 * Math.cos(la * Math.PI / 180))] : null;   // deg per hour
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let la = g.lat0 + j * g.dlat, lo = g.lon0 + i * g.dlon;
    if (sample(base, la, lo) !== sample(base, la, lo)) continue;
    for (let t = H; t > 0; t -= 2) {
      const dt = Math.min(2, t), v1 = vel(la, lo, t); if (!v1) break;
      const v2 = vel(la - v1[0] * dt / 2, lo - v1[1] * dt / 2, t - dt / 2) || v1;
      la -= v2[0] * dt; lo -= v2[1] * dt;
    }
    g.v[j * nx + i] = sample(base, la, lo);
  }
  return { ...g, date: fcTime(H).slice(0, 10), times: [fcTime(H)], drifted: true };
}
async function applyForecast() {
  if (!S.fc) { S.data.curfc = null; S.data.drift = null; return; }
  if (S.prod === 'cur') {
    S.data.curfc = await fcFrame(S.fc, windowFor(0.083, 300));
  } else if (PRODUCTS[S.prod].sst && S.data[S.prod]) {
    const win = windowFor(0.083, 300), hours = []; for (let h = 0; h <= S.fc; h += 6) hours.push(h);
    status(`Forecasting where today's temps will be in ${S.fc} h…`);
    const frames = await Promise.all(hours.map((h) => fcFrame(h, win)));
    S.data.curfc = frames[frames.length - 1];
    S.data.drift = computeDrift(S.data[S.prod], frames, S.fc);
    buildSstGeo(S.data.drift);
  }
}

let loading = 0;
async function refresh() {
  const my = ++loading, p = PRODUCTS[S.prod];
  status(`Loading ${p.name.toLowerCase()}…`);
  try {
    const jobs = [];
    const add = (name, pr) => jobs.push(pr.catch((e) => { console.error(name, e); e.message = `${name}: ${e.message}`; throw e; }));
    // Draw each piece the moment it lands instead of waiting for everything
    const partial = () => { if (my !== loading) return; autoRange(); renderRaster(); renderRelief(); drawLegend(); chart.draw(); updateDate(); };
    if (!covers(S.data.bathy, 1 / 240, 620)) add('depth chart', loadBathy().then(() => { if (my === loading) { renderRelief(); chart.draw(); } }));
    const fresh = (k) => { const pp = PRODUCTS[k]; return covers(S.data[k], pp.res, pp.cells) && (!pp.family || S.data[k].src === S.src[pp.family]); };
    if (!p.computed && !fresh(S.prod)) add(p.name.toLowerCase(), loadGrid(S.prod).then((g) => { S.data[S.prod] = g; if (p.sst) buildSstGeo(g); partial(); status('Loading overlays…'); }));
    else if (p.sst && S.data[S.prod]) buildSstGeo(S.data[S.prod]);
    if (S.prod === 'ftle') add('currents', loadCurrents(6).then((c) => { S.data.cur6 = c; S.data.ftle = computeFtle(c); }));
    const fishy = S.prod === 'fish' || S.prod === 'ana';
    const needSsh = (S.ov.rings && ['ssh', 'sst', 'goes', 'ftle', 'cur', 'sss'].includes(S.prod)) || fishy;
    if (needSsh && S.prod !== 'ssh' && !covers(S.data.ssh, 0.25, 999)) add('eddy rings', loadGrid('ssh').then((g) => { S.data.ssh = g; }));
    const needCur = S.ov.cur || S.prod === 'cur' || fishy;
    if (fishy && !S.date && !covers(S.data.goes, PRODUCTS.goes.res, PRODUCTS.goes.cells)) jobs.push(loadGrid('goes').then((g) => { S.data.goes = g; }).catch((e) => console.warn('hourly SST for fish', e)));
    if (needCur && (!covers(S.data.curb, 0.25, 999) || (S.data.curb.model || 'sat') !== (S.date ? 'sat' : S.curSrc))) add('currents', loadCurrents(1).then((c) => { S.data.curb = c; }));
    if (needCur && !covers(S.data.hf, 0.055, 320)) jobs.push(loadHF(false).then((h) => { S.data.hf = h; }).catch((e) => { console.warn('HF radar', e); S.data.hf = null; }));
    if (needCur && map.getZoom() >= 9 && !covers(S.data.hf1, 0.009, 320)) jobs.push(loadHF(true).then((h) => { S.data.hf1 = h; }).catch((e) => { console.warn('HF radar 1 km', e); S.data.hf1 = null; }));
    if (S.prod === 'wx') add('weather', loadWx().then(() => buildWx()));
    if (fishy) {
      if (!covers(S.data.sst, PRODUCTS.sst.res, PRODUCTS.sst.cells) || S.data.sst?.src !== S.src.sst) add('water temp', loadGrid('sst').then((g) => { S.data.sst = g; }));
      if (!covers(S.data.chl, PRODUCTS.chl.res, PRODUCTS.chl.cells) || S.data.chl?.src !== S.src.chl) jobs.push(loadGrid('chl').then((g) => { S.data.chl = g; }).catch(() => {}));
    } else if (S.prod !== 'sst' && !S.data.sst) jobs.push(loadGrid('sst').then((g) => { S.data.sst = g; }).catch(() => {}));
    const res = await Promise.allSettled(jobs);
    if (my !== loading) return;
    let fail = res.find((r) => r.status === 'rejected');
    try { await applyForecast(); } catch (e) { console.error('forecast', e); fail = { reason: new Error(`forecast: ${e.message}`) }; }
    if (my !== loading) return;
    if (S.prod === 'cur') buildCurGrid();
    if (fishy) buildFish();
    if (S.prod === 'ana') buildAnalysis();
    $('fishPanel').hidden = S.prod !== 'fish' || S.fishCollapsed;
    $('anaPanel').hidden = S.prod !== 'ana' || S.anaCollapsed;
    if (S.prod === 'fish') showFishTimes();
    if (needSsh && S.data.ssh && S.prod !== 'fish') buildRings(S.data.ssh); else S.geo.rings = [];
    if (S.prod === 'ana') renderAnalysis();
    autoRange(); renderRaster(); renderRelief(); drawLegend(); chart.draw(); updateDate();
    const gg = S.data[S.prod];
    if (fail) status(`Some data didn't load (${fail.reason.message}).`, true);
    else if (S.fc > 0 && p.sst) status(`Today's temps moved ${S.fc} h by the forecast currents: breaks and eddy edges shift; the water itself doesn't warm or cool here.`);
    else if (S.fc > 0) status('Ocean-model current forecast (Copernicus, 9 km). HF radar and satellite only show now.');
    else if (gg?.comp && p.family) status(`${gg.comp === 1 ? '1-day' : '3-day'} composite: ${gg.looks} satellite looks stacked, ${gg.coverPct}% of the area covered${gg.noPolar && p.family === 'sst' ? " (GOES only: NOAA's polar-pass server didn't answer)" : ''}. ${p.family === 'sst' ? 'Each spot shows the warm end of its clear readings (clouds read cold).' : 'Each spot is the average of its clear readings.'}`);
    else if (p.hourly && gg && gg.anyPct < 3) status('Clouds: GOES has had almost no clear view here in the last 24 hours. Use daily Temp.', true);
    else if (p.hourly && gg) status(`${gg.clearPct}% clear this hour · rest filled from the last 24 h`);
    else if (S.prod === 'mld' && gg && !gg.via && viewValues(gg).length < 0.3 * gg.nx * gg.ny * 0.5) status('NOAA only computes mixed layer depth in warm (Gulf Stream) water; blank elsewhere.', true);
    else status('');
  } catch (e) {
    console.error(e); if (my === loading) status(`Couldn't load data (${e.message}).`, true);
  }
}

// ---------- UI ----------
function updateDate() {
  const p = PRODUCTS[S.prod], g = S.data[S.prod];
  $('datebar').classList.toggle('static', S.prod === 'bottom');
  if (S.prod === 'bottom') { $('dLabel').textContent = 'Seafloor · NOAA ETOPO 2022'; return; }
  $('wxMode').hidden = S.prod !== 'wx';
  $('curMode').hidden = S.prod !== 'cur' || S.fc > 0;
  $('zMode').hidden = !PRODUCTS[S.prod].zlev;
  if (S.prod === 'wx') {
    const t = S.data.wx?.times?.[0];
    $('dLabel').textContent = S.wxH ? `${t ? niceHour(t) : ''} (+${S.wxH} h)` : `Now${t ? ` · ${niceHour(t)}` : ''}`;
    $('dPrev').disabled = S.wxH <= 0; $('dNext').disabled = S.wxH >= 165; $('dLatest').hidden = !S.wxH; $('dLatest').textContent = 'Now';
    return;
  }
  $('dPrev').disabled = false;
  // Where to fish is "as of now": label it with the newest hourly temp and current it used, not yesterday's daily map
  if ((S.prod === 'fish' || S.prod === 'ana') && !S.date) {
    const th = S.data.goes?.times?.slice(-1)[0], tc = S.data.hf?.time;
    const t = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'America/New_York' });
    $('dLabel').textContent = `Now · temps ${th ? t(th) : 'daily'}${tc ? ` · current ${t(tc)}` : ''} ET`;
    $('dNext').disabled = true; $('dLatest').hidden = true; return;
  }
  const canFc = FC_MAX[S.prod] && !S.date && !S.hour;   // at "latest", ▶ steps into the forecast
  $('datebar').classList.toggle('forecast', S.fc > 0);
  if (S.fc > 0) {
    $('dLabel').textContent = `Forecast ${niceHour(fcTime(S.fc))} (+${S.fc} h)`;
    $('dNext').disabled = S.fc >= FC_MAX[S.prod]; $('dLatest').hidden = false; $('dLatest').textContent = 'Now';
    return;
  }
  $('dLatest').textContent = 'Latest';
  if (p.hourly) {
    const t = g?.times?.length ? g.times[g.times.length - 1] : S.hour;
    $('dLabel').textContent = t ? niceHour(t) : 'Latest';
    $('dNext').disabled = !canFc && (!S.hour || (S.latestHour && S.hour >= S.latestHour));
    $('dLatest').hidden = !S.hour;
  } else {
    const shown = g?.date || S.date;
    $('dLabel').textContent = shown ? nice(shown) : 'Latest';
    $('dNext').disabled = !canFc && !S.date;
    $('dLatest').hidden = !S.date;
  }
  $('dNext').title = canFc ? 'Forecast: step ahead 6 hours' : 'Next';
}
function invalidateTimeData() { for (const k of ['sst', 'goes', 'chl', 'ssh', 'mld', 'cur', 'curb', 'hf', 'hf1', 'cur6', 'ftle', 'sss', 'o2', 'fish', 'ana']) delete S.data[k]; S.geo.iso = []; S.geo.breaks = []; }

// ---------- Chart picker: thumbnails of every source x day for the current view ----------
const PK = { fam: 'sst', items: [], token: 0 };
function pickerItems(fam) {
  const today = S.date ? addDays(S.date, 1) : isoDate(new Date()), items = [];
  if (fam === 'goes') {
    const end = S.latestHour || hourAdd(new Date().toISOString(), -5);
    for (let h = 0; h < 12; h++) { const t = hourAdd(end, -h); items.push({ fam, key: 'goes', t, label: 'GOES-19 hourly', when: niceHour(t), s: { host: 'aoml', id: 'goes19SSThourly', v: 'sst', res: 0.02, asc: true } }); }
    return items;
  }
  const days = fam === 'sst' ? 4 : 7;
  for (const [key, s] of Object.entries(SRC[fam])) {
    for (let d = 1; d <= days; d++) {
      if (s.comp) { if (d === 1) items.push({ fam, key, day: null, t: null, latest: true, label: s.label, who: s.who, when: s.comp === 1 ? 'Last 24 h' : 'Last 3 days', s }); continue; }
      if (key === 'dineof' && d > 1) break;      // gap-filled: just the latest blend
      const day = addDays(today, -d);
      items.push({ fam, key, day: key === 'dineof' ? null : day, t: key === 'dineof' ? null : `${day}T${s.t}`, label: s.label, who: s.who, when: key === 'dineof' ? 'Latest' : nice(day), s });
    }
  }
  return items.sort((a, b) => !!b.s.comp - !!a.s.comp);   // composites lead the grid
}
function openPicker(fam = PK.fam) {
  PK.fam = fam; const my = ++PK.token;
  $('picker').hidden = false;
  document.querySelectorAll('#pkTabs button').forEach((b) => b.classList.toggle('on', b.dataset.fam === fam));
  const b = map.getBounds(), view = { s: +b.getSouth().toFixed(2), n: +b.getNorth().toFixed(2), w: +b.getWest().toFixed(2), e: +b.getEast().toFixed(2) };
  const aspect = (merc(view.n) - merc(view.s)) / ((view.e - view.w) * Math.PI / 180);
  PK.items = pickerItems(fam); PK.view = view; PK.aspect = aspect;
  const grid = $('pkGrid'); grid.innerHTML = ''; PK.rng = null;
  const vkey = [view.s, view.n, view.w, view.e].map((x) => Math.round(x * 2) / 2).join(',');
  // Only fetch what you can see (plus a screen ahead); fast servers get more parallel requests than slow ones
  const queue = [], busy = { cw: 0, other: 0 };
  const pump = () => {
    if (my !== PK.token) return;
    for (let i = 0; i < queue.length; i++) {
      const it = queue[i], slow = !it.s.cm && it.s.host === 'cw';
      if (slow ? busy.cw >= 2 : busy.other >= 6) continue;
      queue.splice(i--, 1); slow ? busy.cw++ : busy.other++;
      loadThumb(it, vkey).finally(() => { slow ? busy.cw-- : busy.other--; pump(); });
    }
  };
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); const it = e.target._it; if (!it.started) { it.started = true; queue.push(it); } }
    // fast sources first
    queue.sort((a, b) => (a.s.cm ? 0 : a.s.host === 'cw' ? 2 : 1) - (b.s.cm ? 0 : b.s.host === 'cw' ? 2 : 1));
    pump();
  }, { root: $('picker'), rootMargin: '400px' });
  for (const it of PK.items) {
    const card = document.createElement('button'); card.className = 'pk';
    card.innerHTML = `<canvas width="160" height="${Math.round(160 * aspect)}"></canvas><b>${it.label}</b><small>${it.when}${it.who ? ` · ${it.who}` : ''}</small><em>loading…</em>`;
    card.onclick = () => choosePicked(it);
    card._it = it; it.el = card; grid.appendChild(card); io.observe(card);
  }
}
const THUMBS = new Map();   // thumbnails already fetched this session, so reopening the picker is instant
// ---------- Prefetched charts (hourly GitHub Action -> live/*.png on the CDN) ----------
// Where the hourly snapshots live: GitHub Pages in production, the local folder when testing
const LIVE_BASE = /^(localhost|127\.)/.test(location.hostname) ? 'live/' : 'https://tcsudbrink.github.io/breakline/live/';
let PRE = null;
async function loadManifest() {
  try { const r = await fetch(`${LIVE_BASE}manifest.json?t=${Math.floor(Date.now() / 600000)}`); if (r.ok) { PRE = await r.json(); return; } } catch (e) { /* no signal: the offshore pack's copy below */ }
  try { const r = 'caches' in window && await caches.match(`${LIVE_BASE}manifest.json`, { ignoreSearch: true }); if (r && !PRE) PRE = await r.json(); } catch (e) { /* none saved */ }
}
const preReady = loadManifest(); setInterval(loadManifest, 15 * 60 * 1000);
// which prefetch box holds this window (all of it)
function preZone(v) {
  for (const [k, b] of Object.entries(PRE?.zones || PRE_BOX)) if (v.s >= b.s && v.n <= b.n && v.w >= b.w && v.e <= b.e) return k;
  return null;
}
function preEntry(id) { return PRE?.items?.[id] || null; }
// smallest saved-copy box holding a point
function preZoneAt(ll) {
  const boxes = Object.entries(PRE?.zones || PRE_BOX).filter(([, b]) => ll.lat >= b.s && ll.lat <= b.n && ll.lng >= b.w && ll.lng <= b.e);
  boxes.sort((a, c) => (a[1].n - a[1].s) * (a[1].e - a[1].w) - (c[1].n - c[1].s) * (c[1].e - c[1].w));
  return boxes[0]?.[0] || null;
}
// newest prefetched day for a source in a zone
function preLatest(zone, fam, key) {
  const pre = `${zone}/${fam}/${key}/`, days = Object.keys(PRE?.items || {}).filter((k) => k.startsWith(pre) && !PRE.items[k].none).sort();
  return days.length ? days[days.length - 1] : null;
}
const PRE_CACHE = new Map();
async function preGrid(entry, conv) {
  if (PRE_CACHE.has(entry.file)) return PRE_CACHE.get(entry.file);
  const r = await fetch(`${LIVE_BASE}${entry.file}`); if (!r.ok) throw new Error('prefetched file missing');
  const bmp = await createImageBitmap(await r.blob()), c = document.createElement('canvas'); c.width = entry.nx; c.height = entry.ny;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, entry.nx, entry.ny).data, [lo0, hi0, log] = PRE.enc[entry.enc];
  const lo = log ? Math.log10(lo0) : lo0, hi = log ? Math.log10(hi0) : hi0, nx = entry.nx, ny = entry.ny, v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {         // PNG is north-up; grid rows run south->north
    const q8 = px[((ny - 1 - j) * nx + i) * 4];
    if (q8 <= 1) { v[j * nx + i] = NaN; continue; }   // 0 = no data; 1 = pinned at the floor (the polar passes' cloud/land fill lands here)
    const x = lo + (q8 - 1) / 254 * (hi - lo); v[j * nx + i] = conv(log ? 10 ** x : x);
  }
  const g = { nx, ny, v, lat0: entry.lat0 + (ny - 1) * entry.dlat, dlat: -entry.dlat, lon0: entry.lon0, dlon: entry.dlon, times: [entry.time], date: entry.time.slice(0, 10), pre: true };
  PRE_CACHE.set(entry.file, g);
  return g;
}
// For the main chart: use the prefetched grid when zoomed out over a prefetched zone
// force = the live source failed: use the saved copy at any zoom, for the zone under the middle of the screen
const PRE_LATEST = { ssh: 'ssh/blend', mld: 'mld/ohc', sss: 'sss/smap' };
async function preForView(prod, force) {
  // Hourly GOES (and the composites built on it) only exist as Breakline's saved copy now: NOAA dropped the hourly
  // feed from ERDDAP in Nov 2026, and the prefetch builds it from the satellite's own files. So use it at any zoom.
  const savedOnly = prod === 'goes' || (PRODUCTS[prod].family && curSrc(PRODUCTS[prod].family).comp);
  if (!force && !savedOnly && map.getZoom() > 8) return null;
  await preReady; if (!PRE) return null;
  const b = map.getBounds(), zone = force ? preZoneAt(map.getCenter()) : preZone({ s: b.getSouth(), n: b.getNorth(), w: b.getWest(), e: b.getEast() }); if (!zone) return null;
  const p = PRODUCTS[prod];
  if (p.zlev && S.zlev) return null;              // saved copies are surface only
  if (PRE_LATEST[prod]) {
    if (!force) return null;                     // live is sharper (Copernicus 8-14 km); the saved copy is the backup
    const e = preEntry(`${zone}/${PRE_LATEST[prod]}/latest`); if (!e?.file || (S.date && e.time.slice(0, 10) !== S.date)) return null;
    return { ...(await preGrid(e, p.conv)), win: { ...PRE_BOX[zone], pre: true, stride: 1 } };
  }
  if (prod === 'goes') {
    // newest-clear-pixel fill across the prefetched hours, same as live
    const hours = Object.keys(PRE.items).filter((k) => k.startsWith(`${zone}/goes/`) && !PRE.items[k].none).sort();
    const upto = S.hour ? hours.filter((k) => k.split('/')[2] <= S.hour) : hours;
    const pick = upto.slice(-24); if (!pick.length) return null;
    const grids = await Promise.all(pick.map((k) => preGrid(PRE.items[k], SST_C)));
    const last = grids[grids.length - 1], v = last.v.slice();
    for (let k = grids.length - 2; k >= 0; k--) { const sl = grids[k].v; for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) v[i] = sl[i]; }
    let fresh = 0, any = 0; for (let i = 0; i < v.length; i++) { if (last.v[i] === last.v[i]) fresh++; if (v[i] === v[i]) any++; }
    if (!S.hour) S.latestHour = pick[pick.length - 1].split('/')[2];
    return { ...last, v, times: pick.map((k) => k.split('/')[2]), clearPct: Math.round(100 * fresh / v.length), anyPct: Math.round(100 * any / v.length), win: { ...PRE_BOX[zone], pre: true, stride: 1 } };
  }
  if (!p.family) return null;
  const key = S.src[p.family], s = curSrc(p.family);
  if (s.comp) { if (S.date) return null; const g = await loadComposite(p.family, s.comp, null, zone); return g && { ...g, win: { ...PRE_BOX[zone], pre: true, stride: 1 }, src: key }; }
  if (s.cm && !force) return null;
  const k2 = s.cm ? 'dineof' : key;               // a Copernicus pick that failed: NOAA's gap-filled copy instead
  const id = S.date ? `${zone}/${p.family}/${k2}/${S.date}` : (k2 === 'dineof' ? `${zone}/chl/dineof/latest` : preLatest(zone, p.family, k2));
  const e = id && preEntry(id); if (!e || e.none) return null;
  const g = await preGrid(e, p.family === 'chl' ? CHL : SST_C);
  return { ...g, win: { ...PRE_BOX[zone], pre: true, stride: 1 }, src: key };
}

async function loadThumb(it, vkey) {
  const fam = PK.fam, view = PK.view, conv = fam === 'chl' ? CHL : SST_C, key = `${it.fam}|${it.key}|${it.day || it.t}|${vkey}`;
  try {
    await preReady;
    const zone = preZone(view), pid = zone && (it.fam === 'goes' ? `${zone}/goes/${it.t}` : `${zone}/${it.fam}/${it.key}/${it.key === 'dineof' ? 'latest' : it.day}`);
    const pe = pid && preEntry(pid);
    if (THUMBS.has(key)) it.g = THUMBS.get(key);
    else if (pe && pe.none) { it.el.querySelector('em').textContent = pe.cloud ? 'all cloud' : 'no pass that day'; it.el.classList.add('none'); return; }
    else if (pe) it.g = await preGrid(pe, conv);
    else if (it.s.comp) {
      const span = Math.max(view.n - view.s, view.e - view.w);
      it.g = (zone && !S.date && await loadComposite(fam, it.s.comp, null, zone)) || await loadComposite(fam, it.s.comp, { ...view, stride: Math.max(1, Math.ceil(span / it.s.res / 70)) }, null);
    }
    else if (it.s.cm) { const g = await loadCmems(CM[it.s.cm], view, it.day, 64); it.g = { ...g, v: g.v.map((x) => (x === x ? conv(x) : x)) }; }
    else {
      const span = Math.max(view.n - view.s, view.e - view.w), stride = Math.max(1, Math.ceil(span / it.s.res / 70));
      it.g = toGrid(parseAsc(await getText(srcUrl(it.s, { ...view, stride }, it.t))), it.s.v, conv);
      // ERDDAP snaps to the nearest date; if that isn't the day asked for, there was no pass that day
      if (it.day && it.g.date && it.g.date !== it.day) { it.g = null; it.el.querySelector('em').textContent = 'no pass that day'; it.el.classList.add('none'); return; }
    }
    THUMBS.set(key, it.g);
    drawThumbs(it);
  } catch (e) { it.el.querySelector('em').textContent = /not published|404/.test(e.message) ? 'not available' : e.message.replace(/ \(coastwatch\.noaa\.gov\)/, ''); it.el.classList.add('none'); }
}
// Draw one new thumbnail; redraw them all only when the shared color range has to widen
function drawThumbs(only) {
  const fam = PK.fam === 'goes' ? 'sst' : PK.fam, p = PRODUCTS[fam];
  if (only) {
    const v = Array.from(only.g.v).filter((x) => x === x).sort((a, b) => a - b);
    if (!v.length) { only.el.querySelector('em').textContent = 'all cloud'; only.el.classList.add('cloudy'); return; }
    const r = [v[Math.floor(v.length * 0.02)], v[Math.floor(v.length * 0.98)]];
    if (p.log) r[0] = Math.max(0.02, r[0]);
    const R = PK.rng;
    if (!R) { PK.rng = r; return drawThumbsAll([only]); }
    const span = p.log ? Math.log10(R[1] / R[0]) : R[1] - R[0];
    const grow = p.log ? Math.max(Math.log10(R[0] / r[0]), Math.log10(r[1] / R[1])) : Math.max(R[0] - r[0], r[1] - R[1]);
    if (grow > span * 0.15) { PK.rng = [Math.min(R[0], r[0]), Math.max(R[1], r[1])]; return drawThumbsAll(PK.items.filter((x) => x.g)); }
    return drawThumbsAll([only]);
  }
  drawThumbsAll(PK.items.filter((x) => x.g));
}
function drawThumbsAll(list) {
  const fam = PK.fam === 'goes' ? 'sst' : PK.fam, p = PRODUCTS[fam], lt = LUTS[fam], rng = PK.rng;
  if (!rng) return;
  const V = PK.view, y0 = merc(V.s), y1 = merc(V.n);
  for (const it of list) {
    if (!it.g) continue;
    const cv = it.el.querySelector('canvas'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, img = ctx.createImageData(W, H);
    let water = 0, clear = 0;
    for (let py = 0; py < H; py++) {
      const lat = imerc(y1 - (py + 0.5) / H * (y1 - y0));
      for (let px = 0; px < W; px++) {
        const lon = V.w + (px + 0.5) / W * (V.e - V.w), o = (py * W + px) * 4, z = sample(S.data.bathy, lat, lon);
        if (z === z && z >= 0) { img.data.set([43, 47, 51, 255], o); continue; }
        water++;
        const v = sample(it.g, lat, lon);
        if (v !== v) { img.data.set([20, 30, 44, 255], o); continue; }
        clear++;
        const i = Math.round(clamp(tOf(p, v, rng), 0, 1) * 255) * 3; img.data.set([lt[i], lt[i + 1], lt[i + 2], 255], o);
      }
    }
    ctx.putImageData(img, 0, 0);
    const pct = water ? Math.round(100 * clear / water) : 0;
    it.el.querySelector('em').textContent = it.key === 'dineof' ? `base ${nice(it.g.date)} + newer clear passes on load` : it.g.comp ? `${it.g.looks} looks · ${pct}% covered` : `${pct}% clear`;
    it.el.classList.toggle('cloudy', pct < 25);
  }
  $('pkScale').textContent = `Same color scale on every thumbnail: ${fmtTick(p, rng[0])} to ${fmtTick(p, rng[1])} ${p.unit}`;
}
function choosePicked(it) {
  if (it.el.classList.contains('none')) return;
  $('picker').hidden = true; PK.token++;
  if (it.fam === 'goes') { S.prod = 'goes'; S.hour = it.t; }
  else { S.prod = it.fam; S.src[it.fam] = it.key; store.set('src2', S.src); S.date = it.key === 'dineof' || it.latest ? null : it.day; }
  store.set('prod', S.prod); S.auto = true;
  document.querySelectorAll('.prod').forEach((x) => x.classList.toggle('active', x.dataset.prod === S.prod));
  invalidateTimeData(); refresh();
}
$('dPick').onclick = () => {
  if (!$('picker').hidden) { $('picker').hidden = true; PK.token++; return; }
  openPicker(['chl'].includes(S.prod) ? 'chl' : S.prod === 'goes' ? 'goes' : 'sst');
};
$('pkClose').onclick = () => { $('picker').hidden = true; PK.token++; };
document.querySelectorAll('#pkTabs button').forEach((b) => { b.onclick = () => openPicker(b.dataset.fam); });

// Hot-spot panel controls
// Species list follows the ocean on screen; each ocean remembers its own last pick
const spSel = $('species');
let spOcean = null, spKey = null;
// The ocean follows your home port (a Pacific port only gets Pacific fish); no port set -> what's on screen
function fishOcean() {
  const hp2 = PORTS.find((x) => x[0] === S.home);
  if (hp2) return oceanAt(hp2[1], hp2[2]);
  const c = map.getCenter(); return oceanAt(c.lat, c.lng);
}
function fillSpecies() {
  const ocean = fishOcean(), hp3 = PORTS.find((x) => x[0] === S.home), c0 = map.getCenter();
  const la = hp3 ? hp3[1] : c0.lat, lo = hp3 ? hp3[2] : c0.lng, list = speciesFor(ocean, la, lo), key = ocean + list.map(([k]) => k).join();
  if (key === spKey) return false;
  spOcean = ocean; spKey = key; spSel.innerHTML = '';
  for (const [lbl, ins] of [[ocean === 'pac' ? 'Offshore · Pacific' : 'Offshore', false], ['Inshore', true]]) {
    const og = document.createElement('optgroup'); og.label = lbl;
    for (const [k, v] of list) { if (!!v.inshore !== ins) continue; const o = document.createElement('option'); o.value = k; o.textContent = v.label; og.appendChild(o); }
    if (og.children.length) spSel.appendChild(og);
  }
  const keep = store.get(`species_${ocean}`, ocean === 'pac' ? 'dorado' : S.species);
  S.species = SPECIES[keep] && list.some(([k]) => k === keep) ? keep : list[0][0];
  spSel.value = S.species; syncAnaSpecies();
  return true;
}
function syncAnaSpecies() { const a = document.getElementById('anaSpecies'); if (!a) return; a.innerHTML = spSel.innerHTML; a.value = spSel.value; }
fillSpecies();
map.on('moveend', () => { if (fillSpecies() && (S.prod === 'fish' || S.prod === 'ana')) { buildFish(); if (S.prod === 'ana') { buildAnalysis(); renderAnalysis(); } autoRange(true); renderRaster(); drawLegend(); chart.draw(); } });
spSel.onchange = () => {
  S.species = spSel.value; store.set('species', S.species); store.set(`species_${spOcean}`, S.species); syncAnaSpecies(); queueHiDem();
  buildFish(); if (S.prod === 'ana') { buildAnalysis(); renderAnalysis(); } autoRange(true); renderRaster(); drawLegend(); chart.draw();
};
syncAnaSpecies();
$('anaSpecies').onchange = () => { spSel.value = $('anaSpecies').value; spSel.onchange(); };
document.querySelectorAll('#anaSeg button').forEach((b) => {
  b.onclick = () => {
    S.anaView = b.dataset.v;
    document.querySelectorAll('#anaSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('anaBody').hidden = S.anaView !== 'now'; $('anaTom').hidden = S.anaView !== 'tom';
    chart.draw();
  };
});
$('maxRun').value = S.maxRun; $('maxRunVal').textContent = `${S.maxRun} nm`;
$('maxRun').oninput = () => { S.maxRun = +$('maxRun').value; $('maxRunVal').textContent = `${S.maxRun} nm`; store.set('maxRun', S.maxRun); };
$('maxRun').onchange = () => { buildFish(); chart.draw(); };
$('depMin').value = S.fishDepth[0] ?? ''; $('depMax').value = S.fishDepth[1] ?? '';
const depChange = () => {
  const v = (x) => (x.value === '' ? null : Math.max(0, +x.value));
  S.fishDepth = [v($('depMin')), v($('depMax'))]; store.set('fishDepth', S.fishDepth); buildFish(); chart.draw();
};
$('depMin').onchange = depChange; $('depMax').onchange = depChange;
function stepTime(dir) {
  const p = PRODUCTS[S.prod], g = S.data[S.prod];
  // forecast steps: 6 hours at a time from "now" (no data reload needed for the base chart)
  if (S.prod === 'wx') { S.wxH = clamp(S.wxH + 3 * dir, 0, 165); buildWx(); autoRange(); renderRaster(); drawLegend(); chart.draw(); updateDate(); return; }
  if (FC_MAX[S.prod] && !S.date && !S.hour && (S.fc > 0 || dir > 0)) {
    S.fc = clamp(S.fc + 6 * dir, 0, FC_MAX[S.prod]); refresh(); return;
  }
  if (p.hourly) {
    const cur = S.hour || g?.times?.[g.times.length - 1] || S.latestHour; if (!cur) return;
    const next = hourAdd(cur, dir); S.hour = S.latestHour && next >= S.latestHour ? null : next;
  } else {
    const cur = S.date || g?.date; if (!cur) return;
    const next = addDays(cur, dir); S.date = next >= isoDate(new Date()) ? null : next;
  }
  invalidateTimeData(); refresh();
}
$('dPrev').onclick = () => stepTime(-1);
// Tap the date to open a calendar and jump to any day (back to 2002 for temps; 1993-1997 for the Copernicus archives)
const dp = $('datePick'); dp.max = isoDate(new Date()); dp.min = '2002-06-01';
$('dLabel').onclick = () => {
  if (S.prod === 'bottom' || S.prod === 'wx') return;
  dp.value = S.date || isoDate(new Date());
  try { dp.showPicker(); } catch (e) { dp.focus(); dp.click(); }
};
dp.onchange = () => {
  const d = dp.value; if (!d) return;
  S.fc = 0;
  if (PRODUCTS[S.prod].hourly) {      // hourly GOES only keeps ~5 days: older dates switch to the daily map
    if (d < addDays(isoDate(new Date()), -4)) { S.prod = 'sst'; store.set('prod', 'sst'); document.querySelectorAll('.prod').forEach((x) => x.classList.toggle('active', x.dataset.prod === 'sst')); S.hour = null; S.date = d; }
    else { S.hour = `${d}T12:00:00Z`; }
  } else S.date = d >= isoDate(new Date()) ? null : d;
  invalidateTimeData(); refresh();
};
$('dNext').onclick = () => stepTime(1);
$('dLatest').onclick = () => { if (S.fc) { S.fc = 0; refresh(); return; } S.date = null; S.hour = null; invalidateTimeData(); refresh(); };

// Currents source and depth level pickers
document.querySelectorAll('#curMode button').forEach((b) => {
  b.classList.toggle('on', b.dataset.m === S.curSrc);
  b.onclick = () => {
    S.curSrc = b.dataset.m; store.set('curSrc', S.curSrc);
    document.querySelectorAll('#curMode button').forEach((x) => x.classList.toggle('on', x === b));
    delete S.data.curb; delete S.data.cur; refresh();
  };
});
$('zLevel').innerHTML = ZLEV.map((z, i) => `<option value="${i}">${z.l}</option>`).join('');
$('zLevel').value = S.zlev;
$('zLevel').onchange = () => { S.zlev = +$('zLevel').value; store.set('zlev', S.zlev); delete S.data.sss; delete S.data.o2; S.auto = true; refresh(); };
document.querySelectorAll('#wxMode button').forEach((b) => {
  b.classList.toggle('on', b.dataset.m === S.wxMode);
  b.onclick = () => {
    S.wxMode = b.dataset.m; store.set('wxMode', S.wxMode); S.auto = true;
    document.querySelectorAll('#wxMode button').forEach((x) => x.classList.toggle('on', x === b));
    buildWx(); autoRange(true); renderRaster(); drawLegend(); chart.draw();
  };
});
let fishTimesFor = '';
function showFishTimes() {
  const hp3 = PORTS.find((x) => x[0] === S.home), el = $('fishTimes'); if (!el) return;
  if (!hp3) { el.innerHTML = ''; return; }
  if (fishTimesFor === S.home && el.innerHTML) return;
  fishTimesFor = S.home; $('fishTimesHdr').textContent = `Best times · ${S.home}`;
  mountBestTimes(el, hp3[1], hp3[2]);
}
function setFishCollapsed(c) {
  S.fishCollapsed = c; $('fishPanel').hidden = c || S.prod !== 'fish';
  document.querySelector('.prod[data-prod=fish]')?.classList.toggle('collapsed', c);
}
$('fishClose').onclick = () => setFishCollapsed(true);
function setAnaCollapsed(c) {
  S.anaCollapsed = c; $('anaPanel').hidden = c || S.prod !== 'ana';
  document.querySelector('.prod[data-prod=ana]')?.classList.toggle('collapsed', c);
}
$('anaClose').onclick = () => setAnaCollapsed(true);
$('anaCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($(S.anaView === 'tom' ? 'anaTom' : 'anaBody').innerText); $('anaCopy').textContent = 'Copied'; setTimeout(() => { $('anaCopy').textContent = 'Copy write-up'; }, 1500); }
  catch (e) { status('The browser blocked copying.', true); }
};
document.querySelectorAll('.prod').forEach((b) => {
  b.classList.toggle('active', b.dataset.prod === S.prod);
  b.onclick = () => {
    // tapping Where to fish again just tucks the list away; the numbered spots stay on the chart
    if (b.dataset.prod === 'fish' && S.prod === 'fish') { setFishCollapsed(!S.fishCollapsed); return; }
    if (b.dataset.prod === 'fish') S.fishCollapsed = false;
    if (b.dataset.prod === 'ana' && S.prod === 'ana') { setAnaCollapsed(!S.anaCollapsed); return; }
    if (b.dataset.prod === 'ana') S.anaCollapsed = false;
    S.prod = b.dataset.prod; store.set('prod', S.prod); S.auto = true;
    if (S.fc && !FC_MAX[S.prod]) S.fc = 0; else if (S.fc) S.fc = Math.min(S.fc, FC_MAX[S.prod]);
    document.querySelectorAll('.prod').forEach((x) => x.classList.toggle('active', x === b));
    if (reliefLayer) { map.removeLayer(reliefLayer); reliefLayer = null; }
    refresh();
  };
});

function togglePanel(id, btn) {
  const el = $(id), open = el.hidden;
  ['layers', 'wpts', 'fwPanel'].forEach((x) => { $(x).hidden = true; });
  ['btnLayers', 'btnWpts', 'btnFind'].forEach((x) => $(x).classList.remove('open'));
  el.hidden = !open; btn.classList.toggle('open', open);
}
$('btnLayers').onclick = () => togglePanel('layers', $('btnLayers'));
$('btnWpts').onclick = () => togglePanel('wpts', $('btnWpts'));

document.querySelectorAll('[data-ov]').forEach((cb) => {
  cb.checked = !!S.ov[cb.dataset.ov];
  cb.onchange = () => {
    S.ov[cb.dataset.ov] = cb.checked; store.set('ov', S.ov);
    if (['cur', 'rings'].includes(cb.dataset.ov) && cb.checked) refresh();
    if (cb.dataset.ov === 'relief') renderRelief();
    if (cb.dataset.ov === 'iso' && cb.checked && PRODUCTS[S.prod].sst && S.data[S.prod]) buildSstGeo(S.data[S.prod]);
    if (cb.dataset.ov === 'buoys') drawBuoys();
    if (cb.dataset.ov === 'enc') syncEnc();
    if (cb.dataset.ov === 'drop') queueHiDem();
    chart.draw();
  };
});
// Slider reads "sensitivity": right = more breaks (lower threshold)
const brkMin = 0.1, brkMax = 1.5;
$('brkThr').value = brkMax + brkMin - S.brk; $('brkVal').textContent = `${S.brk.toFixed(2)}°F/nm`;
$('brkThr').oninput = () => {
  S.brk = +(brkMax + brkMin - +$('brkThr').value).toFixed(2); $('brkVal').textContent = `${S.brk.toFixed(2)}°F/nm`;
  store.set('brk2', S.brk); buildBreaks(); chart.draw();
};

const gm = $('gridMode'); gm.value = S.grid;
const showTdRow = () => { $('tdRow').style.display = S.grid === 'td' || S.grid === 'both' ? '' : 'none'; };
showTdRow();
gm.onchange = () => { S.grid = gm.value; store.set('grid', S.grid); showTdRow(); chart.draw(); };
const tp = $('tdPair');
for (const [k, l] of [['XY', 'X & Y — Nantucket / Carolina Beach (26xxx / 42xxx)'], ['WX', 'W & X — Caribou / Nantucket (13xxx / 26xxx)'],
  ['WY', 'W & Y — Caribou / Carolina Beach (13xxx / 42xxx)'], ['YZ', 'Y & Z — Carolina Beach / Dana (42xxx / 59xxx)'], ['XZ', 'X & Z — Nantucket / Dana']]) {
  const o = document.createElement('option'); o.value = k; o.textContent = l; tp.appendChild(o);
}
tp.value = S.tdPair;
tp.onchange = () => { S.tdPair = tp.value; store.set('tdPair', S.tdPair); chart.draw(); };
$('tdOffA').value = S.tdOff[0] || ''; $('tdOffB').value = S.tdOff[1] || '';
const offChange = () => { S.tdOff = [+$('tdOffA').value || 0, +$('tdOffB').value || 0]; store.set('tdOff', S.tdOff); chart.draw(); };
$('tdOffA').onchange = offChange; $('tdOffB').onchange = offChange;
let tdMarker = null;
$('tdGo').onclick = () => {
  const a = parseFloat($('tdA').value), b = parseFloat($('tdB').value), [sa, sb] = pair();
  if (!(a > 0 && b > 0)) return;
  const c = map.getCenter(), pos = Loran.fromTd(a - (+S.tdOff[0] || 0), sa, b - (+S.tdOff[1] || 0), sb, [c.lat, c.lng]);
  if (!pos) { status('Those TDs don\'t resolve to a spot near here.', true); return; }
  if (tdMarker) map.removeLayer(tdMarker);
  tdMarker = L.circleMarker(pos, { radius: 8, color: '#ffd23f', weight: 3, fillOpacity: 0 }).addTo(map);
  map.setView(pos, Math.max(map.getZoom(), 9));
  openReading(L.latLng(pos[0], pos[1]), `TD ${a} / ${b}`);
};

const hp = $('homePort');
PORTS.forEach(([n]) => { const o = document.createElement('option'); o.value = o.textContent = n; hp.appendChild(o); });
hp.value = S.home;
const homeChanged = () => {
  if (S.prod === 'fish') showFishTimes();
  if (fillSpecies() && S.prod === 'fish') { buildFish(); autoRange(true); renderRaster(); drawLegend(); }
  else if (S.prod === 'fish') { buildFish(); }
  if (S.prod === 'ana') { buildFish(); buildAnalysis(); renderAnalysis(); }
  chart.draw();
};
const ht = $('homeTop');
PORTS.forEach(([n]) => { const o = document.createElement('option'); o.value = n; o.textContent = `Home: ${n}`; ht.appendChild(o); });
ht.value = S.home;
// Each Jump-to zone remembers the home port you last picked inside it
const zoneHome = store.get('zoneHome', {});
function rememberHome() {
  const p = PORTS.find((x) => x[0] === S.home); if (!p) return;
  const inZone = (k) => { const [[s, w], [n, e]] = ZONES[k].view; return p[1] >= s - 1 && p[1] <= n + 1 && p[2] >= w - 1 && p[2] <= e + 1; };
  // the zone you last jumped to, if this port is in it; otherwise the zone whose middle is closest to the port
  let k = store.get('lastZone', null);
  if (!k || !ZONES[k] || !inZone(k)) {
    k = Object.keys(ZONES).sort((a, b) => {
      const d = (z) => { const [[s, w], [n, e]] = ZONES[z].view; return Math.hypot((s + n) / 2 - p[1], (w + e) / 2 - p[2]); };
      return d(a) - d(b);
    })[0];
  }
  zoneHome[k] = S.home; store.set('zoneHome', zoneHome);
}
hp.onchange = () => { S.home = hp.value; ht.value = S.home; store.set('home', S.home); rememberHome(); homeChanged(); };
ht.onchange = () => { S.home = ht.value; hp.value = S.home; store.set('home', S.home); rememberHome(); fillSpecies(); homeChanged(); };

// Zone switcher: jump the view and set that zone's home port (for range/bearing and the hot-spot run limit)
const zs = $('zone');
const ZONE_GROUPS = [['US East Coast', ['ng', 'ne', 'ma', 'se', 'fl']], ['Gulf of Mexico', ['flg', 'gulf', 'tx']],
  ['Atlantic islands & Caribbean', ['bda', 'tci', 'pr', 'puntacana', 'stlucia', 'cancun']],
  ['Mexico & Central America (Pacific)', ['cabo', 'chiapas', 'guat', 'cr', 'crs', 'pan']]];
for (const [label, keys] of ZONE_GROUPS) {
  const og = document.createElement('optgroup'); og.label = label;
  for (const k of keys) { const o = document.createElement('option'); o.value = k; o.textContent = ZONES[k].label; og.appendChild(o); }
  zs.appendChild(og);
}
zs.onchange = () => {
  const z = ZONES[zs.value]; if (!z) return;
  S.home = zoneHome[zs.value] && PORTS.some((x) => x[0] === zoneHome[zs.value]) ? zoneHome[zs.value] : z.home; store.set('home', S.home); hp.value = S.home; ht.value = S.home; fillSpecies();
  store.set('lastZone', zs.value); homeChanged();
  map.fitBounds(z.view); zs.value = '';
};

let moveTimer;
map.on('moveend', () => {
  store.set('view', [map.getCenter().lat, map.getCenter().lng]); store.set('zoom', map.getZoom());
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    const p = PRODUCTS[S.prod];
    const need = !covers(S.data.bathy, 1 / 240, 620) || (!p.computed && !covers(S.data[S.prod], p.res, p.cells)) || ['ftle', 'cur', 'fish', 'ana', 'wx'].includes(S.prod) ||
      ((S.ov.cur || S.prod === 'cur') && !hfCovers());
    if (need) { refresh(); return; }
    const before = JSON.stringify(S.range[S.prod]); autoRange();
    if (JSON.stringify(S.range[S.prod]) !== before) renderRaster();
    drawLegend(); chart.draw();
  }, 450);
});

// ---------- What each reading means (the (i) notes in the tap box) ----------
// spread = biggest difference between this point and four neighbors d degrees away (a quick break/edge check);
// ratio = compare as a ratio (chlorophyll varies by multiples, not by amounts)
function spread(g, lat, lon, d, ratio) {
  const v = sample(g, lat, lon); if (!(v === v)) return NaN;
  let m = ratio ? 1 : 0;
  for (const [a, b] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
    const x = sample(g, lat + a, lon + b);
    if (x === x) m = Math.max(m, ratio ? Math.max(x / v, v / x) : Math.abs(x - v));
  }
  return m;
}
const P3 = (what, means, expect) => `<b>What it is:</b> ${what}<br><b>What this reading means:</b> ${means}${expect ? `<br><b>What to expect here:</b> ${expect}` : ''}`;
const INFO = {
  temp(v, sp) {
    const s = SPECIES[S.species], nm = s?.label.toLowerCase();
    let fit = '';
    if (s) {
      const [lo, ok0, ok1, hi] = s.t;
      fit = v < lo || v > hi ? `${v.toFixed(0)}°F is outside the range ${nm} will tolerate (${lo}-${hi}°F).` : v >= ok0 && v <= ok1 ? `${v.toFixed(0)}°F is right in the ${nm} sweet spot (${ok0}-${ok1}°F).` : `${v.toFixed(0)}°F is fishable for ${nm} but off their best range (${ok0}-${ok1}°F).`;
    }
    const brk = sp === sp && sp >= 1;
    return P3('Surface water temperature from satellites (clouds leave gaps).',
      fit + (brk ? ` The water changes ${sp.toFixed(1)}°F within about 2 miles: that is a temperature break, where bait gathers and predators patrol the edge.` : ' The water is about the same temperature for a couple of miles around: no sharp break right here.'),
      brk ? 'Work along the break, especially the warm side, and watch for bait, birds and weed lines.' : 'Look for the nearest break on the chart (tightly packed colors) rather than fishing open water.');
  },
  hourly(v, daily) {
    const d = daily === daily ? v - daily : NaN;
    return P3('The latest hourly GOES-19 satellite scan: newer than the daily water temp, but coarser.',
      d === d ? `It reads ${Math.abs(d).toFixed(1)}°F ${d >= 0 ? 'warmer' : 'cooler'} than the daily water temp here.${Math.abs(d) > 2 ? ' A gap that big usually means a cloud edge or afternoon surface heating, so trust the daily map for where the edges are.' : ' The two agree, so the edges on the map are current.'}` : 'Use it to see how the water has moved since the daily map.',
      'Calm, sunny afternoons heat the top inch of water; the real edge is usually where the morning scans put it.');
  },
  chl(v, r) {
    const band = v < 0.1 ? 'Very blue, clear offshore water (Gulf Stream or open ocean). Little food, but billfish and tuna travel it, and fish stack where it meets greener water.'
      : v < 0.3 ? 'Blue-green "transition" water. Often the best color: enough food for bait, clear enough for pelagics to hunt.'
      : v < 1 ? 'Green water: plenty of plankton and bait, but cloudier. Better for bottom fish and bait than for billfish.'
      : 'Dirty coastal or river-plume water: heavy plankton or sediment. Inshore species like it; offshore species avoid it.';
    const edge = r === r && r > 1.6;
    return P3('Chlorophyll is plankton in the water, measured by its color from satellites. It stands in for food and water clarity.',
      band + (edge ? ' The color changes sharply within about 2 miles: a color edge, one of the most reliable places to find fish offshore.' : ''),
      edge ? 'Troll along the line where blue meets green, and look for weed lines and birds.' : 'Find the nearest spot where the color changes on the chart.');
  },
  ssh(v, sp) {
    const kind = Math.abs(v) < 4 ? 'This water is close to normal height: no strong eddy right here.'
      : v > 0 ? `The sea surface is ${v.toFixed(0)} cm higher than normal. Plus (+) means a high: usually a warm-core eddy or Gulf Stream water, turning clockwise. Water piles up and sinks in the middle (downwelling), so the center is warm, clear and low on food.`
      : `The sea surface is ${Math.abs(v).toFixed(0)} cm lower than normal. Minus (-) means a low: usually a cold-core eddy, turning counterclockwise. Water rises from below in the middle (upwelling), bringing up cooler, nutrient-rich water that turns green.`;
    const edge = sp === sp && sp >= 8;
    return P3('Altimetry is the height of the sea surface measured by satellite radar, compared with normal. It shows eddies and currents even under clouds.',
      kind + (edge ? ` The height changes ${sp.toFixed(0)} cm within about 15 miles: you are near an eddy edge, where current runs fastest and fish stack up.` : ''),
      edge ? 'Fish the edge rather than the center. Expect current and a temp or color break nearby.' : v > 4 ? 'Head for the edge of the high, where it meets cooler water.' : v < -4 ? 'The edges of a cold eddy often hold bait. Expect cooler, greener water inside it.' : 'Look on the chart for the nearest red or blue blob and fish its edge.');
  },
  mld(v) {
    return P3('How deep the warm, well-mixed surface layer goes before the water turns colder (the thermocline).',
      v < 60 ? `At about ${Math.round(v)} ft the warm layer is shallow, so bait and fish are squeezed up near the surface.` : v < 150 ? `At about ${Math.round(v)} ft the warm layer is a medium depth.` : `At about ${Math.round(v)} ft the warm layer is deep, so fish can spread out and go deep.`,
      v < 60 ? 'Good for surface trolling and topwater.' : 'Run some baits deeper (planers, downriggers or deep-diving plugs), especially in midday sun.');
  },
  ftle(v) {
    return P3('Front strength is worked out from the currents. It shows where water from different directions gets pushed together into a line.',
      v > 0.3 ? 'A strong convergence line: water is being pulled together here.' : v > 0.15 ? 'A moderate convergence line.' : 'No strong convergence right here.',
      v > 0.15 ? 'Expect weed lines, debris, foam and bait collected along the line. Fish along it.' : 'Look for the bright lines on the Fronts chart nearby.');
  },
  sss(v) {
    return P3('How salty the surface water is (PSU, about parts per thousand).',
      v >= 36 ? 'Very salty: typical of Gulf Stream and open subtropical water.' : v >= 34.5 ? 'Normal ocean water.' : v >= 32 ? 'A little fresher than open ocean: shelf water mixed with runoff.' : 'Fresh-influenced water from a river, sound or inlet outflow.',
      v < 34 ? 'Expect off-colored water and inshore species. A sharp salinity change often lines up with a color break.' : 'Clear water where pelagic species are comfortable.');
  },
  score(v) {
    const s = SPECIES[S.species];
    return P3(`Breakline's 0-100 rating of how fishy this spot looks for ${s ? s.label.toLowerCase() : 'the chosen species'}. It weighs temp breaks, color, bottom structure and eddies.`,
      v >= 70 ? 'High score: several good signs line up here.' : v >= 40 ? 'Medium score: a couple of good signs, but not everything lines up.' : 'Low score: little here for this species right now.',
      `It is worked out by computer from satellite data. Treat it as a short list of places to check, not a promise.<br><b>Fishing for something else?</b> <a href="#" class="ppSpecies">Change the species in Where to fish</a> and the score updates.`);
  },
  cur(kt) {
    return P3('Surface current speed and the direction it is flowing toward.',
      kt > 1.5 ? `${kt.toFixed(1)} kt is strong current, likely the Gulf Stream or an eddy edge.` : kt > 0.5 ? `${kt.toFixed(1)} kt is moderate current.` : `${kt.toFixed(1)} kt is light current.`,
      kt > 1.5 ? 'Expect a hard drift and long tag lines. Bottom fishing is tough; trolling the edge is good. Wind against this current stacks up steep seas.' : 'Easy drifts and bottom fishing. Pelagics usually hold on the up-current side of structure, where the current pushes bait up to them; bottom fish tuck into the slack water behind it.');
  },
  wind(kt) {
    return P3('The forecast model wind for right now at this spot: the direction it blows from, speed, and gusts.',
      kt < 10 ? 'Light wind: comfortable for any boat.' : kt < 15 ? 'Moderate wind: fine for most boats, a little chop.' : kt < 20 ? 'Fresh wind: sporty for smaller boats, uncomfortable running into it.' : 'Strong wind: rough for most recreational boats.',
      'Wind blowing against the current (like a north wind on the Gulf Stream) builds steep, dangerous seas fast.');
  },
  seas(ft, sec) {
    const ok = sec >= ft * 2;
    return P3('The forecast model wave height (feet) and period (seconds between waves).',
      `${ft.toFixed(1)} ft at ${Math.round(sec)} seconds is ${ok ? 'a comfortable ride: the waves are spaced out' : 'choppy: the waves are close together'}. Rule of thumb: it is comfortable when the seconds are at least double the feet.`,
      ft > 6 ? 'Rough for most boats; consider waiting.' : ft > 4 || (!ok && ft >= 2.5) ? 'Expect a wet, bumpy ride: slow down in smaller boats.' : 'Reasonable conditions.');
  },
  spot(kind) {
    const k = { reef: 'An artificial or natural reef', pier: 'A fishing pier', jetty: 'A jetty or rock wall', rock: 'A rock pile or hard bottom', 'shoal/bar': 'A shoal or sandbar', inshore: 'A known inshore spot' }[kind] || 'A known fishing spot';
    return P3(`${k} from public fishing-spot lists.`, 'Structure holds bait, and bait holds fish.', 'Pelagics usually sit on the up-current side, where bait gets pushed up; bottom fish hold in the slack water down-current. Expect other boats on popular spots.');
  },
  wreck(kind) {
    return P3(`A charted ${kind.toLowerCase()} from NOAA.`, 'Hard structure on the bottom attracts bait and bottom fish.', 'Bottom fish, amberjack and cobia often hold here. Keep trolling gear clear of it.');
  },
  loran: P3('Loran-C time differences (TDs), the old navigation numbers many fishing spots are still written in.', 'Use them to match spots from old logbooks and spot lists.', 'The conversion is good to within a few hundred feet; double check on your sounder.'),
};

// Readout
function readings(lat, lon) {
  const r = [], D = S.data;
  const add = (k, g, f, why) => { const v = sample(g, lat, lon); if (v === v) r.push([k, f(v), why && why(v, g)]); };
  add('Water temp', D.sst, PRODUCTS.sst.fmt, (v, g) => INFO.temp(v, spread(g, lat, lon, 0.03)));
  add('Hourly temp', D.goes, PRODUCTS.goes.fmt, (v) => INFO.hourly(v, sample(D.sst, lat, lon)));
  add('Chlorophyll', D.chl, PRODUCTS.chl.fmt, (v, g) => INFO.chl(v, spread(g, lat, lon, 0.04, true)));
  add('Altimetry', D.ssh, (v) => `${PRODUCTS.ssh.fmt(v)} <small>${Math.abs(v) < 4 ? 'near normal' : v > 0 ? 'high · downwelling' : 'low · upwelling'}</small>`, (v, g) => INFO.ssh(v, spread(g, lat, lon, 0.25)));
  add('Mixed layer', D.mld, PRODUCTS.mld.fmt, (v) => INFO.mld(v));
  add('Front strength', D.ftle, PRODUCTS.ftle.fmt, (v) => INFO.ftle(v));
  add('Salinity', D.sss, PRODUCTS.sss.fmt, (v) => INFO.sss(v));
  add('Hot-spot score', D.fish, PRODUCTS.fish.fmt, (v) => INFO.score(v));
  const z = depthAt(lat, lon); if (z === z) r.push(['Depth', z >= 0 ? 'land' : depthTxt(z)]);
  const c = curAt(lat, lon);
  if (c) { const kt = Math.hypot(c[0], c[1]) * 1.94384; r.push(['Current', `${kt.toFixed(2)} kt toward ${Math.round((Math.atan2(c[0], c[1]) * 180 / Math.PI + 360) % 360)}° (${c[2]})`, INFO.cur(kt)]); }
  for (const [d, b, sp] of spotsNear(lat, lon)) {
    r.push([sp[3] === 'reef' ? 'Reef' : INSHORE_KINDS.has(sp[3]) ? sp[3][0].toUpperCase() + sp[3].slice(1) : 'Spot', `${sp[2]}${sp[6] ? ` · ${sp[6]}` : ''} · ${d.toFixed(2)} nm @ ${Math.round(b)}°T <small>(${sp[4]})</small>`, INFO.spot(sp[3])]);
  }
  for (const [d, w] of wrecksNear(lat, lon)) {
    const kind = w[2] === 'W' ? 'Wreck' : w[2] === 'F' ? 'Fish haven' : 'Obstruction';
    r.push([kind, `${w[5] ? `${w[5]} · ` : ''}${w[3] || ''}${w[4] != null ? ` · ${Math.round(w[4] * 3.28084)} ft over` : ''} · ${d.toFixed(2)} nm`, INFO.wreck(kind)]);
  }
  if (inLoran(lat, lon)) r.push([`Loran ${S.tdPair[0]}/${S.tdPair[1]}`, fmtTd(lat, lon), INFO.loran]);
  const home = PORTS.find((x) => x[0] === S.home);
  if (ME.pos) { const [d, b] = rangeBearing(ME.pos, [lat, lon]); r.push(['From you', `${d.toFixed(1)} nm @ ${Math.round(b)}°T`]); }
  if (home) { const [d, b] = rangeBearing([home[1], home[2]], [lat, lon]); r.push([`From ${home[0]}`, `${d.toFixed(1)} nm @ ${Math.round(b)}°T`]); }
  return r;
}

map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng, p = PRODUCTS[S.prod], g = PG();
  const val = S.prod === 'bottom' ? NaN : sample(g, lat, lng), z = depthAt(lat, lng), home = PORTS.find((x) => x[0] === S.home);
  const pos = S.grid === 'td' && inLoran(lat, lng) ? fmtTd(lat, lng) : fmtLL(lat, lng);
  const parts = [`<span class="v">${pos}</span>`];
  if (val === val) parts.push(`<span class="v">${p.fmt(val)}</span>`);
  if (z === z && z < 0) parts.push(depthTxt(z));
  if (S.grid === 'both' && inLoran(lat, lng)) parts.push(`TD ${fmtTd(lat, lng)}`);
  if (home) { const [d, b] = rangeBearing([home[1], home[2]], [lat, lng]); parts.push(`${d.toFixed(1)} nm @ ${Math.round(b)}°T`); }
  $('readout').innerHTML = parts.join('<span class="m">·</span>');
});

// ---------- My location (phone GPS) ----------
// Stays on the device: the position is only used to draw the dot and measure range/bearing.
const ME = { pos: null, watch: null, follow: false, dot: null, ring: null, layer: L.layerGroup().addTo(map) };
const LocateCtl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const b = L.DomUtil.create('button', 'locate-btn');
    b.title = 'Show my location'; b.setAttribute('aria-label', 'Show my location'); b.innerHTML = '<span></span>';
    L.DomEvent.disableClickPropagation(b);
    b.onclick = () => {
      if (ME.watch == null) startLocate();
      else if (!ME.follow) { ME.follow = true; if (ME.pos) map.setView(ME.pos, Math.max(map.getZoom(), 9)); }
      else stopLocate();
      paintLocate();
    };
    ME.btn = b; return b;
  },
});
new LocateCtl().addTo(map);
function paintLocate() { if (!ME.btn) return; ME.btn.classList.toggle('on', ME.watch != null); ME.btn.classList.toggle('follow', ME.follow); ME.btn.title = ME.watch == null ? 'Show my location' : ME.follow ? 'Stop tracking' : 'Center on me'; }
function startLocate() {
  if (!navigator.geolocation) { status('This device has no location service.', true); return; }
  ME.follow = true; status('Finding your location…');
  ME.watch = navigator.geolocation.watchPosition(onFix, (e) => {
    if (e.code === 1) { status(''); stopLocate(); showLocHelp(); return; }
    status(e.code === 3 ? 'Still looking for a GPS fix… (works best outside, away from cover)' : 'Can\'t get a location fix right now.', true);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
// The browser remembers a "Don't Allow" per site, so the fix has to happen in settings; show the steps for this device
function showLocHelp() {
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1), android = /Android/.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  $('locSteps').innerHTML = ios ? `<ol>
      <li><b>Settings</b> → <b>Privacy &amp; Security</b> → <b>Location Services</b>: turn it <b>On</b>.</li>
      <li>Same screen, scroll to <b>Safari Websites</b> → <b>While Using the App</b>.</li>
      ${standalone ? '<li>Open breakline-ihfj.netlify.app in <b>Safari</b> once,' : '<li>Back here in Safari,'} tap <b>aA</b> in the address bar → <b>Website Settings</b> → <b>Location</b> → <b>Allow</b>.</li>
      <li>Reload, then tap the locate button again.</li></ol>`
    : android ? `<ol>
      <li>Tap the icon left of the web address → <b>Permissions</b> → <b>Location</b> → <b>Allow</b>.</li>
      <li>Make sure <b>Location</b> is on in your quick settings (swipe down from the top).</li>
      <li>Reload, then tap the locate button again.</li></ol>`
    : `<ol>
      <li>Click the icon left of the web address → <b>Location</b> → <b>Allow</b>.</li>
      <li>Reload, then click the locate button again.</li></ol>`;
  $('locHelp').hidden = false;
}
$('locClose').onclick = () => { $('locHelp').hidden = true; };
$('locRetry').onclick = () => { $('locHelp').hidden = true; startLocate(); paintLocate(); };
function stopLocate() {
  if (ME.watch != null) navigator.geolocation.clearWatch(ME.watch);
  ME.watch = null; ME.follow = false; ME.pos = null; ME.layer.clearLayers(); ME.dot = ME.ring = null; paintLocate();
}
function onFix(p) {
  const { latitude: la, longitude: lo, accuracy, heading, speed } = p.coords, first = !ME.pos;
  ME.pos = [la, lo]; ME.speed = speed; ME.heading = heading;
  if (!ME.dot) {
    ME.ring = L.circle(ME.pos, { radius: accuracy, color: '#35c2ff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(ME.layer);
    ME.dot = L.marker(ME.pos, { icon: L.divIcon({ className: '', html: '<div class="me-tri"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 1.5 21 22 12 17 3 22Z"/></svg></div>', iconSize: [26, 26], iconAnchor: [13, 13] }), interactive: false, zIndexOffset: 1000 }).addTo(ME.layer);
  } else { ME.dot.setLatLng(ME.pos); ME.ring.setLatLng(ME.pos).setRadius(accuracy); }
  // boat-style triangle: points along your course when moving, north when stopped
  const tri = ME.dot.getElement()?.querySelector('.me-tri'), moving = heading != null && speed > 0.5;
  if (tri) { tri.style.transform = `rotate(${moving ? heading : 0}deg)`; tri.classList.toggle('moving', moving); }
  if (ME.follow) map.setView(ME.pos, first ? Math.max(map.getZoom(), 9) : map.getZoom(), { animate: !first });
  if (first) status('');
  paintLocate();
}
map.on('dragstart', () => { if (ME.follow) { ME.follow = false; paintLocate(); } });

// Conditions right now at a tapped point (Open-Meteo current values; cached 15 min per ~1 km cell)
const NOWC = new Map();
function nowConditions(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.floor(Date.now() / 900e3)}`;
  if (NOWC.has(key)) return NOWC.get(key);
  const qs = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=GMT`;
  const p = Promise.all([
    omJson(`https://api.open-meteo.com/v1/forecast?${qs}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn`).catch(() => null),
    omJson(`https://marine-api.open-meteo.com/v1/marine?${qs}&current=wave_height,wave_period,wave_direction`).catch(() => null),
  ]).then(([w, m]) => {
    const r = [], dirTxt = (d) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
    const c = w?.current, mc = m?.current;
    if (c?.wind_speed_10m != null) r.push(['Wind now', `${dirTxt(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} kt${c.wind_gusts_10m != null ? `, gusts ${Math.round(c.wind_gusts_10m)}` : ''}`, INFO.wind(c.wind_speed_10m)]);
    if (mc?.wave_height != null) r.push(['Seas now', `${(mc.wave_height * 3.28084).toFixed(1)} ft${mc.wave_period != null ? ` @ ${Math.round(mc.wave_period)} s` : ''}${mc.wave_direction != null ? ` from ${dirTxt(mc.wave_direction)}` : ''}`, mc.wave_period != null ? INFO.seas(mc.wave_height * 3.28084, mc.wave_period) : null]);
    if (!r.length) NOWC.delete(key);
    return r;
  });
  NOWC.set(key, p);
  return p;
}
function openReading(latlng, title) {
  const { lat, lng } = latlng;
  // Build the popup as a DOM element (not an HTML string): Leaflet re-renders string content when it pans
  // the map to fit the popup, which would drop these button handlers.
  const el = document.createElement('div'); el.className = 'pp';
  el.innerHTML = `<div class="coord">${title ? `${title}<br>` : ''}${fmtLL(lat, lng)}</div><table></table>
    <div class="save"><input class="ppName" placeholder="Spot name" value="Spot ${S.wpts.length + 1}"><button class="ppSave">Save</button></div>
    <div class="pp-btns"><button class="ppbt">Best times here</button><button class="ppwx">Weather forecast</button></div><button class="ppMatch">Find this water again</button><div class="ppBtOut"></div><div class="ppWxOut"></div>`;
  const pop = L.popup(POP_OPTS()).setLatLng(latlng).setContent(el);
  const rowEls = ([k, v, info]) => {
    const tr = document.createElement('tr'); tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
    if (!info) return [tr];
    const b = document.createElement('button'); b.className = 'ppi'; b.type = 'button'; b.textContent = 'i'; b.title = `What does ${k.toLowerCase()} mean?`;
    tr.firstChild.appendChild(b);
    const note = document.createElement('tr'); note.className = 'ppnote'; note.hidden = true; note.innerHTML = `<td colspan="2">${info}</td>`;
    b.onclick = (e) => { e.stopPropagation(); note.hidden = !note.hidden; b.classList.toggle('on', !note.hidden); pop.update(); };
    return [tr, note];
  };
  el.querySelector('table').append(...readings(lat, lng).flatMap(rowEls));
  el.addEventListener('click', (e) => {
    if (!e.target.closest('.ppSpecies')) return;
    e.preventDefault(); map.closePopup(pop);
    if (S.prod !== 'fish') document.querySelector('.prod[data-prod="fish"]').click();
    setTimeout(() => { setFishCollapsed(false); $('species').focus(); try { $('species').showPicker?.(); } catch { /* needs a fresh tap on some browsers */ } }, 150);
  });
  { // wind + seas right now, slotted in as rows once they arrive
    const tb = el.querySelector('table'), ld = document.createElement('tr');
    ld.innerHTML = '<td>Wind &amp; seas</td><td class="dim">loading…</td>'; tb.prepend(ld);
    nowConditions(lat, lng).then((r) => {
      if (!r.length) { ld.lastChild.textContent = 'unavailable right now'; return; }
      ld.replaceWith(...r.flatMap(rowEls));
      pop.update();
    });
  }
  const wb = el.querySelector('.ppwx');
  wb.onclick = async () => {
    wb.disabled = true; wb.textContent = 'Loading forecast…';
    try { el.querySelector('.ppWxOut').innerHTML = await spotForecast(lat, lng); wb.remove(); pop.update(); }
    catch (e) { wb.disabled = false; wb.textContent = `${/overloaded|busy|responding/.test(e.message) ? 'Weather service busy' : 'Forecast unavailable'}: tap to try again`; }
  };
  const bb = el.querySelector('.ppbt');
  bb.onclick = () => { bb.remove(); mountBestTimes(el.querySelector('.ppBtOut'), lat, lng); setTimeout(() => pop.update(), 600); setTimeout(() => pop.update(), 2500); };
  el.querySelector('.ppMatch').onclick = () => matchHere(lat, lng);
  el.querySelector('.ppSave').onclick = () => {
    const name = (el.querySelector('.ppName').value || '').trim() || `Spot ${S.wpts.length + 1}`;
    const sst = sample(S.data.sst, lat, lng), z = sample(S.data.bathy, lat, lng), [ta, tb] = tds(lat, lng);
    S.wpts.push({ id: newId(), u: Date.now(), name, lat: +lat.toFixed(5), lon: +lng.toFixed(5), t: new Date().toISOString(),
      sst: sst === sst ? +sst.toFixed(1) : null, fm: z === z && z < 0 ? Math.round(-z / FATHOM) : null, td: `${S.tdPair}:${ta.toFixed(1)}/${tb.toFixed(1)}` });
    saveWpts(); map.closePopup(pop);
  };
  pop.openOn(map);
}
// ---------- Measure: tap points to get leg + total distance (nm) and bearings ----------
const MEAS = { on: false, pts: [], layer: L.layerGroup().addTo(map) };
const MeasureCtl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const b = L.DomUtil.create('button', 'locate-btn measure-btn');
    b.title = 'Measure distance'; b.setAttribute('aria-label', 'Measure distance'); b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17 17 3l4 4L7 21z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2" stroke="currentColor" stroke-width="1.6"/></svg>';
    L.DomEvent.disableClickPropagation(b);
    b.onclick = () => { MEAS.on = !MEAS.on; if (!MEAS.on) clearMeasure(); b.classList.toggle('on', MEAS.on); $('measureBar').hidden = !MEAS.on; drawMeasure(); };
    MEAS.btn = b; return b;
  },
});
new MeasureCtl().addTo(map);
function clearMeasure() { MEAS.pts = []; MEAS.layer.clearLayers(); drawMeasure(); }
function drawMeasure() {
  MEAS.layer.clearLayers();
  const p = MEAS.pts; let total = 0;
  if (p.length > 1) L.polyline(p, { color: '#000', weight: 5, opacity: 0.7, interactive: false }).addTo(MEAS.layer);
  if (p.length > 1) L.polyline(p, { color: '#ffd23f', weight: 2.5, dashArray: '8 6', interactive: false }).addTo(MEAS.layer);
  p.forEach((pt, i) => {
    L.circleMarker(pt, { radius: 5, color: '#000', weight: 2, fillColor: '#ffd23f', fillOpacity: 1, interactive: false }).addTo(MEAS.layer);
    if (i) {
      const [d, b] = rangeBearing(p[i - 1], pt); total += d;
      const mid = [(p[i - 1][0] + pt[0]) / 2, (p[i - 1][1] + pt[1]) / 2];
      L.marker(mid, { interactive: false, icon: L.divIcon({ className: '', html: `<div class="meas-lbl">${d.toFixed(1)} nm · ${Math.round(b)}°T</div>`, iconSize: [0, 0] }) }).addTo(MEAS.layer);
    }
  });
  const kts = 25;   // typical cruise; the run time is just a guide
  $('measureTxt').innerHTML = !p.length ? 'Tap the chart to drop points' : p.length === 1 ? 'Tap another point'
    : `<b>${total.toFixed(1)} nm</b> total · ${p.length - 1} leg${p.length > 2 ? 's' : ''} · ~${(total / kts).toFixed(1)} h at ${kts} kt`;
}
$('measureUndo').onclick = () => { MEAS.pts.pop(); drawMeasure(); };
$('measureClear').onclick = () => clearMeasure();
$('measureDone').onclick = () => { MEAS.on = false; clearMeasure(); MEAS.btn.classList.remove('on'); $('measureBar').hidden = true; };

map.on('click', (e) => {
  if (TRIP.pinning) return;                       // Track my day: this tap places a catch
  if (MEAS.on) { MEAS.pts.push([e.latlng.lat, e.latlng.lng]); drawMeasure(); return; }
  openReading(e.latlng);
});

// Waypoints
const wLayer = L.layerGroup().addTo(map);
function saveWpts(fromCloud) {
  if (!fromCloud) {
    const now = Date.now(), keep = new Set(S.wpts.map((w) => w.id)), gone = store.get('wptsGone', {});
    for (const id of store.get('wptsIds', [])) if (!keep.has(id)) gone[id] = now;
    for (const w of S.wpts) if (!w.id) { w.id = newId(); w.u = now; }
    store.set('wptsGone', gone);
  }
  store.set('wptsIds', S.wpts.map((w) => w.id));
  store.set('wpts', S.wpts); drawWpts();
  if (!fromCloud) ACCT_HOOK.spots?.();
}
function drawWpts() {
  wLayer.clearLayers();
  const list = $('wList'); list.innerHTML = '';
  $('wCount').textContent = S.wpts.length ? `(${S.wpts.length})` : '';
  S.wpts.forEach((w, i) => {
    L.marker([w.lat, w.lon], { icon: L.divIcon({ className: '', html: '<div class="wpt-icon"></div>', iconSize: [12, 12], iconAnchor: [6, 6] }) })
      .bindTooltip(w.name, { permanent: true, direction: 'right', offset: [8, 0], className: 'wpt-label' }).addTo(wLayer);
    const li = document.createElement('li');
    li.innerHTML = `<b>${w.name.replace(/</g, '&lt;')}</b><small>${fmtLL(w.lat, w.lon)}<br>TD ${fmtTd(w.lat, w.lon)}${w.sst ? ` · ${w.sst}°F` : ''}${w.fm ? ` · ${w.fm} fm` : ''}</small><button title="Delete">&times;</button>`;
    li.querySelector('b').onclick = () => map.setView([w.lat, w.lon], Math.max(map.getZoom(), 9));
    li.querySelector('button').onclick = () => { S.wpts.splice(i, 1); saveWpts(); };
    list.appendChild(li);
  });
}
$('wClear').onclick = () => { if (S.wpts.length && confirm(`Delete all ${S.wpts.length} spots?`)) { S.wpts = []; saveWpts(); } };
$('wGpx').onclick = () => {
  const esc = (s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const body = S.wpts.map((w) => `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${esc(w.name)}</name><desc>${esc([`TD ${fmtTd(w.lat, w.lon)}`, w.sst && `${w.sst}F`, w.fm && `${w.fm} fm`].filter(Boolean).join(', '))}</desc></wpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Breakline" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>\n`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `breakline-spots-${isoDate(new Date())}.gpx`; a.click();
};

if (matchMedia('(hover: none)').matches) $('readout').textContent = 'Tap the chart for a reading';
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

// Optional timing (localStorage breakline.perf = 1): logs how long each heavy step takes to window.__perf
if (store.get('perf', 0)) {
  window.__perf = [];
  const wrap = (name, f) => function (...a) {
    const t = performance.now(), r = f.apply(this, a);
    const done = () => window.__perf.push([name, Math.round(performance.now() - t)]);
    if (r && typeof r.then === 'function') r.then(done, done); else done();
    return r;
  };
  buildSstGeo = wrap('sst-geo', buildSstGeo); renderRaster = wrap('raster', renderRaster); renderRelief = wrap('relief', renderRelief);
  getText = wrap('net:erddap', getText); loadCmems = wrap('net:copernicus', loadCmems); loadBathy = wrap('depth', loadBathy);
  drawChart = wrap('chart', drawChart); buildRings = wrap('rings', buildRings); autoRange = wrap('autorange', autoRange);
}
chart = new Chart().addTo(map);
// ---------- Accounts (Supabase): spots + settings follow the user to every device ----------
// The URL and publishable (anon) key are public by design; row-level security on every table keeps each
// user to their own rows (see supabase/schema.sql). Empty = accounts switched off, app works as before.
const SB_URL = 'https://uydsbqqjuxhbhhujhsgd.supabase.co', SB_KEY = 'sb_publishable_qQLZTM_1THgVTToQZAhiYA_IY5IEdL9';
const ACCT = { sb: null, user: null, plan: 'free', busy: false, pushT: 0 };
function sbInit() {
  if (ACCT.sb || !window.supabase) return ACCT.sb;
  ACCT.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'breakline.auth' } });
  ACCT.sb.auth.onAuthStateChange((ev, sess) => {
    if (ev === 'PASSWORD_RECOVERY') { gateMode('recovery'); showGate(true); }
    const u = sess?.user || null, was = ACCT.user?.id;
    ACCT.user = u; paintAcct();
    if (u && ev !== 'PASSWORD_RECOVERY') checkAccess();
    if (!u && ev === 'SIGNED_OUT') { gateMode('signin'); showGate(true); }
    if (u && u.id !== was) setTimeout(() => { claimDevice(u.id); syncAll(true); ACCT_HOOK.alerts?.(); }, 0);
  });
  return ACCT.sb;
}
const sbLoad = () => Promise.resolve(sbInit());
// Spots on this device belong to whoever last signed in here; a different account starts clean
function claimDevice(uid) {
  const last = store.get('lastUid', null);
  if (last && last !== uid) { S.wpts = []; for (const k of ['wptsIds', 'wptsGone', 'settingsU']) localStorage.removeItem('breakline.' + k); saveWpts(true); }
  store.set('lastUid', uid);
}
const acctMsg = (t, bad) => { const m = $('acctMsg'); m.textContent = t || ''; m.classList.toggle('bad', !!bad); };
function paintAcct() {
  const on = !!ACCT.user;
  $('acct').hidden = !on;
  if (on) {
    $('acctWho').textContent = ACCT.user.email || 'your account';
    const a = ACCT.access || {}, st = a.status;
    $('acctPlan').textContent = st === 'free' ? 'Free account' : st === 'pro' ? `Subscribed${a.renews ? ` · renews ${new Date(a.renews).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`
      : st === 'trial' ? `Free trial · ${daysLeft(a.trial_ends)} day${daysLeft(a.trial_ends) === 1 ? '' : 's'} left` : st === 'expired' ? 'Trial ended' : '';
    $('acctSubscribe').hidden = !(st === 'trial' || st === 'expired');
    $('acctSubscribe').textContent = `Subscribe · ${PRICE_TXT}`;
    $('acctManage').hidden = st !== 'pro';
  }
  $('btnWpts').classList.toggle('signed', on);
}
// Spots: last change wins per spot; deletes travel as deleted_at so they reach other devices
async function syncSpots() {
  const sb = ACCT.sb, uid = ACCT.user?.id; if (!sb || !uid) return;
  const { data: rows, error } = await sb.from('spots').select('id,name,lat,lon,td,sst,fm,note,created_at,updated_at,deleted_at');
  if (error) throw error;
  const remote = new Map(rows.map((r) => [r.id, r])), gone = store.get('wptsGone', {}), local = new Map(S.wpts.map((w) => [w.id, w]));
  const up = [], out = [];
  for (const w of S.wpts) {
    const r = remote.get(w.id), ru = r ? Date.parse(r.updated_at) : 0;
    if (r && r.deleted_at && ru >= (w.u || 0)) continue;                      // deleted on another device
    if (r && !r.deleted_at && ru > (w.u || 0)) { out.push({ ...w, name: r.name, lat: r.lat, lon: r.lon, td: r.td, sst: r.sst, fm: r.fm, note: r.note, u: ru }); continue; }
    out.push(w);
    if (!r || ru < (w.u || 0)) up.push({ id: w.id, name: w.name, lat: w.lat, lon: w.lon, td: w.td || null, sst: w.sst ?? null, fm: w.fm ?? null, note: w.note || null, created_at: w.t || new Date(w.u || Date.now()).toISOString(), updated_at: new Date(w.u || Date.now()).toISOString(), deleted_at: null });
  }
  for (const r of rows) {
    if (local.has(r.id) || r.deleted_at) continue;
    if (gone[r.id] && gone[r.id] >= Date.parse(r.updated_at)) { up.push({ ...r, deleted_at: new Date(gone[r.id]).toISOString(), updated_at: new Date(gone[r.id]).toISOString() }); continue; }
    out.push({ id: r.id, name: r.name, lat: r.lat, lon: r.lon, td: r.td, sst: r.sst, fm: r.fm, note: r.note, t: r.created_at, u: Date.parse(r.updated_at) });
  }
  for (const [id, t] of Object.entries(gone)) {
    const r = remote.get(id);
    if (r && !r.deleted_at && t >= Date.parse(r.updated_at) && !up.some((x) => x.id === id)) up.push({ ...r, deleted_at: new Date(t).toISOString(), updated_at: new Date(t).toISOString() });
  }
  if (up.length) { const { error: e2 } = await sb.from('spots').upsert(up.map((x) => ({ ...x, user_id: uid }))); if (e2) throw e2; }
  store.set('wptsGone', {});
  out.sort((a, b) => (Date.parse(a.t) || a.u || 0) - (Date.parse(b.t) || b.u || 0));
  S.wpts = out; saveWpts(true);
}
// Settings: whichever side changed last wins
function applySettings(st) {
  ACCT.applying = true;
  try {
    const fire = (el, ev = 'change') => el.dispatchEvent(new Event(ev));
    if (st.grid && st.grid !== S.grid) { gm.value = st.grid; fire(gm); }
    if (st.tdPair && st.tdPair !== S.tdPair) { tp.value = st.tdPair; fire(tp); }
    if (Array.isArray(st.tdOff)) { $('tdOffA').value = st.tdOff[0] || ''; $('tdOffB').value = st.tdOff[1] || ''; fire($('tdOffA')); }
    if (st.home && st.home !== S.home && PORTS.some((x) => x[0] === st.home)) { hp.value = st.home; fire(hp); }
    if (st.maxRun && st.maxRun !== S.maxRun) { $('maxRun').value = st.maxRun; fire($('maxRun'), 'input'); fire($('maxRun')); }
    if (Array.isArray(st.fishDepth)) { $('depMin').value = st.fishDepth[0] ?? ''; $('depMax').value = st.fishDepth[1] ?? ''; fire($('depMin')); }
    if (st.species && st.species !== S.species && [...spSel.options].some((o) => o.value === st.species)) { spSel.value = st.species; fire(spSel); }
    if (st.fw && typeof st.fw === 'object') { store.set('fw', st.fw); fwLoad(); fwToUi(); }
  } finally { ACCT.applying = false; }
}
const localSettings = () => Object.fromEntries(SYNC_KEYS.map((k) => [k, store.get(k, null)]).filter(([, v]) => v != null));
async function syncSettings(first) {
  const sb = ACCT.sb, uid = ACCT.user?.id; if (!sb || !uid) return;
  const { data: p, error } = await sb.from('profiles').select('settings,updated_at').eq('id', uid).maybeSingle();
  if (error) throw error;
  const lu = store.get('settingsU', 0), ru = p ? Date.parse(p.updated_at) : 0, has = p && Object.keys(p.settings || {}).length;
  if (has && (first ? ru > lu || !lu : ru > lu)) { applySettings(p.settings); store.set('settingsU', ru); return; }
  if (!has || lu > ru) {
    const { error: e2 } = await sb.from('profiles').upsert({ id: uid, settings: localSettings(), updated_at: new Date(lu || Date.now()).toISOString() });
    if (e2) throw e2;
  }
}
// ---------- Access: 5-day free trial, then $100/yr; emails on the free_accounts list never pay ----------
// Flip PAYWALL_LIVE to true once Stripe is set up (see supabase/SETUP.md). Until then an ended trial still gets in.
const PAYWALL_LIVE = false, PRICE_TXT = '$100 a year';
ACCT.access = store.get('access', null);
async function checkAccess() {
  if (!ACCT.user) return;
  try {
    const { data, error } = await ACCT.sb.rpc('my_access'); if (error) throw error;
    ACCT.access = data; store.set('access', data);
  } catch (e) { console.warn('access', e); }      // offline: keep the last answer, never lock someone out for no signal
  applyAccess();
}
function applyAccess() {
  const a = ACCT.access, st = a?.status;
  ACCT.plan = st === 'pro' || st === 'free' ? 'pro' : 'free';
  paintAcct();
  if (G.mode === 'recovery' && !$('gate').hidden) return;
  if (st === 'expired' && PAYWALL_LIVE) { gateMode('paywall'); showGate(true); }
  else showGate(false);
}
const daysLeft = (t) => Math.max(0, Math.ceil((Date.parse(t) - Date.now()) / 864e5));
async function payApi(path) {
  const { data } = await ACCT.sb.auth.getSession();
  const r = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 503) throw new Error('Subscriptions are not switched on yet.');
  if (!r.ok || !j.url) throw new Error(j.error || `Payment page did not open (${r.status}).`);
  location.href = j.url;
}
async function startCheckout(btn, say) {
  btn.disabled = true; say('Opening the secure payment page…');
  try { await payApi('/api/checkout'); } catch (e) { say(e.message, true); btn.disabled = false; }
}
// back from Stripe: the webhook can take a few seconds to land
if (/[?&]paid=1/.test(location.search)) {
  history.replaceState(null, '', location.pathname);
  let n = 0; const poll = () => { if (!ACCT.user) { if (n++ < 20) setTimeout(poll, 1500); return; } checkAccess().then(() => { if (ACCT.access?.status !== 'pro' && n++ < 12) setTimeout(poll, 2500); else if (ACCT.access?.status === 'pro') { status('You are subscribed. Thank you!'); adConversion('purchase', { value: 100, currency: 'USD' }); } }); };
  setTimeout(poll, 1500);
}
async function syncAll(first) {
  if (!ACCT.user || ACCT.busy) { ACCT.again = true; return; }
  ACCT.busy = true; $('acctSync').textContent = 'Syncing…';
  try {
    await syncSettings(first); await syncSpots(); await tripSync(); await checkAccess().catch(() => {});
    $('acctSync').textContent = `Synced ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  } catch (e) {
    $('acctSync').textContent = navigator.onLine ? 'Sync failed: will retry' : 'Offline: will sync when you reconnect';
    console.warn('sync', e);
  } finally {
    ACCT.busy = false;
    if (ACCT.again) { ACCT.again = false; setTimeout(() => syncAll(), 1500); }
  }
}
const queueSync = () => { if (!ACCT.user) return; clearTimeout(ACCT.pushT); ACCT.pushT = setTimeout(() => syncAll(), 1200); };
ACCT_HOOK.spots = queueSync;
ACCT_HOOK.settings = () => { if (ACCT.applying) return; store.set('settingsU', Date.now()); queueSync(); };
// ---------- Sign-in screen: the app opens behind it until there's an account ----------
const G = { mode: 'signin' };
const gMsg = (t, bad) => { const m = $('gMsg'); m.innerHTML = t || ''; m.classList.toggle('bad', !!bad); };
function showGate(on) { $('gate').hidden = !on; document.body.classList.toggle('gated', on); }
function gateMode(m) {
  G.mode = m; gMsg('');
  const T = {
    signin: ['Sign in', 'Welcome back. Your spots and settings are waiting.', 'Sign in', 'current-password'],
    signup: ['Start your free trial', '5 days free, no card needed. Then $100 a year. Your spots and settings follow you to every device. We use your phone and email for your account and to check in about your trial.', 'Create account', 'new-password'],
    forgot: ['Reset your password', 'Enter your email and we will send you a link to set a new password.', 'Email me a reset link', ''],
    recovery: ['Set a new password', 'Choose a new password for your account.', 'Save password', 'new-password'],
    paywall: ['Your free trial has ended', `Keep every chart, every layer and your saved spots for ${PRICE_TXT}. Cancel any time.`, `Subscribe · ${PRICE_TXT}`, ''],
  }[m];
  $('gTitle').textContent = T[0]; $('gSub').textContent = T[1]; $('gGo').textContent = T[2];
  $('gNames').hidden = $('gPhone').hidden = $('gPort').hidden = m !== 'signup';
  if (m === 'signup' && $('gPort').options.length < 2) {
    // home ports grouped like the Jump-to menu, with the current one picked
    $('gPort').innerHTML = '<option value="">Home port…</option>' + ZONE_GROUPS.map(([label, keys]) => {
      const ports = PORTS.filter((p) => keys.some((k) => { const v = ZONES[k].view; return p[1] >= v[0][0] - 1.5 && p[1] <= v[1][0] + 1.5 && p[2] >= v[0][1] - 1.5 && p[2] <= v[1][1] + 1.5; }));
      return `<optgroup label="${label}">${ports.map((p) => `<option>${p[0]}</option>`).join('')}</optgroup>`;
    }).join('');
    // a port can sit in two neighbouring areas: keep its first listing only
    const seen = new Set(); [...$('gPort').querySelectorAll('option')].forEach((o) => { if (o.value && seen.has(o.value)) o.remove(); else seen.add(o.value); });
  }
  $('gEmail').hidden = m === 'recovery' || m === 'paywall'; $('gPass').hidden = m === 'forgot' || m === 'paywall';
  $('gPayLinks').hidden = m !== 'paywall';
  $('gPass').autocomplete = T[3]; $('gPass').placeholder = m === 'signin' ? 'Password' : 'Password (8+ characters)';
  $('gToSignup').textContent = m === 'signin' ? 'Create an account' : 'I already have an account';
  $('gForgot').hidden = m !== 'signin';
  $('gLinks').hidden = m === 'recovery' || m === 'paywall';
}
const gErr = (e) => {
  const t = e?.message || String(e);
  if (/invalid login/i.test(t)) return 'Wrong email or password.';
  if (/not confirmed/i.test(t)) return 'Confirm your email first: open the link we sent you (check spam too). <a href="#" id="gResend">Send it again</a>';
  if (/rate limit|too many/i.test(t)) return 'Too many emails went out in the last hour. Try again a bit later.';
  if (/already registered/i.test(t)) return 'That email already has an account. Sign in instead.';
  if (/password/i.test(t) && /(short|length|at least)/i.test(t)) return 'Use a password with at least 8 characters.';
  if (/fetch|network/i.test(t)) return navigator.onLine ? 'Could not reach the sign-in server. Try again.' : 'You are offline. Connect to sign in.';
  return t;
};
// Ad attribution (track.js, shared with the website): where this person first came from, and conversion pings
const adSource = () => { try { return window.blSource ? window.blSource() : null; } catch (e) { return null; } };
const adConversion = (name, extra) => { try { window.blTrack?.(name, extra); } catch (e) { /* never block sign-up */ } };
async function gateSubmit(ev) {
  ev.preventDefault();
  if (G.mode === 'paywall') { startCheckout($('gGo'), gMsg); return; }
  const sb = sbInit(), email = $('gEmail').value.trim(), password = $('gPass').value;
  if (!sb) { gMsg('Could not load sign-in. Reload the page.', true); return; }
  if (G.mode !== 'recovery' && !/^\S+@\S+\.\S+$/.test(email)) { gMsg('Enter your email address.', true); return; }
  const clean = (x) => x.trim().replace(/\s+/g, ' ');
  const first = clean($('gFirst').value), last = clean($('gLast').value), fullName = `${first} ${last}`.trim(), phone = $('gPhone').value.trim(), port = $('gPort').value;
  if (G.mode === 'signup' && (!first || !last)) { gMsg('Enter your first and last name.', true); return; }
  if (G.mode === 'signup' && phone.replace(/\D/g, '').length < 10) { gMsg(phone ? 'Check the phone number (10 digits, with area code).' : 'Enter your phone number.', true); return; }
  if (G.mode === 'signup' && !port) { gMsg('Pick your home port (the closest inlet if yours isn\'t listed).', true); return; }
  if ((G.mode === 'signup' || G.mode === 'recovery') && password.length < 8) { gMsg('Use a password with at least 8 characters.', true); return; }
  $('gGo').disabled = true; gMsg('One moment…');
  const back = location.origin + '/app';
  try {
    if (G.mode === 'signin') {
      const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; gMsg('');
    } else if (G.mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: back, data: { full_name: fullName, first_name: first, last_name: last, phone, home_port: port, src: adSource() } } }); if (error) throw error;
      // start them at their home port (this also syncs to the account once they're in)
      if (PORTS.some((x) => x[0] === port)) { hp.value = port; hp.dispatchEvent(new Event('change')); }
      adConversion('sign_up');
      if (data.session) gMsg('');
      else if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) {
        // Supabase answers a sign-up for an existing email with a fake success and sends nothing
        gateMode('signin'); $('gEmail').value = email;
        gMsg('That email already has a Breakline account. Sign in, or tap <b>Forgot password?</b> if you never set one.', true);
      } else { gateMode('signin'); $('gEmail').value = email; gMsg(`Almost there: we sent a confirmation link to <b>${email.replace(/</g, '&lt;')}</b>. Open it, then sign in here. (Check spam if it doesn't show up.)`); }
    } else if (G.mode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back }); if (error) throw error;
      gMsg(`If ${email.replace(/</g, '&lt;')} has an account, a reset link is on its way.`);
    } else if (G.mode === 'recovery') {
      const { error } = await sb.auth.updateUser({ password }); if (error) throw error;
      gMsg(''); showGate(false); status('Password updated.');
    }
  } catch (e) { gMsg(gErr(e), true); }
  finally { $('gGo').disabled = false; }
}
if (SB_URL && SB_KEY) {
  $('gForm').onsubmit = gateSubmit;
  $('gToSignup').onclick = (e) => { e.preventDefault(); gateMode(G.mode === 'signin' ? 'signup' : 'signin'); };
  $('gForgot').onclick = (e) => { e.preventDefault(); gateMode('forgot'); };
  $('gMsg').addEventListener('click', async (e) => {
    if (e.target.id !== 'gResend') return; e.preventDefault();
    const { error } = await ACCT.sb.auth.resend({ type: 'signup', email: $('gEmail').value.trim(), options: { emailRedirectTo: location.origin + '/app' } });
    gMsg(error ? gErr(error) : 'Sent. Open the newest email.', !!error);
  });
  $('acctOutBtn').onclick = async () => {
    if (!confirm('Sign out of Breakline on this device?')) return;
    await ACCT.sb.auth.signOut(); ACCT.plan = 'free'; ACCT.access = null; localStorage.removeItem('breakline.access'); paintAcct();
  };
  $('acctSyncNow').onclick = () => syncAll();
  $('acctSubscribe').onclick = () => startCheckout($('acctSubscribe'), acctMsg);
  $('acctManage').onclick = async () => { $('acctManage').disabled = true; try { await payApi('/api/portal'); } catch (e) { acctMsg(e.message, true); } $('acctManage').disabled = false; };
  $('gPayOut').onclick = async (e) => { e.preventDefault(); await ACCT.sb.auth.signOut(); };
  $('gPayCheck').onclick = async (e) => { e.preventDefault(); gMsg('Checking…'); await checkAccess(); if (ACCT.access?.status === 'expired') gMsg('No subscription found yet. If you just paid, give it a minute.', true); };
  addEventListener('online', queueSync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueSync(); });
  gateMode(/[?&]signup/.test(location.search) ? 'signup' : 'signin');
  // a saved session opens straight into the chart; otherwise the sign-in screen waits for the session check
  const had = !!localStorage.getItem('breakline.auth');
  showGate(!had);
  if (had && ACCT.access?.status === 'expired' && PAYWALL_LIVE) { gateMode('paywall'); showGate(true); }
  if (!sbInit()) { gMsg('Could not load sign-in. Check your connection and reload.', true); showGate(true); }
  else ACCT.sb.auth.getSession().then(({ data }) => { if (!data.session && !/access_token|type=recovery/.test(location.hash)) showGate(true); });
  paintAcct();
} else showGate(false);

drawWpts();
refresh();
window.__S = S; window.__map = map; window.__ACCT = ACCT;
// inshore layers: NOAA chart + high-res bottom follow the view
syncEnc();
map.on('moveend', queueHiDem);
queueHiDem();

// ---------- Water alerts: save the water you're in (or any Find your water search) and get told when it's back ----------
// Alerts live in the account (water_alerts). After every saved-chart update the server re-runs each one
// (api/check-alerts.js) and emails when the water shows up inside your run; the app shows "matching now".
S.alerts = [];
function fwCriteria() {
  fwFromUi();
  const f = JSON.parse(JSON.stringify(S.fw)), port = PORTS.find((x) => x[0] === f.port) || PORTS.find((x) => x[0] === S.home);
  return { ...f, port: port[0], portLat: port[1], portLon: port[2], run: f.run || S.maxRun };
}
// "Find this water again": the conditions at a tapped spot become Find your water settings
async function matchHere(lat, lng) {
  const [c] = await tripConditions([[lat, lng]]), f = S.fw;
  if (!c || c.T == null) { status('No saved water readings at that spot yet (clouds or outside the saved areas).', true); return; }
  Object.assign(f.temp, { on: true, lo: Math.floor((c.T - 1.5) * 2) / 2, hi: Math.ceil((c.T + 1.5) * 2) / 2 });
  if (c.chl != null) Object.assign(f.chl, { on: true, lo: +(c.chl * 0.7).toFixed(2), hi: +(c.chl * 1.4).toFixed(2) });
  else f.chl.on = false;
  if (c.fm != null) Object.assign(f.depth, { on: c.fm >= 10, lo: Math.round(c.fm * 0.6), hi: Math.round(c.fm * 1.6) });
  if (c.kt != null) Object.assign(f.cur, { on: false, lo: null, hi: +(c.kt + 0.5).toFixed(1) });
  Object.assign(f.front, { on: c.brk >= 0.27, mode: 'on' });
  if (c.sal != null) Object.assign(f.sal, { on: false, mode: 'range', lo: +(c.sal - 0.3).toFixed(1), hi: +(c.sal + 0.3).toFixed(1) });
  f.tempSrc = 'hourly'; if (!f.port) f.port = S.home;
  store.set('fw', f); fwToUi();
  map.closePopup();
  $('fwPanel').hidden = false; $('btnFind').classList.add('open'); $('fishPanel').hidden = true; $('anaPanel').hidden = true; $('tripPanel').hidden = true;
  $('fwMsg').classList.remove('err');
  $('fwMsg').innerHTML = `Set from that spot: ${condTxt(c)}. Tap <b>Find water</b> to see where it is now, or <b>Save as alert</b> to be told when it shows up within ${f.run || S.maxRun} nm of ${esc(f.port || S.home)}.`;
}
async function alertsLoad() {
  const sb = ACCT.sb; if (!sb || !ACCT.user) { S.alerts = []; alertsUi(); return; }
  const { data, error } = await sb.from('water_alerts').select('*').order('created_at');
  if (!error) { S.alerts = data; alertsUi(); }
}
function alertName(c) {
  const p = [];
  if (c.temp.on) p.push(`${c.temp.lo ?? ''}-${c.temp.hi ?? ''}°F`);
  if (c.front.on) p.push(c.front.mode === 'off' ? 'off breaks' : 'on a break');
  if (c.chl.on) p.push(`color ${c.chl.lo ?? ''}-${c.chl.hi ?? ''}`);
  if (c.depth.on) p.push(`${c.depth.lo ?? 0}-${c.depth.hi ?? '∞'} fm`);
  if (c.cur.on) p.push(`current ${c.cur.lo ?? 0}-${c.cur.hi ?? ''} kt`);
  if (c.sal.on) p.push(c.sal.mode === 'edge' ? 'salinity edge' : `${c.sal.lo}-${c.sal.hi} PSU`);
  if (c.mld.on) p.push(`MLD ${c.mld.lo ?? 0}-${c.mld.hi ?? ''} ft`);
  return `${p.join(', ') || 'My water'} within ${Math.round(c.run)} nm of ${c.port}`;
}
async function alertSave() {
  const sb = ACCT.sb; if (!sb || !ACCT.user) { $('fwMsg').textContent = 'Sign in to save alerts.'; return; }
  const c = fwCriteria(); if (!FW_KEYS.some((k) => c[k].on)) { $('fwMsg').textContent = 'Turn on at least one thing to look for first.'; return; }
  const name = prompt('Name this alert:', alertName(c).slice(0, 120)); if (name == null) return;
  const minA = +prompt('Smallest patch worth telling you about (square nautical miles):', '5') || 5;
  const row = { id: newId(), user_id: ACCT.user.id, name: (name.trim() || alertName(c)).slice(0, 140), criteria: c, min_nm2: Math.max(1, Math.min(5000, minA)) };
  const { error } = await sb.from('water_alerts').insert(row);
  if (error) { $('fwMsg').textContent = `Couldn't save the alert: ${error.message}`; $('fwMsg').classList.add('err'); return; }
  $('fwMsg').classList.remove('err');
  $('fwMsg').innerHTML = `Saved. Breakline checks it every time new charts land (up to every 10 minutes) and emails ${esc(ACCT.user.email)} when it shows up.`;
  // ask the server to look right away, so "matching now" fills in
  fetch('/api/check-alerts', { method: 'POST' }).then(() => setTimeout(alertsLoad, 1500)).catch(() => {});
  alertsLoad();
}
function alertsUi() {
  const el = $('fwAlerts'); if (!el) return;
  $('fwAlertsHdr').hidden = !S.alerts.length;
  el.innerHTML = S.alerts.map((a) => {
    const m = a.last_match, when = a.last_checked ? new Date(a.last_checked).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'not yet';
    const st = !a.active ? 'Paused' : m ? `<b class="ok">Matching now</b>: ${m.nm2.toLocaleString()} sq nm, biggest ${m.dist} nm @ ${m.brg}°T` : `Not showing yet (checked ${when})`;
    return `<li data-id="${a.id}"><b>${esc(a.name)}</b><small>${st}</small><div class="row"><button class="ghost al-show">Show</button><button class="ghost al-pause">${a.active ? 'Pause' : 'Resume'}</button><button class="ghost al-del">Delete</button></div></li>`;
  }).join('');
}
async function alertShow(a) {
  S.fw = { ...FW_DEF, ...JSON.parse(JSON.stringify(a.criteria)) };
  for (const k of FW_KEYS) S.fw[k] = { ...FW_DEF[k], ...(a.criteria[k] || {}) };
  store.set('fw', S.fw); fwToUi();
  $('fwPanel').hidden = false; $('btnFind').classList.add('open'); ['fishPanel', 'anaPanel', 'tripPanel'].forEach((x) => { $(x).hidden = true; });
  await findWater();
}
$('fwAlerts').addEventListener('click', async (ev) => {
  const li = ev.target.closest('li[data-id]'); if (!li) return; const a = S.alerts.find((x) => x.id === li.dataset.id); if (!a) return;
  if (ev.target.classList.contains('al-show')) alertShow(a);
  if (ev.target.classList.contains('al-pause')) { await ACCT.sb.from('water_alerts').update({ active: !a.active, updated_at: new Date().toISOString() }).eq('id', a.id); alertsLoad(); }
  if (ev.target.classList.contains('al-del') && confirm(`Delete the alert "${a.name}"?`)) { await ACCT.sb.from('water_alerts').delete().eq('id', a.id); alertsLoad(); }
});
$('fwAlert').onclick = alertSave;
// the link in an alert email: /app?alert=<id> opens it and shows the matching water
const ALERT_LINK = (location.search.match(/[?&]alert=([0-9a-f-]{36})/i) || [])[1];
async function alertFromLink() {
  if (!ALERT_LINK || !ACCT.user) return;
  history.replaceState(null, '', location.pathname);
  const { data } = await ACCT.sb.from('water_alerts').select('*').eq('id', ALERT_LINK).maybeSingle();
  if (data) alertShow(data);
}
ACCT_HOOK.alerts = () => { alertsLoad(); alertFromLink(); };

// ---------- Track my day: record the run, then at the end ask why you turned and what you caught where ----------
// The track and catches stay on the phone and sync to the account (trips / catches tables). Every catch keeps the
// water it came out of, and once there are 3+ of a species, Where to fish and Find your water tune to them.
// Phones pause web GPS when the screen locks, so recording keeps the screen awake (Wake Lock) while it runs.
const WHY = ['Temp break', 'Color change', 'Weed line', 'Birds', 'Bait', 'Marks on the sounder', 'Bite / hookup', 'Current edge', 'Bottom / structure', 'Other boats', 'Just searching', 'Weather / seas'];
const TRIP = { watch: null, lock: null, layer: L.layerGroup().addTo(map), review: null };
S.trip = store.get('tripLive', null);               // the day being recorded, saved after every point
S.trips = store.get('trips', []);                   // finished days on this device (track thinned)
S.catches = store.get('catches', []);
const tripSave = () => store.set('tripLive', S.trip);
const nmBetween = (a, b) => rangeBearing([a[1], a[2]], [b[1], b[2]])[0];
function tripNm(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += nmBetween(pts[i - 1], pts[i]); return d; }
const hhmm = (ms) => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
const spLabel = (k) => SPECIES[k]?.label || k;

function tripStart() {
  if (!navigator.geolocation) { status('This device has no location service.', true); return; }
  S.trip = { id: newId(), start: Date.now(), pts: [] }; tripSave();
  tripWatch(); tripUi();
}
async function tripWakeLock() {
  try { if ('wakeLock' in navigator && $('tripAwake').checked && !TRIP.lock) { TRIP.lock = await navigator.wakeLock.request('screen'); TRIP.lock.addEventListener('release', () => { TRIP.lock = null; }); } } catch (e) { /* not allowed right now */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.trip) tripWakeLock(); });
function tripWatch() {
  if (TRIP.watch != null) return;
  tripWakeLock();
  TRIP.watch = navigator.geolocation.watchPosition((p) => {
    if (!S.trip || p.coords.accuracy > 150) return;
    const t = p.timestamp || Date.now(), la = p.coords.latitude, lo = p.coords.longitude, last = S.trip.pts[S.trip.pts.length - 1];
    let kt = p.coords.speed != null ? p.coords.speed * 1.94384 : NaN;
    if (last) {
      const d = nmBetween(last, [0, la, lo]), dt = (t - last[0]) / 3600e3;
      if (kt !== kt && dt > 0) kt = d / dt;
      // keep a point every 20 s once you've moved 30 m, and at least every 2 min
      if (!((t - last[0] > 20e3 && d > 0.016) || t - last[0] > 120e3)) return;
    }
    S.trip.pts.push([t, +la.toFixed(5), +lo.toFixed(5), kt === kt ? +kt.toFixed(1) : null]);
    tripSave(); tripDraw(); tripUi();
  }, (e) => { if (e.code === 1) { showLocHelp(); } }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 60000 });
}
function tripStopWatch() {
  if (TRIP.watch != null) navigator.geolocation.clearWatch(TRIP.watch);
  TRIP.watch = null; try { TRIP.lock?.release(); } catch (e) { /* already released */ } TRIP.lock = null;
}

// Where you stopped (under 2 kt for 8+ minutes) and where you turned hard while moving (60°+ over ~2 minutes).
// Skips the first and last mile out of the inlet so the run out and back doesn't count.
function tripEvents(pts) {
  const ev = [], nearPort = (la, lo) => PORTS.some((p) => rangeBearing([p[1], p[2]], [la, lo])[0] < 1.5);
  const spd = pts.map((p, i) => (p[3] != null ? p[3] : i ? nmBetween(pts[i - 1], p) / Math.max(1e-6, (p[0] - pts[i - 1][0]) / 3600e3) : 0));
  for (let i = 0; i < pts.length;) {
    if (spd[i] >= 2) { i++; continue; }
    let j = i; while (j + 1 < pts.length && spd[j + 1] < 2) j++;
    if (pts[j][0] - pts[i][0] >= 8 * 60e3) {
      const seg = pts.slice(i, j + 1), la = seg.reduce((s, p) => s + p[1], 0) / seg.length, lo = seg.reduce((s, p) => s + p[2], 0) / seg.length;
      if (!nearPort(la, lo)) ev.push({ type: 'stop', t: pts[i][0], t1: pts[j][0], lat: +la.toFixed(5), lon: +lo.toFixed(5) });
    }
    i = j + 1;
  }
  const at = (t) => { let k = 0; while (k + 1 < pts.length && pts[k + 1][0] <= t) k++; return k; };
  const turns = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (spd[i] < 3) continue;
    const a = pts[at(pts[i][0] - 120e3)], b = pts[i], c = pts[Math.min(pts.length - 1, at(pts[i][0] + 120e3) + 1)];
    if (a === b || b === c || nmBetween(a, b) < 0.1 || nmBetween(b, c) < 0.1) continue;
    const h1 = rangeBearing([a[1], a[2]], [b[1], b[2]])[1], h2 = rangeBearing([b[1], b[2]], [c[1], c[2]])[1];
    const d = Math.abs(((h2 - h1 + 540) % 360) - 180);
    if (d >= 60 && !nearPort(b[1], b[2])) turns.push({ type: 'turn', t: b[0], lat: b[1], lon: b[2], turn: Math.round(d), dir: ((h2 - h1 + 360) % 360) < 180 ? 'right' : 'left' });
  }
  // one question per turn: keep the sharpest within 10 minutes, and none during a stop
  for (const tn of turns.sort((x, y) => y.turn - x.turn)) {
    if (ev.some((e) => Math.abs(e.t - tn.t) < 10 * 60e3 || (e.t1 && tn.t >= e.t && tn.t <= e.t1))) continue;
    ev.push(tn);
  }
  return ev.sort((x, y) => x.t - y.t).slice(0, 20).map((e) => ({ ...e, why: [], note: '' }));
}

// The water at a spot, from Breakline's saved charts (same sources as Find your water)
async function tripConditions(points) {
  await preReady; await bathy2Ready;
  const out = points.map(() => ({}));
  if (!PRE || !points.length) return out;
  const zone = preZoneAt({ lat: points[0][0], lng: points[0][1] }); if (!zone) return out;
  const [T, Tb, chl, cur, sal] = await Promise.all([preGoesFill(zone), preBlend(zone), preChlBest(zone), preCurrents(zone), preLatestGrid(zone, 'sss/smap', PRODUCTS.sss.conv)].map((p) => p.catch(() => null)));
  const tg = T ? gradNm(T) : Tb ? gradNm(Tb) : null;
  points.forEach(([la, lo], i) => {
    const r = out[i], b = bathyFromStatic({ s: la - 0.1, n: la + 0.1, w: lo - 0.1, e: lo + 0.1 });
    let t = T ? sample(T, la, lo) : NaN; if (t !== t && Tb) t = sample(Tb, la, lo);
    if (t === t) r.T = +t.toFixed(1);
    const z = b ? sample(b, la, lo) : NaN; if (z < 0) r.fm = Math.round(-z / FATHOM);
    const c = chl ? sample(chl, la, lo) : NaN; if (c === c) r.chl = +c.toFixed(3);
    if (cur) { const u = sample(cur, la, lo, cur.u), v = sample(cur, la, lo, cur.vv); if (u === u && v === v) r.kt = +(Math.hypot(u, v) * 1.94384).toFixed(2); }
    const g = tg ? sample(tg, la, lo) : NaN; if (g === g) r.brk = +g.toFixed(2);
    const s = sal ? sample(sal, la, lo) : NaN; if (s === s) r.sal = +s.toFixed(2);
  });
  return out;
}
const condTxt = (c) => [c.T != null && `${c.T}°F`, c.fm != null && `${c.fm.toLocaleString()} fm`, c.chl != null && `${c.chl < 1 ? c.chl.toFixed(2) : c.chl.toFixed(1)} mg/m³`, c.kt != null && `${c.kt.toFixed(1)} kt`, c.brk >= 0.27 && 'on a break'].filter(Boolean).join(' · ');

async function tripStop() {
  if (!S.trip) return;
  tripStopWatch();
  const t = S.trip; t.end = Date.now();
  t.events = tripEvents(t.pts);
  const conds = await tripConditions(t.events.map((e) => [e.lat, e.lon]));
  t.events.forEach((e, i) => { e.c = conds[i]; });
  TRIP.review = t; S.trip = null; tripSave();
  tripUi(); tripDraw();
  if (t.pts.length > 1) map.fitBounds(L.latLngBounds(t.pts.map((p) => [p[1], p[2]])).pad(0.15));
}
function tripReviewPast(id) {
  const t = S.trips.find((x) => x.id === id); if (!t) return;
  TRIP.review = JSON.parse(JSON.stringify(t)); TRIP.review.saved = true;
  tripUi(); tripDraw();
  if (t.pts.length > 1) map.fitBounds(L.latLngBounds(t.pts.map((p) => [p[1], p[2]])).pad(0.15));
}

// species list for a spot: offshore and inshore species for that ocean, plus anything already logged
function speciesNear(la, lo) {
  const keys = speciesFor(oceanAt(la, lo), la, lo).map(([k]) => k);
  for (const c of S.catches) if (!keys.includes(c.species)) keys.push(c.species);
  return keys;
}
function catchForm(ev, idx) {
  const opts = speciesNear(ev.lat, ev.lon).map((k) => `<option value="${k}">${esc(spLabel(k))}</option>`).join('');
  return `<div class="tc-add" data-i="${idx}"><select class="tc-sp"><option value="">Caught something here?</option>${opts}<option value="__other">Other…</option></select>` +
    `<input class="tc-n" type="number" min="1" max="500" value="1" aria-label="How many"><button class="ghost tc-go">Add</button></div>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function tripUi() {
  const live = !!S.trip, rv = TRIP.review;
  $('tripIdle').hidden = live || !!rv; $('tripLive').hidden = !live; $('tripReview').hidden = !rv;
  $('tripChip').hidden = !live;
  $('btnTrip').classList.toggle('rec', live);
  if (live) {
    const p = S.trip.pts, el = Date.now() - Math.min(S.trip.start, p[0]?.[0] ?? S.trip.start), nm = tripNm(p);
    $('tripStats').textContent = `${hhmm(el)} on the water · ${nm.toFixed(1)} nm · ${p.length} points${TRIP.watch == null ? ' · GPS paused' : ''}`;
    $('tripChip').textContent = `● Tracking ${hhmm(el)} · ${nm.toFixed(1)} nm`;
  }
  if (rv) {
    const nm = tripNm(rv.pts), mine = S.catches.filter((c) => c.trip_id === rv.id && !c.deleted);
    $('tripSum').textContent = `${new Date(rv.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${hhmm((rv.end || rv.start) - Math.min(rv.start, rv.pts[0]?.[0] ?? rv.start))} · ${nm.toFixed(1)} nm · ${rv.events.length} stops and turns`;
    $('tripEvents').innerHTML = rv.events.map((e, i) => `<li data-i="${i}">
      <b>${i + 1}. ${e.type === 'stop' ? `Stopped ${hhmm(e.t1 - e.t)}` : `Turned ${e.turn}° ${e.dir}`}</b>
      <small>${new Date(e.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${fmtLL(e.lat, e.lon)}${e.c && condTxt(e.c) ? `<br>${condTxt(e.c)}` : ''}</small>
      <div class="why">${e.type === 'stop' ? 'What was here?' : 'Why did you turn?'}</div>
      <div class="chips">${WHY.map((w) => `<button class="chip${e.why.includes(w) ? ' on' : ''}" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      <input class="tc-note" placeholder="Anything else? (optional)" value="${esc(e.note || '')}">
      ${mine.filter((c) => c.ev === i).map((c) => `<div class="tc-row">🐟 ${c.n} ${esc(spLabel(c.species))} <button class="x tc-del" data-id="${c.id}" title="Remove">&times;</button></div>`).join('')}
      ${catchForm(e, i)}</li>`).join('') || '<li><small>No stops or hard turns found. Add your catches on the map below.</small></li>';
    $('tripOther').innerHTML = mine.filter((c) => c.ev == null).map((c) => `<div class="tc-row">🐟 ${c.n} ${esc(spLabel(c.species))} · ${fmtLL(c.lat, c.lon)} <button class="x tc-del" data-id="${c.id}" title="Remove">&times;</button></div>`).join('');
    $('tripSave').textContent = rv.saved ? 'Save changes' : 'Save my day';
  }
  $('tripList').innerHTML = S.trips.slice(-8).reverse().map((t) => {
    const n = S.catches.filter((c) => c.trip_id === t.id && !c.deleted).reduce((s, c) => s + c.n, 0);
    return `<li><button class="ghost" data-id="${t.id}">${new Date(t.start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${(t.nm || 0).toFixed(0)} nm · ${n} fish</button></li>`;
  }).join('');
  $('tripList').querySelectorAll('button').forEach((b) => { b.onclick = () => tripReviewPast(b.dataset.id); });
  tripLearnTxt();
}
function tripLearnTxt() {
  const sp = S.species, L2 = learned(sp), n = S.catches.filter((c) => !c.deleted && c.species === sp).length;
  $('tripLearn').innerHTML = L2 ? `Where to fish is tuned to your <b>${L2.n} ${esc(spLabel(sp).toLowerCase())}</b> catches: ${L2.T ? `${L2.T[0]}-${L2.T[1]}°F` : ''}${L2.fm ? `, ${L2.fm[0]}-${L2.fm[1]} fm` : ''}.`
    : `Log ${Math.max(0, 3 - n)} more ${esc(spLabel(sp).toLowerCase())} and Where to fish starts tuning to the water you catch them in.`;
}
function tripDraw() {
  TRIP.layer.clearLayers();
  const t = S.trip || TRIP.review;
  if (t && t.pts.length > 1) L.polyline(t.pts.map((p) => [p[1], p[2]]), { color: S.trip ? '#ff5a5f' : '#ffd23f', weight: 3, opacity: 0.9, interactive: false }).addTo(TRIP.layer);
  if (TRIP.review) TRIP.review.events.forEach((e, i) => L.marker([e.lat, e.lon], { icon: L.divIcon({ className: '', html: `<div class="trip-ev ${e.type}">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
    .on('click', () => { $('tripPanel').hidden = false; $('tripEvents').querySelector(`li[data-i="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }).addTo(TRIP.layer));
  if (S.ov.catches !== false) for (const c of S.catches) if (!c.deleted) L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', html: `<div class="catch-pin" title="${esc(`${c.n} ${spLabel(c.species)}`)}">🐟</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(TRIP.layer);
}
async function addCatch(species, n, la, lo, ev) {
  const rv = TRIP.review, e = ev != null && rv ? rv.events[ev] : null;
  const [c] = e?.c ? [e.c] : await tripConditions([[la, lo]]);
  S.catches.push({ id: newId(), trip_id: rv?.id || null, ev, species, n: Math.max(1, Math.min(500, n | 0 || 1)), lat: +la.toFixed(5), lon: +lo.toFixed(5),
    t: new Date(e?.t || Date.now()).toISOString(), why: e?.why || [], c, u: Date.now() });
  store.set('catches', S.catches); tripUi(); tripDraw(); tripSync();
}
// a catch logged on the water: tied to the day being recorded, placed where the boat is now
async function addCatchLive(sp, last) {
  const [c] = await tripConditions([[last[1], last[2]]]);
  S.catches.push({ id: newId(), trip_id: S.trip.id, ev: null, species: sp, n: 1, lat: last[1], lon: last[2], t: new Date(last[0]).toISOString(), why: [], c, u: Date.now() });
  store.set('catches', S.catches); tripDraw(); status(`Logged: ${spLabel(sp)}.`);
}
async function tripSaveDay() {
  const rv = TRIP.review; if (!rv) return;
  rv.nm = +tripNm(rv.pts).toFixed(1);
  // keep the phone's copy small: at most ~1,500 points per day
  if (rv.pts.length > 1500) { const k = Math.ceil(rv.pts.length / 1500); rv.pts = rv.pts.filter((p, i) => i % k === 0 || i === rv.pts.length - 1); }
  // the reasons given at a spot travel with the catches logged there (the model weighs them)
  for (const c of S.catches) if (c.trip_id === rv.id && c.ev != null && rv.events[c.ev]) { c.why = rv.events[c.ev].why; c.u = Date.now(); }
  const i = S.trips.findIndex((x) => x.id === rv.id), copy = { ...rv, u: Date.now() }; delete copy.saved;
  if (i >= 0) S.trips[i] = copy; else S.trips.push(copy);
  store.set('trips', S.trips); store.set('catches', S.catches);
  TRIP.review = null; tripUi(); tripDraw(); tripSync();
  status('Day saved. Your catches now help pick where to fish.');
  if (S.prod === 'fish') buildFish(), chart.draw();
}
// account sync: last change wins, like spots
async function tripSync() {
  const sb = ACCT.sb, uid = ACCT.user?.id; if (!sb || !uid) return;
  try {
    const sent = store.get('tripSent', 0);
    const trips = S.trips.filter((t) => (t.u || 0) > sent).map((t) => ({ id: t.id, user_id: uid, started_at: new Date(t.start).toISOString(), ended_at: t.end ? new Date(t.end).toISOString() : null,
      nm: t.nm, track: t.pts.map((p) => [Math.round(p[0] / 1000), p[1], p[2], p[3]]), events: t.events, updated_at: new Date(t.u).toISOString() }));
    if (trips.length) { const { error } = await sb.from('trips').upsert(trips); if (error) throw error; }
    const cs = S.catches.filter((c) => (c.u || 0) > sent).map((c) => ({ id: c.id, user_id: uid, trip_id: c.trip_id && S.trips.some((t) => t.id === c.trip_id) ? c.trip_id : null, species: c.species, n: c.n,
      lat: c.lat, lon: c.lon, caught_at: c.t, why: c.why || [], conditions: c.c || null, note: c.note || null, deleted_at: c.deleted ? new Date(c.u).toISOString() : null, updated_at: new Date(c.u).toISOString() }));
    if (cs.length) { const { error } = await sb.from('catches').upsert(cs); if (error) throw error; }
    // pull what other devices logged
    const { data: rc, error: e3 } = await sb.from('catches').select('id,trip_id,species,n,lat,lon,caught_at,why,conditions,note,deleted_at,updated_at');
    if (e3) throw e3;
    const have = new Map(S.catches.map((c) => [c.id, c]));
    for (const r of rc) {
      const l = have.get(r.id), ru = Date.parse(r.updated_at);
      if (l && (l.u || 0) >= ru) continue;
      const c = { id: r.id, trip_id: r.trip_id, species: r.species, n: r.n, lat: r.lat, lon: r.lon, t: r.caught_at, why: r.why || [], c: r.conditions, note: r.note, deleted: !!r.deleted_at, u: ru, ev: l?.ev };
      if (l) Object.assign(l, c); else S.catches.push(c);
    }
    const { data: rt, error: e4 } = await sb.from('trips').select('id,started_at,ended_at,nm,track,events,updated_at');
    if (e4) throw e4;
    for (const r of rt) {
      const l = S.trips.find((t) => t.id === r.id), ru = Date.parse(r.updated_at);
      if (l && (l.u || 0) >= ru) continue;
      const t = { id: r.id, start: Date.parse(r.started_at), end: r.ended_at ? Date.parse(r.ended_at) : null, nm: r.nm, pts: (r.track || []).map((p) => [p[0] * 1000, p[1], p[2], p[3]]), events: r.events || [], u: ru };
      if (l) Object.assign(l, t); else S.trips.push(t);
    }
    S.trips.sort((a, b) => a.start - b.start);
    store.set('trips', S.trips); store.set('catches', S.catches); store.set('tripSent', Date.now());
    tripUi(); tripDraw();
  } catch (e) { console.warn('trip sync', e); }
}

// What your catches say about a species: the water you actually caught them in (needs 3+)
const pctl = (a, p) => { const v = a.filter((x) => x != null && x === x).sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(p * (v.length - 1) + 0.5))] : null; };
function learned(sp) {
  const cs = (S.catches || []).filter((c) => !c.deleted && c.species === sp && c.c);
  const n = cs.reduce((s, c) => s + 1, 0); if (n < 3) return null;
  const col = (k) => cs.map((c) => c.c[k]).filter((x) => x != null), out = { n };
  const tv = col('T'); if (tv.length >= 3) out.T = [Math.round(pctl(tv, 0.1) - 1), Math.round(pctl(tv, 0.9) + 1)];
  const fv = col('fm'); if (fv.length >= 3) out.fm = [Math.max(0, Math.round(pctl(fv, 0.1) * 0.8)), Math.round(pctl(fv, 0.9) * 1.2)];
  const cv = col('chl'); if (cv.length >= 3) out.chl = [+(pctl(cv, 0.1) * 0.8).toFixed(2), +(pctl(cv, 0.9) * 1.25).toFixed(2)];
  const kv = col('kt'); if (kv.length >= 3) out.kt = [0, +(pctl(kv, 0.9) + 0.3).toFixed(1)];
  const bv = col('brk'); if (bv.length >= 3) out.onBreak = bv.filter((x) => x >= 0.2).length / bv.length;
  const tally = {}; for (const c of cs) for (const w of c.why || []) tally[w] = (tally[w] || 0) + 1;
  out.why = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v / n]));
  return out;
}
// Species settings for Where to fish, nudged by your catches: your temp window, and more weight on what you say finds fish
function tunedSpecies(sp, key) {
  const L2 = learned(key); if (!L2) return sp;
  // shrink toward the species' usual window until there are plenty of catches (3 catches = half and half)
  const mix = (mine, usual) => Math.round((mine * L2.n + usual * 3) / (L2.n + 3) * 2) / 2;
  const lo = L2.T ? mix(L2.T[0], sp.t[1]) : sp.t[1], hi = L2.T ? mix(L2.T[1], sp.t[2]) : sp.t[2];
  const t = L2.T ? [Math.min(sp.t[0], lo - 3), lo, hi, Math.max(sp.t[3], hi + 3)] : sp.t;
  const w = { ...sp.w }, sum = Object.values(sp.w).reduce((s, x) => s + x, 0), y = L2.why || {};
  if ((y['Temp break'] || 0) >= 0.3 || (L2.onBreak || 0) >= 0.5) w.brk += 0.1;
  if ((y['Color change'] || 0) >= 0.3) w.chl += 0.1;
  if ((y['Bottom / structure'] || 0) >= 0.3) w.bot += 0.1;
  if ((y['Current edge'] || 0) >= 0.3) w.eddy += 0.1;
  const s2 = Object.values(w).reduce((s, x) => s + x, 0); for (const k in w) w[k] = w[k] * sum / s2;
  return { ...sp, t, w, fm: L2.fm ? Math.min(sp.fm, L2.fm[0]) : sp.fm, tuned: L2 };
}

// panel wiring
$('btnTrip').onclick = () => { const open = $('tripPanel').hidden; ['fishPanel', 'anaPanel', 'fwPanel'].forEach((x) => { $(x).hidden = true; }); $('tripPanel').hidden = !open; tripUi(); };
$('tripClose').onclick = () => { $('tripPanel').hidden = true; };
$('tripChip').onclick = () => { $('tripPanel').hidden = false; tripUi(); };
$('tripGo').onclick = tripStart;
$('tripEnd').onclick = () => { if (confirm('Stop tracking and review your day?')) tripStop(); };
$('tripAwake').checked = store.get('tripAwake', true);
$('tripAwake').onchange = () => { store.set('tripAwake', $('tripAwake').checked); if ($('tripAwake').checked) tripWakeLock(); else { try { TRIP.lock?.release(); } catch (e) { /* none */ } } };
$('tripSave').onclick = tripSaveDay;
$('tripDiscard').onclick = () => { if (!TRIP.review) return; if (!TRIP.review.saved && !confirm('Throw this day away? The track and its catches won\'t be saved.')) return;
  if (!TRIP.review.saved) { S.catches = S.catches.filter((c) => c.trip_id !== TRIP.review.id); store.set('catches', S.catches); }
  TRIP.review = null; tripUi(); tripDraw(); };
$('tripEvents').addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-i]'); if (!li || !TRIP.review) return; const e = TRIP.review.events[+li.dataset.i];
  if (ev.target.classList.contains('chip')) { const w = ev.target.dataset.w; e.why = e.why.includes(w) ? e.why.filter((x) => x !== w) : [...e.why, w]; ev.target.classList.toggle('on'); }
  if (ev.target.classList.contains('tc-go')) {
    const box = ev.target.closest('.tc-add'); let sp = box.querySelector('.tc-sp').value;
    if (sp === '__other') sp = (prompt('What species?') || '').trim().slice(0, 40);
    if (!sp) return; addCatch(sp, +box.querySelector('.tc-n').value, e.lat, e.lon, +li.dataset.i);
  }
  if (ev.target.classList.contains('tc-del')) tripDelCatch(ev.target.dataset.id);
});
$('tripEvents').addEventListener('input', (ev) => { if (!ev.target.classList.contains('tc-note')) return; const li = ev.target.closest('li[data-i]'); TRIP.review.events[+li.dataset.i].note = ev.target.value.slice(0, 300); });
$('tripOther').addEventListener('click', (ev) => { if (ev.target.classList.contains('tc-del')) tripDelCatch(ev.target.dataset.id); });
function tripDelCatch(id) { const c = S.catches.find((x) => x.id === id); if (!c) return; c.deleted = true; c.u = Date.now(); store.set('catches', S.catches); tripUi(); tripDraw(); tripSync(); }
// "Add a catch on the map": the next tap on the chart drops it there
document.querySelectorAll('.tripPin').forEach((b) => { b.onclick = () => {
  // while tracking, log it right where the boat is; otherwise the next tap on the chart places it
  const last = S.trip?.pts[S.trip.pts.length - 1];
  if (S.trip && last && b.closest('#tripLive')) { const sp = prompt(`What did you catch? (${speciesNear(last[1], last[2]).map(spLabel).join(', ')})`); if (sp) { const k = speciesNear(last[1], last[2]).find((x) => spLabel(x).toLowerCase() === sp.trim().toLowerCase()) || sp.trim(); addCatchLive(k, last); } return; }
  TRIP.pinning = true; status('Tap the chart where you caught it.');
}; });
map.on('click', (e) => {
  if (!TRIP.pinning) return; TRIP.pinning = false; status('');
  const keys = speciesNear(e.latlng.lat, e.latlng.lng), ans = prompt(`What did you catch here?\n${keys.map((k, i) => `${i + 1}. ${spLabel(k)}`).join('\n')}\n\nType a number or a name, then how many (e.g. "1 x3").`);
  if (!ans) return;
  const m = ans.trim().match(/^(.+?)(?:\s*x\s*(\d+))?$/i), pick = m[1].trim(), k = /^\d+$/.test(pick) ? keys[+pick - 1] : (keys.find((x) => spLabel(x).toLowerCase() === pick.toLowerCase()) || pick);
  if (k) addCatch(k, +(m[2] || 1), e.latlng.lat, e.latlng.lng, null);
});
if (S.trip) { tripWatch(); }
tripUi(); tripDraw();
ACCT_HOOK.trips = tripSync;

// ---------- Offshore pack: save the last 48 hours of every chart for your area, for use with no signal ----------
// Everything comes from Breakline's saved copies (GitHub Pages). The service worker serves these files from its
// cache, and the manifest falls back to the saved one, so with no signal every chart, Find your water and the
// picker still work; live-only extras (weather, tides, HF radar, the NOAA nautical chart) need a connection.
const OFF_CACHE = 'breakline-data-v2', OFF_HOURS = 48;
const BOX_LABEL = { east: 'East Coast & Gulf of Mexico', fl: 'Florida, Bahamas & Turks and Caicos', cr: 'Costa Rica & Panama', cabo: 'Cabo & Mag Bay',
  chiapas: 'Chiapas & Guatemala', cancun: 'Cancún & Cozumel', puntacana: 'Punta Cana', stlucia: 'St. Lucia', pr: 'Puerto Rico & Virgin Islands' };
function offZones() {
  const zs = new Set(), add = (la, lo) => { const z = preZoneAt({ lat: la, lng: lo }); if (z) zs.add(z); };
  const hp4 = PORTS.find((x) => x[0] === S.home); if (hp4) add(hp4[1], hp4[2]);
  const c = map.getCenter(); add(c.lat, c.lng);
  return [...zs];
}
function offFiles(zones) {
  const cutHour = new Date(Date.now() - OFF_HOURS * 3600e3).toISOString().slice(0, 13), cutDay = cutHour.slice(0, 10);
  const files = [];
  for (const [k, e] of Object.entries(PRE?.items || {})) {
    if (!e.file || !zones.includes(k.split('/')[0])) continue;
    const when = k.split('/').pop();
    // the latest copy of each daily product, plus every scan and pass from the last 48 h (and the day before, for the blends)
    if (when === 'latest' || (k.includes('/goes/') ? when.slice(0, 13) >= cutHour : when >= addDays(cutDay, -1))) files.push(e.file);
  }
  return files;
}
async function offlinePack() {
  const btn = $('offGo'), msg = (t, err) => { $('offMsg').innerHTML = t; $('offMsg').classList.toggle('err', !!err); };
  if (!('caches' in window)) { msg('This browser can\'t save charts for offline use.', true); return; }
  btn.disabled = true;
  try {
    await loadManifest(); if (!PRE) throw new Error('Couldn\'t reach the saved charts. Try again with signal.');
    const zones = offZones(); if (!zones.length) throw new Error('Breakline doesn\'t save charts for this area yet.');
    const c = await caches.open(OFF_CACHE), files = offFiles(zones);
    // the manifest, so the app knows what it has with no signal
    await c.put(`${LIVE_BASE}manifest.json`, new Response(JSON.stringify(PRE), { headers: { 'content-type': 'application/json' } }));
    // app files and the shipped depth/wreck/spot data (also cached by the service worker on install)
    const statics = ['app', 'app.html', 'app.js', 'style.css', 'track.js', 'loran.js', 'solunar.js', 'vendor/supabase.js', 'vendor/leaflet.js', 'vendor/leaflet.css',
      'vendor/d3-array.min.js', 'vendor/d3-contour.min.js', 'data/wrecks.json', 'data/spots.json', 'data/places.json', 'data/tide_stations.json',
      ...['2m', 'fl', 'cr', 'cabo', 'chiapas', 'cancun', 'puntacana', 'stlucia'].flatMap((n) => [`data/bathy_${n}.json`, `data/bathy_${n}.bin`])];
    let done = 0, bytes = 0, failed = 0;
    const todo = [...files.map((f) => `${LIVE_BASE}${f}`), ...statics.map((f) => new URL(f, location.origin + '/').href)];
    const one = async (u) => {
      try {
        if (!u.startsWith(location.origin) && await c.match(u)) { done++; return; }   // chart files never change once saved
        const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
        const b = await r.clone().blob(); bytes += b.size;
        await c.put(u, r);
        done++;
      } catch (e) { failed++; }
      if ((done + failed) % 10 === 0) msg(`Saving… ${done + failed} of ${todo.length}`);
    };
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(one));
    // drop chart files older than the pack window that nothing points at any more
    const keep = new Set(Object.values(PRE.items).map((e) => e.file).filter(Boolean));
    for (const req of await c.keys()) { const m = req.url.match(/\/live\/([^/?]+\.png)$/); if (m && !keep.has(m[1])) await c.delete(req); }
    const info = { at: Date.now(), zones, charts: files.length, mb: +(bytes / 1048576).toFixed(1), failed };
    store.set('offPack', info); offShow();
    if (failed) msg(`Saved ${done} files; ${failed} didn't download. Tap again with better signal to finish.`, true);
  } catch (e) { msg(e.message, true); } finally { btn.disabled = false; }
}
function offShow() {
  const p = store.get('offPack', null), el = $('offMsg'); if (!el) return;
  el.classList.remove('err');
  if (!p) { el.textContent = 'Nothing saved yet. Do this at the dock, on Wi-Fi.'; return; }
  const hrs = Math.round((Date.now() - p.at) / 3600e3), names = p.zones.map((z) => BOX_LABEL[z] || z).join(', ');
  el.innerHTML = `Saved ${new Date(p.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (${hrs < 1 ? 'just now' : `${hrs} h ago`}): ${p.charts} charts, ${p.mb} MB, for ${names}.`;
}
$('offGo').onclick = offlinePack;
offShow();
// with no signal, say so once, so nobody waits on a chart that can't load
addEventListener('offline', () => status('No signal: showing your saved charts. Weather, tides and HF radar need a connection.', true));

// ---------- Find your water: search Breakline's saved charts for every patch inside your run that matches ----------
// Runs on our own copies (checked against NOAA every 10 minutes), so it works even when NOAA is down.
const FW_KEYS = ['depth', 'temp', 'front', 'chl', 'cur', 'mld', 'sal'];
const FW_DEF = {
  port: null, run: null, tempSrc: 'hourly', curSrc: 'sat',
  depth: { on: true, lo: 20, hi: null }, temp: { on: true, lo: null, hi: null }, front: { on: false, mode: 'on' },
  chl: { on: false, lo: 0.08, hi: 0.4 }, cur: { on: false, lo: null, hi: 1.5 }, mld: { on: false, lo: null, hi: 150 },
  sal: { on: false, mode: 'range', lo: 35, hi: 36.5 },
};
const FW_CELL = 0.04;                 // ~2.4 nm, the saved charts' grid
// Temp-break cutoffs in °F per nm, set from the saved charts off the Carolinas and Florida (Nov 2026):
// "on" ~ the sharpest 10% of the water, "strong" ~ the sharpest 5%. The blend is smoother, so its cutoffs are lower.
const FW_BRK = { hourly: { on: 0.27, strong: 0.4, off: 0.1 }, blend: { on: 0.15, strong: 0.21, off: 0.06 } };
function fwLoad() {
  const st = store.get('fw', {}) || {};
  S.fw = { ...FW_DEF, ...st };
  for (const k of FW_KEYS) S.fw[k] = { ...FW_DEF[k], ...(st[k] || {}) };
  if (S.fw.temp.lo == null && S.fw.temp.hi == null) { const sp = SPECIES[S.species] || SPECIES.yellowfin; S.fw.temp.lo = sp.t[1]; S.fw.temp.hi = sp.t[2]; }
}
fwLoad();
const fwNum = (el) => (el && el.value.trim() !== '' && isFinite(+el.value) ? +el.value : null);
function fwToUi() {
  const f = S.fw;
  $('fwPort').value = PORTS.some((p) => p[0] === f.port) ? f.port : S.home;
  $('fwRun').value = f.run || S.maxRun;
  document.querySelectorAll('#fwPanel .fwc').forEach((el) => {
    const c = f[el.dataset.k];
    el.querySelector('.on').checked = !!c.on; el.classList.toggle('on', !!c.on);
    if (el.querySelector('.lo')) { el.querySelector('.lo').value = c.lo ?? ''; el.querySelector('.hi').value = c.hi ?? ''; }
    if (el.querySelector('.mode')) el.querySelector('.mode').value = c.mode;
  });
  document.querySelectorAll('#fwTempSrc button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.tempSrc));
  document.querySelector('#fwPanel .salr').hidden = f.sal.mode !== 'range';
  $('fwCurSrc').value = f.curSrc || 'sat';
}
function fwFromUi() {
  const f = S.fw;
  f.port = $('fwPort').value; f.run = fwNum($('fwRun'));
  document.querySelectorAll('#fwPanel .fwc').forEach((el) => {
    const c = f[el.dataset.k];
    c.on = el.querySelector('.on').checked; el.classList.toggle('on', c.on);
    if (el.querySelector('.lo')) { c.lo = fwNum(el.querySelector('.lo')); c.hi = fwNum(el.querySelector('.hi')); }
    if (el.querySelector('.mode')) c.mode = el.querySelector('.mode').value;
  });
  document.querySelector('#fwPanel .salr').hidden = f.sal.mode !== 'range';
  f.curSrc = $('fwCurSrc').value;
  store.set('fw', f);
}
async function preLatestGrid(zone, key, conv) {
  const e = preEntry(`${zone}/${key}/latest`);
  return e?.file ? preGrid(e, conv) : null;
}
// Color for searches and alerts: the newest clear satellite pass from the last 3 days at each spot (VIIRS NOAA-20/21,
// Sentinel-3A/B), with NOAA's gap-filled DINEOF under it where clouds blocked every pass (DINEOF runs ~2-3 weeks behind).
async function preChlBest(zone) {
  const base = await preLatestGrid(zone, 'chl/dineof', CHL).catch(() => null), cut = addDays(isoDate(new Date()), -3);
  const keys = Object.keys(PRE.items).filter((k) => k.startsWith(`${zone}/chl/`) && /\/chl\/(n21|n20|s3a|s3b)\//.test(k) && PRE.items[k].file && k.split('/').pop() >= cut)
    .sort((a, b) => b.split('/').pop().localeCompare(a.split('/').pop()));
  const passes = await Promise.all(keys.map((k) => preGrid(PRE.items[k], CHL)));
  const g0 = base || passes[0]; if (!g0) return null;
  const v = new Float32Array(g0.nx * g0.ny); let fresh = 0, any = 0;
  for (let j = 0; j < g0.ny; j++) for (let i = 0; i < g0.nx; i++) {
    const k = j * g0.nx + i, la = g0.lat0 + j * g0.dlat, lo = g0.lon0 + i * g0.dlon; let x = NaN;
    for (const p of passes) { x = sample(p, la, lo); if (x === x) { fresh++; break; } }
    if (x !== x && base) x = base.v[k];
    v[k] = x; if (x === x) any++;
  }
  return { ...g0, v, date: keys.length ? keys[0].split('/').pop() : base.date, freshPct: any ? Math.round(100 * fresh / any) : 0, gapDate: base?.date };
}
// newest clear GOES-19 look at every pixel over the last 24 saved hours
async function preGoesFill(zone) {
  const hours = Object.keys(PRE.items).filter((k) => k.startsWith(`${zone}/goes/`) && !PRE.items[k].none).sort().slice(-24);
  if (!hours.length) return null;
  const grids = await Promise.all(hours.map((k) => preGrid(PRE.items[k], SST_C)));
  const last = grids[grids.length - 1], v = last.v.slice();
  for (let k = grids.length - 2; k >= 0; k--) { const sl = grids[k].v; for (let i = 0; i < v.length; i++) if (v[i] !== v[i]) v[i] = sl[i]; }
  return { ...last, v, times: [hours[hours.length - 1].split('/')[2]], hourly: true };
}
async function preBlend(zone) {
  const id = preLatest(zone, 'sst', 'mur') || preLatest(zone, 'sst', 'geopolar');
  return id ? preGrid(PRE.items[id], SST_C) : null;
}
// gradient strength per nautical mile (central difference: spans ~5 nm on the saved charts)
function gradNm(g) {
  const out = new Float32Array(g.nx * g.ny).fill(NaN), dy = g.dlat * 60;
  for (let j = 1; j < g.ny - 1; j++) {
    const dx = g.dlon * 60 * Math.cos((g.lat0 + j * g.dlat) * Math.PI / 180);
    for (let i = 1; i < g.nx - 1; i++) {
      const k = j * g.nx + i, m = Math.hypot((g.v[k + 1] - g.v[k - 1]) / (2 * dx), (g.v[k + g.nx] - g.v[k - g.nx]) / (2 * dy));
      if (m === m) out[k] = m;
    }
  }
  return { ...g, v: out };
}
const fwIn = (x, lo, hi) => x === x && (lo == null || x >= lo) && (hi == null || x <= hi);
const fwRange = (a, b, f) => (f(a) === f(b) ? f(a) : `${f(a)}-${f(b)}`);
async function findWater() {
  fwFromUi();
  const f = S.fw, port = PORTS.find((x) => x[0] === f.port), on = (k) => f[k].on;
  const msg = (t, err) => { $('fwMsg').innerHTML = t; $('fwMsg').classList.toggle('err', !!err); };
  if (!port) return msg('Pick a home port.', true);
  if (!FW_KEYS.some(on)) return msg('Turn on at least one thing to look for.', true);
  const R = clamp(f.run || S.maxRun, 5, 400);
  for (const k of ['depth', 'temp', 'chl', 'cur', 'mld']) if (on(k) && f[k].lo != null && f[k].hi != null && f[k].lo > f[k].hi) return msg('One of the ranges has its min above its max.', true);
  if (on('sal') && f.sal.mode === 'range' && f.sal.lo != null && f.sal.hi != null && f.sal.lo > f.sal.hi) return msg('The salinity range has its min above its max.', true);
  $('fwGo').disabled = true; msg('Searching the saved charts…'); $('fwList').innerHTML = '';
  try {
    await preReady; if (!PRE) await loadManifest();
    if (!PRE) throw new Error('The saved charts didn\'t load. Check your connection and try again.');
    await bathy2Ready;
    const pla = port[1], plo = port[2], dLa = R / 60, dLo = R / (60 * Math.cos(pla * Math.PI / 180));
    let box = { s: pla - dLa, n: pla + dLa, w: plo - dLo, e: plo + dLo };
    // the saved-chart box holding most of the run (the smaller box wins a tie: same data, less to load)
    const zs = Object.entries(PRE.zones || PRE_BOX).map(([k, b]) => [k, b, Math.max(0, Math.min(b.n, box.n) - Math.max(b.s, box.s)) * Math.max(0, Math.min(b.e, box.e) - Math.max(b.w, box.w)), (b.n - b.s) * (b.e - b.w)])
      .filter((z) => z[2] > 0).sort((a, b) => b[2] - a[2] || a[3] - b[3]);
    if (!zs.length) throw new Error('Breakline doesn\'t have saved charts around that port yet.');
    const [zone, zb] = zs[0];
    box = { s: Math.max(box.s, zb.s), n: Math.min(box.n, zb.n), w: Math.max(box.w, zb.w), e: Math.min(box.e, zb.e) };
    const got = {};
    const tempSrc = f.tempSrc === 'blend' ? 'blend' : 'hourly';
    await Promise.all([
      (on('temp') || on('front')) && (tempSrc === 'hourly' ? preGoesFill(zone) : preBlend(zone)).then((g) => { got.temp = g; }),
      on('chl') && preChlBest(zone).then((g) => { got.chl = g; }),
      on('cur') && (f.curSrc && f.curSrc !== 'sat' ? preModelCurrents(f.curSrc, zone) : preCurrents(zone)).then((g) => { got.cur = g; }),
      on('mld') && preLatestGrid(zone, 'mld/ohc', PRODUCTS.mld.conv).then((g) => { got.mld = g; }),
      on('sal') && preLatestGrid(zone, 'sss/smap', PRODUCTS.sss.conv).then((g) => { got.sal = g; }),
    ].filter(Boolean).map((p) => p.catch((e) => console.warn('find water layer', e))));
    const dep = bathyFromStatic(box);
    const tg = on('front') && got.temp ? gradNm(got.temp) : null, sg = on('sal') && f.sal.mode === 'edge' && got.sal ? gradNm(got.sal) : null;
    const LBL = { depth: 'depth', temp: 'water temp', front: 'temp breaks', chl: 'color', cur: 'currents', mld: 'mixed layer', sal: 'salinity' };
    const have = { depth: !!dep, temp: !!got.temp, front: !!got.temp, chl: !!got.chl, cur: !!got.cur, mld: !!got.mld, sal: !!got.sal };
    const use = FW_KEYS.filter((k) => on(k) && have[k]), missing = FW_KEYS.filter((k) => on(k) && !have[k]);
    if (!use.length) throw new Error(`No saved ${missing.map((k) => LBL[k]).join(', ')} for this area yet. Try again in a few minutes.`);
    const nx = Math.round((box.e - box.w) / FW_CELL) + 1, ny = Math.round((box.n - box.s) / FW_CELL) + 1, n = nx * ny;
    const hit = new Uint8Array(n), V = {};
    for (const k of ['fm', 'T', 'chl', 'kt', 'mld', 'sal']) V[k] = new Float32Array(n).fill(NaN);
    let water = 0, matched = 0, blind = 0;
    // salinity edge: the sharpest 20% of salinity change in this area (SMAP is a 25 km product, so a fixed cutoff fits nowhere)
    let salCut = Infinity;
    if (sg) {
      const xs = [];
      for (let j = 0; j < sg.ny; j++) { const la = sg.lat0 + j * sg.dlat; if (la < box.s || la > box.n) continue;
        for (let i = 0; i < sg.nx; i++) { const lo = sg.lon0 + i * sg.dlon, x = sg.v[j * sg.nx + i]; if (lo >= box.w && lo <= box.e && x === x) xs.push(x); } }
      xs.sort((a, b) => a - b); if (xs.length) salCut = Math.max(0.004, xs[Math.floor(xs.length * 0.8)]);
    }
    const alone = Object.fromEntries(use.map((k) => [k, 0])), seen = {};   // how much water passes each setting by itself / has data
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const la = box.s + j * FW_CELL, lo = box.w + i * FW_CELL, k = j * nx + i;
      if (rangeBearing([pla, plo], [la, lo])[0] > R) continue;
      const z = dep ? sample(dep, la, lo) : NaN, T = got.temp ? sample(got.temp, la, lo) : NaN;
      if (dep ? !(z < 0) : T !== T) continue;          // land
      water++;
      const fm = -z / FATHOM; V.fm[k] = fm; V.T[k] = T;
      if (on('temp') && have.temp && T !== T) blind++;
      const pass = {};
      if (use.includes('depth')) pass.depth = fwIn(fm, f.depth.lo, f.depth.hi);
      if (use.includes('temp')) pass.temp = fwIn(T, f.temp.lo, f.temp.hi);
      if (tg) { const gr = sample(tg, la, lo), cut = FW_BRK[tempSrc]; pass.front = f.front.mode === 'off' ? gr < cut.off : gr >= cut[f.front.mode]; }
      if (use.includes('chl')) { const x = sample(got.chl, la, lo); V.chl[k] = x; pass.chl = fwIn(x, f.chl.lo, f.chl.hi); }
      if (use.includes('cur')) { const u = sample(got.cur, la, lo, got.cur.u), v = sample(got.cur, la, lo, got.cur.vv), kt = Math.hypot(u, v) * 1.94384; V.kt[k] = kt; pass.cur = fwIn(kt, f.cur.lo, f.cur.hi); }
      if (use.includes('mld')) { const x = sample(got.mld, la, lo); V.mld[k] = x; pass.mld = fwIn(x, f.mld.lo, f.mld.hi); }
      if (use.includes('sal')) { const x = sample(got.sal, la, lo); V.sal[k] = x; pass.sal = f.sal.mode === 'edge' ? sample(sg, la, lo) >= salCut : fwIn(x, f.sal.lo, f.sal.hi); }
      let all = true;
      for (const c of use) if (pass[c]) alone[c]++; else all = false;
      for (const [c, x] of [['temp', T], ['chl', V.chl[k]], ['cur', V.kt[k]], ['mld', V.mld[k]], ['sal', V.sal[k]]]) if (x === x) seen[c] = (seen[c] || 0) + 1;
      if (all) { hit[k] = 1; matched++; }
    }
    // group touching matches into patches
    const lab = new Int32Array(n).fill(-1), areas = [];
    for (let k0 = 0; k0 < n; k0++) {
      if (!hit[k0] || lab[k0] >= 0) continue;
      const a = { cells: [] }, st = [k0], id = areas.length; lab[k0] = id;
      while (st.length) {
        const k = st.pop(), j = Math.floor(k / nx), i = k % nx; a.cells.push(k);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const jj = j + dj, ii = i + di, kk = jj * nx + ii;
          if (jj >= 0 && jj < ny && ii >= 0 && ii < nx && hit[kk] && lab[kk] < 0) { lab[kk] = id; st.push(kk); }
        }
      }
      areas.push(a);
    }
    for (const a of areas) {
      let sla = 0, slo = 0, nm2 = 0, bb = [90, 180, -90, -180];
      const span = {};
      for (const k of a.cells) {
        const la = box.s + Math.floor(k / nx) * FW_CELL, lo = box.w + (k % nx) * FW_CELL;
        sla += la; slo += lo; nm2 += (FW_CELL * 60) ** 2 * Math.cos(la * Math.PI / 180);
        bb = [Math.min(bb[0], la), Math.min(bb[1], lo), Math.max(bb[2], la), Math.max(bb[3], lo)];
        for (const v of ['fm', 'T', 'chl', 'kt', 'mld', 'sal']) { const x = V[v][k]; if (x === x) { const s = (span[v] ||= [x, x]); s[0] = Math.min(s[0], x); s[1] = Math.max(s[1], x); } }
      }
      const cla = sla / a.cells.length, clo = slo / a.cells.length;
      let best = a.cells[0], bd = Infinity;          // the matching cell nearest the middle of the patch
      for (const k of a.cells) { const d = (box.s + Math.floor(k / nx) * FW_CELL - cla) ** 2 + (box.w + (k % nx) * FW_CELL - clo) ** 2; if (d < bd) { bd = d; best = k; } }
      Object.assign(a, { nm2, bb, span, lat: box.s + Math.floor(best / nx) * FW_CELL, lon: box.w + (best % nx) * FW_CELL });
      [a.dist, a.brg] = rangeBearing([pla, plo], [a.lat, a.lon]);
      delete a.cells;
    }
    areas.sort((a, b) => b.nm2 - a.nm2);
    S.fwHits = { box, nx, ny, hit, areas, port: [pla, plo], R };
    const side = innerWidth > 700 && !$('fwPanel').hidden ? $('fwPanel').offsetWidth + 70 : 20;   // keep the matches out from under the panel
    map.fitBounds([[box.s, box.w], [box.n, box.e]], { paddingTopLeft: [70, 60], paddingBottomRight: [side, 40] });
    chart.draw();
    // what the search used, and how old it is
    const asOf = [];
    if (got.temp) asOf.push(`water temp ${tempSrc === 'hourly' ? `hourly to ${niceHour(got.temp.times[0])}` : `blend ${nice(got.temp.date)}`}`);
    if (got.chl) asOf.push(`color ${nice(got.chl.date)}${got.chl.freshPct < 90 && got.chl.gapDate ? ` (${100 - got.chl.freshPct}% under cloud, filled from ${nice(got.chl.gapDate)})` : ''}`);
    if (got.cur) asOf.push(`currents ${got.cur.model ? `${CUR_SRC[got.cur.model]} ${niceHour(got.cur.time)}` : `satellite ${nice(got.cur.date)}`}`);
    if (got.mld) asOf.push(`mixed layer ${nice(got.mld.date)}`);
    if (got.sal) asOf.push(`salinity ${nice(got.sal.date)}`);
    const total = areas.reduce((s, a) => s + a.nm2, 0);
    let t = matched ? `<b>${areas.length} patch${areas.length === 1 ? '' : 'es'}, about ${Math.round(total).toLocaleString()} sq nm</b> inside ${R} nm of ${port[0]} match.` : `Nothing inside ${R} nm of ${port[0]} matches all of that. Widen a range or turn something off.`;
    // each setting on its own: shows which one is doing the cutting
    if (water && use.length > 1) t += `<br>On its own: ${use.map((c) => `${LBL[c]} ${Math.round(100 * alone[c] / water)}%`).join(' · ')} of the water.`;
    const blank = use.filter((c) => c !== 'depth' && c !== 'front' && !(c === 'temp' && tempSrc === 'hourly') && water && (seen[c] || 0) / water < 0.1);
    if (blank.length) t += `<br>${blank.map((c) => LBL[c]).join(', ')}: NOAA has no reading for most of this area${blank.includes('mld') ? ' (it only computes mixed layer in warm, Gulf Stream-type water)' : ''}, so ${blank.length > 1 ? 'they rule' : 'it rules'} it out. Turn ${blank.length > 1 ? 'them' : 'it'} off here.`;
    if (missing.length) t += `<br>Skipped (no saved data for this area yet): ${missing.map((k) => LBL[k]).join(', ')}.`;
    if (blind && water && blind / water > 0.25) t += `<br>${Math.round(100 * blind / water)}% of the run is under cloud on the hourly temp. Switch to Blend to see through it.`;
    if (asOf.length) t += `<br>Data: ${asOf.join(' · ')}.`;
    msg(t);
    const fmt1 = (x) => x.toFixed(1), fm0 = (x) => Math.round(x).toLocaleString();
    $('fwList').innerHTML = areas.slice(0, 15).map((a, i) => {
      const p = [];
      if (a.span.T) p.push(`${fwRange(...a.span.T, fmt1)}°F`);
      if (a.span.fm) p.push(`${fwRange(...a.span.fm, fm0)} fm`);
      if (a.span.chl) p.push(`${fwRange(...a.span.chl, (x) => x.toFixed(2))} mg/m³`);
      if (a.span.kt) p.push(`${fwRange(...a.span.kt, fmt1)} kt`);
      if (a.span.mld) p.push(`MLD ${fwRange(...a.span.mld, fm0)} ft`);
      if (a.span.sal) p.push(`${fwRange(...a.span.sal, (x) => x.toFixed(2))} PSU`);
      return `<li data-i="${i}"><b>${i + 1}. ${a.nm2 < 10 ? a.nm2.toFixed(1) : Math.round(a.nm2).toLocaleString()} sq nm</b><small>${p.join(' · ')}<br>${fmtLL(a.lat, a.lon)}${inLoran(a.lat, a.lon) ? ` · TD ${fmtTd(a.lat, a.lon)}` : ''}<br>${a.dist.toFixed(0)} nm @ ${Math.round(a.brg)}°T from ${port[0]}</small></li>`;
    }).join('') + (areas.length > 15 ? `<li><small>+${areas.length - 15} smaller patches on the chart</small></li>` : '');
    $('fwList').querySelectorAll('li[data-i]').forEach((li) => {
      li.onclick = () => {
        const a = S.fwHits.areas[+li.dataset.i], pad = FW_CELL * 2;
        map.fitBounds([[a.bb[0] - pad, a.bb[1] - pad], [a.bb[2] + pad, a.bb[3] + pad]], { maxZoom: 10, padding: [30, 30] });
        openReading(L.latLng(a.lat, a.lon), `Match ${+li.dataset.i + 1}`);
      };
    });
  } catch (e) {
    console.warn('find water', e); msg(e.message || 'Search failed. Try again.', true);
  } finally { $('fwGo').disabled = false; }
}
function drawFindWater(ctx) {
  const h = S.fwHits; if (!h) return;
  ctx.save();
  const [cx, cy] = project(h.port[0], h.port[1]), [, ty] = project(h.port[0] + h.R / 60, h.port[1]);
  ctx.setLineDash([7, 6]); ctx.strokeStyle = 'rgba(53,194,255,.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, Math.abs(cy - ty), 0, 7); ctx.stroke(); ctx.setLineDash([]);
  const d = FW_CELL / 2, [x0] = project(h.box.s, h.box.w), [x1] = project(h.box.s, h.box.w + FW_CELL), cw = Math.max(1, x1 - x0) + 0.6;
  ctx.fillStyle = 'rgba(53,194,255,.42)'; ctx.beginPath();
  for (let k = 0; k < h.hit.length; k++) {
    if (!h.hit[k]) continue;
    const la = h.box.s + Math.floor(k / h.nx) * FW_CELL, lo = h.box.w + (k % h.nx) * FW_CELL;
    const [x, ya] = project(la + d, lo - d), [, yb] = project(la - d, lo - d);
    ctx.rect(x, ya, cw, yb - ya + 0.6);
  }
  ctx.fill();
  ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  h.areas.slice(0, 15).forEach((a, i) => {
    const [x, y] = project(a.lat, a.lon);
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 7); ctx.fillStyle = '#35c2ff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#04121d'; ctx.stroke();
    ctx.fillStyle = '#04121d'; ctx.fillText(String(i + 1), x, y + 0.5);
  });
  ctx.restore();
}
// panel wiring
$('fwPort').innerHTML = PORTS.map((p) => `<option>${p[0]}</option>`).join('');
fwToUi();
$('fwPanel').addEventListener('change', () => fwFromUi());
document.querySelectorAll('#fwTempSrc button').forEach((b) => { b.onclick = () => { S.fw.tempSrc = b.dataset.v; store.set('fw', S.fw); fwToUi(); }; });
$('fwGo').onclick = findWater;
$('fwFill').onclick = () => {
  const sp = SPECIES[S.species] || SPECIES.yellowfin;
  Object.assign(S.fw.temp, { on: true, lo: sp.t[1], hi: sp.t[2] });
  if (!sp.inshore) Object.assign(S.fw.depth, { on: true, lo: sp.fm || null, hi: null });
  store.set('fw', S.fw); fwToUi();
  $('fwMsg').textContent = `Temp ${sp.t[1]}-${sp.t[2]}°F${sp.inshore ? '' : ` and ${sp.fm}+ fm`} for ${sp.label.toLowerCase()}.`; $('fwMsg').classList.remove('err');
};
$('fwMine').onclick = () => {
  const L2 = learned(S.species), lbl = (SPECIES[S.species]?.label || S.species).toLowerCase();
  if (!L2) { $('fwMsg').textContent = `Log at least 3 ${lbl} with Track my day first (Trip button on the left).`; $('fwMsg').classList.remove('err'); return; }
  if (L2.T) Object.assign(S.fw.temp, { on: true, lo: L2.T[0], hi: L2.T[1] });
  if (L2.fm) Object.assign(S.fw.depth, { on: true, lo: L2.fm[0], hi: L2.fm[1] });
  if (L2.chl) Object.assign(S.fw.chl, { on: true, lo: L2.chl[0], hi: L2.chl[1] });
  if (L2.kt) Object.assign(S.fw.cur, { on: true, lo: null, hi: L2.kt[1] });
  if ((L2.onBreak || 0) >= 0.5) Object.assign(S.fw.front, { on: true, mode: 'on' });
  store.set('fw', S.fw); fwToUi();
  $('fwMsg').textContent = `Set from your ${L2.n} ${lbl} catches.`; $('fwMsg').classList.remove('err');
};
$('fwClear').onclick = () => { S.fwHits = null; $('fwList').innerHTML = ''; $('fwMsg').textContent = ''; chart.draw(); };
$('btnFind').onclick = () => {
  togglePanel('fwPanel', $('btnFind'));
  if (!$('fwPanel').hidden) { $('fishPanel').hidden = true; $('anaPanel').hidden = true; if (!S.fw.port) fwToUi(); }
};
$('fwClose').onclick = () => { $('fwPanel').hidden = true; $('btnFind').classList.remove('open'); };
})();
