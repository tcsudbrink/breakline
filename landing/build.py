"""Builds Breakline's Google Ads landing pages into the site root. Re-run after editing: python landing/build.py

One page per ad group, so the headline matches what the person searched (Google rewards that with a better
Quality Score and cheaper clicks). Every page: one goal (start the free trial), the price up front, real
screenshots, no navigation away. Ad plan: landing/ADS-PLAN.md.
"""
import html
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://www.breaklinefishing.com'

PAGES = {
    'sst-charts': dict(
        title='SST Charts for Offshore Fishing · Breakline',
        desc='Sea surface temperature charts for offshore fishing: hourly GOES-19 scans, cloud-free daily blends and 1- and 3-day composites, with temp breaks drawn for you. 5 days free.',
        kicker='SST charts', h1='Sea surface temperature charts,<br>updated every hour.',
        lead='Hourly GOES-19 water temp, the cloud-free daily blend, every polar pass and 1- and 3-day composites, with the breaks outlined so you can see the edge before you leave the inlet.',
        shot=('sst.jpg', 'Breakline sea surface temperature chart of the Mid-Atlantic canyons with temp breaks, depth lines and eddy rings'),
        points=[('Every hour, not once a day', 'GOES-19 scans the water every hour. Breakline keeps the newest clear look at every spot and tells you how old it is.'),
                ('See through the clouds', 'Cloud-free daily blends and 1- and 3-day composites fill the holes, so a cloudy morning doesn\'t leave you guessing.'),
                ('Breaks drawn for you', 'Temp breaks are outlined automatically, with the strength in degrees per mile, plus eddy rings from altimetry.')],
        faq=[('Where does the SST come from?', 'NOAA GOES-19 (hourly), NOAA and NASA polar-orbiting satellites (VIIRS and others) and the NASA JPL MUR cloud-free analysis.'),
             ('What about clouds?', 'Clouds block every water-temp satellite. Breakline keeps the newest clear reading for each spot, shows its age, and has cloud-free blends and multi-day composites for cloudy stretches.')],
    ),
    'offshore-fishing-charts': dict(
        title='Offshore Fishing Charts App · Breakline',
        desc='Offshore fishing charts on your phone: water temp, chlorophyll, altimetry, currents and where to fish, with Loran or lat/long and offline use. 5 days free, then $100 a year.',
        kicker='Offshore fishing charts', h1='Offshore fishing charts<br>for the run out of your inlet.',
        lead='Water temp, color, altimetry, currents, salinity and mixed layer on one chart, with picks for where to fish and a search that finds every patch of water that fits what you\'re after.',
        shot=('ssh.jpg', 'Breakline altimetry chart showing warm and cold eddies offshore'),
        points=[('Every layer in one place', 'SST, chlorophyll, altimetry, currents (satellite, HYCOM and RTOFS), salinity, oxygen, mixed layer, fronts, wind and seas.'),
                ('Find your water', 'Set your port, how far you\'ll run and the temp, depth, color, current and breaks you want. Breakline marks every patch that matches.'),
                ('Works with no signal', 'Download the last 48 hours of charts at the dock and they\'re all there 80 miles out. Spots in lat/long or Loran, GPX to your plotter.')],
        faq=[('Does it work offshore with no cell service?', 'Yes. Tap Download for offshore before you leave and the last 48 hours of every chart for your area are saved on the phone.'),
             ('Can I use my Loran numbers?', 'Yes. Show the grid in Loran TDs, lat/long or both, and every saved spot keeps its TDs.')],
    ),
    'tuna-fishing-charts': dict(
        title='Tuna Fishing Charts: Find Tuna Water · Breakline',
        desc='Tuna fishing charts: water temp, temp breaks, color edges and eddies, with yellowfin, bigeye, bluefin and blackfin picks inside your run. 5 days free.',
        kicker='Tuna fishing charts', h1='Find tuna water<br>before you burn the fuel.',
        lead='Pick yellowfin, bigeye, bluefin or blackfin and Breakline scores the water inside your run on temperature, breaks, color edges, the bottom and eddy edges.',
        shot=('chl.jpg', 'Breakline chlorophyll chart showing a color edge offshore'),
        points=[('Species-tuned temps', 'Each tuna has its own temp window. Breakline marks where the water fits, hour by hour.'),
                ('Edges that hold bait', 'Temp breaks, blue-green color edges, canyon walls and eddy edges are scored and numbered.'),
                ('Plan the run', 'Range and bearing from your inlet, tides, wind and seas for each pick, and the best times to be there.')],
        faq=[('Which tuna does it cover?', 'Yellowfin, bigeye, bluefin and blackfin, plus mahi, wahoo, marlin and sailfish, and inshore species.'),
             ('Is it a guarantee?', 'No chart can promise fish. Breakline shows you where the conditions line up, so you spend the fuel on the best water.')],
    ),
    'marlin-fishing-charts': dict(
        title='Marlin & Billfish Fishing Charts · Breakline',
        desc='Billfish charts for white marlin, blue marlin and sailfish: water temp, color, eddies and currents, with picks inside your run. East Coast, Gulf, Caribbean and Pacific. 5 days free.',
        kicker='Billfish charts', h1='Marlin water,<br>marked on the chart.',
        lead='White marlin, blue marlin, black and striped marlin and sailfish: Breakline finds the temp, color and eddy edges they hunt and ranks them inside your run.',
        shot=('sst.jpg', 'Breakline water temperature chart with eddy rings and numbered hot spots'),
        points=[('Eddies and edges', 'Altimetry shows warm and cold eddies under the clouds, with the edges where current and bait stack up.'),
                ('Atlantic and Pacific', 'From the Mid-Atlantic canyons to Cabo, Guatemala, Costa Rica and Panama.'),
                ('Find your water', 'Search by temp, color, current, breaks, mixed layer and salinity to mark every patch worth a look.')],
        faq=[('Where does it cover?', 'Maine to Panama: the East Coast canyons, Florida, the Gulf, the Bahamas and Caribbean, and Pacific Mexico and Central America.'),
             ('Does it show eddies?', 'Yes. Altimetry (sea height) shows warm and cold eddies even under clouds, with the rings drawn on the chart.')],
    ),
}


def page(slug, p):
    e = html.escape
    pts = ''.join(f'<div class="card"><h3>{e(h)}</h3><p>{e(t)}</p></div>' for h, t in p['points'])
    faq = ''.join(f'<details><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in p['faq'] + [
        ('How does the free trial work?', 'Create an account and you get everything for 5 days, no card needed. Then it\'s $100 a year to keep going. Cancel any time.'),
        ('Can I navigate with it?', 'No. Breakline is a fishing planning tool. Always navigate with proper charts and your own electronics.')])
    img, alt = p['shot']
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1622">
<title>{e(p['title'])}</title>
<meta name="description" content="{e(p['desc'])}">
<link rel="canonical" href="{SITE}/{slug}">
<meta property="og:title" content="{e(p['title'])}">
<meta property="og:description" content="{e(p['desc'])}">
<meta property="og:image" content="{SITE}/img/{img}">
<link rel="icon" href="icon.svg">
<link rel="preload" as="image" href="img/{img}">
<link rel="stylesheet" href="site.css">
<script src="track.js"></script>
</head>
<body class="landing">
<!-- Google Ads landing page ({slug}); built by landing/build.py -->
<header class="nav">
  <a class="brand" href="/"><img src="icon.svg" alt="" width="30" height="30"><span>Breakline</span></a>
  <div class="cta"><a class="btn ghost" href="/app">Sign in</a><a class="btn" href="/app?signup">Start free trial</a></div>
</header>

<section class="hero">
  <div class="hero-copy">
    <p class="kicker">{e(p['kicker'])}</p>
    <h1>{p['h1']}</h1>
    <p class="lead">{e(p['lead'])}</p>
    <div class="hero-btns"><a class="btn big" href="/app?signup">Start your 5-day free trial</a></div>
    <p class="fine">5 days free, no card needed. Then $100 a year. Phone, tablet and computer.</p>
  </div>
  <figure class="hero-shot shot"><img src="img/{img}" alt="{e(alt)}" width="1288" height="952"></figure>
</section>

<section class="band">
  <div class="grid three">{pts}</div>
</section>

<section class="band">
  <p class="kicker">Also in every plan</p>
  <h2>Built for the run out and back</h2>
  <div class="grid three">
    <div class="card"><h3>Find your water</h3><p>Pick your port and how far you'll run, set the conditions you want, and every matching patch is marked.</p></div>
    <div class="card"><h3>Offshore, no signal</h3><p>Save the last 48 hours of charts for your area at the dock and use them 80 miles out.</p></div>
    <div class="card"><h3>Works when NOAA doesn't</h3><p>Breakline keeps its own copy of every chart, checked every 10 minutes, so an outage doesn't cost you the morning.</p></div>
  </div>
  <p class="sub center">Covers Maine to Panama: the canyons, the Carolinas, Florida, the Gulf, the Bahamas and Caribbean, Cabo and Central America. <a href="/#coverage">See every port</a>.</p>
</section>

<section class="band pricing">
  <h2>One plan. Everything in it.</h2>
  <div class="plan">
    <div class="plan-head"><h3>Breakline</h3><p class="price">$100<small>/year</small></p></div>
    <p class="fine plan-sub">5 days free, no card needed. About $8.33 a month, billed yearly. Cancel any time.</p>
    <a class="btn big" href="/app?signup">Start your 5-day free trial</a>
  </div>
</section>

<section class="band faq">
  <h2>Questions</h2>
  {faq}
</section>

<section class="final">
  <h2>Your next run starts with the next clear pass.</h2>
  <a class="btn big" href="/app?signup">Start your 5-day free trial</a>
</section>

<footer>
  <div class="brand"><img src="icon.svg" alt="" width="22" height="22"><span>Breakline</span></div>
  <p>Satellite data from NOAA, NASA and Copernicus Marine. Not for navigation.</p>
  <p>&copy; 2026 Breakline, LLC</p>
</footer>
</body>
</html>
'''


if __name__ == '__main__':
    for slug, p in PAGES.items():
        open(os.path.join(ROOT, f'{slug}.html'), 'w', encoding='utf-8').write(page(slug, p))
    urls = [''] + list(PAGES)
    open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8').write(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + ''.join(f'  <url><loc>{SITE}/{u}</loc></url>\n' for u in urls) + '</urlset>\n')
    open(os.path.join(ROOT, 'robots.txt'), 'w', encoding='utf-8').write(f'User-agent: *\nDisallow: /app\nDisallow: /api/\nSitemap: {SITE}/sitemap.xml\n')
    print('built', len(PAGES), 'pages + sitemap.xml + robots.txt')
