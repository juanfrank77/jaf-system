import { precacheAndRoute } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst, NetworkFirst } from "workbox-strategies"

declare let self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

// Dashboard and document list/detail pages: try network first, fallback to cache.
// This keeps the app usable when offline.
registerRoute(
	({ url, request }) =>
		request.destination === "document" &&
		(url.pathname === "/dashboard" || url.pathname.startsWith("/docs")),
	new NetworkFirst({
		cacheName: "documents-v1",
		networkTimeoutSeconds: 5,
	}),
)

// Static assets — cache first
registerRoute(
	({ request }) =>
		request.destination === "style" || request.destination === "script",
	new CacheFirst({ cacheName: "static-v1" }),
)

// API responses (e.g. current job state for conflict checks) — network first with short timeout
registerRoute(
	({ url }) =>
		url.pathname.startsWith("/api/") || url.pathname.startsWith("/docs/"),
	new NetworkFirst({
		cacheName: "api-v1",
		networkTimeoutSeconds: 3,
	}),
)
