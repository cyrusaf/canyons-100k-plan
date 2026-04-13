#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "race-plan.json");
const GPX_PATH = path.join(ROOT, "data", "canyons-100k-course.gpx");
const STYLE_PATH = path.join(ROOT, "src", "styles.css");
const INDEX_OUTPUT_PATH = path.join(ROOT, "docs", "index.html");
const GUIDE_OUTPUT_PATH = path.join(ROOT, "docs", "canyons-100k-crew-guide.html");
const TRACKER_OUTPUT_PATH = path.join(ROOT, "docs", "canyons-100k-route-tracker.html");
const NOJEKYLL_OUTPUT_PATH = path.join(ROOT, "docs", ".nojekyll");
const FEET_PER_METER = 3.28084;
const EARTH_RADIUS_MI = 3958.7613;

const plan = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const styles = fs.readFileSync(STYLE_PATH, "utf8");

validatePlan(plan);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function decodeXml(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function jsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US");
}

function formatMiles(value) {
  return Number(value).toFixed(1);
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h${String(mins).padStart(2, "0")}` : `${hours}h00`;
}

function formatPace(minutes, miles) {
  if (!miles) return "";
  const totalSeconds = Math.round((minutes * 60) / miles);
  const paceMinutes = Math.floor(totalSeconds / 60);
  const paceSeconds = totalSeconds % 60;
  return `${paceMinutes}:${String(paceSeconds).padStart(2, "0")}/mi`;
}

function roundTo(value, increment) {
  // Round halves down so 0.25 L becomes 0.2 L instead of 0.3 L.
  return Math.floor(value / increment + 0.5 - Number.EPSILON) * increment;
}

function roundCoordinate(value) {
  return Number(value.toFixed(6));
}

function roundMile(value) {
  return Number(value.toFixed(3));
}

function roundElevation(value) {
  return Math.round(value);
}

function distanceMi(a, b) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(haversine));
}

function nutritionForMinutes(minutes) {
  const hours = minutes / 60;
  const carbRound = plan.nutrition.carbRoundToGrams;
  const sodiumRound = plan.nutrition.sodiumRoundToMg;
  const fluidRound = plan.nutrition.fluidRoundToLiters;

  return {
    carbs: roundTo(hours * plan.nutrition.carbsPerHour, carbRound),
    sodiumLow: roundTo(hours * plan.nutrition.sodiumMgPerHour.low, sodiumRound),
    sodiumHigh: roundTo(hours * plan.nutrition.sodiumMgPerHour.high, sodiumRound),
    fluidLow: roundTo(hours * plan.nutrition.fluidLitersPerHour.low, fluidRound),
    fluidHigh: roundTo(hours * plan.nutrition.fluidLitersPerHour.high, fluidRound)
  };
}

function addNutrition(a, b) {
  return {
    carbs: a.carbs + b.carbs,
    sodiumLow: a.sodiumLow + b.sodiumLow,
    sodiumHigh: a.sodiumHigh + b.sodiumHigh,
    fluidLow: Number((a.fluidLow + b.fluidLow).toFixed(1)),
    fluidHigh: Number((a.fluidHigh + b.fluidHigh).toFixed(1))
  };
}

function emptyNutrition() {
  return {
    carbs: 0,
    sodiumLow: 0,
    sodiumHigh: 0,
    fluidLow: 0,
    fluidHigh: 0
  };
}

function formatFluid(value) {
  return Number(value).toFixed(1);
}

function formatNutritionLine(nutrition) {
  return `${formatNumber(nutrition.carbs)} g carbs | ${formatNumber(nutrition.sodiumLow)}-${formatNumber(nutrition.sodiumHigh)} mg Na | ${formatFluid(nutrition.fluidLow)}-${formatFluid(nutrition.fluidHigh)} L`;
}

function classForStop(stop) {
  if (stop.kind === "crew") return "stop crew";
  if (stop.kind === "finish") return "stop finish";
  return "stop";
}

function renderTags(tags) {
  return tags
    .map((tag) => {
      const typeClass = tag.type && tag.type !== "default" ? ` ${tag.type}` : "";
      return `<span class="badge${typeClass}">${escapeHtml(tag.label)}</span>`;
    })
    .join("");
}

function renderStats() {
  return `
      <div class="stats" aria-label="Race facts">
        <div class="stat">
          <span>Start</span>
          <strong>${escapeHtml(plan.race.start)}</strong>
        </div>
        <div class="stat">
          <span>Finish Goal</span>
          <strong>${escapeHtml(plan.race.finishGoal)}</strong>
        </div>
        <div class="stat">
          <span>Course</span>
          <strong>${formatMiles(plan.race.courseDistanceMi)} mi</strong>
        </div>
        <div class="stat">
          <span>Fuel / Electrolytes</span>
          <strong>${formatNumber(plan.nutrition.carbsPerHour)} g/hr carbs</strong>
          <em>${formatNumber(plan.nutrition.sodiumMgPerHour.low)}-${formatNumber(plan.nutrition.sodiumMgPerHour.high)} mg Na/hr</em>
        </div>
      </div>`;
}

function renderCrewStrip() {
  return `
      <div class="crew-strip" aria-label="Crew stops">
${plan.crewStops
  .map(
    (stop, index) => `        <div class="crew-pill">
          <span>Crew Stop ${index + 1}</span>
          <strong>${escapeHtml(stop.name)} - ${escapeHtml(stop.eta)}</strong>
          <em>Arrive by ${escapeHtml(stop.arriveBy)}. ${escapeHtml(stop.summary)}</em>
        </div>`
  )
  .join("\n")}
      </div>`;
}

function getStopIndex(name) {
  return plan.stops.findIndex((stop) => stop.name === name);
}

function resupplyFor(stop, index) {
  if (!stop.resupplyTo) return null;
  const toIndex = getStopIndex(stop.resupplyTo);
  if (toIndex <= index) {
    throw new Error(`Invalid resupply target '${stop.resupplyTo}' for '${stop.name}'`);
  }

  let miles = 0;
  let minutes = 0;
  let nutrition = emptyNutrition();

  for (let i = index; i < toIndex; i += 1) {
    const leg = plan.stops[i].nextLeg;
    const legNutrition = nutritionForMinutes(leg.plannedMinutes);
    miles += leg.distanceMi;
    minutes += leg.plannedMinutes;
    nutrition = addNutrition(nutrition, legNutrition);
  }

  return {
    label: stop.resupplyLabel || stop.resupplyTo,
    miles,
    minutes,
    nutrition,
    note: stop.resupplyNote
  };
}

function renderResupply(stop, index) {
  const resupply = resupplyFor(stop, index);
  if (!resupply) return "";

  return `
          <div class="resupply" aria-label="Resupply target from ${escapeAttr(stop.name)} to ${escapeAttr(resupply.label)}">
            <div class="resupply-head"><span>Resupply to ${escapeHtml(resupply.label)}</span><strong>${formatMiles(resupply.miles)} mi | ${formatDuration(resupply.minutes)}</strong></div>
            <div class="resupply-grid">
              <div class="resupply-metric"><span>Carbs</span><strong>${formatNumber(resupply.nutrition.carbs)} g</strong></div>
              <div class="resupply-metric"><span>Sodium</span><strong>${formatNumber(resupply.nutrition.sodiumLow)}-${formatNumber(resupply.nutrition.sodiumHigh)} mg</strong></div>
              <div class="resupply-metric"><span>Fluid</span><strong>${formatFluid(resupply.nutrition.fluidLow)}-${formatFluid(resupply.nutrition.fluidHigh)} L</strong></div>
            </div>
            <p>${escapeHtml(resupply.note)}</p>
          </div>`;
}

function renderLeg(leg) {
  if (!leg) return "";

  const nutrition = nutritionForMinutes(leg.plannedMinutes);

  return `
          <div class="leg">
            <div class="leg-row"><span class="row-label">Next</span><strong>${escapeHtml(leg.to)}</strong></div>
            <div class="leg-row"><span class="row-label">Leg</span><strong>${formatMiles(leg.distanceMi)} mi | +${formatNumber(leg.gainFt)} / -${formatNumber(leg.lossFt)} ft</strong></div>
            <div class="leg-row"><span class="row-label">Time/Pace</span><strong>${escapeHtml(leg.plannedTime)} | ${escapeHtml(leg.pace)}</strong></div>
            <div class="leg-row"><span class="row-label">Leg Fuel</span><strong>${formatNutritionLine(nutrition)}</strong></div>
          </div>`;
}

function renderStop(stop, index) {
  const bodyCopy = stop.crewCallout
    ? `<div class="crew-callout">${escapeHtml(stop.crewCallout)}</div>`
    : stop.note
      ? `<p class="note">${escapeHtml(stop.note)}</p>`
      : "";

  return `        <article class="${classForStop(stop)}">
          <div class="stop-top">
            <div class="milebox"><div><strong>${formatMiles(stop.mile)}</strong><span>mi</span></div></div>
            <div class="stop-main">
              <h3>${escapeHtml(stop.name)}</h3>
              <div class="badges">${renderTags(stop.tags)}</div>
            </div>
            <div class="eta"><span>ETA</span>${escapeHtml(stop.eta)}</div>
          </div>
          ${bodyCopy}
${renderResupply(stop, index)}
${renderLeg(stop.nextLeg)}
        </article>`;
}

function renderCrewCheatSheet() {
  return plan.crewCheatSheet
    .map(
      (item) => `        <article class="crew-card">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </article>`
    )
    .join("\n");
}

function renderMaps() {
  return plan.maps
    .map(
      (item) => `        <article class="map-card crew">
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </article>`
    )
    .join("\n");
}

function renderSources() {
  return plan.sources
    .map(
      (source) => `        <article class="source-card">
          <h3>${escapeHtml(source.title)}</h3>
          <p><a href="${escapeAttr(source.url)}">${escapeHtml(source.label)}</a></p>
        </article>`
    )
    .join("\n");
}

function stopForName(name) {
  return plan.stops.find((stop) => stop.name === name);
}

function stopTypeFor(stop) {
  const labels = (stop.tags || []).map((tag) => tag.label.toLowerCase());
  const hasLabel = (needle) => labels.some((label) => label.includes(needle));
  const name = stop.name.toLowerCase();

  if (stop.kind === "finish" || name.includes("finish")) return "finish";
  if (hasLabel("start") || name.includes("start")) return "start";
  if (stop.kind === "crew" || hasLabel("crew stop")) return "crew";
  if (hasLabel("hydration")) return "hydration";
  if (hasLabel("no aid") || hasLabel("turnaround")) return "no-aid";
  if (hasLabel("full aid") || hasLabel("aid")) return "full-aid";
  return stop.kind || "aid";
}

function countsAsSegmentBoundary(stop) {
  if (stop.segmentBoundary === false) return false;
  return stopTypeFor(stop) !== "no-aid";
}

function mergedNextLeg(fromIndex, toIndex) {
  if (toIndex <= fromIndex) return null;
  if (toIndex === fromIndex + 1) {
    return { ...plan.stops[fromIndex].nextLeg };
  }

  let distanceMi = 0;
  let gainFt = 0;
  let lossFt = 0;
  let plannedMinutes = 0;

  for (let index = fromIndex; index < toIndex; index += 1) {
    const leg = plan.stops[index].nextLeg;
    if (!leg) {
      throw new Error(`Missing leg while merging segment from '${plan.stops[fromIndex].name}'`);
    }
    distanceMi += leg.distanceMi;
    gainFt += leg.gainFt;
    lossFt += leg.lossFt;
    plannedMinutes += leg.plannedMinutes;
  }

  const roundedDistance = Number(distanceMi.toFixed(1));
  return {
    to: plan.stops[toIndex].name,
    distanceMi: roundedDistance,
    gainFt: Math.round(gainFt),
    lossFt: Math.round(lossFt),
    plannedTime: formatDuration(plannedMinutes),
    plannedMinutes,
    pace: formatPace(plannedMinutes, roundedDistance)
  };
}

function routeStopForClient(stop, index) {
  const resupply = resupplyFor(stop, index);

  return {
    name: stop.name,
    mile: stop.mile,
    eta: stop.eta,
    kind: stop.kind || "aid",
    type: stopTypeFor(stop),
    segmentBoundary: countsAsSegmentBoundary(stop),
    tags: stop.tags,
    note: stop.crewCallout || stop.note || "",
    resupply: resupply
      ? {
          label: resupply.label,
          miles: resupply.miles,
          minutes: resupply.minutes,
          nutrition: resupply.nutrition,
          note: resupply.note
        }
      : null,
    nextLeg: stop.nextLeg || null
  };
}

function parseAttrs(value) {
  const attrs = {};
  for (const match of value.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseGpxCourse() {
  const gpx = fs.readFileSync(GPX_PATH, "utf8");
  const rawPoints = [];
  const waypoints = [];

  for (const match of gpx.matchAll(/<wpt\s+([^>]+)>([\s\S]*?)<\/wpt>/g)) {
    const attrs = parseAttrs(match[1]);
    const nameMatch = match[2].match(/<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>/);

    waypoints.push({
      name: decodeXml(nameMatch ? nameMatch[1].trim() : ""),
      lat: Number(attrs.lat),
      lon: Number(attrs.lon)
    });
  }

  for (const match of gpx.matchAll(/<trkpt\s+([^>]+)>([\s\S]*?)<\/trkpt>/g)) {
    const attrs = parseAttrs(match[1]);
    const eleMatch = match[2].match(/<ele>([^<]+)<\/ele>/);
    const point = {
      lat: Number(attrs.lat),
      lon: Number(attrs.lon),
      eleFt: eleMatch ? Number(eleMatch[1]) * FEET_PER_METER : 0,
      rawMile: 0
    };

    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    if (rawPoints.length) {
      point.rawMile = rawPoints[rawPoints.length - 1].rawMile + distanceMi(rawPoints[rawPoints.length - 1], point);
    }
    rawPoints.push(point);
  }

  if (rawPoints.length < 2) {
    throw new Error(`No usable track points found in ${path.relative(ROOT, GPX_PATH)}`);
  }

  const rawTotalMiles = rawPoints[rawPoints.length - 1].rawMile;
  const officialTotalMiles = plan.race.courseDistanceMi;
  const points = rawPoints.map((point) => ({
    lat: roundCoordinate(point.lat),
    lon: roundCoordinate(point.lon),
    mile: roundMile((point.rawMile / rawTotalMiles) * officialTotalMiles),
    eleFt: roundElevation(point.eleFt)
  }));
  const bounds = points.reduce(
    (acc, point) => ({
      south: Math.min(acc.south, point.lat),
      west: Math.min(acc.west, point.lon),
      north: Math.max(acc.north, point.lat),
      east: Math.max(acc.east, point.lon)
    }),
    { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity }
  );

  return {
    points,
    waypoints,
    rawTotalMiles: roundMile(rawTotalMiles),
    officialTotalMiles,
    bounds
  };
}

function interpolateCoursePoint(points, mile) {
  if (mile <= points[0].mile) return points[0];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (mile <= to.mile) {
      const t = (mile - from.mile) / Math.max(0.001, to.mile - from.mile);
      return {
        lat: roundCoordinate(from.lat + (to.lat - from.lat) * t),
        lon: roundCoordinate(from.lon + (to.lon - from.lon) * t),
        mile: roundMile(mile),
        eleFt: roundElevation(from.eleFt + (to.eleFt - from.eleFt) * t)
      };
    }
  }
  return points[points.length - 1];
}

function waypointForStop(stop, waypoints) {
  const name = stop.name.toLowerCase();
  const includes = (needle) => waypoints.find((waypoint) => waypoint.name.toLowerCase().includes(needle));

  if (name.includes("china wall")) return includes("china wall") || includes("start");
  if (name.includes("deadwood")) return includes("deadwood");
  if (name.includes("devils thumb")) return includes("devils thumb");
  if (name.includes("swinging bridge")) return includes("swinging bridge");
  if (name.includes("michigan bluff")) return includes("michigan bluff");
  if (name.includes("foresthill")) return includes("foresthill");
  if (name.includes("cal 2")) return includes("cal 2");
  if (name.includes("drivers flat")) return includes("drivers flat");
  if (name.includes("mammoth bar")) return includes("mammoth bar");
  if (name.includes("confluence")) return includes("confluence");
  if (name.includes("finish")) return includes("finish");
  return null;
}

function buildRouteData() {
  const course = parseGpxCourse();
  const stops = plan.stops.map((stop, index) => {
    const waypoint = waypointForStop(stop, course.waypoints);
    const coordinate = waypoint || interpolateCoursePoint(course.points, stop.mile);

    return {
      ...routeStopForClient(stop, index),
      lat: roundCoordinate(coordinate.lat),
      lon: roundCoordinate(coordinate.lon)
    };
  });
  const segmentStopIndexes = plan.stops
    .map((stop, index) => (countsAsSegmentBoundary(stop) ? index : null))
    .filter((index) => index !== null);

  return {
    title: plan.title,
    eyebrow: plan.eyebrow,
    subtitle: plan.subtitle,
    race: plan.race,
    nutrition: plan.nutrition,
    course: {
      points: course.points,
      bounds: course.bounds,
      rawTotalMiles: course.rawTotalMiles,
      totalMiles: course.officialTotalMiles
    },
    stops,
    segmentStops: segmentStopIndexes.map((stopIndex, segmentIndex) => ({
      ...stops[stopIndex],
      nextLeg:
        segmentIndex < segmentStopIndexes.length - 1
          ? mergedNextLeg(stopIndex, segmentStopIndexes[segmentIndex + 1])
          : null
    }))
  };
}

function renderGuideHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(plan.title)}</title>
  <style>
${styles}
  </style>
</head>
<body>
  <div class="topbar">
    <nav class="nav" aria-label="Guide sections">
      <a href="#overview">Overview</a>
      <a href="#plan">Plan</a>
      <a href="#crew">Crew</a>
      <a href="#maps">Maps</a>
      <a href="./canyons-100k-route-tracker.html">Tracker</a>
    </nav>
  </div>

  <main class="wrap">
    <header id="overview">
      <p class="eyebrow">${escapeHtml(plan.eyebrow)}</p>
      <h1>Race Day Crew Guide</h1>
      <p class="subtitle">${escapeHtml(plan.subtitle)}</p>
${renderStats()}
${renderCrewStrip()}
    </header>

    <section id="plan" aria-labelledby="plan-title">
      <div class="section-head">
        <h2 id="plan-title">Course Plan</h2>
        <p>Each card shows the current stop, ETA, crew status, and the next-leg distance, climb/descent, planned split, pace, and fuel to consume before the next stop. Resupply bands sum the leg-fuel targets to the next crew stop or finish; add buffer for extra stop time, delays, and heat.</p>
      </div>

      <div class="course-list">
${plan.stops.map((stop, index) => renderStop(stop, index)).join("\n\n")}
      </div>
    </section>

    <section id="crew" aria-labelledby="crew-title">
      <div class="section-head">
        <h2 id="crew-title">Crew Cheat Sheet</h2>
        <p>The detailed handoffs are highlighted in the course plan. This is just the fast memory jog.</p>
      </div>

      <div class="crew-quick">
${renderCrewCheatSheet()}
      </div>
    </section>

    <section id="maps" aria-labelledby="maps-title">
      <div class="section-head">
        <h2 id="maps-title">Maps & Parking</h2>
        <p>Confirm parking against the race-week guide, then add exact pins and screenshots here.</p>
      </div>

      <div class="map-grid">
${renderMaps()}
      </div>
    </section>

    <section aria-labelledby="sources-title">
      <div class="section-head">
        <h2 id="sources-title">Source Notes</h2>
        <p>Update after packet pickup and runner briefing.</p>
      </div>

      <div class="source-grid">
${renderSources()}
      </div>
      <p class="small-note">${escapeHtml(plan.versionNote)}</p>
    </section>
  </main>
</body>
</html>
`;
}

function renderRouteTrackerHtml() {
  const routeData = buildRouteData();
  const routeJson = jsonForScript(routeData);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Canyons 100K Route Tracker</title>
  <link rel="stylesheet" href="https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.css">
  <style>
${styles}
  </style>
</head>
<body class="route-body">
  <main class="route-app" data-route-app>
    <section class="route-stage" aria-label="Course visualizations">
      <div class="route-head">
        <div>
          <p class="eyebrow">Canyons 100K by UTMB</p>
          <h1>Route Tracker</h1>
        </div>
        <div class="route-head-meta">
          <span id="route-distance-label">0.0 / ${formatMiles(plan.race.courseDistanceMi)} mi</span>
          <a href="./canyons-100k-crew-guide.html">Crew Guide</a>
        </div>
      </div>

      <article class="route-viz map-viz real-map-viz" aria-labelledby="map-title">
        <h2 id="map-title" class="sr-only">Course map and progress dot</h2>
        <div id="route-map" class="maplibre-route-map" aria-label="Interactive course map with GPX track and progress dot"></div>
      </article>
    </section>

    <section class="route-details real-route-details" aria-label="Current route details">
      <article class="station-panel" id="station-panel">
        <div class="station-route-summary">
          <div class="station-overline" id="station-overline">Current leg</div>
          <div class="station-route-line">
            <div class="station-route-stop">
              <span id="station-meta">Depart 5:00 AM</span>
              <h2 id="station-name">China Wall Start</h2>
            </div>
            <span class="station-route-arrow">to</span>
            <div class="station-route-stop">
              <span id="arrival-meta">Arrive 7:25 AM</span>
              <strong id="next-stop">Deadwood 1</strong>
            </div>
          </div>
          <div class="station-tags" id="station-tags"></div>
          <p class="station-note" id="station-note"></p>
        </div>

        <div class="station-grid station-leg-metrics" id="station-grid" aria-label="Current leg distance and elevation">
          <div class="station-section-title">Leg effort</div>
          <div class="station-metric primary">
            <span>Distance</span>
            <strong id="next-leg">10.1 mi</strong>
          </div>
          <div class="station-metric">
            <span>Elevation</span>
            <strong id="leg-elevation">+1,787 / -2,870 ft</strong>
          </div>
        </div>

        <div class="station-grid station-nutrition-metrics" id="station-nutrition" aria-label="Nutrition needed for this leg">
          <div class="station-section-title">Fuel for this leg</div>
          <div class="station-metric">
            <span>Carbs</span>
            <strong id="next-fuel">220 g</strong>
          </div>
          <div class="station-metric">
            <span>Salt</span>
            <strong id="leg-sodium">1,200-1,800 mg</strong>
          </div>
          <div class="station-metric">
            <span>Fluid</span>
            <strong id="leg-fluid">1.2-1.8 L</strong>
          </div>
        </div>

        <div class="station-resupply" id="station-resupply" hidden>
          <span id="resupply-label">Resupply to Michigan Bluff</span>
          <strong id="resupply-block">24.0 mi | 6h40</strong>
          <em id="resupply-nutrition">590 g carbs | 3,250-4,900 mg Na | 3.3-4.9 L</em>
          <p id="resupply-note"></p>
        </div>
      </article>

      <article class="route-viz profile-viz bottom-profile-viz" aria-labelledby="profile-title">
        <div class="viz-title">
          <div>
            <span>Full GPX Elevation Profile</span>
            <strong id="profile-title">Tap or drag to move the marker</strong>
          </div>
          <em id="route-elevation-label">0 ft</em>
        </div>
        <svg id="profile-svg" class="route-svg" preserveAspectRatio="none" role="img" aria-label="Full course elevation profile with current position line">
          <g class="profile-grid" id="profile-grid"></g>
          <path class="profile-area" id="profile-area"></path>
          <rect class="profile-current-leg" id="profile-current-leg" x="0" y="0" width="0" height="0"></rect>
          <g class="profile-stop-guides" id="profile-stop-guides"></g>
          <path class="profile-line-shadow" id="profile-line-shadow"></path>
          <path class="profile-line" id="profile-line"></path>
          <path class="profile-progress" id="profile-progress"></path>
          <g id="profile-stops"></g>
          <line class="profile-cursor-line" id="profile-cursor-line"></line>
          <circle class="profile-cursor" id="profile-cursor" r="5.5"></circle>
        </svg>
        <div class="profile-marker-popup" id="profile-marker-popup" hidden aria-hidden="true">
          <div class="profile-popup-row profile-popup-current">
            <span id="profile-popup-mile">0.0 mi</span>
            <span id="profile-popup-elevation">0 ft</span>
            <span id="profile-popup-grade">0%</span>
          </div>
          <div class="profile-popup-leg">
            <span id="profile-popup-leg-route">China Wall Start -> Deadwood 1</span>
            <span id="profile-popup-leg-stats">10.1 mi / +1,787 / -2,870 ft</span>
          </div>
        </div>
      </article>
    </section>
  </main>

  <script src="./route-map-config.js"></script>
  <script src="https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.umd.min.js"></script>
  <script>
    const routeData = ${routeJson};

    const state = {
      currentMile: 0,
      targetMile: 0,
      touchY: null,
      raf: null,
      map: null,
      profileDragging: false
    };

    const elements = {
      distanceLabel: document.getElementById("route-distance-label"),
      elevationLabel: document.getElementById("route-elevation-label"),
      stationPanel: document.getElementById("station-panel"),
      stationOverline: document.getElementById("station-overline"),
      stationName: document.getElementById("station-name"),
      stationMeta: document.getElementById("station-meta"),
      arrivalMeta: document.getElementById("arrival-meta"),
      stationTags: document.getElementById("station-tags"),
      stationNote: document.getElementById("station-note"),
      stationGrid: document.getElementById("station-grid"),
      stationResupply: document.getElementById("station-resupply"),
      nextStop: document.getElementById("next-stop"),
      nextLeg: document.getElementById("next-leg"),
      legElevation: document.getElementById("leg-elevation"),
      nextFuel: document.getElementById("next-fuel"),
      legSodium: document.getElementById("leg-sodium"),
      legFluid: document.getElementById("leg-fluid"),
      resupplyLabel: document.getElementById("resupply-label"),
      resupplyBlock: document.getElementById("resupply-block"),
      resupplyNutrition: document.getElementById("resupply-nutrition"),
      resupplyNote: document.getElementById("resupply-note"),
      profileSvg: document.getElementById("profile-svg"),
      profileGrid: document.getElementById("profile-grid"),
      profileStopGuides: document.getElementById("profile-stop-guides"),
      profileCurrentLeg: document.getElementById("profile-current-leg"),
      profileArea: document.getElementById("profile-area"),
      profileLine: document.getElementById("profile-line"),
      profileLineShadow: document.getElementById("profile-line-shadow"),
      profileProgress: document.getElementById("profile-progress"),
      profileStops: document.getElementById("profile-stops"),
      profileCursor: document.getElementById("profile-cursor"),
      profileCursorLine: document.getElementById("profile-cursor-line"),
      profilePopup: document.getElementById("profile-marker-popup"),
      profilePopupMile: document.getElementById("profile-popup-mile"),
      profilePopupElevation: document.getElementById("profile-popup-elevation"),
      profilePopupGrade: document.getElementById("profile-popup-grade"),
      profilePopupLegRoute: document.getElementById("profile-popup-leg-route"),
      profilePopupLegStats: document.getElementById("profile-popup-leg-stats")
    };

    const totalMiles = routeData.course.totalMiles;
    const coursePoints = routeData.course.points;
    const segmentStops = routeData.segmentStops || routeData.stops;
    const mapHighlightColor = "#ff5a3d";
    const mapHighlightSoft = "#ffe7e2";
    const stopColors = {
      "full-aid": { stroke: "#527a2f", fill: "#edf6e6", mapRadius: 4, profileRadius: 4.2 },
      hydration: { stroke: "#1d6fb8", fill: "#e7f2ff", mapRadius: 4, profileRadius: 4.2 },
      "no-aid": { stroke: "#7b847d", fill: "#f4f7f5", mapRadius: 3, profileRadius: 3.2 },
      crew: { stroke: "#ff5a3d", fill: "#ffe7e2", mapRadius: 6, profileRadius: 5 },
      start: { stroke: "#6366a8", fill: "#ececff", mapRadius: 5, profileRadius: 4.6 },
      finish: { stroke: "#0f766e", fill: "#dff7f2", mapRadius: 6, profileRadius: 5 },
      aid: { stroke: "#0f766e", fill: "#ffffff", mapRadius: 4, profileRadius: 4.2 }
    };
    const stopTypeLabels = {
      "full-aid": "Full aid",
      hydration: "Hydration",
      "no-aid": "No aid",
      crew: "Crew",
      start: "Start",
      finish: "Finish",
      aid: "Aid"
    };
    let profile = null;
    const mapLayerIds = {
      fullRouteCasing: "course-route-casing",
      fullRoute: "course-route",
      progressRouteCasing: "course-progress-casing",
      progressRoute: "course-progress",
      stops: "course-stops",
      progressHalo: "course-progress-halo",
      progressDot: "course-progress-dot"
    };
    const mapSourceIds = {
      fullRoute: "course-route-source",
      progressRoute: "course-progress-source",
      stops: "course-stops-source",
      progressPoint: "course-progress-point-source"
    };
    window.routeTrackerReady = false;
    window.routeTrackerMapLayerIds = mapLayerIds;
    window.routeTrackerMapSourceIds = mapSourceIds;

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function formatMiles(value) {
      return Number(value).toFixed(1);
    }

    function formatNumber(value) {
      return Number(value).toLocaleString("en-US");
    }

    function formatFluid(value) {
      return Number(value).toFixed(1);
    }

    function stopTypeLabel(stop) {
      return stopTypeLabels[stop.type] || "Aid";
    }

    function formatDuration(minutes) {
      if (!minutes) return "";
      if (minutes < 60) return minutes + "m";
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins ? hours + "h" + String(mins).padStart(2, "0") : hours + "h00";
    }

    function nutritionForMinutes(minutes) {
      const hours = minutes / 60;
      const roundTo = (value, increment) => Math.floor(value / increment + 0.5 - Number.EPSILON) * increment;
      return {
        carbs: roundTo(hours * routeData.nutrition.carbsPerHour, routeData.nutrition.carbRoundToGrams),
        sodiumLow: roundTo(hours * routeData.nutrition.sodiumMgPerHour.low, routeData.nutrition.sodiumRoundToMg),
        sodiumHigh: roundTo(hours * routeData.nutrition.sodiumMgPerHour.high, routeData.nutrition.sodiumRoundToMg),
        fluidLow: roundTo(hours * routeData.nutrition.fluidLitersPerHour.low, routeData.nutrition.fluidRoundToLiters),
        fluidHigh: roundTo(hours * routeData.nutrition.fluidLitersPerHour.high, routeData.nutrition.fluidRoundToLiters)
      };
    }

    function formatElevationLine(leg) {
      return "+" + formatNumber(leg.gainFt) + " / -" + formatNumber(leg.lossFt) + " ft";
    }

    function formatNutritionLine(nutrition) {
      return formatNumber(nutrition.carbs) + " g carbs | " +
        formatNumber(nutrition.sodiumLow) + "-" + formatNumber(nutrition.sodiumHigh) + " mg Na | " +
        formatFluid(nutrition.fluidLow) + "-" + formatFluid(nutrition.fluidHigh) + " L";
    }

    function legContext(stop, index) {
      if (stop.nextLeg) {
        return {
          depart: stop,
          arrive: segmentStops[index + 1] || null,
          leg: stop.nextLeg,
          complete: false
        };
      }
      if (index > 0) {
        const depart = segmentStops[index - 1];
        return {
          depart,
          arrive: stop,
          leg: depart.nextLeg || null,
          complete: true
        };
      }
      return {
        depart: stop,
        arrive: null,
        leg: null,
        complete: true
      };
    }

    function buildProfileGeometry() {
      const rect = elements.profileSvg.getBoundingClientRect();
      const width = rect.width > 0 ? Math.round(rect.width) : 1000;
      const measuredHeight = rect.height > 0 ? Math.round(rect.height) : 220;
      const minElevation = Math.min(...coursePoints.map((point) => point.eleFt)) - 120;
      const maxElevation = Math.max(...coursePoints.map((point) => point.eleFt)) + 120;
      const left = 8;
      const right = width - 8;
      const top = 18;
      const minBottomPadding = 40;
      const minPlotHeight = 48;
      const height = Math.max(measuredHeight, top + minBottomPadding + minPlotHeight);
      const bottom = height - Math.max(minBottomPadding, Math.round(height * 0.16));
      const points = coursePoints.map((point) => {
        const x = left + (point.mile / totalMiles) * (right - left);
        const y = bottom - ((point.eleFt - minElevation) / (maxElevation - minElevation)) * (bottom - top);
        return { ...point, x, y };
      });

      return { points, left, right, top, bottom, width, height, minElevation, maxElevation };
    }

    function pointPath(points) {
      return points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(2) + " " + point.y.toFixed(2)).join(" ");
    }

    function interpolate(points, mile) {
      if (mile <= points[0].mile) return points[0];
      for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (mile <= to.mile) {
          const t = (mile - from.mile) / Math.max(0.001, to.mile - from.mile);
          return {
            mile,
            lat: from.lat + (to.lat - from.lat) * t,
            lon: from.lon + (to.lon - from.lon) * t,
            eleFt: from.eleFt + (to.eleFt - from.eleFt) * t,
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t
          };
        }
      }
      return points[points.length - 1];
    }

    function profilePoint(mile) {
      return interpolate(profile.points, mile);
    }

    function coursePoint(mile) {
      return interpolate(coursePoints, mile);
    }

    function gradeForMile(mile) {
      const windowMiles = 0.12;
      const fromMile = clamp(mile - windowMiles, 0, totalMiles);
      const toMile = clamp(mile + windowMiles, 0, totalMiles);
      const distanceFt = (toMile - fromMile) * 5280;
      if (distanceFt < 120) return null;
      const from = coursePoint(fromMile);
      const to = coursePoint(toMile);
      return ((to.eleFt - from.eleFt) / distanceFt) * 100;
    }

    function partialProfilePath(mile) {
      const drawn = [];
      for (let index = 0; index < profile.points.length; index += 1) {
        const point = profile.points[index];
        if (point.mile < mile) {
          drawn.push(point);
          continue;
        }
        if (point.mile === mile || index === 0) drawn.push(point);
        else drawn.push(profilePoint(mile));
        break;
      }
      return pointPath(drawn);
    }

    function partialLatLngs(mile) {
      const latLngs = [];
      for (let index = 0; index < coursePoints.length; index += 1) {
        const point = coursePoints[index];
        if (point.mile < mile) {
          latLngs.push([point.lat, point.lon]);
          continue;
        }
        const current = point.mile === mile || index === 0 ? point : coursePoint(mile);
        latLngs.push([current.lat, current.lon]);
        break;
      }
      return latLngs;
    }

    function coordinatesFromLatLngs(latLngs) {
      return latLngs.map((point) => [point[1], point[0]]);
    }

    function lineFeatureFromLatLngs(latLngs) {
      const coordinates = coordinatesFromLatLngs(latLngs);
      const firstCoordinate = coordinates[0] || [coursePoints[0].lon, coursePoints[0].lat];
      const safeCoordinates = coordinates.length > 1 ? coordinates : [firstCoordinate, firstCoordinate];
      return {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: safeCoordinates
        }
      };
    }

    function pointFeature(point, properties) {
      return {
        type: "Feature",
        properties: properties || {},
        geometry: {
          type: "Point",
          coordinates: [point.lon, point.lat]
        }
      };
    }

    function featureCollection(features) {
      return { type: "FeatureCollection", features };
    }

    function previousStop(mile) {
      let index = 0;
      segmentStops.forEach((stop, stopIndex) => {
        if (stop.mile <= mile + 0.05) index = stopIndex;
      });
      return { stop: segmentStops[index], index };
    }

    function initProfile() {
      profile = buildProfileGeometry();
      elements.profileSvg.setAttribute("viewBox", "0 0 " + profile.width + " " + profile.height);

      const gridFragment = document.createDocumentFragment();
      for (let index = 0; index < 4; index += 1) {
        const y = profile.top + ((profile.bottom - profile.top) * index) / 3;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "profile-grid-line");
        line.setAttribute("x1", profile.left);
        line.setAttribute("x2", profile.right);
        line.setAttribute("y1", y);
        line.setAttribute("y2", y);
        gridFragment.appendChild(line);
      }
      elements.profileGrid.replaceChildren(gridFragment);

      const profileD = pointPath(profile.points);
      const areaD = profileD + " L " + profile.points[profile.points.length - 1].x.toFixed(2) + " " + profile.height + " L " + profile.points[0].x.toFixed(2) + " " + profile.height + " Z";
      elements.profileArea.setAttribute("d", areaD);
      elements.profileLine.setAttribute("d", profileD);
      elements.profileLineShadow.setAttribute("d", profileD);
      elements.profileCursorLine.setAttribute("y1", profile.top);
      elements.profileCursorLine.setAttribute("y2", profile.bottom);

      const guideFragment = document.createDocumentFragment();
      routeData.stops.forEach((stop) => {
        const point = profilePoint(stop.mile);
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.setAttribute("class", "profile-stop-guide stop-" + (stop.type || "aid") + (stop.resupply ? " resupply-guide" : ""));
        guide.setAttribute("x1", point.x);
        guide.setAttribute("x2", point.x);
        guide.setAttribute("y1", profile.top);
        guide.setAttribute("y2", profile.bottom);
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = stopTypeLabel(stop) + ": " + stop.name + " | Mile " + formatMiles(stop.mile);
        guide.appendChild(title);
        guideFragment.appendChild(guide);
      });
      elements.profileStopGuides.replaceChildren(guideFragment);

      const fragment = document.createDocumentFragment();
      routeData.stops.forEach((stop) => {
        const point = profilePoint(stop.mile);
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("class", "svg-stop stop-" + (stop.type || "aid"));
        circle.setAttribute("cx", point.x);
        circle.setAttribute("cy", point.y);
        circle.setAttribute("r", stopColors[stop.type]?.profileRadius || stopColors.aid.profileRadius);
        const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
        title.textContent = stopTypeLabel(stop) + ": " + stop.name + " | Mile " + formatMiles(stop.mile);
        circle.appendChild(title);
        fragment.appendChild(circle);
      });
      elements.profileStops.replaceChildren(fragment);
    }

    function currentLegStops(stopIndex) {
      if (segmentStops.length < 2) return null;
      if (stopIndex >= segmentStops.length - 1) {
        return {
          from: segmentStops[segmentStops.length - 2],
          to: segmentStops[segmentStops.length - 1]
        };
      }
      return {
        from: segmentStops[stopIndex],
        to: segmentStops[stopIndex + 1]
      };
    }

    function updateCurrentLegHighlight(stopIndex) {
      const leg = currentLegStops(stopIndex);
      if (!leg) {
        elements.profileCurrentLeg.setAttribute("width", 0);
        elements.profileCurrentLeg.setAttribute("height", 0);
        return;
      }

      const from = profilePoint(leg.from.mile);
      const to = profilePoint(leg.to.mile);
      elements.profileCurrentLeg.setAttribute("x", Math.min(from.x, to.x).toFixed(2));
      elements.profileCurrentLeg.setAttribute("y", profile.top);
      elements.profileCurrentLeg.setAttribute("width", Math.abs(to.x - from.x).toFixed(2));
      elements.profileCurrentLeg.setAttribute("height", Math.max(0, profile.bottom - profile.top).toFixed(2));
    }

    function mapTilerKey() {
      const query = new URLSearchParams(window.location.search);
      const queryKey = query.get("maptiler_key");
      if (queryKey) {
        try {
          localStorage.setItem("canyonsMaptilerKey", queryKey);
        } catch (error) {
          // Storage can be unavailable in private browsing.
        }
        return queryKey;
      }

      try {
        const storedKey = localStorage.getItem("canyonsMaptilerKey");
        if (storedKey) return storedKey;
      } catch (error) {
        // Ignore storage errors and try the local config file.
      }

      return window.CANYONS_MAPTILER_API_KEY || "";
    }

    function redactMapError(value) {
      return String(value || "Map error").replace(/([?&]key=)[^&\\s)]+/g, "$1redacted");
    }

    function safeSetPaint(layerId, property, value) {
      if (!state.map.getLayer(layerId)) return;
      try {
        state.map.setPaintProperty(layerId, property, value);
      } catch (error) {
        // MapTiler can revise style internals; keep the tracker resilient.
      }
    }

    function safeSetLayout(layerId, property, value) {
      if (!state.map.getLayer(layerId)) return;
      try {
        state.map.setLayoutProperty(layerId, property, value);
      } catch (error) {
        // Ignore optional base-map layer tweaks.
      }
    }

    function safeSetLayerZoomRange(layerId, minzoom, maxzoom) {
      if (!state.map.getLayer(layerId) || typeof state.map.setLayerZoomRange !== "function") return;
      try {
        state.map.setLayerZoomRange(layerId, minzoom, maxzoom);
      } catch (error) {
        // Ignore optional base-map layer tweaks.
      }
    }

    function stylizeBaseMap() {
      safeSetPaint("Background", "background-color", "#f7f8f5");

      ["Forest", "Wood"].forEach((layerId) => {
        safeSetPaint(layerId, "fill-color", "#dfead9");
        safeSetPaint(layerId, "fill-opacity", 0.24);
      });
      ["Grass", "Scrub", "Crop"].forEach((layerId) => {
        safeSetPaint(layerId, "fill-color", "#e8eee1");
        safeSetPaint(layerId, "fill-opacity", 0.18);
      });
      safeSetPaint("Residential", "fill-color", "#f7f7f5");
      safeSetPaint("Residential", "fill-opacity", 0.86);
      safeSetPaint("Industrial", "fill-color", "#f5f5f3");
      safeSetPaint("Industrial", "fill-opacity", 0.76);

      safeSetPaint("Hillshade", "hillshade-exaggeration", 0.11);
      safeSetPaint("Hillshade", "hillshade-shadow-color", "#8f9b94");
      safeSetPaint("Hillshade", "hillshade-highlight-color", "#ffffff");
      safeSetPaint("Hillshade", "hillshade-accent-color", "#c8d2ca");

      safeSetPaint("Contour index", "line-color", "#748178");
      safeSetPaint("Contour index", "line-opacity", ["interpolate", ["linear"], ["zoom"], 8, 0.16, 11, 0.24, 14, 0.32]);
      safeSetPaint("Contour index", "line-width", ["interpolate", ["linear"], ["zoom"], 9, 0.55, 13, 0.86, 16, 1.12]);
      safeSetPaint("Contour", "line-color", "#95a098");
      safeSetPaint("Contour", "line-opacity", ["interpolate", ["linear"], ["zoom"], 8, 0.06, 11, 0.12, 15, 0.18]);
      safeSetPaint("Contour", "line-width", ["interpolate", ["linear"], ["zoom"], 9, 0.32, 13, 0.52, 16, 0.76]);
      safeSetLayout("Contour labels", "visibility", "visible");
      safeSetPaint("Contour labels", "text-color", "#6f7c74");
      safeSetPaint("Contour labels", "text-opacity", ["interpolate", ["linear"], ["zoom"], 11, 0, 13, 0.16, 15, 0.28]);
      safeSetPaint("Contour labels", "text-halo-color", "rgba(247, 248, 245, 0.78)");
      safeSetPaint("Contour labels", "text-halo-width", 1.1);
      safeSetLayout("Glacier contour labels", "visibility", "none");

      safeSetPaint("Water", "fill-color", "#b6deee");
      safeSetPaint("River", "line-color", "#7fc1df");
      safeSetPaint("Waterway", "line-color", "#83c4df");
      safeSetPaint("River intermittent", "line-color", "#9dd4e9");
      safeSetPaint("Waterway intermittent", "line-color", "#9dd4e9");

      ["Minor road outline", "Major road outline", "Highway outline"].forEach((layerId) => {
        safeSetPaint(layerId, "line-color", "#ffffff");
        safeSetPaint(layerId, "line-opacity", 0.54);
      });
      safeSetPaint("Minor road", "line-color", "#ffffff");
      safeSetPaint("Major road", "line-color", "#fff7d9");
      safeSetPaint("Highway", "line-color", "#f2dda2");
      safeSetPaint("Highway", "line-opacity", 0.45);

      ["Path minor", "Path"].forEach((layerId) => {
        safeSetLayerZoomRange(layerId, 10, 24);
        safeSetPaint(layerId, "line-color", "#ffffff");
        safeSetPaint(layerId, "line-opacity", 0.84);
        safeSetPaint(layerId, "line-width", ["interpolate", ["linear"], ["zoom"], 9, 0.45, 12, 1, 15, 1.8]);
      });

      safeSetPaint("Road labels", "text-color", "#49524c");
      safeSetPaint("Road labels", "text-opacity", ["interpolate", ["linear"], ["zoom"], 8, 0.02, 12, 0.28]);
      safeSetPaint("Road labels", "text-halo-color", "rgba(255, 255, 255, 0.78)");
      ["Place labels", "Village labels", "Town labels", "City labels"].forEach((layerId) => {
        safeSetPaint(layerId, "text-color", "#2d3430");
        safeSetPaint(layerId, "text-halo-color", "rgba(255, 255, 255, 0.82)");
        safeSetPaint(layerId, "text-halo-width", 1.4);
      });
      ["Protected area labels", "National park labels"].forEach((layerId) => {
        safeSetPaint(layerId, "text-color", "#2f6b30");
        safeSetPaint(layerId, "text-halo-color", "rgba(239, 248, 237, 0.9)");
        safeSetPaint(layerId, "text-halo-width", 1.5);
      });
      ["Peak labels", "Peak labels (US)", "Volcano labels", "Volcano labels (US)"].forEach((layerId) => {
        safeSetPaint(layerId, "text-color", "#42503e");
        safeSetPaint(layerId, "text-halo-color", "rgba(255, 255, 255, 0.78)");
        safeSetPaint(layerId, "icon-color", "#56624d");
      });
    }

    function addRouteMapLayers() {
      const routeLatLngs = coursePoints.map((point) => [point.lat, point.lon]);
      const stopFeatures = routeData.stops.map((stop) =>
        pointFeature(stop, {
          name: stop.name,
          mile: stop.mile,
          type: stop.type || "aid",
          label: stopTypeLabel(stop)
        })
      );

      state.map.addSource(mapSourceIds.fullRoute, {
        type: "geojson",
        data: lineFeatureFromLatLngs(routeLatLngs)
      });
      state.map.addSource(mapSourceIds.progressRoute, {
        type: "geojson",
        data: lineFeatureFromLatLngs([[coursePoints[0].lat, coursePoints[0].lon]])
      });
      state.map.addSource(mapSourceIds.stops, {
        type: "geojson",
        data: featureCollection(stopFeatures)
      });
      state.map.addSource(mapSourceIds.progressPoint, {
        type: "geojson",
        data: pointFeature(coursePoints[0], {})
      });

      state.map.addLayer({
        id: mapLayerIds.fullRouteCasing,
        type: "line",
        source: mapSourceIds.fullRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.92, "line-width": 9.5 }
      });
      state.map.addLayer({
        id: mapLayerIds.fullRoute,
        type: "line",
        source: mapSourceIds.fullRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#287e76", "line-opacity": 0.58, "line-width": 4.6 }
      });
      state.map.addLayer({
        id: mapLayerIds.progressRouteCasing,
        type: "line",
        source: mapSourceIds.progressRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.96, "line-width": 11.5 }
      });
      state.map.addLayer({
        id: mapLayerIds.progressRoute,
        type: "line",
        source: mapSourceIds.progressRoute,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": mapHighlightColor, "line-opacity": 1, "line-width": 6.6 }
      });
      state.map.addLayer({
        id: mapLayerIds.stops,
        type: "circle",
        source: mapSourceIds.stops,
        paint: {
          "circle-radius": [
            "match",
            ["get", "type"],
            "crew",
            6,
            "finish",
            7,
            "start",
            5,
            "no-aid",
            3,
            4
          ],
          "circle-color": [
            "match",
            ["get", "type"],
            "finish",
            mapHighlightColor,
            "crew",
            mapHighlightSoft,
            "start",
            "#ececff",
            "no-aid",
            "#f4f7f5",
            "#ffffff"
          ],
          "circle-stroke-color": [
            "match",
            ["get", "type"],
            "crew",
            mapHighlightColor,
            "finish",
            "#ffffff",
            "start",
            "#6366a8",
            "no-aid",
            "#7b847d",
            "#0f766e"
          ],
          "circle-stroke-width": ["match", ["get", "type"], "finish", 3, "crew", 2.5, "no-aid", 1.5, 2],
          "circle-opacity": 1,
          "circle-stroke-opacity": 1
        }
      });
      state.map.addLayer({
        id: mapLayerIds.progressHalo,
        type: "circle",
        source: mapSourceIds.progressPoint,
        paint: {
          "circle-radius": 19,
          "circle-color": mapHighlightColor,
          "circle-opacity": 0.16,
          "circle-stroke-color": mapHighlightColor,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.24
        }
      });
      state.map.addLayer({
        id: mapLayerIds.progressDot,
        type: "circle",
        source: mapSourceIds.progressPoint,
        paint: {
          "circle-radius": 8,
          "circle-color": mapHighlightColor,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3
        }
      });
    }

    function initMap() {
      const mapElement = document.getElementById("route-map");
      if (!window.maptilersdk) {
        mapElement.textContent = "Map library could not load.";
        window.routeTrackerReady = true;
        return;
      }

      const apiKey = mapTilerKey();
      if (!apiKey) {
        mapElement.innerHTML = '<div class="map-setup-message"><strong>Map key needed</strong><span>Add docs/route-map-config.js with window.CANYONS_MAPTILER_API_KEY or open with ?maptiler_key=...</span></div>';
        window.routeTrackerReady = true;
        return;
      }

      maptilersdk.config.apiKey = apiKey;
      state.map = new maptilersdk.Map({
        container: "route-map",
        style: maptilersdk.MapStyle.TOPO,
        attributionControl: true,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false
      });

      state.map.on("load", () => {
        stylizeBaseMap();
        addRouteMapLayers();
        const isMobile = window.matchMedia("(max-width: 719px)").matches;
        state.map.fitBounds(
          [
            [routeData.course.bounds.west, routeData.course.bounds.south],
            [routeData.course.bounds.east, routeData.course.bounds.north]
          ],
          {
            duration: 0,
            padding: isMobile
              ? { top: 150, right: 76, bottom: 76, left: 20 }
              : { top: 84, right: 96, bottom: 56, left: 24 }
          }
        );
        window.routeTrackerMap = state.map;
        update(state.currentMile);
        window.routeTrackerReady = true;
      });
      state.map.on("error", (error) => {
        window.routeTrackerMapError = redactMapError(error?.error?.message || error?.message);
        window.routeTrackerReady = true;
      });
    }

    function setTargetMile(mile) {
      state.targetMile = clamp(mile, 0, totalMiles);
      if (!state.raf) state.raf = requestAnimationFrame(animate);
    }

    function mileFromProfileEvent(event) {
      const transform = elements.profileSvg.getScreenCTM();
      let svgX;
      if (transform) {
        const point = elements.profileSvg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        svgX = point.matrixTransform(transform.inverse()).x;
      } else {
        const rect = elements.profileSvg.getBoundingClientRect();
        svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * profile.width;
      }
      const progress = (clamp(svgX, profile.left, profile.right) - profile.left) / (profile.right - profile.left);
      return progress * totalMiles;
    }

    function jumpToMile(mile) {
      state.targetMile = clamp(mile, 0, totalMiles);
      state.currentMile = state.targetMile;
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = null;
      }
      update(state.currentMile);
    }

    function hideProfilePopup() {
      elements.profilePopup.hidden = true;
      elements.profilePopup.setAttribute("aria-hidden", "true");
    }

    function scrubProfile(event) {
      event.preventDefault();
      jumpToMile(mileFromProfileEvent(event));
    }

    function updateProfilePopup(mile, currentCourse, currentProfile, context) {
      if (!state.profileDragging) return;

      const grade = gradeForMile(mile);
      elements.profilePopupMile.textContent = formatMiles(mile) + " mi";
      elements.profilePopupElevation.textContent = formatNumber(Math.round(currentCourse.eleFt)) + " ft";
      elements.profilePopupGrade.textContent = grade === null ? "--%" : (grade > 0 ? "+" : "") + Math.round(grade) + "%";
      elements.profilePopupLegRoute.textContent = context.arrive
        ? context.depart.name + " -> " + context.arrive.name
        : context.depart.name;
      elements.profilePopupLegStats.textContent = context.leg
        ? formatMiles(context.leg.distanceMi) + " mi / " + formatElevationLine(context.leg)
        : "Finish";
      elements.profilePopup.hidden = false;
      elements.profilePopup.setAttribute("aria-hidden", "false");

      const containerRect = elements.profilePopup.parentElement.getBoundingClientRect();
      const svgRect = elements.profileSvg.getBoundingClientRect();
      const popupWidth = elements.profilePopup.offsetWidth;
      const popupHeight = elements.profilePopup.offsetHeight;
      const localX = svgRect.left - containerRect.left + (currentProfile.x / Math.max(1, profile.width)) * svgRect.width;
      const localY = svgRect.top - containerRect.top + (currentProfile.y / Math.max(1, profile.height)) * svgRect.height;
      let x = localX + 12;
      let y = localY - popupHeight - 12;

      if (y < 6) y = localY + 12;
      x = clamp(x, 6, Math.max(6, containerRect.width - popupWidth - 6));
      y = clamp(y, 6, Math.max(6, containerRect.height - popupHeight - 6));
      elements.profilePopup.style.left = x.toFixed(1) + "px";
      elements.profilePopup.style.top = y.toFixed(1) + "px";
    }

    function animate() {
      const delta = state.targetMile - state.currentMile;
      if (Math.abs(delta) < 0.02) {
        state.currentMile = state.targetMile;
        state.raf = null;
        update(state.currentMile);
        return;
      }
      state.currentMile += delta * 0.22;
      update(state.currentMile);
      state.raf = requestAnimationFrame(animate);
    }

    function update(mile) {
      const currentCourse = coursePoint(mile);
      const currentProfile = profilePoint(mile);
      const { stop, index } = previousStop(mile);
      const context = legContext(stop, index);
      const leg = context.leg;
      const fuel = leg ? nutritionForMinutes(leg.plannedMinutes) : null;

      elements.distanceLabel.textContent = formatMiles(mile) + " / " + formatMiles(totalMiles) + " mi";
      elements.elevationLabel.textContent = formatNumber(Math.round(currentCourse.eleFt)) + " ft";
      elements.profileCursor.setAttribute("cx", currentProfile.x);
      elements.profileCursor.setAttribute("cy", currentProfile.y);
      elements.profileCursorLine.setAttribute("x1", currentProfile.x);
      elements.profileCursorLine.setAttribute("x2", currentProfile.x);
      elements.profileProgress.setAttribute("d", partialProfilePath(mile));
      updateCurrentLegHighlight(index);
      updateProfilePopup(mile, currentCourse, currentProfile, context);
      window.routeTrackerCurrentPoint = [currentCourse.lon, currentCourse.lat];

      if (state.map && state.map.loaded() && state.map.getSource(mapSourceIds.progressRoute) && state.map.getSource(mapSourceIds.progressPoint)) {
        state.map.getSource(mapSourceIds.progressRoute).setData(lineFeatureFromLatLngs(partialLatLngs(mile)));
        state.map.getSource(mapSourceIds.progressPoint).setData(pointFeature(currentCourse, {}));
      }

      elements.stationOverline.textContent = context.complete ? "Last leg complete" : "Current leg";
      elements.stationName.textContent = context.depart.name;
      elements.stationMeta.textContent = "Depart " + context.depart.eta;
      elements.nextStop.textContent = context.arrive ? context.arrive.name : "Done";
      elements.arrivalMeta.textContent = context.arrive ? "Arrive " + context.arrive.eta : "";
      elements.stationTags.innerHTML = context.depart.tags.map((tag) => '<span class="badge ' + escapeHtml(tag.type || "default") + '">' + escapeHtml(tag.label) + "</span>").join("");
      elements.stationNote.textContent = context.complete && context.arrive ? context.arrive.note : context.depart.note;

      if (stop.resupply) {
        const resupply = stop.resupply;
        elements.stationPanel.classList.add("has-resupply");
        elements.stationResupply.hidden = false;
        elements.resupplyLabel.textContent = "Resupply to " + resupply.label;
        elements.resupplyBlock.textContent = formatMiles(resupply.miles) + " mi | " + formatDuration(resupply.minutes);
        elements.resupplyNutrition.textContent = formatNutritionLine(resupply.nutrition);
        elements.resupplyNote.textContent = resupply.note;
      } else {
        elements.stationPanel.classList.remove("has-resupply");
        elements.stationResupply.hidden = true;
      }

      if (leg) {
        elements.nextLeg.textContent = formatMiles(leg.distanceMi) + " mi";
        elements.legElevation.textContent = formatElevationLine(leg);
        elements.nextFuel.textContent = formatNumber(fuel.carbs) + " g";
        elements.legSodium.textContent = formatNumber(fuel.sodiumLow) + "-" + formatNumber(fuel.sodiumHigh) + " mg";
        elements.legFluid.textContent = formatFluid(fuel.fluidLow) + "-" + formatFluid(fuel.fluidHigh) + " L";
      } else {
        elements.nextLeg.textContent = "Finish";
        elements.legElevation.textContent = "Done";
        elements.nextFuel.textContent = "Recover";
        elements.legSodium.textContent = "--";
        elements.legFluid.textContent = "--";
      }
    }

    function isMapEvent(event) {
      return event.target.closest && event.target.closest(".maplibre-route-map");
    }

    function isPageScrollable() {
      return document.documentElement.scrollHeight > window.innerHeight + 1;
    }

    window.addEventListener("wheel", (event) => {
      if (isMapEvent(event)) return;
      if (isPageScrollable()) return;
      event.preventDefault();
      setTargetMile(state.targetMile + event.deltaY * 0.025);
    }, { passive: false });

    window.addEventListener("touchstart", (event) => {
      if (isMapEvent(event)) {
        state.touchY = null;
        return;
      }
      state.touchY = event.touches[0].clientY;
    }, { passive: true });

    window.addEventListener("touchmove", (event) => {
      if (isMapEvent(event)) return;
      if (isPageScrollable()) return;
      if (state.touchY === null) return;
      event.preventDefault();
      const nextY = event.touches[0].clientY;
      setTargetMile(state.targetMile + (state.touchY - nextY) * 0.035);
      state.touchY = nextY;
    }, { passive: false });

    window.addEventListener("keydown", (event) => {
      const keys = {
        ArrowDown: 0.5,
        ArrowRight: 0.5,
        PageDown: 3,
        ArrowUp: -0.5,
        ArrowLeft: -0.5,
        PageUp: -3,
        Home: -totalMiles,
        End: totalMiles
      };
      if (!(event.key in keys)) return;
      event.preventDefault();
      setTargetMile(event.key === "Home" ? 0 : event.key === "End" ? totalMiles : state.targetMile + keys[event.key]);
    });

    elements.profileSvg.addEventListener("pointerdown", (event) => {
      state.profileDragging = true;
      elements.profileSvg.setPointerCapture(event.pointerId);
      scrubProfile(event);
    });

    elements.profileSvg.addEventListener("pointermove", (event) => {
      if (!state.profileDragging) return;
      scrubProfile(event);
    });

    elements.profileSvg.addEventListener("pointerup", (event) => {
      state.profileDragging = false;
      elements.profileSvg.releasePointerCapture(event.pointerId);
      hideProfilePopup();
    });

    elements.profileSvg.addEventListener("pointercancel", () => {
      state.profileDragging = false;
      hideProfilePopup();
    });

    initProfile();
    initMap();
    update(0);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(() => {
        initProfile();
        update(state.currentMile);
        if (state.map) state.map.resize();
      });
      observer.observe(elements.profileSvg);
    }
  </script>
</body>
</html>
`;
}
function validatePlan(data) {
  const names = new Set(data.stops.map((stop) => stop.name));
  for (const stop of data.stops) {
    if (stop.nextLeg && !names.has(stop.nextLeg.to)) {
      throw new Error(`Leg from '${stop.name}' points to unknown stop '${stop.nextLeg.to}'`);
    }
    if (stop.resupplyTo && !names.has(stop.resupplyTo)) {
      throw new Error(`Resupply from '${stop.name}' points to unknown stop '${stop.resupplyTo}'`);
    }
  }
}

fs.mkdirSync(path.dirname(GUIDE_OUTPUT_PATH), { recursive: true });
const guideHtml = renderGuideHtml();
fs.writeFileSync(INDEX_OUTPUT_PATH, guideHtml);
fs.writeFileSync(GUIDE_OUTPUT_PATH, guideHtml);
fs.writeFileSync(TRACKER_OUTPUT_PATH, renderRouteTrackerHtml());
fs.writeFileSync(NOJEKYLL_OUTPUT_PATH, "");
console.log(`Generated ${path.relative(ROOT, INDEX_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, GUIDE_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, TRACKER_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, NOJEKYLL_OUTPUT_PATH)}`);
