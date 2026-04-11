# Canyons 100K Plan

Generated race-day crew guide for the Canyons 100K.

## Files

- `data/race-plan.json` is the editable race plan: stops, ETAs, leg splits, elevation, crew notes, fuel targets, map notes, and source links.
- `data/canyons-100k-course.gpx` is the official 2026 100K GPX used for the route tracker map and elevation profile.
- `src/styles.css` is the report styling.
- `scripts/generate.js` builds the HTML report and route tracker.
- `scripts/review.js` builds the pages, captures Playwright screenshots, and checks mobile overflow, tap targets, tiny text, and route-tracker cursor movement.
- `docs/index.html` is the GitHub Pages entrypoint.
- `docs/canyons-100k-crew-guide.html` is the generated guide.
- `docs/canyons-100k-route-tracker.html` is the generated full-screen route tracker.

## Common Changes

To change nutrition targets, edit:

```json
"nutrition": {
  "carbsPerHour": 90,
  "sodiumMgPerHour": {
    "low": 500,
    "high": 750
  },
  "fluidLitersPerHour": {
    "low": 0.5,
    "high": 0.75
  }
}
```

To change the schedule, edit each stop `eta` and the `plannedMinutes` / `plannedTime` values in `nextLeg`.

The guide intentionally keeps ETAs explicit because the displayed ETAs include practical race-day stop time and rounding, while nutrition math is based on planned leg split minutes.

## Build

```sh
npm run build
```

Open:

```sh
open docs/index.html
open docs/canyons-100k-crew-guide.html
open docs/canyons-100k-route-tracker.html
```

## Local Map Key

The route tracker uses MapTiler for the interactive trail map. Do not commit a key. For local review, export `MAPTILER_API_KEY` in your shell and run:

```sh
source ~/.zshrc
npm run review
```

For opening the static tracker directly in a browser, create an ignored local config file:

```sh
cat > docs/route-map-config.js <<'JS'
window.CANYONS_MAPTILER_API_KEY = "YOUR_LOCAL_KEY";
JS
```

You can also open `docs/canyons-100k-route-tracker.html?maptiler_key=YOUR_LOCAL_KEY`; the page stores that value in local browser storage for later local opens.

## GitHub Pages

This repo is set up for local builds and branch-based GitHub Pages publishing.

1. Run `npm run build`.
2. Commit the generated `docs/` files.
3. In GitHub, set **Settings -> Pages -> Build and deployment -> Source** to **Deploy from a branch**.
4. Select branch `main` and folder `/docs`.

## Visual Review

Install dependencies once:

```sh
npm install
```

Then run:

```sh
npm run review
```

Screenshots are written to `.artifacts/screenshots/`.
