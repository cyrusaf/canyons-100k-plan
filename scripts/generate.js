#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "race-plan.json");
const GPX_PATH = path.join(ROOT, "data", "canyons-100k-course.gpx");
const STYLE_PATH = path.join(ROOT, "src", "styles.css");
const INDEX_OUTPUT_PATH = path.join(ROOT, "docs", "index.html");
const GUIDE_OUTPUT_PATH = path.join(ROOT, "docs", "canyons-100k-crew-guide.html");
const TRACKER_OUTPUT_PATH = path.join(ROOT, "docs", "canyons-100k-route-tracker.html");
const MANIFEST_OUTPUT_PATH = path.join(ROOT, "docs", "manifest.webmanifest");
const SERVICE_WORKER_OUTPUT_PATH = path.join(ROOT, "docs", "sw.js");
const NOJEKYLL_OUTPUT_PATH = path.join(ROOT, "docs", ".nojekyll");
const FEET_PER_METER = 3.28084;
const EARTH_RADIUS_MI = 3958.7613;
const PACE_SAMPLE_MILES = 0.05;
const PACE_SMOOTHING_WINDOW_MILES = 0.15;
const CLIMB_SAMPLE_MILES = 0.05;
const CLIMB_SMOOTHING_WINDOW_MILES = 0.15;
const CLIMB_BREAK_LOSS_FT = 100;
const MAJOR_CLIMB_MIN_GAIN_FT = 500;
const MAJOR_CLIMB_MIN_DISTANCE_MI = 0.75;
const MAJOR_CLIMB_MIN_AVG_GRADE = 3;

const plan = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const styles = fs.readFileSync(STYLE_PATH, "utf8");
const PWA_ASSETS = [
  "./",
  "./index.html",
  "./canyons-100k-crew-guide.html",
  "./canyons-100k-route-tracker.html",
  "./route-map-config.js",
  "./manifest.webmanifest",
  "./sw.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/guide-michigan-bluff-parking.png",
  "./assets/guide-foresthill-parking.png",
  "./assets/guide-drivers-flat-parking.png"
];
const PWA_EXTERNAL_ASSETS = [
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.css",
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.umd.min.js"
];
let cachedCourse = null;
let cachedClimbs = null;

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

function shortHash(value) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function hashFileContents(filePath) {
  return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function hashPwaAssetContents() {
  return PWA_ASSETS
    .map((asset) => {
      if (["./", "./index.html", "./canyons-100k-crew-guide.html", "./canyons-100k-route-tracker.html", "./manifest.webmanifest", "./sw.js"].includes(asset)) {
        return `${asset}:generated`;
      }

      const assetPath = path.join(ROOT, "docs", asset.replace(/^\.\//, ""));
      return `${asset}:${fs.existsSync(assetPath) ? hashFileContents(assetPath) : "missing"}`;
    })
    .join("\n");
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

function parseClockMinutes(value) {
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  const minutes = Number(match[2]);
  if (match[3].toUpperCase() === "PM") hours += 12;
  return hours * 60 + minutes;
}

function formatClockMinutes(value) {
  const total = ((Math.round(value) % 1440) + 1440) % 1440;
  const hours24 = Math.floor(total / 60);
  const minutes = total % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${period}`;
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

function formatCompactNutritionLine(nutrition) {
  return `${formatNumber(nutrition.carbs)} g carbs · ${formatNumber(nutrition.sodiumLow)}-${formatNumber(nutrition.sodiumHigh)} mg Na · ${formatFluid(nutrition.fluidLow)}-${formatFluid(nutrition.fluidHigh)} L`;
}

function formatElevationLine(leg) {
  return `+${formatNumber(leg.gainFt)} / -${formatNumber(leg.lossFt)} ft`;
}

function formatLegClimbLine(climbs) {
  if (!climbs?.length) return "";

  const totalDistance = climbs.reduce((total, climb) => total + climb.distanceMi, 0);
  if (climbs.length === 1) {
    return `${formatMiles(climbs[0].distanceMi)} mi @ ${climbs[0].avgGradePct}%`;
  }
  return `${formatMiles(totalDistance)} mi across ${climbs.length} climbs`;
}

function climbsForLeg(climbs, fromStop, toStop) {
  return climbs.filter((climb) => {
    const dominant = dominantLegForRange(climb.startMile, climb.endMile);
    return dominant?.from.name === fromStop.name && dominant?.to.name === toStop.name;
  });
}

function classForStop(stop) {
  if (stop.kind === "crew") return "stop crew";
  if (stop.kind === "finish") return "stop finish";
  return "stop";
}

function crewStopFor(stop) {
  return plan.crewStops.find((crewStop) => crewStop.name === stop.name) || null;
}

function crewCalloutFor(stop) {
  if (!stop.crewCallout) return "";

  const crewStop = crewStopFor(stop);
  if (!crewStop?.arriveBy) return stop.crewCallout;

  return stop.crewCallout.replace(
    /arrive by\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i,
    `arrive by ${crewStop.arriveBy}`
  );
}

function cutLabelFor(stop) {
  const cutTag = (stop.tags || []).find((tag) => /^cut\s+/i.test(tag.label));
  return cutTag ? cutTag.label.replace(/^cut\s+/i, "") : "";
}

function renderTags(tags) {
  return tags
    .map((tag) => {
      const typeClass = tag.type && tag.type !== "default" ? ` ${tag.type}` : "";
      return `<span class="badge${typeClass}">${escapeHtml(tag.label)}</span>`;
    })
    .join("");
}

function renderExternalLink(url, label, ariaLabel) {
  if (!url) return "";
  const aria = ariaLabel ? ` aria-label="${escapeAttr(ariaLabel)}"` : "";
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"${aria}>${escapeHtml(label)}</a>`;
}

function officialRunnerGuideSource() {
  return (plan.sources || []).find((source) => source.title === "Official Runner Guide") || null;
}

function renderFullGuideLink() {
  const source = officialRunnerGuideSource();
  if (!source?.url) return "";

  return `<a class="crew-guide-link" href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open the full official runner guide PDF">Full guide PDF</a>`;
}

function renderPwaHead(title) {
  return `  <meta name="theme-color" content="#ff5a45">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Canyons Crew">
  <link rel="manifest" href="./manifest.webmanifest">
  <link rel="apple-touch-icon" href="./assets/icon-192.png">`;
}

function renderOfflineStatus() {
  return `<span class="offline-status" data-offline-status hidden role="status" aria-live="polite"></span>`;
}

function renderPwaRegistrationScript() {
  return `  <script>
    (() => {
      const status = document.querySelector("[data-offline-status]");
      const setStatus = (message, state = "pending") => {
        if (!status) return;
        status.hidden = false;
        status.dataset.state = state;
        status.textContent = message;
      };

      if (location.protocol === "file:") return;

      window.addEventListener("offline", () => setStatus("Offline mode: saved guide is loaded.", "ready"));
      window.addEventListener("online", () => setStatus("Offline cache: checking for updates.", "pending"));

      if (!("serviceWorker" in navigator)) return;

      setStatus("Offline cache: saving this guide.", "pending");
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js")
          .then((registration) => {
            const worker = registration.installing || registration.waiting || registration.active;
            if (worker) {
              worker.addEventListener("statechange", () => {
                if (worker.state === "activated") {
                  setStatus("Offline cache ready. Add to Home Screen before race day.", "ready");
                }
              });
            }
            return navigator.serviceWorker.ready;
          })
          .then(() => setStatus("Offline cache ready. Add to Home Screen before race day.", "ready"))
          .catch(() => setStatus("Offline cache unavailable. Use the hosted page online once.", "warn"));
      });
    })();
  </script>`;
}

function renderCrewTask(stop) {
  const links = [
    renderExternalLink(stop.driveUrl, "Google Maps", `Open Google Maps directions for ${stop.name}`),
    renderExternalLink(stop.offlineGuideImageUrl, stop.offlineGuideImageLabel || "Parking map", `Open saved parking map for ${stop.name}`)
  ].filter(Boolean);
  const note = stop.crewNote ? `<p class="crew-note">${escapeHtml(stop.crewNote)}</p>` : "";

  if (links.length) {
    return `<div class="crew-task crew-logistics" aria-label="${escapeAttr(stop.name)} crew navigation and logistics"><div class="crew-links">${links.join("")}</div>${note}</div>`;
  }

  return `<div class="crew-task"><strong>${escapeHtml(stop.action || stop.summary)}</strong>${stop.detail ? `<span>${escapeHtml(stop.detail)}</span>` : ""}</div>`;
}

function renderResourceLinks(item) {
  const links = [
    renderExternalLink(item.driveUrl, "Google Maps", `Open Google Maps directions for ${item.name}`),
    renderExternalLink(item.guideUrl, item.guideLabel || "Runner Guide", `Open runner guide directions for ${item.name}`)
  ].filter(Boolean);

  if (!links.length) return "";
  return `
          <div class="card-links">${links.join("")}</div>`;
}

function renderGuideImage(item) {
  if (!item.offlineGuideImageUrl) return "";

  return `
          <a class="guide-image-link" href="${escapeAttr(item.offlineGuideImageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open offline guide image for ${escapeAttr(item.name)}">
            <img src="${escapeAttr(item.offlineGuideImageUrl)}" alt="${escapeAttr(item.offlineGuideImageAlt || `${item.name} parking guide image`)}" loading="lazy">
            <span>Saved for offline use</span>
          </a>`;
}

function stripMeridiem(value) {
  return String(value ?? "").replace(/\s+(AM|PM)$/i, "");
}

function compactGoalTime(value) {
  return String(value ?? "").replace(":00 ", " ");
}

function renderStats() {
  return `
      <div class="race-facts" aria-label="Race facts">
        <span><strong>Start</strong> ${escapeHtml(plan.race.start)}</span>
        <span><strong>Goal</strong> ${escapeHtml(compactGoalTime(plan.race.finishGoal))}</span>
        <span><strong>Course</strong> ${formatMiles(plan.race.courseDistanceMi)} mi</span>
        <span><strong>Fuel</strong> ${formatNumber(plan.nutrition.carbsPerHour)} g/hr carbs - ${formatNumber(plan.nutrition.sodiumMgPerHour.low)}-${formatNumber(plan.nutrition.sodiumMgPerHour.high)} mg Na/hr</span>
      </div>`;
}

function renderCrewStrip() {
  return `
      <div class="crew-timeline" aria-label="Crew timeline">
        <div class="crew-timeline-title"><span class="label">Crew Timeline</span><strong>Arrive-by times are the working target</strong>${renderFullGuideLink()}</div>
${plan.crewStops
  .map(
    (stop) => `        <div class="crew-timeline-row">
          <div class="crew-arrive"><span class="label">Arrive by</span><strong>${escapeHtml(stripMeridiem(stop.arriveBy))}</strong></div>
          <div class="crew-stop-name"><strong>${escapeHtml(stop.name)}</strong><em>Runner ${escapeHtml(stop.eta)}</em></div>
          ${renderCrewTask(stop)}
        </div>`
  )
  .join("\n")}
      </div>`;
}

function getStopIndex(name) {
  return plan.stops.findIndex((stop) => stop.name === name);
}

function resupplyContextFor(stop) {
  if (stop?.kind === "finish") return "to finish";
  if (stop?.kind === "crew") return "to next crew";
  return "to target";
}

function resupplyFor(stop, index) {
  if (!stop.resupplyTo) return null;
  const toIndex = getStopIndex(stop.resupplyTo);
  if (toIndex <= index) {
    throw new Error(`Invalid resupply target '${stop.resupplyTo}' for '${stop.name}'`);
  }
  const targetStop = plan.stops[toIndex];

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
    context: resupplyContextFor(targetStop),
    miles,
    minutes,
    nutrition
  };
}

function renderResupply(stop, index) {
  const resupply = resupplyFor(stop, index);
  if (!resupply) return "";

  return `
              <div class="resupply" aria-label="Resupply from ${escapeAttr(stop.name)} to ${escapeAttr(resupply.label)}">
                <div class="resupply-head">
                  <span class="label">Resupply</span>
                </div>
                <div class="resupply-fuel" aria-label="Fuel to cover before ${escapeAttr(resupply.label)}">
                  <span><span class="label">Carbs</span><strong>${formatNumber(resupply.nutrition.carbs)} g</strong></span>
                  <span><span class="label">Sodium</span><strong>${formatNumber(resupply.nutrition.sodiumLow)}-${formatNumber(resupply.nutrition.sodiumHigh)} mg</strong></span>
                  <span><span class="label">Fluid</span><strong>${formatFluid(resupply.nutrition.fluidLow)}-${formatFluid(resupply.nutrition.fluidHigh)} L</strong></span>
                </div>
                <p class="resupply-context"><span class="resupply-context-label">Next resupply</span> <span class="resupply-context-detail"><strong>${escapeHtml(resupply.label)}</strong> | ${formatMiles(resupply.miles)} mi | ${formatDuration(resupply.minutes)} ${escapeHtml(resupply.context)}</span></p>
              </div>`;
}

function renderStopMetrics(stop) {
  const crewStop = crewStopFor(stop);
  const cutLabel = cutLabelFor(stop);
  const thirdMetric = crewStop
    ? { label: "Crew by", value: crewStop.arriveBy }
    : cutLabel
      ? { label: "Cut", value: cutLabel }
      : stop.nextLeg
        ? { label: "Next", value: `${formatMiles(stop.nextLeg.distanceMi)} mi` }
        : { label: "Status", value: "Finish" };

  return [
    { label: "Mile", value: formatMiles(stop.mile) },
    { label: "ETA", value: stop.eta },
    thirdMetric
  ]
    .map(
      (metric) => `                <span class="stop-metric"><span class="label">${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></span>`
    )
    .join("\n");
}

function renderLeg(leg) {
  if (!leg) return "";

  const nutrition = nutritionForMinutes(leg.plannedMinutes);
  const arrivalStop = plan.stops[getStopIndex(leg.to)];
  const arrivalEta = arrivalStop ? arrivalStop.eta : "";
  const climbLine = formatLegClimbLine(leg.climbs);
  const climbSummary = climbLine
    ? `                  <span class="split-pair"><span class="label">Climb</span><strong>${escapeHtml(climbLine)}</strong></span>\n`
    : "";

  return `
          <section class="leg" aria-label="Leg to ${escapeAttr(leg.to)}">
            <div class="leg-rail" aria-hidden="true">
              <span class="rail-thread"></span>
              <span class="rail-arrow"></span>
            </div>
            <div class="leg-content">
              <div class="split-main">
                <span class="label">Split</span>
                <strong>${escapeHtml(leg.plannedTime)}</strong>
                <span class="split-distance">${formatMiles(leg.distanceMi)} mi</span>
              </div>
              <div class="split-data">
                <div class="split-summary">
                  <span class="split-pair"><span class="label">Pace</span><strong>${escapeHtml(leg.pace)}</strong></span>
                  <span class="split-pair"><span class="label">Gain/Loss</span><strong>${formatElevationLine(leg)}</strong></span>
${climbSummary}                  <span class="split-pair"><span class="label">Arrive</span><strong>${escapeHtml(arrivalEta)}</strong></span>
                </div>
                <div class="split-fuel" aria-label="Fuel to consume before ${escapeAttr(leg.to)}">
                  <span><span class="label">Carbs</span><strong>${formatNumber(nutrition.carbs)} g</strong></span>
                  <span><span class="label">Sodium</span><strong>${formatNumber(nutrition.sodiumLow)}-${formatNumber(nutrition.sodiumHigh)} mg</strong></span>
                  <span><span class="label">Fluid</span><strong>${formatFluid(nutrition.fluidLow)}-${formatFluid(nutrition.fluidHigh)} L</strong></span>
                </div>
              </div>
            </div>
          </section>`;
}

function renderStop(stop, index) {
  const crewCallout = crewCalloutFor(stop);
  const bodyCopy = crewCallout
    ? `<p class="stop-note">${escapeHtml(crewCallout)}</p>`
    : stop.note
      ? `<p class="stop-note">${escapeHtml(stop.note)}</p>`
      : "";

  return `        <article class="${classForStop(stop)}">
          <div class="stop-station">
            <div class="stop-main">
              <div class="stop-title">
                <h3>${escapeHtml(stop.name)}</h3>
                <span class="stop-mile">Mile ${formatMiles(stop.mile)}</span>
              </div>
              <div class="badges">${renderTags(stop.tags)}</div>
              ${bodyCopy}
${renderResupply(stop, index)}
            </div>
            <div class="stop-side" aria-label="${escapeAttr(stop.name)} timing">
              <div class="stop-metrics">
${renderStopMetrics(stop)}
              </div>
            </div>
          </div>
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
${renderResourceLinks(item)}
${renderGuideImage(item)}
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
  let effortDistanceMi = 0;
  const climbs = [];

  for (let index = fromIndex; index < toIndex; index += 1) {
    const leg = plan.stops[index].nextLeg;
    if (!leg) {
      throw new Error(`Missing leg while merging segment from '${plan.stops[fromIndex].name}'`);
    }
    distanceMi += leg.distanceMi;
    gainFt += leg.gainFt;
    lossFt += leg.lossFt;
    plannedMinutes += leg.plannedMinutes;
    effortDistanceMi += leg.effortDistanceMi || 0;
    climbs.push(...(leg.climbs || []));
  }

  const roundedDistance = Number(distanceMi.toFixed(1));
  return {
    to: plan.stops[toIndex].name,
    distanceMi: roundedDistance,
    gainFt: Math.round(gainFt),
    lossFt: Math.round(lossFt),
    effortDistanceMi: Number(effortDistanceMi.toFixed(3)),
    climbs,
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
          context: resupply.context,
          miles: resupply.miles,
          minutes: resupply.minutes,
          nutrition: resupply.nutrition
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

function getCourse() {
  if (!cachedCourse) cachedCourse = parseGpxCourse();
  return cachedCourse;
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

function smoothElevationSamples(samples, windowMiles = CLIMB_SMOOTHING_WINDOW_MILES) {
  return samples.map((sample) => {
    let totalElevation = 0;
    let count = 0;

    samples.forEach((candidate) => {
      if (Math.abs(candidate.mile - sample.mile) <= windowMiles) {
        totalElevation += candidate.eleFt;
        count += 1;
      }
    });

    return {
      ...sample,
      smoothEleFt: totalElevation / Math.max(1, count)
    };
  });
}

function sampledElevationProfile(points, totalMiles, sampleMiles, smoothingWindowMiles) {
  const samples = [];
  for (let mile = 0; mile <= totalMiles; mile += sampleMiles) {
    const point = interpolateCoursePoint(points, mile);
    samples.push({ mile, eleFt: point.eleFt });
  }
  if (samples[samples.length - 1].mile < totalMiles) {
    const point = interpolateCoursePoint(points, totalMiles);
    samples.push({ mile: totalMiles, eleFt: point.eleFt });
  }
  return smoothElevationSamples(samples, smoothingWindowMiles);
}

function interpolateSmoothElevation(samples, mile) {
  if (mile <= samples[0].mile) return samples[0].smoothEleFt;
  for (let index = 0; index < samples.length - 1; index += 1) {
    const from = samples[index];
    const to = samples[index + 1];
    if (mile <= to.mile) {
      const t = (mile - from.mile) / Math.max(0.001, to.mile - from.mile);
      return from.smoothEleFt + (to.smoothEleFt - from.smoothEleFt) * t;
    }
  }
  return samples[samples.length - 1].smoothEleFt;
}

function samplesForRange(samples, startMile, endMile) {
  const start = Math.min(startMile, endMile);
  const end = Math.max(startMile, endMile);
  const range = [{ mile: start, smoothEleFt: interpolateSmoothElevation(samples, start) }];

  samples.forEach((sample) => {
    if (sample.mile > start && sample.mile < end) {
      range.push(sample);
    }
  });

  range.push({ mile: end, smoothEleFt: interpolateSmoothElevation(samples, end) });
  return range;
}

function gradeEffortFactor(grade) {
  const pct = grade * 100;
  if (pct >= 0) {
    return Math.min(3.5, 1 + pct * 0.04 + pct * pct * 0.0015);
  }

  const downhill = Math.abs(pct);
  if (downhill <= 10) {
    return Math.max(0.82, 1 - downhill * 0.018);
  }
  return Math.min(1.8, 0.82 + (downhill - 10) * 0.018 + (downhill - 10) ** 2 * 0.0008);
}

function analyzePacingRange(samples, startMile, endMile) {
  const range = samplesForRange(samples, startMile, endMile);
  let gainFt = 0;
  let lossFt = 0;
  let effortDistanceMi = 0;

  for (let index = 1; index < range.length; index += 1) {
    const from = range[index - 1];
    const to = range[index];
    const distance = to.mile - from.mile;
    if (distance <= 0) continue;

    const elevationDelta = to.smoothEleFt - from.smoothEleFt;
    if (elevationDelta > 0) gainFt += elevationDelta;
    else lossFt += Math.abs(elevationDelta);

    effortDistanceMi += distance * gradeEffortFactor(elevationDelta / (distance * 5280));
  }

  return {
    gainFt: Math.round(gainFt),
    lossFt: Math.round(lossFt),
    effortDistanceMi: Number(effortDistanceMi.toFixed(3))
  };
}

function plannedMinutesTotal() {
  return plan.stops.reduce((total, stop) => total + (stop.nextLeg?.plannedMinutes || 0), 0);
}

function configuredTargetMovingMinutes() {
  const configured = Number(plan.pacing?.targetMovingMinutes);
  if (Number.isFinite(configured) && configured > 0) return Math.round(configured);
  const legacyTotal = plannedMinutesTotal();
  if (legacyTotal > 0) return legacyTotal;
  throw new Error("Set pacing.targetMovingMinutes before deriving GPX pacing");
}

function monotonicStopEtaMinutes() {
  let dayOffset = 0;
  let previous = null;
  return plan.stops.map((stop) => {
    const parsed = parseClockMinutes(stop.eta);
    if (parsed === null) return null;
    let absolute = parsed + dayOffset;
    if (previous !== null) {
      while (absolute < previous) {
        dayOffset += 1440;
        absolute = parsed + dayOffset;
      }
    }
    previous = absolute;
    return absolute;
  });
}

function originalLegPaddingMinutes(stopEtaMinutes) {
  return plan.stops.slice(0, -1).map((stop, index) => {
    const configured = Number(stop.nextLeg?.schedulePaddingMinutes);
    if (Number.isFinite(configured) && configured >= 0) return Math.round(configured);

    const depart = stopEtaMinutes[index];
    const arrive = stopEtaMinutes[index + 1];
    const plannedMinutes = stop.nextLeg?.plannedMinutes;
    if (depart === null || arrive === null || !plannedMinutes) return 0;
    return Math.max(0, arrive - depart - plannedMinutes);
  });
}

function crewArriveByBuffers() {
  return new Map(
    plan.crewStops.map((crewStop) => {
      const configured = Number(crewStop.arriveByBufferMinutes);
      if (Number.isFinite(configured) && configured >= 0) {
        return [crewStop.name, Math.round(configured)];
      }

      const eta = parseClockMinutes(crewStop.eta);
      const arriveBy = parseClockMinutes(crewStop.arriveBy);
      const buffer = eta === null || arriveBy === null ? 60 : (eta - arriveBy + 1440) % 1440;
      return [crewStop.name, buffer || 60];
    })
  );
}

function allocateMinutesByWeight(items, targetMinutes) {
  const totalWeight = items.reduce((total, item) => total + item.weight, 0);
  if (!totalWeight) return items.map(() => 0);

  const allocations = items.map((item, index) => {
    const exact = (item.weight / totalWeight) * targetMinutes;
    const minutes = Math.floor(exact);
    return { index, exact, minutes, remainder: exact - minutes };
  });
  let remaining = targetMinutes - allocations.reduce((total, item) => total + item.minutes, 0);

  allocations
    .slice()
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (remaining <= 0) return;
      allocations[item.index].minutes += 1;
      remaining -= 1;
    });

  return allocations.map((item) => item.minutes);
}

function applyDerivedPacing() {
  if (plan.pacing?.model === "manual") return;

  const course = getCourse();
  const sampleMiles = Number(plan.pacing?.sampleMiles) || PACE_SAMPLE_MILES;
  const smoothingWindowMiles = Number(plan.pacing?.smoothingWindowMiles) || PACE_SMOOTHING_WINDOW_MILES;
  const samples = sampledElevationProfile(course.points, course.officialTotalMiles, sampleMiles, smoothingWindowMiles);
  const majorClimbs = getMajorClimbs(course);
  const targetMovingMinutes = configuredTargetMovingMinutes();
  const stopEtaMinutes = monotonicStopEtaMinutes();
  const legPaddingMinutes = originalLegPaddingMinutes(stopEtaMinutes);
  const crewBuffers = crewArriveByBuffers();

  const legAnalyses = plan.stops.slice(0, -1).map((stop, index) => {
    const nextStop = plan.stops[index + 1];
    const analysis = analyzePacingRange(samples, stop.mile, nextStop.mile);
    const manualFactor = Number(stop.nextLeg?.effortFactor) || 1;
    return {
      stop,
      nextStop,
      analysis,
      weight: Math.max(0.001, analysis.effortDistanceMi * manualFactor)
    };
  });
  const allocatedMinutes = allocateMinutesByWeight(legAnalyses, targetMovingMinutes);

  legAnalyses.forEach((item, index) => {
    const leg = item.stop.nextLeg;
    if (!leg) return;
    const plannedMinutes = allocatedMinutes[index];
    leg.gainFt = item.analysis.gainFt;
    leg.lossFt = item.analysis.lossFt;
    leg.effortDistanceMi = item.analysis.effortDistanceMi;
    leg.climbs = climbsForLeg(majorClimbs, item.stop, item.nextStop);
    leg.plannedMinutes = plannedMinutes;
    leg.plannedTime = formatDuration(plannedMinutes);
    leg.pace = formatPace(plannedMinutes, leg.distanceMi);
  });

  let runningClock = stopEtaMinutes[0] ?? parseClockMinutes(plan.race.start) ?? parseClockMinutes(plan.stops[0]?.eta) ?? 0;
  plan.stops[0].eta = formatClockMinutes(runningClock);
  for (let index = 0; index < plan.stops.length - 1; index += 1) {
    runningClock += (plan.stops[index].nextLeg?.plannedMinutes || 0) + (legPaddingMinutes[index] || 0);
    plan.stops[index + 1].eta = formatClockMinutes(runningClock);
  }

  plan.crewStops.forEach((crewStop) => {
    const stop = stopForName(crewStop.name);
    if (!stop) return;
    const stopMinutes = parseClockMinutes(stop.eta);
    if (stopMinutes === null) return;
    const buffer = crewBuffers.get(crewStop.name) || 60;
    crewStop.eta = stop.eta;
    crewStop.arriveBy = formatClockMinutes(stopMinutes - buffer);
  });
}

function dominantLegForRange(startMile, endMile) {
  let best = null;

  for (let index = 0; index < plan.stops.length - 1; index += 1) {
    const from = plan.stops[index];
    const to = plan.stops[index + 1];
    const overlap = Math.min(endMile, to.mile) - Math.max(startMile, from.mile);
    if (overlap > 0 && (!best || overlap > best.overlap)) {
      best = { from, to, overlap };
    }
  }

  return best;
}

function shortStopName(name) {
  return String(name)
    .replace("Downtown Auburn Finish", "Finish")
    .replace("China Wall Start", "China Wall");
}

function climbLabelForRange(startMile, endMile) {
  const leg = dominantLegForRange(startMile, endMile);
  if (!leg) return `Mile ${formatMiles(startMile)} to ${formatMiles(endMile)}`;
  return `${leg.from.name} to ${leg.to.name}`;
}

function shortClimbLabelForRange(startMile, endMile) {
  const leg = dominantLegForRange(startMile, endMile);
  if (!leg) return `Mile ${formatMiles(startMile)}-${formatMiles(endMile)}`;
  return `${shortStopName(leg.from.name)} to ${shortStopName(leg.to.name)}`;
}

function detectMajorClimbs(points, totalMiles) {
  const samples = [];
  for (let mile = 0; mile <= totalMiles; mile += CLIMB_SAMPLE_MILES) {
    const point = interpolateCoursePoint(points, mile);
    samples.push({ mile, eleFt: point.eleFt });
  }
  if (samples[samples.length - 1].mile < totalMiles) {
    const point = interpolateCoursePoint(points, totalMiles);
    samples.push({ mile: totalMiles, eleFt: point.eleFt });
  }

  const smoothed = smoothElevationSamples(samples);
  const climbs = [];
  let inClimb = false;
  let startIndex = 0;
  let peakIndex = 0;
  let gainFt = 0;
  let lossFt = 0;
  let currentDescentFt = 0;

  const finalizeClimb = () => {
    const start = smoothed[startIndex];
    const end = smoothed[peakIndex];
    const distanceMi = end.mile - start.mile;
    const netGainFt = end.smoothEleFt - start.smoothEleFt;
    const avgGradePct = distanceMi > 0 ? (netGainFt / (distanceMi * 5280)) * 100 : 0;

    if (
      gainFt >= MAJOR_CLIMB_MIN_GAIN_FT &&
      distanceMi >= MAJOR_CLIMB_MIN_DISTANCE_MI &&
      avgGradePct >= MAJOR_CLIMB_MIN_AVG_GRADE
    ) {
      climbs.push({
        id: `climb-${climbs.length + 1}`,
        index: climbs.length + 1,
        label: climbLabelForRange(start.mile, end.mile),
        shortLabel: shortClimbLabelForRange(start.mile, end.mile),
        startMile: roundMile(start.mile),
        endMile: roundMile(end.mile),
        distanceMi: Number(distanceMi.toFixed(1)),
        gainFt: Math.round(gainFt),
        lossFt: Math.round(lossFt),
        netGainFt: Math.round(netGainFt),
        avgGradePct: Number(avgGradePct.toFixed(1)),
        startEleFt: roundElevation(start.smoothEleFt),
        endEleFt: roundElevation(end.smoothEleFt)
      });
    }
  };

  for (let index = 1; index < smoothed.length; index += 1) {
    const deltaFt = smoothed[index].smoothEleFt - smoothed[index - 1].smoothEleFt;

    if (deltaFt > 0) {
      if (!inClimb) {
        inClimb = true;
        startIndex = index - 1;
        peakIndex = index;
        gainFt = 0;
        lossFt = 0;
        currentDescentFt = 0;
      }

      gainFt += deltaFt;
      currentDescentFt = 0;
      if (smoothed[index].smoothEleFt > smoothed[peakIndex].smoothEleFt) {
        peakIndex = index;
      }
      continue;
    }

    if (!inClimb) continue;

    const descentFt = Math.abs(deltaFt);
    lossFt += descentFt;
    currentDescentFt += descentFt;
    if (currentDescentFt > CLIMB_BREAK_LOSS_FT) {
      finalizeClimb();
      inClimb = false;
      startIndex = index;
      peakIndex = index;
      gainFt = 0;
      lossFt = 0;
      currentDescentFt = 0;
    }
  }

  if (inClimb) finalizeClimb();

  return climbs;
}

function getMajorClimbs(course = getCourse()) {
  if (!cachedClimbs) {
    cachedClimbs = detectMajorClimbs(course.points, course.officialTotalMiles);
  }
  return cachedClimbs;
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
  const course = getCourse();
  const climbs = getMajorClimbs(course);
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
    climbs,
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
${renderPwaHead(plan.title)}
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
  <div class="offline-status-wrap">
    ${renderOfflineStatus()}
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
        <p>Pacing follows the smoothed course profile, with the total moving-time budget held steady through the finish.</p>
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
${renderPwaRegistrationScript()}
</body>
</html>
`;
}

function renderRouteTrackerHtml() {
  const routeData = buildRouteData();
  const routeJson = jsonForScript(routeData);
  const firstDepart = routeData.segmentStops[0] || routeData.stops[0];
  const firstArrive = routeData.segmentStops[1] || routeData.stops[1];
  const firstLeg = firstDepart?.nextLeg || null;
  const firstLegDistance = firstLeg ? `${formatMiles(firstLeg.distanceMi)} mi` : "Finish";
  const firstLegClimb = firstLeg ? formatLegClimbLine(firstLeg.climbs) : "";
  const firstLegNutrition = firstLeg ? formatCompactNutritionLine(nutritionForMinutes(firstLeg.plannedMinutes)) : "Recover";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Canyons 100K Route Tracker</title>
${renderPwaHead("Canyons 100K Route Tracker")}
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
          <p class="eyebrow">Canyons 100K</p>
          <h1>Route Tracker</h1>
        </div>
        <div class="route-head-meta">
          <span id="route-distance-label">0.0 / ${formatMiles(plan.race.courseDistanceMi)} mi</span>
          <a href="./canyons-100k-crew-guide.html">Crew Guide</a>
          ${renderOfflineStatus()}
        </div>
      </div>

      <article class="route-viz map-viz real-map-viz" aria-labelledby="map-title">
        <h2 id="map-title" class="sr-only">Course map and progress dot</h2>
        <div id="route-map" class="maplibre-route-map" aria-label="Interactive course map with GPX track and progress dot"></div>
      </article>
    </section>

    <section class="route-details real-route-details" aria-label="Current route details">
      <article class="station-panel tracker-split-panel" id="station-panel">
        <div class="tracker-split-primary">
          <div class="tracker-time-rail" aria-label="Current leg timing">
            <span class="label" id="station-meta-label">Depart</span>
            <strong id="station-meta">${escapeHtml(firstDepart?.eta || plan.race.start)}</strong>
            <span class="label" id="arrival-meta-label">Arrive</span>
            <strong id="arrival-meta">${escapeHtml(firstArrive?.eta || "")}</strong>
          </div>
          <div class="tracker-route-block">
            <div class="tracker-route-title">
              <h2><span id="station-name">${escapeHtml(firstDepart?.name || "")}</span> <span id="route-title-joiner">to</span> <strong id="next-stop">${escapeHtml(firstArrive?.name || "Finish")}</strong></h2>
            </div>
            <div class="tracker-route-duration">
              <span class="label" id="station-overline">Split</span>
              <strong id="leg-duration">${firstLeg ? formatDuration(firstLeg.plannedMinutes) : "Done"}</strong>
              <span class="tracker-split-distance" id="next-leg">${escapeHtml(firstLegDistance)}</span>
            </div>
            <div class="tracker-distance-large" aria-hidden="true">
              <strong id="leg-distance-large">${escapeHtml(firstLegDistance)}</strong>
              <span id="leg-distance-label">Distance</span>
            </div>
          </div>
        </div>

        <div class="tracker-support-row">
          <div class="tracker-data-cell">
            <span class="label" id="leg-elevation-label">Elevation</span>
            <strong id="leg-elevation">${firstLeg ? formatElevationLine(firstLeg) : "Done"}</strong>
            <span class="tracker-metric-note" id="leg-climb"${firstLegClimb ? "" : " hidden"}>${firstLegClimb ? `Climb ${escapeHtml(firstLegClimb)}` : ""}</span>
          </div>
          <div class="tracker-data-cell">
            <span class="label" id="leg-pace-label">Pace</span>
            <strong id="leg-pace">${firstLeg ? escapeHtml(firstLeg.pace) : "--"}</strong>
          </div>
          <div class="tracker-data-cell tracker-nutrition-cell">
            <span class="label" id="leg-nutrition-label">Nutrition</span>
            <strong id="leg-nutrition">${escapeHtml(firstLegNutrition)}</strong>
          </div>
          <div class="tracker-data-cell tracker-resupply-cell" id="station-resupply" hidden>
            <span class="label" id="resupply-label">Resupply</span>
            <strong id="resupply-arrival">Deadwood 1 arrival · full aid</strong>
            <span class="tracker-resupply-refill" id="resupply-block">
              <span id="resupply-carbs">590g carbs</span>
              <span id="resupply-sodium">Na 3.25-4.9g</span>
              <span id="resupply-fluid">3.3-4.9L</span>
            </span>
            <span class="tracker-resupply-next" id="resupply-nutrition">Next Michigan Bluff · 24.0 mi / 6h32</span>
          </div>
        </div>
      </article>

      <article class="route-viz profile-viz bottom-profile-viz" aria-labelledby="profile-title">
        <div class="viz-title profile-readout">
          <h2 id="profile-title" class="sr-only">Full course elevation profile</h2>
          <em id="route-elevation-label">0 ft</em>
        </div>
        <div class="profile-mode-toggle" role="group" aria-label="Elevation profile mode">
          <button type="button" class="profile-mode-button is-active" data-profile-mode="splits" aria-pressed="true">Splits</button>
          <button type="button" class="profile-mode-button" data-profile-mode="climbs" aria-pressed="false">Climbs</button>
        </div>
        <svg id="profile-svg" class="route-svg" preserveAspectRatio="none" role="img" aria-label="Full course elevation profile with current position line">
          <g class="profile-grid" id="profile-grid"></g>
          <path class="profile-area" id="profile-area"></path>
          <g class="profile-climbs" id="profile-climbs"></g>
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
          <div class="profile-popup-climb" id="profile-popup-climb"></div>
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
      profileMode: "splits",
      profileDragging: false
    };

    const elements = {
      distanceLabel: document.getElementById("route-distance-label"),
      elevationLabel: document.getElementById("route-elevation-label"),
      stationPanel: document.getElementById("station-panel"),
      stationOverline: document.getElementById("station-overline"),
      stationName: document.getElementById("station-name"),
      routeTitleJoiner: document.getElementById("route-title-joiner"),
      stationMetaLabel: document.getElementById("station-meta-label"),
      stationMeta: document.getElementById("station-meta"),
      arrivalMetaLabel: document.getElementById("arrival-meta-label"),
      arrivalMeta: document.getElementById("arrival-meta"),
      stationResupply: document.getElementById("station-resupply"),
      nextStop: document.getElementById("next-stop"),
      nextLeg: document.getElementById("next-leg"),
      legDuration: document.getElementById("leg-duration"),
      legDistanceLarge: document.getElementById("leg-distance-large"),
      legDistanceLabel: document.getElementById("leg-distance-label"),
      legElevationLabel: document.getElementById("leg-elevation-label"),
      legElevation: document.getElementById("leg-elevation"),
      legPaceLabel: document.getElementById("leg-pace-label"),
      legPace: document.getElementById("leg-pace"),
      legClimb: document.getElementById("leg-climb"),
      legNutritionLabel: document.getElementById("leg-nutrition-label"),
      legNutrition: document.getElementById("leg-nutrition"),
      resupplyLabel: document.getElementById("resupply-label"),
      resupplyArrival: document.getElementById("resupply-arrival"),
      resupplyBlock: document.getElementById("resupply-block"),
      resupplyCarbs: document.getElementById("resupply-carbs"),
      resupplySodium: document.getElementById("resupply-sodium"),
      resupplyFluid: document.getElementById("resupply-fluid"),
      resupplyNutrition: document.getElementById("resupply-nutrition"),
      profileViz: document.querySelector(".bottom-profile-viz"),
      profileTitle: document.querySelector(".bottom-profile-viz .viz-title"),
      profileSvg: document.getElementById("profile-svg"),
      profileGrid: document.getElementById("profile-grid"),
      profileClimbs: document.getElementById("profile-climbs"),
      profileModeButtons: [...document.querySelectorAll("[data-profile-mode]")],
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
      profilePopupLegStats: document.getElementById("profile-popup-leg-stats"),
      profilePopupClimb: document.getElementById("profile-popup-climb")
    };

    const totalMiles = routeData.course.totalMiles;
    const coursePoints = routeData.course.points;
    const segmentStops = routeData.segmentStops || routeData.stops;
    const majorClimbs = routeData.climbs || [];
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

    function syncViewportHeight() {
      const viewportHeight =
        window.visualViewport && window.visualViewport.height
          ? window.visualViewport.height
          : window.innerHeight;
      document.documentElement.style.setProperty("--route-vh", viewportHeight * 0.01 + "px");
    }

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

    function formatTightDecimal(value) {
      return Number(value).toFixed(2).replace(/\\.0+$/, "").replace(/(\\.\\d*[1-9])0+$/, "$1");
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

    function formatCompactNutritionLine(nutrition) {
      return formatNumber(nutrition.carbs) + " g carbs · " +
        formatNumber(nutrition.sodiumLow) + "-" + formatNumber(nutrition.sodiumHigh) + " mg Na · " +
        formatFluid(nutrition.fluidLow) + "-" + formatFluid(nutrition.fluidHigh) + " L";
    }

    function formatSodiumGramsRange(nutrition) {
      return formatTightDecimal(nutrition.sodiumLow / 1000) + "-" + formatTightDecimal(nutrition.sodiumHigh / 1000) + "g";
    }

    function formatCompactFluidRange(nutrition) {
      return formatFluid(nutrition.fluidLow) + "-" + formatFluid(nutrition.fluidHigh) + "L";
    }

    function formatClimbStats(climb) {
      return formatMiles(climb.distanceMi) + " mi / +" + formatNumber(climb.gainFt) + " ft / " + climb.avgGradePct + "%";
    }

    function formatLegClimbLine(climbs) {
      if (!climbs || !climbs.length) return "";
      const totalDistance = climbs.reduce((total, climb) => total + climb.distanceMi, 0);
      return climbs.length === 1
        ? formatMiles(climbs[0].distanceMi) + " mi @ " + climbs[0].avgGradePct + "%"
        : formatMiles(totalDistance) + " mi across " + climbs.length + " climbs";
    }

    function formatElevationRange(climb) {
      return formatNumber(climb.startEleFt) + " -> " + formatNumber(climb.endEleFt) + " ft";
    }

    function climbContext(mile) {
      for (let index = 0; index < majorClimbs.length; index += 1) {
        const climb = majorClimbs[index];
        if (mile >= climb.startMile && mile <= climb.endMile) {
          return { climb, index, status: "active" };
        }
        if (mile < climb.startMile) {
          return { climb, index, status: "next" };
        }
      }
      return majorClimbs.length
        ? { climb: majorClimbs[majorClimbs.length - 1], index: majorClimbs.length - 1, status: "done" }
        : null;
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

    function fitProfileSvgToContainer() {
      const profileRect = elements.profileViz.getBoundingClientRect();
      const titleRect = elements.profileTitle.getBoundingClientRect();
      const titleStyle = window.getComputedStyle(elements.profileTitle);
      const titleHeight = titleStyle.position === "absolute" ? 0 : titleRect.height;
      const targetHeight = Math.max(1, Math.round(profileRect.height - titleHeight));
      const nextHeight = targetHeight + "px";
      if (targetHeight > 1 && elements.profileSvg.style.height !== nextHeight) {
        elements.profileSvg.style.setProperty("height", nextHeight, "important");
      }
    }

    function buildProfileGeometry() {
      fitProfileSvgToContainer();
      const rect = elements.profileSvg.getBoundingClientRect();
      const width = rect.width > 0 ? Math.round(rect.width) : 1000;
      const measuredHeight = rect.height > 0 ? Math.round(rect.height) : 220;
      const minElevation = Math.min(...coursePoints.map((point) => point.eleFt)) - 120;
      const maxElevation = Math.max(...coursePoints.map((point) => point.eleFt)) + 120;
      const left = 8;
      const right = width - 8;
      const top = 2;
      const bottomPadding = Math.max(24, Math.min(32, Math.round(measuredHeight * 0.1)));
      const minPlotHeight = 48;
      const height = Math.max(measuredHeight, top + bottomPadding + minPlotHeight);
      const paintBottom = height;
      const bottom = height - bottomPadding;
      const points = coursePoints.map((point) => {
        const x = left + (point.mile / totalMiles) * (right - left);
        const y = bottom - ((point.eleFt - minElevation) / (maxElevation - minElevation)) * (bottom - top);
        return { ...point, x, y };
      });

      return { points, left, right, top, bottom, paintBottom, width, height, minElevation, maxElevation };
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

    function profileSegmentPath(startMile, endMile) {
      const segment = [profilePoint(startMile)];
      profile.points.forEach((point) => {
        if (point.mile > startMile && point.mile < endMile) {
          segment.push(point);
        }
      });
      segment.push(profilePoint(endMile));
      return pointPath(segment);
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
      const gridYValues = [];
      for (let index = 0; index < 4; index += 1) {
        gridYValues.push(profile.top + ((profile.bottom - profile.top) * index) / 3);
      }
      if (profile.paintBottom - profile.bottom > 1) gridYValues.push(profile.paintBottom);
      gridYValues.forEach((y) => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "profile-grid-line");
        line.setAttribute("x1", profile.left);
        line.setAttribute("x2", profile.right);
        line.setAttribute("y1", y);
        line.setAttribute("y2", y);
        gridFragment.appendChild(line);
      });
      elements.profileGrid.replaceChildren(gridFragment);

      const profileD = pointPath(profile.points);
      const areaD = profileD + " L " + profile.points[profile.points.length - 1].x.toFixed(2) + " " + profile.paintBottom + " L " + profile.points[0].x.toFixed(2) + " " + profile.paintBottom + " Z";
      elements.profileArea.setAttribute("d", areaD);
      elements.profileLine.setAttribute("d", profileD);
      elements.profileLineShadow.setAttribute("d", profileD);
      elements.profileCursorLine.setAttribute("y1", profile.top);
      elements.profileCursorLine.setAttribute("y2", profile.paintBottom);

      const climbFragment = document.createDocumentFragment();
      majorClimbs.forEach((climb) => {
        const start = profilePoint(climb.startMile);
        const end = profilePoint(climb.endMile);
        const titleText =
          "Climb " + climb.index + ": " + climb.label + " | mile " +
          formatMiles(climb.startMile) + "-" + formatMiles(climb.endMile) +
          " | " + formatClimbStats(climb);

        const band = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        band.setAttribute("class", "profile-climb-band");
        band.setAttribute("x", Math.min(start.x, end.x).toFixed(2));
        band.setAttribute("y", profile.top);
        band.setAttribute("width", Math.abs(end.x - start.x).toFixed(2));
        band.setAttribute("height", Math.max(0, profile.paintBottom - profile.top).toFixed(2));
        const bandTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
        bandTitle.textContent = titleText;
        band.appendChild(bandTitle);
        climbFragment.appendChild(band);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("class", "profile-climb-line");
        line.setAttribute("d", profileSegmentPath(climb.startMile, climb.endMile));
        const lineTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
        lineTitle.textContent = titleText;
        line.appendChild(lineTitle);
        climbFragment.appendChild(line);
      });
      elements.profileClimbs.replaceChildren(climbFragment);

      const guideFragment = document.createDocumentFragment();
      routeData.stops.forEach((stop) => {
        const point = profilePoint(stop.mile);
        const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
        guide.setAttribute("class", "profile-stop-guide stop-" + (stop.type || "aid") + (stop.resupply ? " resupply-guide" : ""));
        guide.setAttribute("x1", point.x);
        guide.setAttribute("x2", point.x);
        guide.setAttribute("y1", profile.top);
        guide.setAttribute("y2", profile.paintBottom);
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
      elements.profileCurrentLeg.setAttribute("height", Math.max(0, profile.paintBottom - profile.top).toFixed(2));
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
              ? { top: 42, right: 76, bottom: 42, left: 20 }
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
      const currentClimb = climbContext(mile);
      if (state.profileMode === "climbs" && currentClimb && currentClimb.status !== "done") {
        elements.profilePopupClimb.textContent =
          (currentClimb.status === "active" ? "On climb " : "Next climb ") +
          currentClimb.climb.index + ": " + currentClimb.climb.shortLabel + " | " +
          formatClimbStats(currentClimb.climb);
        elements.profilePopupClimb.hidden = false;
      } else {
        elements.profilePopupClimb.hidden = true;
      }
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

    function syncProfileModeUi() {
      const isClimbs = state.profileMode === "climbs";
      elements.profileViz.classList.toggle("profile-mode-climbs", isClimbs);
      elements.profileViz.classList.toggle("profile-mode-splits", !isClimbs);
      elements.profileModeButtons.forEach((button) => {
        const active = button.dataset.profileMode === state.profileMode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function setProfileMode(mode) {
      if (mode !== "splits" && mode !== "climbs") return;
      state.profileMode = mode;
      syncProfileModeUi();
      hideProfilePopup();
      update(state.currentMile);
    }

    function updateSplitPanel(context, leg, fuel) {
      elements.stationPanel.classList.remove("is-climb-panel");
      elements.stationMetaLabel.textContent = "Depart";
      elements.arrivalMetaLabel.textContent = "Arrive";
      elements.routeTitleJoiner.hidden = false;
      elements.routeTitleJoiner.textContent = "to";
      elements.legDistanceLabel.textContent = "Distance";
      elements.legElevationLabel.textContent = "Elevation";
      elements.legPaceLabel.textContent = "Pace";
      elements.legNutritionLabel.textContent = "Nutrition";

      elements.stationOverline.textContent = context.complete ? "Last split" : "Split";
      elements.stationName.textContent = context.depart.name;
      elements.stationMeta.textContent = context.depart.eta;
      elements.nextStop.textContent = context.arrive ? context.arrive.name : "Finish";
      elements.arrivalMeta.textContent = context.arrive ? context.arrive.eta : "";

      if (context.depart.resupply) {
        const resupply = context.depart.resupply;
        const arrivalStatus = context.arrive ? stopTypeLabel(context.arrive).toLowerCase() : "finish";
        const resupplyRefillLabel = formatNumber(resupply.nutrition.carbs) + "g carbs, Na " +
          formatSodiumGramsRange(resupply.nutrition) + ", " +
          formatCompactFluidRange(resupply.nutrition);
        elements.stationPanel.classList.add("has-resupply");
        elements.stationResupply.hidden = false;
        elements.resupplyLabel.textContent = "Resupply";
        elements.resupplyArrival.textContent = context.arrive ? context.arrive.name + " arrival · " + arrivalStatus : "Finish";
        elements.resupplyCarbs.textContent = formatNumber(resupply.nutrition.carbs) + "g carbs";
        elements.resupplySodium.textContent = "Na " + formatSodiumGramsRange(resupply.nutrition);
        elements.resupplyFluid.textContent = formatCompactFluidRange(resupply.nutrition);
        elements.resupplyBlock.setAttribute("aria-label", "Refill " + resupplyRefillLabel);
        elements.resupplyNutrition.textContent =
          "Next " + resupply.label + " · " +
          formatMiles(resupply.miles) + " mi / " +
          formatDuration(resupply.minutes);
      } else {
        elements.stationPanel.classList.remove("has-resupply");
        elements.stationResupply.hidden = true;
      }

      if (leg) {
        const legDistance = formatMiles(leg.distanceMi) + " mi";
        const climbLine = formatLegClimbLine(leg.climbs);
        elements.legDuration.textContent = formatDuration(leg.plannedMinutes);
        elements.nextLeg.textContent = legDistance;
        elements.legDistanceLarge.textContent = legDistance;
        elements.legElevation.textContent = formatElevationLine(leg);
        elements.legPace.textContent = leg.pace;
        elements.legClimb.hidden = !climbLine;
        elements.legClimb.textContent = climbLine ? "Climb " + climbLine : "";
        elements.legNutrition.textContent = formatCompactNutritionLine(fuel);
      } else {
        elements.legDuration.textContent = "Done";
        elements.nextLeg.textContent = "Finish";
        elements.legDistanceLarge.textContent = "Finish";
        elements.legElevation.textContent = "Done";
        elements.legPace.textContent = "--";
        elements.legClimb.hidden = true;
        elements.legClimb.textContent = "";
        elements.legNutrition.textContent = "Recover";
      }
    }

    function updateClimbPanel(mile) {
      const context = climbContext(mile);
      elements.stationPanel.classList.add("is-climb-panel");
      elements.stationPanel.classList.remove("has-resupply");
      elements.stationResupply.hidden = true;
      elements.stationMetaLabel.textContent = "Start";
      elements.arrivalMetaLabel.textContent = "Top";
      elements.routeTitleJoiner.hidden = true;
      elements.legDistanceLabel.textContent = "Avg grade";
      elements.legElevationLabel.textContent = "Elevation";
      elements.legPaceLabel.textContent = "Avg grade";
      elements.legNutritionLabel.textContent = "Range";
      elements.legClimb.hidden = true;
      elements.legClimb.textContent = "";

      if (!context) {
        elements.stationOverline.textContent = "Climbs";
        elements.stationName.textContent = "Major climbs";
        elements.stationMeta.textContent = "--";
        elements.nextStop.textContent = "None detected";
        elements.arrivalMeta.textContent = "--";
        elements.legDuration.textContent = "--";
        elements.nextLeg.textContent = "--";
        elements.legDistanceLarge.textContent = "--";
        elements.legElevation.textContent = "--";
        elements.legPace.textContent = "--";
        elements.legNutrition.textContent = "No qualifying climb windows";
        return;
      }

      const climb = context.climb;
      const statusLabel =
        context.status === "active"
          ? "Current climb"
          : context.status === "next"
            ? "Next climb"
            : "Last climb";
      elements.stationOverline.textContent = statusLabel;
      elements.stationName.textContent = "Climb " + climb.index + "/" + majorClimbs.length + ":";
      elements.stationMeta.textContent = "mi " + formatMiles(climb.startMile);
      elements.nextStop.textContent = climb.shortLabel;
      elements.arrivalMeta.textContent = "mi " + formatMiles(climb.endMile);
      elements.legDuration.textContent = formatMiles(climb.distanceMi) + " mi";
      elements.nextLeg.textContent = "+" + formatNumber(climb.gainFt) + " ft";
      elements.legDistanceLarge.textContent = climb.avgGradePct + "%";
      elements.legElevation.textContent = formatElevationRange(climb);
      elements.legPace.textContent = climb.avgGradePct + "%";
      elements.legNutrition.textContent =
        "mile " + formatMiles(climb.startMile) + "-" + formatMiles(climb.endMile) +
        " | +" + formatNumber(climb.netGainFt) + " ft net | -" + formatNumber(climb.lossFt) + " ft inside";
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

      if (state.profileMode === "climbs") updateClimbPanel(mile);
      else updateSplitPanel(context, leg, fuel);
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

    elements.profileModeButtons.forEach((button) => {
      button.addEventListener("click", () => setProfileMode(button.dataset.profileMode));
    });

    let layoutFrame = null;
    function refreshLayout() {
      layoutFrame = null;
      syncViewportHeight();
      initProfile();
      syncProfileModeUi();
      update(state.currentMile);
      if (state.map) state.map.resize();
    }

    function scheduleLayoutRefresh() {
      if (layoutFrame !== null) return;
      layoutFrame = window.requestAnimationFrame(refreshLayout);
    }

    syncViewportHeight();
    initProfile();
    syncProfileModeUi();
    initMap();
    update(0);
    window.addEventListener("resize", scheduleLayoutRefresh);
    window.addEventListener("orientationchange", scheduleLayoutRefresh);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleLayoutRefresh);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleLayoutRefresh);
      observer.observe(elements.profileViz);
      observer.observe(elements.profileSvg);
    }
  </script>
${renderPwaRegistrationScript()}
</body>
</html>
`;
}

function renderManifest() {
  return `${JSON.stringify(
    {
      name: "Canyons 100K Crew Guide",
      short_name: "Canyons Crew",
      description: "Offline-ready race day crew guide, parking maps, and route tracker for Canyons 100K.",
      start_url: "./index.html",
      scope: "./",
      display: "standalone",
      background_color: "#f7faf9",
      theme_color: "#ff5a45",
      icons: [
        {
          src: "./assets/icon-192.png",
          sizes: "192x192",
          type: "image/png"
        },
        {
          src: "./assets/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    },
    null,
    2
  )}\n`;
}

function renderServiceWorker(cacheVersion) {
  return `"use strict";

const CACHE_NAME = "canyons-100k-${cacheVersion}";
const RUNTIME_CACHE_NAME = "canyons-100k-runtime-${cacheVersion}";
const CORE_ASSETS = ${JSON.stringify(PWA_ASSETS, null, 2)};
const EXTERNAL_ASSETS = ${JSON.stringify(PWA_EXTERNAL_ASSETS, null, 2)};

async function cacheCoreAssets() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(CORE_ASSETS);

  const runtime = await caches.open(RUNTIME_CACHE_NAME);
  await Promise.allSettled(
    EXTERNAL_ASSETS.map(async (url) => {
      const response = await fetch(url, { mode: "no-cors" });
      await runtime.put(url, response);
    })
  );
}

async function deleteOldCaches() {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith("canyons-100k-") && key !== CACHE_NAME && key !== RUNTIME_CACHE_NAME)
      .map((key) => caches.delete(key))
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (await caches.match(fallbackUrl));
  }
}

async function staleWhileRevalidate(request) {
  const runtime = await caches.open(RUNTIME_CACHE_NAME);
  const cached = await runtime.match(request);
  const fetched = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        runtime.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetched;
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheCoreAssets().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin === self.location.origin) {
    if (event.request.mode === "navigate") {
      event.respondWith(networkFirst(event.request, "./index.html"));
      return;
    }

    event.respondWith(cacheFirst(event.request));
    return;
  }

  if (EXTERNAL_ASSETS.includes(url.href)) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
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

applyDerivedPacing();
fs.mkdirSync(path.dirname(GUIDE_OUTPUT_PATH), { recursive: true });
const guideHtml = renderGuideHtml();
const trackerHtml = renderRouteTrackerHtml();
const manifest = renderManifest();
const cacheVersion = shortHash(`${guideHtml}\n${trackerHtml}\n${manifest}\n${JSON.stringify(PWA_ASSETS)}\n${hashPwaAssetContents()}`);
fs.writeFileSync(INDEX_OUTPUT_PATH, guideHtml);
fs.writeFileSync(GUIDE_OUTPUT_PATH, guideHtml);
fs.writeFileSync(TRACKER_OUTPUT_PATH, trackerHtml);
fs.writeFileSync(MANIFEST_OUTPUT_PATH, manifest);
fs.writeFileSync(SERVICE_WORKER_OUTPUT_PATH, renderServiceWorker(cacheVersion));
fs.writeFileSync(NOJEKYLL_OUTPUT_PATH, "");
console.log(`Generated ${path.relative(ROOT, INDEX_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, GUIDE_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, TRACKER_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, MANIFEST_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, SERVICE_WORKER_OUTPUT_PATH)}`);
console.log(`Generated ${path.relative(ROOT, NOJEKYLL_OUTPUT_PATH)}`);
