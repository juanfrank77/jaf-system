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
		route("admin/settings", "routes/_app.admin.settings.tsx"),
		route("admin/docs/:id", "routes/_app.admin.docs.$id.tsx"),
		route("docs/new", "routes/_app.docs.new.tsx"),
		route("docs/:id", "routes/_app.docs.$id.tsx"),
		route("docs/:id/edit", "routes/_app.docs.$id_.edit.tsx"),
		route("docs/:id/prep", "routes/_app.docs.$id_.prep.tsx"),
		route("docs/:id/sign", "routes/_app.docs.$id_.sign.tsx"),
		route("docs/:id/field", "routes/_app.docs.$id_.field.tsx"),
		route("docs/:id/review", "routes/_app.docs.$id_.review.tsx"),
		route("docs/:id/lc", "routes/_app.docs.$id_.lc.tsx"),
		route("docs/:id/audit-package", "routes/_app.docs.$id_.audit-package.tsx"),
		route("finance/receivables", "routes/_app.finance.receivables.tsx"),
	]),
	route("files/*", "routes/files.$.tsx"),
	route("api/auth/*", "routes/api.auth.$.tsx"),
	route("sign-out", "routes/action.sign-out.tsx"),
	route("notifications/:id/read", "routes/action.notifications.$id.read.tsx"),
	route(
		"notifications/mark-all-read",
		"routes/action.notifications.mark-all-read.tsx",
	),
	route("*", "routes/$.tsx"),
] satisfies RouteConfig
