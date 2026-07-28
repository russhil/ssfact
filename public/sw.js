/*
 * Change 36 Part 10 Part A — the service worker.
 *
 * ★ Degrade, don't die. This is the one part of Change 36 that can BREAK a working
 * factory if it is rushed, so every rule below exists because of something specific in
 * this app. Read the reasons before changing any of them.
 *
 * 1. HTML IS NETWORK-FIRST, ALWAYS.
 *    All 39 pages are `export const dynamic = "force-dynamic"`. Nothing here is
 *    statically renderable and every screen shows live stock and cut quantities. A
 *    cache-first document strategy would serve yesterday's numbers to someone standing at
 *    a cutting table. Cache is the fallback when the network is gone, never the default.
 *
 * 2. THE CACHE IS VERSIONED BY BUILD, AND OLD CACHES ARE PURGED ON ACTIVATE.
 *    Deploy rsyncs with --delete, so /_next/static/<buildId>/… from the previous build no
 *    longer exists on the box. A cached page referencing those chunks fails with "Failed
 *    to fetch dynamically imported module" — a white screen, not a graceful degrade.
 *
 * 3. NON-GET IS NEVER INTERCEPTED.
 *    Server actions are POSTs to the current URL carrying a `Next-Action: <id>` header,
 *    and that id changes every build. Replaying a captured action POST after a deploy
 *    would invoke the wrong action or none. The offline queue therefore stores DOMAIN
 *    INTENT (in IndexedDB, replayed through the normal action call) and never the
 *    request itself.
 *
 * 4. RSC PAYLOADS ARE NOT HTML.
 *    A client navigation fetches the same URL with `RSC: 1` and gets a flight stream, not
 *    a document. Those are left alone entirely — caching them is how you get a page that
 *    renders with one build's HTML and another build's data.
 */

const VERSION = "ssfact-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener("install", (event) => {
  // Take over immediately: a half-updated worker across tabs is worse than a hard swap.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Rule 2 — anything not belonging to this build goes.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

function isRSC(request) {
  return request.headers.get("RSC") === "1" || new URL(request.url).searchParams.has("_rsc");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Rule 3 — never touch a write.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Rule 4 — leave flight payloads to the framework.
  if (isRSC(request)) return;

  // Never cache the auth boundary or anything under /api.
  if (url.pathname.startsWith("/api") || url.pathname === "/login") return;

  // Immutable build assets: cache-first is safe precisely BECAUSE the path carries the
  // build id, so a new build asks for a different URL.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Rule 1 — documents are network-first, cache only as a lifeboat.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(SHELL);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          const hit = await cache.match(request);
          if (hit) {
            // Mark it so the banner can say the page is a cached copy.
            const headers = new Headers(hit.headers);
            headers.set("x-ssfact-offline", "1");
            return new Response(hit.body, { status: hit.status, headers });
          }
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style='font-family:system-ui;padding:2rem'><h1>Offline</h1>" +
              "<p>This page has not been opened on this device yet, so there is no copy to show.</p>",
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
  }
});
