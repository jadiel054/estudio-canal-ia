const CACHE = "estudio-canal-ia-v2";
const LEGACY_CACHES = new Set(["estudio-canal-ia-v1"]);
const OFFLINE_PAGE = "/offline.html";
const ICON_PATHS = new Set(["/estudio-mark.svg", "/favicon.ico", "/favicon.svg"]);
const HASHED_ASSET = /^\/assets\/.+[-._][A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|png|jpg|jpeg|webp|svg)$/i;

function isApi(requestUrl) {
  return requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith("/api/");
}

function isCacheableAsset(requestUrl) {
  return requestUrl.origin === self.location.origin && (HASHED_ASSET.test(requestUrl.pathname) || ICON_PATHS.has(requestUrl.pathname));
}

self.addEventListener("install", event => {
  event.waitUntil(Promise.all([self.skipWaiting(), caches.open(CACHE).then(cache => cache.add(OFFLINE_PAGE))]));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE || LEGACY_CACHES.has(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  // API responses can contain authentication and Neon state. Never intercept or cache them.
  if (isApi(requestUrl)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_PAGE)),
    );
    return;
  }

  if (!isCacheableAsset(requestUrl)) return;

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, response.clone())));
      }
      return response;
    })),
  );
});
