# Canyons 100K Plan

Generated race-day crew guide for the Canyons 100K.

## Files

- `data/race-plan.json` is the editable race plan: stops, total moving-time target, station ETA padding, crew notes, fuel targets, map notes, and source links.
- `data/canyons-100k-course.gpx` is the official 2026 100K alternate-course GPX used for leg pacing, gain/loss, the route tracker map, and the elevation profile.
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

To change the schedule, edit `pacing.targetMovingMinutes` for the total moving-time budget. The generator allocates that time across legs from the smoothed GPX elevation profile, then derives each leg split, pace, gain, loss, and downstream ETA.

Each `nextLeg.schedulePaddingMinutes` value preserves practical stop time or ETA rounding after that leg. Nutrition math is based on the GPX-derived planned leg minutes.

Crew `arriveBy` times are generated from each crew stop ETA minus `arriveByBufferMinutes`.

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

## Map Key

The route tracker uses MapTiler for the interactive trail map. `docs/route-map-config.js` contains the public browser key used by GitHub Pages; only commit a key that is restricted to the Pages origin in MapTiler.

For local review with the committed Pages key, run:

```sh
npm run review
```

If MapTiler rejects the committed key from `file://`, the review still checks layout and interaction. Live map assertions run when `MAPTILER_API_KEY` is set for local review.

To test a different local key without editing the committed config file, export `MAPTILER_API_KEY` in your shell and run:

```sh
source ~/.zshrc
npm run review
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
