/* Prakriti HRMS — basic offline shell */
const CACHE = "ph-hrms-v1";
const SHELL = [
  "/portal/",
  "/portal/index.html",
  "/portal/manifest.json",
  "/portal/app.css",
  "/portal/app.js",
  "/portal/assets/logo.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.includes("/portal/")) return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        const copy = res.clone();
        if (req.url.includes("/portal/app.") || req.url.includes("/portal/assets/")) {
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
