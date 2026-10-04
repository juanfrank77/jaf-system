import { useTranslation } from "react-i18next"
import {
	data,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
} from "react-router"
import { useChangeLanguage } from "remix-i18next/react"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { SyncManager } from "~/components/sync-manager"
import type { Route } from "./+types/root"
import "./app.css"
import { themeInitScript } from "./lib/theme"
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
	return (
		<html lang={i18n.language} dir={i18n.dir()} suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, app-owned constant (no user input) */}
				<script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
