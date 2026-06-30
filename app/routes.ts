import {
	index,
	layout,
	type RouteConfig,
	route,
} from "@react-router/dev/routes"

export default [
	index("routes/home.tsx"),
	layout("routes/_auth.tsx", [route("login", "routes/_auth.login.tsx")]),
	layout("routes/_app.tsx", [
		route("dashboard", "routes/_app.dashboard.tsx"),
		route("admin/catalog", "routes/_app.admin.catalog.tsx"),
		// Tasks 6-15 routes will be added later as those tasks are implemented
	]),
	route("api/auth/*", "routes/api.auth.$.tsx"),
	route("*", "routes/$.tsx"),
] satisfies RouteConfig
