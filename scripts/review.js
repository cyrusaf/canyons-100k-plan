#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

let chromium;
let webkit;
try {
  ({ chromium, webkit } = require("playwright"));
} catch (error) {
  console.error("Playwright is not installed. Run `npm install`, then `npm run review`.");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const GUIDE_OUTPUT = path.join(ROOT, "docs", "canyons-100k-crew-guide.html");
const TRACKER_OUTPUT = path.join(ROOT, "docs", "canyons-100k-route-tracker.html");
const SCREENSHOT_DIR = path.join(ROOT, ".artifacts", "screenshots");
const MAPTILER_API_KEY = process.env.MAPTILER_API_KEY || "";

function fileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

function trackerUrl() {
  const url = pathToFileURL(TRACKER_OUTPUT);
  if (MAPTILER_API_KEY) url.searchParams.set("maptiler_key", MAPTILER_API_KEY);
  return url.href;
}

async function waitForTrackerMapIdle(page) {
  await page.waitForFunction(() => {
    const map = window.routeTrackerMap;
    if (!window.CANYONS_MAPTILER_API_KEY) return true;
    return Boolean(
      map &&
      typeof map.loaded === "function" &&
      map.loaded() &&
      (typeof map.areTilesLoaded !== "function" || map.areTilesLoaded())
    );
  }, null, { timeout: 6000 }).catch(() => {});
}

async function collectTrackerBottomSweep(browser, viewports) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const sweep = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(trackerUrl(), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Boolean(
        document.getElementById("profile-line")?.getAttribute("d") &&
        document.querySelectorAll("#profile-stops circle").length
      ),
      null,
      { timeout: 10000 }
    );
    await page.waitForTimeout(100);
    sweep.push(await page.evaluate(() => {
      const profile = document.querySelector(".bottom-profile-viz").getBoundingClientRect();
      const station = document.querySelector(".station-panel").getBoundingClientRect();
      const titleEl = document.querySelector(".bottom-profile-viz .viz-title");
      const title = titleEl.getBoundingClientRect();
      const titleHeight = window.getComputedStyle(titleEl).position === "absolute" ? 0 : title.height;
      const svg = document.getElementById("profile-svg").getBoundingClientRect();
      const area = document.getElementById("profile-area").getBoundingClientRect();
      const grid = document.getElementById("profile-grid").getBoundingClientRect();
      const currentLeg = document.getElementById("profile-current-leg").getBoundingClientRect();
      const guideBottom = Math.max(
        ...[...document.querySelectorAll("#profile-stop-guides line")]
          .map((el) => el.getBoundingClientRect().bottom)
      );
      const contentBottom = Math.max(
        ...[...document.querySelectorAll("#profile-line, #profile-stops circle")]
          .map((el) => el.getBoundingClientRect().bottom)
      );
      const doc = document.documentElement;
      const normalChromeBudget =
        (window.innerWidth >= 720 && window.innerHeight >= 421) ||
        (window.innerWidth < 720 && window.innerHeight >= 481);

      return {
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        scrollHeight: doc.scrollHeight,
        innerHeight: window.innerHeight,
        profileBottomGap: Math.round(window.innerHeight - profile.bottom),
        stationBottomGap: Math.round(window.innerHeight - station.bottom),
        profileAboveStation: profile.bottom <= station.top + 1,
        profileFreeBottomGap: Math.round(profile.height - titleHeight - svg.height),
        profileSvgBottomGap: Math.round(profile.bottom - svg.bottom),
        profileAreaBottomGap: Math.round(svg.bottom - area.bottom),
        profileGridBottomGap: Math.round(svg.bottom - grid.bottom),
        profileGuideBottomGap: Math.round(svg.bottom - guideBottom),
        profileCurrentLegBottomGap: Math.round(svg.bottom - currentLeg.bottom),
        profileContentBottomGap: Math.round(svg.bottom - contentBottom),
        bottomBufferMin: normalChromeBudget ? 12 : 8,
        bottomBufferMax: normalChromeBudget ? 36 : 24
      };
    }));
  }
  await page.close();
  return sweep;
}

function bottomSweepHasFailure(item) {
  return (
    item.scrollHeight > item.innerHeight + 1 ||
    Math.abs(item.stationBottomGap) > 1 ||
    !item.profileAboveStation ||
    Math.abs(item.profileFreeBottomGap) > 1 ||
    Math.abs(item.profileSvgBottomGap) > 1 ||
    Math.abs(item.profileAreaBottomGap) > 1 ||
    Math.abs(item.profileGridBottomGap) > 1 ||
    Math.abs(item.profileGuideBottomGap) > 1 ||
    Math.abs(item.profileCurrentLegBottomGap) > 1 ||
    item.profileContentBottomGap < item.bottomBufferMin ||
    item.profileContentBottomGap > item.bottomBufferMax
  );
}

execFileSync(process.execPath, [path.join(ROOT, "scripts", "generate.js")], {
  cwd: ROOT,
  stdio: "inherit"
});

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true
  });

  await page.goto(fileUrl(GUIDE_OUTPUT), { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, "iphone-overview.png"), fullPage: false });

  for (const id of ["plan", "crew", "maps"]) {
    await page.evaluate((sectionId) => {
      const el = document.getElementById(sectionId);
      window.scrollTo({ top: el.offsetTop - 70, left: 0, behavior: "instant" });
    }, id);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `iphone-${id}.png`), fullPage: false });
  }

  const crewStops = await page.locator(".stop.crew").count();
  for (let i = 0; i < crewStops; i += 1) {
    await page.evaluate((index) => {
      const el = document.querySelectorAll(".stop.crew")[index];
      window.scrollTo({ top: el.offsetTop - 70, left: 0, behavior: "instant" });
    }, i);
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `iphone-crew-${i + 1}.png`), fullPage: false });
  }

  const guideMetrics = await page.evaluate(() => {
    const overflow = [...document.querySelectorAll("body *")]
      .filter((el) => !el.closest(".maplibregl-canvas-container"))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
        right: Math.round(el.getBoundingClientRect().right),
        width: Math.round(el.getBoundingClientRect().width)
      }))
      .filter((item) => item.right > window.innerWidth + 1);

    const tapTargets = [...document.querySelectorAll("a, button")]
      .filter((el) => !el.closest(".maplibregl-ctrl-attrib"))
      .filter((el) => !el.closest(".maplibregl-ctrl-logo"))
      .filter((el) => el.getAttribute("aria-label") !== "MapTiler logo")
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim().replace(/\s+/g, " "),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      })
      .filter((item) => item.w < 40 || item.h < 44);

    const tinyText = [...document.querySelectorAll("body *")]
      .map((el) => ({
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        size: parseFloat(getComputedStyle(el).fontSize),
        cls: String(el.className)
      }))
      .filter((item) => item.text && item.size < 10);

    return {
      scrollWidth: document.documentElement.scrollWidth,
      navHeight: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
      overflow,
      tapTargets,
      tinyText
    };
  });

  const desktop = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
  await desktop.goto(fileUrl(GUIDE_OUTPUT), { waitUntil: "networkidle" });
  await desktop.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-overview.png"), fullPage: false });

  const trackerMobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true
  });
  await trackerMobile.goto(trackerUrl(), { waitUntil: "domcontentloaded" });
  await trackerMobile.waitForFunction(() => window.routeTrackerReady === true, null, { timeout: 10000 });
  await waitForTrackerMapIdle(trackerMobile);
  await trackerMobile.waitForTimeout(500);
  await trackerMobile.screenshot({ path: path.join(SCREENSHOT_DIR, "iphone-tracker-start.png"), fullPage: false });
  const trackerStartResupplyMetrics = await trackerMobile.evaluate(() => {
    const stationEl = document.querySelector(".station-panel");
    const resupply = document.getElementById("station-resupply");
    const station = stationEl.getBoundingClientRect();
    const box = resupply.getBoundingClientRect();
    const metricContentFits = [...document.querySelectorAll(".tracker-data-cell:not([hidden])")]
      .every((el) => {
        const label = el.querySelector(".label").getBoundingClientRect();
        const value = el.querySelector("strong").getBoundingClientRect();
        const card = el.getBoundingClientRect();
        const minValueHeight = el.classList.contains("tracker-resupply-cell") ? 10 : 12;
        return (
          label.height >= 10 &&
          value.height >= minValueHeight &&
          label.top >= card.top - 1 &&
          value.bottom <= card.bottom + 1
        );
      });
    const overflow = [...document.querySelectorAll("body *")]
      .filter((el) => !el.closest(".maplibregl-canvas-container") && !el.closest(".maplibregl-ctrl-attrib"))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.getBoundingClientRect())
      .filter((rect) => rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1);

    return {
      visible: !resupply.hidden,
      text: resupply.textContent.trim().replace(/\s+/g, " "),
      stationText: stationEl.textContent.trim().replace(/\s+/g, " "),
      height: Math.round(box.height),
      stationHeight: Math.round(station.height),
      metricContentFits,
      overflowCount: overflow.length
    };
  });
  await trackerMobile.locator('[data-profile-mode="climbs"]').click();
  await trackerMobile.waitForTimeout(200);
  const trackerClimbModeMetrics = await trackerMobile.evaluate(() => {
    const stationEl = document.querySelector(".station-panel");
    return {
      active: document.querySelector('[data-profile-mode="climbs"]').getAttribute("aria-pressed") === "true",
      stationText: stationEl.textContent.trim().replace(/\s+/g, " "),
      primary: document.getElementById("leg-duration").textContent.trim(),
      secondary: document.getElementById("next-leg").textContent.trim(),
      label: document.getElementById("station-overline").textContent.trim(),
      grade: document.getElementById("leg-distance-large").textContent.trim(),
      range: document.getElementById("leg-nutrition").textContent.trim()
    };
  });
  await trackerMobile.locator('[data-profile-mode="splits"]').click();
  await trackerMobile.waitForTimeout(200);
  const mobileProfileBoxBeforeWheel = await trackerMobile.locator("#profile-svg").boundingBox();
  await trackerMobile.mouse.move(
    mobileProfileBoxBeforeWheel.x + mobileProfileBoxBeforeWheel.width / 2,
    mobileProfileBoxBeforeWheel.y + mobileProfileBoxBeforeWheel.height / 2
  );
  await trackerMobile.mouse.wheel(0, 1300);
  await trackerMobile.waitForTimeout(650);
  await trackerMobile.screenshot({ path: path.join(SCREENSHOT_DIR, "iphone-tracker-mid.png"), fullPage: false });
  await trackerMobile.keyboard.press("End");
  await trackerMobile.waitForTimeout(650);
  await trackerMobile.screenshot({ path: path.join(SCREENSHOT_DIR, "iphone-tracker-end.png"), fullPage: false });
  const profileBox = await trackerMobile.locator("#profile-svg").boundingBox();
  await trackerMobile.mouse.move(profileBox.x + profileBox.width * 0.18, profileBox.y + profileBox.height * 0.55);
  await trackerMobile.mouse.down();
  await trackerMobile.mouse.move(profileBox.x + profileBox.width * 0.54, profileBox.y + profileBox.height * 0.42, { steps: 5 });
  const profilePopupDuringDrag = await trackerMobile.evaluate(() => {
    const popup = document.getElementById("profile-marker-popup");
    const rect = popup.getBoundingClientRect();
    const svg = document.getElementById("profile-svg").getBoundingClientRect();
    return {
      visible: !popup.hidden,
      text: popup.textContent.trim().replace(/\s+/g, " "),
      withinProfile:
        rect.left >= svg.left - 1 &&
        rect.right <= svg.right + 1 &&
        rect.top >= svg.top - 60 &&
        rect.bottom <= svg.bottom + 60
    };
  });
  await trackerMobile.mouse.up();
  await trackerMobile.waitForTimeout(650);
  const profileDragLabel = await trackerMobile.locator("#route-distance-label").textContent();
  await trackerMobile.keyboard.press("End");
  await waitForTrackerMapIdle(trackerMobile);
  await trackerMobile.waitForTimeout(650);

  const trackerMetrics = await trackerMobile.evaluate(({ profileDragLabel, hasMapTilerKey }) => {
    const overflow = [...document.querySelectorAll("body *")]
      .filter((el) => !el.closest(".maplibregl-canvas-container"))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => ({
        tag: el.tagName,
        cls: String(el.className),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100),
        right: Math.round(el.getBoundingClientRect().right),
        bottom: Math.round(el.getBoundingClientRect().bottom),
        width: Math.round(el.getBoundingClientRect().width)
      }))
      .filter((item) => item.right > window.innerWidth + 1 || item.bottom > window.innerHeight + 1);

    const tapTargets = [...document.querySelectorAll("a, button")]
      .filter((el) => !el.closest(".maplibregl-ctrl-attrib"))
      .filter((el) => !el.closest(".maplibregl-ctrl-logo"))
      .filter((el) => el.getAttribute("aria-label") !== "MapTiler logo")
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || "").trim().replace(/\s+/g, " "),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      })
      .filter((item) => item.w < 40 || item.h < 44);

    const tinyText = [...document.querySelectorAll("body *")]
      .map((el) => ({
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        size: parseFloat(getComputedStyle(el).fontSize),
        cls: String(el.className)
      }))
      .filter((item) => item.text && item.size < 10);

    const map = window.routeTrackerMap || null;
    const mapReady = Boolean(map && typeof map.getZoom === "function");
    const mapLoaded = Boolean(map && map.loaded && map.loaded());
    const mapSetupText = (
      document.querySelector(".map-setup-message")?.textContent ||
      document.getElementById("route-map").textContent ||
      ""
    ).trim().replace(/\s+/g, " ");
    const layerIds = window.routeTrackerMapLayerIds || {};
    const sourceIds = window.routeTrackerMapSourceIds || {};
    const mapConfigPresent = Boolean(window.CANYONS_MAPTILER_API_KEY);
    const mapLayerIds = [layerIds.fullRoute, layerIds.progressRoute, layerIds.stops, layerIds.progressDot].filter(Boolean);
    const mapSourceIds = [sourceIds.fullRoute, sourceIds.progressRoute, sourceIds.stops, sourceIds.progressPoint].filter(Boolean);
    const mapLayerCount = mapReady && typeof map.getLayer === "function"
      ? mapLayerIds.filter((id) => map.getLayer(id)).length
      : 0;
    const mapSourceCount = mapReady && typeof map.getSource === "function"
      ? mapSourceIds.filter((id) => map.getSource(id)).length
      : 0;
    const mapStopsAvailable = mapReady && typeof map.getSource === "function" && sourceIds.stops
      ? Boolean(map.getSource(sourceIds.stops))
      : false;
    const mapStopTypes = mapLoaded && layerIds.stops
      ? map.queryRenderedFeatures({ layers: [layerIds.stops] })
        .map((feature) => "stop-" + feature.properties.type)
        .filter(Boolean)
      : [];
    const progressFeatureCount = mapLoaded && layerIds.progressDot
      ? map.queryRenderedFeatures({ layers: [layerIds.progressDot] }).length
      : 0;
    const projectedPoint = map && window.routeTrackerCurrentPoint
      ? map.project(window.routeTrackerCurrentPoint)
      : null;
    const profileCursor = document.getElementById("profile-cursor").getBoundingClientRect();
    const profilePopup = document.getElementById("profile-marker-popup");
    const doc = document.documentElement;
    const profileStopTypes = [...document.querySelectorAll("#profile-stops .svg-stop")]
      .map((el) => [...el.classList].find((cls) => cls.startsWith("stop-")))
      .filter(Boolean);
    const profileGuideTypes = [...document.querySelectorAll("#profile-stop-guides .profile-stop-guide")]
      .map((el) => [...el.classList].find((cls) => cls.startsWith("stop-")))
      .filter(Boolean);
    const currentLeg = document.getElementById("profile-current-leg").getBoundingClientRect();

    return {
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      bodyOverflow: getComputedStyle(document.body).overflowY,
      mileLabel: document.getElementById("route-distance-label").textContent,
      profileDragLabel,
      profileStopTypeCount: new Set(profileStopTypes).size,
      profileGuideTypeCount: new Set(profileGuideTypes).size,
      profileGuideCount: profileGuideTypes.length,
      profileStopCount: profileStopTypes.length,
      profileCurrentLegWidth: Math.round(currentLeg.width),
      profileCurrentLegHeight: Math.round(currentLeg.height),
      profilePopupHiddenAtRest: profilePopup.hidden && getComputedStyle(profilePopup).display === "none",
      resupplyGuideCount: document.querySelectorAll("#profile-stop-guides .resupply-guide").length,
      mapStopTypeCount: new Set(mapStopTypes).size,
      mapKeyPresent: hasMapTilerKey || mapConfigPresent,
      mapEnvKeyPresent: hasMapTilerKey,
      mapConfigPresent,
      mapReady,
      mapLoaded,
      mapError: String(window.routeTrackerMapError || "").replace(/([?&]key=)[^&\s)]+/g, "$1redacted"),
      mapSetupText,
      mapLayerCount,
      mapSourceCount,
      mapStopsAvailable,
      mapTilesReady: mapLoaded && map.areTilesLoaded ? map.areTilesLoaded() : false,
      mapProgressFeatureCount: progressFeatureCount,
      cursorVisible:
        Boolean(projectedPoint) &&
        projectedPoint.x >= 0 &&
        projectedPoint.x <= window.innerWidth &&
        projectedPoint.y >= 0 &&
        projectedPoint.y <= window.innerHeight,
      profileCursorVisible:
        profileCursor.left >= 0 &&
        profileCursor.right <= window.innerWidth &&
        profileCursor.top >= 0 &&
        profileCursor.bottom <= window.innerHeight,
      overflow,
      tapTargets,
      tinyText
    };
  }, { profileDragLabel, hasMapTilerKey: Boolean(MAPTILER_API_KEY) });
  trackerMetrics.profilePopupDuringDrag = profilePopupDuringDrag;

  const trackerDesktop = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await trackerDesktop.goto(trackerUrl(), { waitUntil: "domcontentloaded" });
  await trackerDesktop.waitForFunction(() => window.routeTrackerReady === true, null, { timeout: 10000 });
  await waitForTrackerMapIdle(trackerDesktop);
  await trackerDesktop.waitForTimeout(500);
  const desktopProfileBoxBeforeWheel = await trackerDesktop.locator("#profile-svg").boundingBox();
  await trackerDesktop.mouse.move(
    desktopProfileBoxBeforeWheel.x + desktopProfileBoxBeforeWheel.width / 2,
    desktopProfileBoxBeforeWheel.y + desktopProfileBoxBeforeWheel.height / 2
  );
  await trackerDesktop.mouse.wheel(0, 2200);
  await trackerDesktop.waitForTimeout(650);
  const desktopProfileBox = await trackerDesktop.locator("#profile-svg").boundingBox();
  const desktopProfileTargetX = desktopProfileBox.x + desktopProfileBox.width * 0.82;
  await trackerDesktop.mouse.move(desktopProfileBox.x + desktopProfileBox.width * 0.2, desktopProfileBox.y + desktopProfileBox.height * 0.5);
  await trackerDesktop.mouse.down();
  await trackerDesktop.mouse.move(desktopProfileTargetX, desktopProfileBox.y + desktopProfileBox.height * 0.42, { steps: 8 });
  await trackerDesktop.mouse.up();
  await trackerDesktop.waitForTimeout(200);
  await trackerDesktop.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-tracker-mid.png"), fullPage: false });
  const desktopMapState = await trackerDesktop.evaluate(() => {
    const map = window.routeTrackerMap || null;
    return {
      ready: Boolean(map && typeof map.getZoom === "function"),
      configPresent: Boolean(window.CANYONS_MAPTILER_API_KEY),
      error: String(window.routeTrackerMapError || "").replace(/([?&]key=)[^&\s)]+/g, "$1redacted"),
      setupText: (
        document.querySelector(".map-setup-message")?.textContent ||
        document.getElementById("route-map").textContent ||
        ""
      ).trim().replace(/\s+/g, " ")
    };
  });
  let mapZoomBefore = null;
  let mapZoomAfter = null;
  if (desktopMapState.ready) {
    mapZoomBefore = await trackerDesktop.evaluate(() => window.routeTrackerMap.getZoom());
    await trackerDesktop.locator(".maplibregl-ctrl-zoom-in").first().click();
    await trackerDesktop.waitForTimeout(250);
    mapZoomAfter = await trackerDesktop.evaluate(() => window.routeTrackerMap.getZoom());
  }
  const trackerDesktopMetrics = await trackerDesktop.evaluate((desktopProfileTargetX) => {
    const stage = document.querySelector(".route-stage").getBoundingClientRect();
    const map = document.querySelector(".map-viz").getBoundingClientRect();
    const details = document.querySelector(".route-details").getBoundingClientRect();
    const app = document.querySelector(".route-app").getBoundingClientRect();
    const profile = document.querySelector(".bottom-profile-viz").getBoundingClientRect();
    const station = document.querySelector(".station-panel").getBoundingClientRect();
    const profileLine = document.getElementById("profile-cursor-line").getBoundingClientRect();
    const svg = document.getElementById("profile-svg").getBoundingClientRect();
    const contentBottom = Math.max(
      ...[...document.querySelectorAll("#profile-line, #profile-stops circle")]
        .map((el) => el.getBoundingClientRect().bottom)
    );
    const zoomButton = document.querySelector(".maplibregl-ctrl-zoom-in")?.getBoundingClientRect();
    const cursorCenter = profileLine.left + profileLine.width / 2;
    const doc = document.documentElement;

    return {
      scrollHeight: doc.scrollHeight,
      innerHeight: window.innerHeight,
      appHeight: Math.round(app.height),
      stageBottom: Math.round(stage.bottom),
      mapBottom: Math.round(map.bottom),
      detailsTop: Math.round(details.top),
      profileBottomGap: Math.round(window.innerHeight - profile.bottom),
      stationBottomGap: Math.round(window.innerHeight - station.bottom),
      profileAboveStation: profile.bottom <= station.top + 1,
      profileSvgBottomGap: Math.round(profile.bottom - svg.bottom),
      profileContentBottomGap: Math.round(svg.bottom - contentBottom),
      mapFitsStage: map.bottom <= stage.bottom + 1,
      detailsBelowMap: details.top >= map.bottom - 1,
      profileDragDeltaPx: Math.abs(cursorCenter - desktopProfileTargetX),
      profilePathWidth: Math.round(document.getElementById("profile-line").getBoundingClientRect().width),
      profileSvgWidth: Math.round(document.getElementById("profile-svg").getBoundingClientRect().width),
      zoomButtonWidth: zoomButton ? Math.round(zoomButton.width) : 0,
      zoomButtonHeight: zoomButton ? Math.round(zoomButton.height) : 0
    };
  }, desktopProfileTargetX);
  trackerDesktopMetrics.mapReady = desktopMapState.ready;
  trackerDesktopMetrics.mapConfigPresent = desktopMapState.configPresent;
  trackerDesktopMetrics.mapError = desktopMapState.error;
  trackerDesktopMetrics.mapSetupText = desktopMapState.setupText;
  trackerDesktopMetrics.mapZoomBefore = mapZoomBefore;
  trackerDesktopMetrics.mapZoomAfter = mapZoomAfter;

  const trackerShortMobile = await browser.newPage({
    viewport: { width: 390, height: 667 },
    deviceScaleFactor: 2,
    isMobile: true
  });
  await trackerShortMobile.goto(trackerUrl(), { waitUntil: "domcontentloaded" });
  await trackerShortMobile.waitForFunction(() => window.routeTrackerReady === true, null, { timeout: 10000 });
  await trackerShortMobile.waitForTimeout(500);
  await trackerShortMobile.screenshot({ path: path.join(SCREENSHOT_DIR, "iphone-tracker-short.png"), fullPage: false });
  const trackerShortMobileMetrics = await trackerShortMobile.evaluate(() => {
    const profile = document.querySelector(".bottom-profile-viz").getBoundingClientRect();
    const station = document.querySelector(".station-panel").getBoundingClientRect();
    const svg = document.getElementById("profile-svg").getBoundingClientRect();
    const profilePath = document.getElementById("profile-line").getBoundingClientRect();
    const contentBottom = Math.max(
      profilePath.bottom,
      ...[...document.querySelectorAll("#profile-stops circle")]
        .map((el) => el.getBoundingClientRect().bottom)
    );
    const metricContentFits = [...document.querySelectorAll(".tracker-data-cell:not([hidden])")]
      .every((el) => {
        const label = el.querySelector(".label").getBoundingClientRect();
        const value = el.querySelector("strong").getBoundingClientRect();
        const card = el.getBoundingClientRect();
        const minValueHeight = el.classList.contains("tracker-resupply-cell") ? 10 : 12;
        return (
          label.height >= 10 &&
          value.height >= minValueHeight &&
          label.top >= card.top - 1 &&
          value.bottom <= card.bottom + 1
        );
      });

    return {
      profileHeight: Math.round(profile.height),
      svgHeight: Math.round(svg.height),
      stationHeight: Math.round(station.height),
      stationBottomGap: Math.round(window.innerHeight - station.bottom),
      profileAboveStation: profile.bottom <= station.top + 1,
      profileSvgBottomGap: Math.round(profile.bottom - svg.bottom),
      profileLineBottomGap: Math.round(svg.bottom - profilePath.bottom),
      profileContentBottomGap: Math.round(svg.bottom - contentBottom),
      profilePathWidth: Math.round(profilePath.width),
      profileSvgWidth: Math.round(svg.width),
      metricContentFits
    };
  });

  const trackerShortLandscape = await browser.newPage({
    viewport: { width: 1024, height: 300 },
    deviceScaleFactor: 2
  });
  await trackerShortLandscape.goto(trackerUrl(), { waitUntil: "domcontentloaded" });
  await trackerShortLandscape.waitForFunction(() => window.routeTrackerReady === true, null, { timeout: 10000 });
  await trackerShortLandscape.waitForTimeout(500);
  await trackerShortLandscape.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-tracker-short.png"), fullPage: false });
  const trackerShortLandscapeMetrics = await trackerShortLandscape.evaluate(() => {
    const app = document.querySelector(".route-app").getBoundingClientRect();
    const profile = document.querySelector(".bottom-profile-viz").getBoundingClientRect();
    const station = document.querySelector(".station-panel").getBoundingClientRect();
    const svg = document.getElementById("profile-svg").getBoundingClientRect();
    const profilePath = document.getElementById("profile-line").getBoundingClientRect();
    const contentBottom = Math.max(
      profilePath.bottom,
      ...[...document.querySelectorAll("#profile-stops circle")]
        .map((el) => el.getBoundingClientRect().bottom)
    );
    const doc = document.documentElement;

    return {
      scrollHeight: doc.scrollHeight,
      innerHeight: window.innerHeight,
      appHeight: Math.round(app.height),
      profileHeight: Math.round(profile.height),
      svgHeight: Math.round(svg.height),
      stationHeight: Math.round(station.height),
      stationBottomGap: Math.round(window.innerHeight - station.bottom),
      profileAboveStation: profile.bottom <= station.top + 1,
      profileSvgBottomGap: Math.round(profile.bottom - svg.bottom),
      profileLineBottomGap: Math.round(svg.bottom - profilePath.bottom),
      profileContentBottomGap: Math.round(svg.bottom - contentBottom),
      stationWithinApp: station.bottom <= app.bottom + 1
    };
  });

  const trackerBottomSweepViewports = [
    { width: 2048, height: 300 },
    { width: 2048, height: 360 },
    { width: 2048, height: 420 },
    { width: 2048, height: 440 },
    { width: 2048, height: 460 },
    { width: 2048, height: 500 },
    { width: 2048, height: 517 },
    { width: 2048, height: 540 },
    { width: 2048, height: 720 },
    { width: 2048, height: 832 },
    { width: 1280, height: 517 },
    { width: 720, height: 517 },
    { width: 390, height: 360 },
    { width: 390, height: 400 },
    { width: 390, height: 480 },
    { width: 390, height: 500 },
    { width: 390, height: 560 },
    { width: 390, height: 667 },
    { width: 390, height: 844 }
  ];
  const trackerBottomSweep = await collectTrackerBottomSweep(browser, trackerBottomSweepViewports);

  const trackerWebkitBottomSweepViewports = [
    { width: 2048, height: 409 },
    { width: 2048, height: 420 },
    { width: 2048, height: 517 },
    { width: 390, height: 400 },
    { width: 390, height: 844 }
  ];
  let trackerWebkitBottomSweep = [];
  let trackerWebkitError = "";
  let webkitBrowser = null;
  try {
    webkitBrowser = await webkit.launch();
    trackerWebkitBottomSweep = await collectTrackerBottomSweep(webkitBrowser, trackerWebkitBottomSweepViewports);
  } catch (error) {
    trackerWebkitError = String(error.message || error).split("\n")[0];
  } finally {
    if (webkitBrowser) await webkitBrowser.close();
  }

  await browser.close();

  const metrics = {
    guide: guideMetrics,
    tracker: trackerMetrics,
    trackerDesktop: trackerDesktopMetrics,
    trackerStartResupply: trackerStartResupplyMetrics,
    trackerClimbMode: trackerClimbModeMetrics,
    trackerShortMobile: trackerShortMobileMetrics,
    trackerShortLandscape: trackerShortLandscapeMetrics,
    trackerBottomSweep,
    trackerWebkitBottomSweep,
    trackerWebkitError
  };
  console.log(JSON.stringify(metrics, null, 2));
  const mileLabelMatch = trackerMetrics.mileLabel.match(/([\d.]+)\s*\/\s*([\d.]+)\s*mi/);
  const mileLabelAtEnd = mileLabelMatch
    ? Math.abs(Number(mileLabelMatch[1]) - Number(mileLabelMatch[2])) <= 0.11 && Number(mileLabelMatch[2]) >= 63
    : false;
  const liveMapReview = Boolean(MAPTILER_API_KEY);
  const trackerMapSkippedLocally =
    !liveMapReview &&
    !trackerMetrics.mapReady &&
    (trackerMetrics.mapSetupText.includes("Map key needed") || trackerMetrics.mapConfigPresent);
  const trackerMapFailed = liveMapReview
    ? !trackerMetrics.mapReady ||
      !trackerMetrics.mapLoaded ||
      trackerMetrics.mapLayerCount < 4 ||
      trackerMetrics.mapSourceCount < 4 ||
      !trackerMetrics.mapStopsAvailable ||
      trackerMetrics.mapProgressFeatureCount < 1 ||
      !trackerMetrics.cursorVisible
    : !trackerMapSkippedLocally;
  const trackerDesktopMapSkippedLocally =
    !liveMapReview &&
    !trackerDesktopMetrics.mapReady &&
    (trackerDesktopMetrics.mapSetupText.includes("Map key needed") || trackerDesktopMetrics.mapConfigPresent);
  const trackerDesktopMapFailed = liveMapReview
    ? !trackerDesktopMetrics.mapReady ||
      trackerDesktopMetrics.zoomButtonWidth < 40 ||
      trackerDesktopMetrics.zoomButtonHeight < 44 ||
      trackerDesktopMetrics.mapZoomAfter <= trackerDesktopMetrics.mapZoomBefore
    : !trackerDesktopMapSkippedLocally;
  if (
    guideMetrics.overflow.length ||
    guideMetrics.tapTargets.length ||
    guideMetrics.tinyText.length ||
    trackerMetrics.overflow.length ||
    trackerMetrics.tapTargets.length ||
    trackerMetrics.tinyText.length ||
    trackerMetrics.bodyOverflow !== "hidden" ||
    !mileLabelAtEnd ||
    trackerMetrics.profileDragLabel.startsWith("63.1") ||
    !trackerMetrics.profilePopupDuringDrag.visible ||
    !trackerMetrics.profilePopupDuringDrag.withinProfile ||
    !trackerMetrics.profilePopupDuringDrag.text.includes("mi") ||
    !trackerMetrics.profilePopupDuringDrag.text.includes("ft") ||
    !trackerMetrics.profilePopupDuringDrag.text.includes("%") ||
    !trackerMetrics.profilePopupDuringDrag.text.includes("->") ||
    trackerMetrics.profileStopTypeCount < 6 ||
    trackerMetrics.profileGuideTypeCount < 6 ||
    trackerMetrics.profileGuideCount !== trackerMetrics.profileStopCount ||
    trackerMetrics.profileCurrentLegWidth < 4 ||
    trackerMetrics.profileCurrentLegHeight < 80 ||
    !trackerMetrics.profilePopupHiddenAtRest ||
    trackerMetrics.resupplyGuideCount < 3 ||
    trackerMapFailed ||
    !trackerMetrics.profileCursorVisible ||
    trackerDesktopMetrics.scrollHeight > trackerDesktopMetrics.innerHeight + 1 ||
    Math.abs(trackerDesktopMetrics.appHeight - trackerDesktopMetrics.innerHeight) > 1 ||
    Math.abs(trackerDesktopMetrics.stationBottomGap) > 1 ||
    !trackerDesktopMetrics.profileAboveStation ||
    Math.abs(trackerDesktopMetrics.profileSvgBottomGap) > 1 ||
    trackerDesktopMetrics.profileContentBottomGap < 12 ||
    trackerDesktopMetrics.profileContentBottomGap > 36 ||
    !trackerDesktopMetrics.mapFitsStage ||
    !trackerDesktopMetrics.detailsBelowMap ||
    trackerDesktopMetrics.profileDragDeltaPx > 5 ||
    trackerDesktopMetrics.profilePathWidth < trackerDesktopMetrics.profileSvgWidth * 0.95 ||
    trackerDesktopMapFailed ||
    !trackerStartResupplyMetrics.visible ||
    !trackerStartResupplyMetrics.text.includes("Resupply") ||
    !trackerStartResupplyMetrics.text.includes("Deadwood 1 arrival · full aid") ||
    !trackerStartResupplyMetrics.text.includes("Next Michigan Bluff · 24.0 mi / 6h35") ||
    trackerStartResupplyMetrics.text.includes("Resupply to") ||
    trackerStartResupplyMetrics.text.includes("Next resupply:") ||
    trackerStartResupplyMetrics.text.includes("Block total") ||
    !trackerStartResupplyMetrics.text.includes("595g carbs") ||
    !trackerStartResupplyMetrics.text.includes("Na 3.35-4.95g") ||
    !trackerStartResupplyMetrics.stationText.includes("10.1 mi") ||
    !trackerStartResupplyMetrics.stationText.includes("+1,620 / -2,552 ft") ||
    !trackerStartResupplyMetrics.stationText.includes("Climb 2.9 mi @ 11.9%") ||
    !trackerStartResupplyMetrics.stationText.includes("230 g") ||
    !trackerStartResupplyMetrics.stationText.includes("1,300-1,900 mg") ||
    !trackerStartResupplyMetrics.stationText.includes("1.3-1.9 L") ||
    !trackerStartResupplyMetrics.stationText.includes("Arrive 7:33 AM") ||
    !trackerStartResupplyMetrics.metricContentFits ||
    trackerStartResupplyMetrics.overflowCount ||
    trackerStartResupplyMetrics.height > trackerStartResupplyMetrics.stationHeight ||
    !trackerClimbModeMetrics.active ||
    trackerClimbModeMetrics.primary !== "2.9 mi" ||
    !trackerClimbModeMetrics.secondary.includes("+1,835 ft") ||
    !trackerClimbModeMetrics.grade.includes("11.9%") ||
    !trackerClimbModeMetrics.range.includes("mile 8.2-11.1") ||
    Math.abs(trackerShortMobileMetrics.stationBottomGap) > 1 ||
    !trackerShortMobileMetrics.profileAboveStation ||
    !trackerShortMobileMetrics.metricContentFits ||
    trackerShortMobileMetrics.profileHeight < 180 ||
    trackerShortMobileMetrics.svgHeight < 140 ||
    Math.abs(trackerShortMobileMetrics.profileSvgBottomGap) > 1 ||
    trackerShortMobileMetrics.profileLineBottomGap < 14 ||
    trackerShortMobileMetrics.profileLineBottomGap > 36 ||
    trackerShortMobileMetrics.profileContentBottomGap < 12 ||
    trackerShortMobileMetrics.profileContentBottomGap > 36 ||
    trackerShortMobileMetrics.profilePathWidth < trackerShortMobileMetrics.profileSvgWidth * 0.95 ||
    trackerShortLandscapeMetrics.scrollHeight > trackerShortLandscapeMetrics.innerHeight + 1 ||
    Math.abs(trackerShortLandscapeMetrics.appHeight - trackerShortLandscapeMetrics.innerHeight) > 1 ||
    Math.abs(trackerShortLandscapeMetrics.stationBottomGap) > 1 ||
    !trackerShortLandscapeMetrics.profileAboveStation ||
    !trackerShortLandscapeMetrics.stationWithinApp ||
    trackerShortLandscapeMetrics.profileHeight < 80 ||
    trackerShortLandscapeMetrics.svgHeight < 50 ||
    Math.abs(trackerShortLandscapeMetrics.profileSvgBottomGap) > 1 ||
    trackerShortLandscapeMetrics.profileLineBottomGap < 10 ||
    trackerShortLandscapeMetrics.profileLineBottomGap > 28 ||
    trackerShortLandscapeMetrics.profileContentBottomGap < 8 ||
    trackerShortLandscapeMetrics.profileContentBottomGap > 24 ||
    trackerBottomSweep.some(bottomSweepHasFailure) ||
    trackerWebkitBottomSweep.some(bottomSweepHasFailure) ||
    trackerMetrics.scrollWidth > trackerMetrics.innerWidth + 1 ||
    trackerMetrics.scrollHeight > trackerMetrics.innerHeight + 1
  ) {
    process.exitCode = 1;
  }
})();
