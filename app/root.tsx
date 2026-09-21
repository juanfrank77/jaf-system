import { useTranslation } from "react-i18next"
import {
	data,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useRouteLoaderData,
} from "react-router"
import { useChangeLanguage } from "remix-i18next/react"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { SyncManager } from "~/components/sync-manager"
import type { Route } from "./+types/root"
import "./app.css"
import i18next, { lngCookie } from "./localization/i18n.server"

export const handle = {
	i18n: "common",
}

export const meta: Route.MetaFunction = () => [{ title: "JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const lang = await i18next.getLocale(request)
	const url = new URL(request.url)
	const requestedLang = url.searchParams.get("lng")

	if (requestedLang) {
		return data(
			{ lang },
			{ headers: { "Set-Cookie": await lngCookie.serialize(lang) } },
		)
	}

	return { lang }
}

export function Layout({ children }: { children: React.ReactNode }) {
	const { i18n } = useTranslation()
	// Theme preference only exists on the authenticated app shell's loader
	// data — this keeps the sign-in page pinned to the default light theme.
	const appData = useRouteLoaderData<{ theme?: "light" | "dark" }>(
		"routes/_app",
	)
	const dark = appData?.theme === "dark"
	return (
		<html
			lang={i18n.language}
			dir={i18n.dir()}
			className={dark ? "dark" : undefined}
		>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	)
}

export default function App({ loaderData }: Route.ComponentProps) {
	useChangeLanguage(loaderData.lang)
	return (
		<>
			<SyncManager />
			<Outlet />
		</>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
