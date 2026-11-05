// Pulse's service worker. Pulse is live data, so nothing is cached except a page to show when the
// phone has no connection; every request still goes to the network, and new releases arrive as usual.
// The host serves offline.html at /offline; a browser refuses a redirected page here, so use that address.
const CACHE = "pulse-offline-3";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/offline")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
  }
});
