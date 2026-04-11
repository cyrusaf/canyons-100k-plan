#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "race-plan.json");
const STYLE_PATH = path.join(ROOT, "src", "styles.css");
const OUTPUT_PATH = path.join(ROOT, "dist", "canyons-100k-crew-guide.html");

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

function roundTo(value, increment) {
  // Round halves down so 0.25 L becomes 0.2 L instead of 0.3 L.
  return Math.floor(value / increment + 0.5 - Number.EPSILON) * increment;
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

function renderHtml() {
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

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, renderHtml());
console.log(`Generated ${path.relative(ROOT, OUTPUT_PATH)}`);
