/**
 * Service worker: precache shell, quiz JSON, and all referenced images.
 * Paths are resolved relative to this script so the app works on GitHub Pages
 * project sites (e.g. /repo-name/) as well as at domain root.
 * Bump CACHE_VERSION after changing cached assets.
 */
const CACHE_VERSION = "grundkenntnistest-v41";

/** Base URL of the directory containing sw.js (trailing slash). */
const BASE = new URL("./", self.location.href);

function abs(relPath) {
  const p = String(relPath || "").replace(/^\/+/, "");
  return new URL(p, BASE).href;
}

const SHELL = [
  "index.html",
  "uebersicht.html",
  "uebersicht.js",
  "fragenkatalog.html",
  "fragenkatalog.js",
  "styles.css",
  "app.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "grundkenntnistest_kanton_zuerich.json",
  "sources/grundkenntnistest_kanton_zuerich.pdf",
  "sources/broschuere_einbuergerung_grundkenntnistest.pdf",
];

function walkStrings(obj, fn) {
  if (obj == null) return;
  if (typeof obj === "string") {
    fn(obj);
    return;
  }
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((x) => walkStrings(x, fn));
    return;
  }
  for (const v of Object.values(obj)) walkStrings(v, fn);
}

function imageUrlsFromQuiz(data) {
  const urls = new Set();
  walkStrings(data, (s) => {
    if (typeof s !== "string") return;
    if (s.startsWith("images/") || s.startsWith("question-images/")) {
      urls.add(abs(s));
    }
  });
  return [...urls];
}

async function cacheBatched(cache, urls) {
  const chunk = 30;
  for (let i = 0; i < urls.length; i += chunk) {
    const part = urls.slice(i, i + chunk);
    await Promise.all(
      part.map((url) =>
        cache.add(url).catch(() => {
          console.warn("[sw] skip cache", url);
        })
      )
    );
  }
}

async function precacheAll() {
  const cache = await caches.open(CACHE_VERSION);
  for (const rel of SHELL) {
    await cache.add(abs(rel)).catch((e) => {
      console.warn("[sw] shell miss", rel, e);
    });
  }

  const jsonRes = await caches.match(abs("grundkenntnistest_kanton_zuerich.json"));
  if (!jsonRes) return;
  let data;
  try {
    data = await jsonRes.json();
  } catch {
    return;
  }
  const imgs = imageUrlsFromQuiz(data);
  await cacheBatched(cache, imgs);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => (k !== CACHE_VERSION ? caches.delete(k) : null))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          return caches.match(abs("index.html")).then((r) => r || Response.error());
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((c) => {
              c.put(request, copy).catch(() => {});
            });
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
