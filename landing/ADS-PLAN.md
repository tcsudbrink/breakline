# Breakline Google Ads plan

The site is built around these ad groups: each has its own landing page whose headline matches the search, so Quality Score stays high and clicks stay cheap. All copy fits Google's limits (headlines 30 characters or fewer, descriptions 90 or fewer).

## Before the first ad runs (about 15 minutes)

1. **Create the Google Ads account** under Breakline, LLC (or your personal account until the LLC is approved). Turn on **auto-tagging** (Admin > Account settings). It adds the `gclid` that track.js saves on each sign-up.
2. **Conversion actions**: Goals > Conversions > New > Website > "Add a conversion action manually" > "Use Google tag":
   - **Sign up**: category "Sign-up", value $0, count One. This is the primary goal while the trial is the offer.
   - **Purchase**: category "Purchase", value $100, count One.
   Copy the `AW-...` ID and each label into `ADS_ID` and `LABELS` at the top of `track.js`, then push. The app fires *sign_up* when someone creates an account and *purchase* when Stripe confirms payment.
3. **Billing**: set a daily budget you're fine losing while it learns. $20-30/day across the campaign is a sensible start.

## Campaign: Breakline - Search - US

- **Network**: Search only (untick Display and Search Partners).
- **Locations**: "Presence: people in or regularly in". Target ME, NH, MA, RI, CT, NY, NJ, DE, MD, VA, NC, SC, GA, FL, AL, MS, LA, TX and Puerto Rico. Add Bermuda, the Bahamas and the USVI later if they convert.
- **Bidding**: Maximize clicks with a $2.50 max CPC for the first 2-3 weeks. Switch to **Maximize conversions** once there are about 15 or more sign-ups, then to Target CPA once there are 30 or more.
- **Season**: in December through April the Northeast and Mid-Atlantic tuna terms barely search. Lean on Florida, the Gulf, the Caribbean and the Pacific (Cabo and Costa Rica peak now). Raise the Northeast budget in May.
- **Ad schedule**: all days to start. The early morning before trips and Thursday through Saturday are likely the best times; check after 30 days.

### Ad groups, keywords (phrase match unless [exact]) and landing pages

| Ad group | Final URL | Keywords |
|---|---|---|
| SST charts | `/sst-charts?utm_source=google&utm_medium=cpc&utm_campaign=sst` | "sst charts", [sst charts], "sea surface temperature charts", "sst fishing charts", "water temperature charts offshore", "gulf stream temperature chart", "ocean temperature map fishing", "sst map" |
| Offshore charts | `/offshore-fishing-charts?utm_source=google&utm_medium=cpc&utm_campaign=offshore` | "offshore fishing charts", "offshore fishing app", "fishing charts app", "satellite fishing charts", "chlorophyll fishing charts", "altimetry fishing charts", "fishing satellite maps" |
| Tuna | `/tuna-fishing-charts?utm_source=google&utm_medium=cpc&utm_campaign=tuna` | "tuna fishing charts", "yellowfin tuna charts", "where to find tuna offshore", "tuna water temperature", "bluefin tuna charts", "blackfin tuna charts" |
| Billfish | `/marlin-fishing-charts?utm_source=google&utm_medium=cpc&utm_campaign=billfish` | "marlin fishing charts", "billfish charts", "white marlin water temperature", "blue marlin charts", "sailfish charts" |

Optional, as its own small campaign: **competitor names** as keywords (ripcharts, roffs, hilton's realtime navigator, salty offshore, fishtrack), pointing at `/offshore-fishing-charts`. Bidding on the names is allowed. Using them in the ad text is not, so use the ads below unchanged.

### Negative keywords (campaign level)

jobs, job, salary, career, navionics, nautical chart, navigation, depth chart, lake, lakes, freshwater, bass, crappie, walleye, ice fishing, fishing license, fishing report, charter, charters, boat rental, rental, recipe, seafood, restaurant, aquarium, fish tank, minecraft, game, stardew, tattoo, weather radar, hurricane

### Responsive search ad (one per ad group: pin the ad group's own headline in position 1)

Headlines: SST Charts for Fishing · Hourly Water Temp Charts · Offshore Fishing Charts · Find Tuna Water Faster · Marlin & Billfish Charts · Try It Free for 5 Days · $100 a Year, Every Layer · Temp Breaks Drawn for You · Works Offshore, No Signal · Maine to Panama Coverage · Loran or Lat/Long Spots · Color, Altimetry, Currents · HYCOM & RTOFS Currents · Find Your Water Fast · Gulf Stream Temps Hourly · Satellite Fishing Charts

Descriptions:
- Hourly GOES-19 water temp, cloud-free blends and temp breaks drawn for you. 5 days free.
- Temp, color, altimetry and currents on one chart, with picks for where to fish. $100/yr.
- Set your port, run and conditions. Breakline marks every patch of water that matches.
- Save 48 hours of charts at the dock and use them offshore with no signal. Try it free.
- Yellowfin, bigeye, bluefin and blackfin temps scored inside your run. 5-day free trial. (tuna group)
- Warm and cold eddies under the clouds, with the edges where bait stacks up. Try it free. (billfish group)

Assets: sitelinks (Pricing `/#pricing`, Coverage `/#coverage`, The data `/#data`, Inshore `/#inshore`), callouts ("No card to start", "Hourly SST", "Works offline", "Loran TDs") and a price asset ($100/year).

## Reading the results

- Google Ads shows sign-ups and purchases per keyword once the conversion tags are in.
- Each account also keeps the ad that brought it: Supabase > Table Editor > `profiles` > `signup_source` (campaign, keyword term, gclid, landing page).
- Supabase > Table Editor > `follow_up` lists everyone to call or email: trials that ended without paying, cancellations and failed cards, with phone and home port.
- After 2 weeks: pause keywords with 30 or more clicks and no sign-up, add any new search terms that converted, and add junk terms as negatives (Insights > Search terms).
