// service-worker.js — PWA offline cache (Vite build: dynamic cache strategy)
// Since Vite output has hashed filenames, we cache dynamically on first visit.
const CACHE_NAME = 'meditation-timer-v12';

self.addEventListener('install', (e) => {
    self.skipWaiting();
    // Pre-cache the app shell (known static entries)
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            cache.addAll(['./', './index.html', './manifest.json'])
        )
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) =>
                Promise.all(
                    keys.map((key) => {
                        if (key !== CACHE_NAME) {
                            console.log('[SW] Clearing old cache', key);
                            return caches.delete(key);
                        }
                    })
                )
            ),
        ])
    );
});

// Cache-first for same-origin, network-only for external (fonts, CDN)
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Only cache same-origin requests
    if (url.origin !== location.origin) {
        return;
    }

    e.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(e.request);
            if (cached) return cached;

            const response = await fetch(e.request);
            if (response.ok) {
                cache.put(e.request, response.clone());
            }
            return response;
        })
    );
});
