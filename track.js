// Breakline ad tracking, shared by the website and the app.
// 1. Remembers where a visitor came from (UTM tags and Google Ads click ids). Sign-up saves it on the account,
//    so you can see which ads bring paying customers (Supabase -> profiles -> signup_source).
// 2. Once ADS_ID and the labels are filled in, loads Google's tag and reports sign-ups and purchases to Google Ads.
//    Google Ads -> Goals -> Conversions -> New conversion action -> Website -> "Add manually with code":
//    copy the AW-... id into ADS_ID and each action's label into LABELS.
(() => {
  const ADS_ID = '';                                  // e.g. 'AW-123456789'
  const LABELS = { sign_up: '', purchase: '' };       // e.g. { sign_up: 'AbC-dEfGhIjK', purchase: 'XyZ...' }
  const KEY = 'breakline.adsrc', PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid'];
  const q = new URLSearchParams(location.search), hit = {};
  for (const k of PARAMS) if (q.get(k)) hit[k] = q.get(k).slice(0, 150);
  let src = null;
  try { src = JSON.parse(localStorage.getItem(KEY)); if (!src || !src.at) src = null; } catch (e) { src = null; }
  // a new ad click replaces the old one; otherwise keep the first visit
  if (Object.keys(hit).length || !src) {
    let ref = '';
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { /* bad referrer */ }
    if (ref === location.hostname) ref = '';
    src = { ...hit, landing: location.pathname, ref, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(src)); } catch (e) { /* private mode */ }
  }
  window.blSource = () => src;

  if (ADS_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ADS_ID);
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
    document.head.appendChild(s);
  }
  window.blTrack = (name, extra = {}) => {
    if (!ADS_ID || !LABELS[name] || !window.gtag) return;
    window.gtag('event', 'conversion', { send_to: `${ADS_ID}/${LABELS[name]}`, ...extra });
  };
})();
