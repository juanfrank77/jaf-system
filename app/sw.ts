import { precacheAndRoute } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, NetworkFirst } from "workbox-strategies"

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// Field update route — NetworkFirst so online updates win, falls back to cache
registerRoute(
	({ url }) =>
		url.pathname.startsWith("/docs/") && url.pathname.endsWith("/field"),
	new NetworkFirst({ cacheName: "field-update-v1" }),
)

// Static assets — cache first
registerRoute(
	({ request }) =>
		request.destination === "style" || request.destination === "script",
	new CacheFirst({ cacheName: "static-v1" }),
)
