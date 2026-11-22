# Breakline v0.2

A RipCharts-style offshore chart for the Mid-Atlantic (Hatteras to Hudson), built on free NOAA/NASA data.

## Run it

```powershell
python breakline/server.py 8791
```

Then open http://localhost:8791. The server proxies NOAA ERDDAP and caches every grid in
`%LOCALAPPDATA%\breakline-cache`, so a day you've already viewed loads instantly and works with no signal.

## What's on the chart

| Product | Source | Resolution | Lag |
|---|---|---|---|
| Sea surface temp | NASA JPL MUR L4 (cloud-free) | 1 km (sampled at 2 km) | ~1 day |
| Chlorophyll | NOAA VIIRS + OLCI gap-filled (DINEOF) | 2 km | ~2 weeks |
| Altimetry (SSH anomaly) | NOAA blended altimetry | 25 km | ~1 day |
| Currents (overlay) | NOAA blended geostrophic | 25 km | ~2 days |
| Depth lines, land, coast | NOAA ETOPO 2022 15 arc-sec | ~1.4 km | static |

Depth lines are in fathoms: 50 / 100 / 500 / 1000 always, plus 10-40 / 200 / 300 / 1500 / 2000 as you zoom in.
The lat/lon grid tightens from 30' to 5' with zoom. Colors auto-fit to the water on screen (the Auto button); type a
min/max to lock them.

## Not built yet (was in the Grok version)

Weather, wave height, NDBC buoys, NOAA tides, trip log/track recording. Waypoints (save, list, GPX export) are in.

Not for navigation.
