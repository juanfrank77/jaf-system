import { precacheAndRoute } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, NetworkOnly } from "workbox-strategies"

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// Authenticated field-update pages must never be served from cache. NetworkOnly
// always hits the network, so a logged-in user is never shown stale HTML out in
// the field. Scoped to document requests so the page's JS/CSS still cache.
registerRoute(
	({ url, request }) =>
		request.destination === "document" &&
		url.pathname.startsWith("/docs/") &&
		url.pathname.endsWith("/field"),
	new NetworkOnly(),
)

// Static assets — cache first
registerRoute(
	({ request }) =>
		request.destination === "style" || request.destination === "script",
	new CacheFirst({ cacheName: "static-v1" }),
)
