"use strict";

const CACHE_NAME = "canyons-100k-3c440d998719";
const RUNTIME_CACHE_NAME = "canyons-100k-runtime-3c440d998719";
const CORE_ASSETS = [
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
const EXTERNAL_ASSETS = [
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.css",
  "https://cdn.maptiler.com/maptiler-sdk-js/v3.0.1/maptiler-sdk.umd.min.js"
];

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
