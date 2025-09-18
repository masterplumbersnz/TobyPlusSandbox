const CACHE_NAME = "tobyplus-cache-v1";

// ✅ Only include files you *know* exist in your repo
const ASSETS_TO_CACHE = [
  "/",                // root
  "/bot.html",        // chatbot UI
  "/chatbot.js",      // chatbot logic
  "/manifest.json",
  "/icons/icon-192.png",
  "icons/icon-512.png"
  // Add your actual icons if they exist
  // "/icons/icon-192.png",
  // "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  console.log("📥 Service Worker installing…");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("⚠️ Skipped caching:", url, err.message);
          })
        )
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  console.log("✅ Service Worker activated");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
});

// ✅ Network-first, fallback to cache
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
