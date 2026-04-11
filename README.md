# Canyons 100K Plan

Generated race-day crew guide for the Canyons 100K.

## Files

- `data/race-plan.json` is the editable race plan: stops, ETAs, leg splits, elevation, crew notes, fuel targets, map notes, and source links.
- `src/styles.css` is the report styling.
- `scripts/generate.js` builds the HTML report.
- `scripts/review.js` builds the report, captures Playwright screenshots, and checks mobile overflow, tap targets, and tiny text.
- `dist/canyons-100k-crew-guide.html` is the generated guide.

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
open dist/canyons-100k-crew-guide.html
```

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
