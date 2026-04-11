#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("Playwright is not installed. Run `npm install`, then `npm run review`.");
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "dist", "canyons-100k-crew-guide.html");
const SCREENSHOT_DIR = path.join(ROOT, ".artifacts", "screenshots");

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

  await page.goto(`file://${OUTPUT}`, { waitUntil: "networkidle" });
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

  const metrics = await page.evaluate(() => {
    const overflow = [...document.querySelectorAll("body *")]
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
  await desktop.goto(`file://${OUTPUT}`, { waitUntil: "networkidle" });
  await desktop.screenshot({ path: path.join(SCREENSHOT_DIR, "desktop-overview.png"), fullPage: false });

  await browser.close();

  console.log(JSON.stringify(metrics, null, 2));
  if (metrics.overflow.length || metrics.tapTargets.length || metrics.tinyText.length) {
    process.exitCode = 1;
  }
})();
