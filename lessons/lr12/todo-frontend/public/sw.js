"use strict";
(() => {
  // src/sw.ts
  var sw = self;
  var CACHE_NAME = "app-shell-v1";
  var APP_SHELL = ["/", "/index.html", "/offline.html"];
  sw.addEventListener("install", (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  });
  sw.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
    );
  });
  sw.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }
        const offlinePage = await caches.match("/offline.html");
        return offlinePage ?? Response.error();
      })
    );
  });
})();
