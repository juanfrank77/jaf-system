import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher, useLocation, useNavigate } from "react-router"
import { useOnline } from "~/hooks/use-online"
import type { Theme } from "~/lib/theme.server"
import { type Language, supportedLanguages } from "~/localization/resource"

const LANGUAGE_LABELS: Record<Language, string> = {
	en: "EN",
	es: "ES",
}

export function DsThemeToggle({ theme }: { theme: Theme }) {
	const { t } = useTranslation()
	const fetcher = useFetcher<{ theme?: Theme; errorKey?: string }>()
	const pendingTheme = fetcher.formData?.get("theme")
	const appliedTheme: Theme =
		typeof pendingTheme === "string"
			? pendingTheme === "dark"
				? "dark"
				: "light"
			: fetcher.data?.theme && !fetcher.data.errorKey
				? fetcher.data.theme
				: theme
	const next: Theme = appliedTheme === "dark" ? "light" : "dark"

	useEffect(() => {
		if (fetcher.state === "idle" && fetcher.data?.errorKey) {
			document.documentElement.classList.toggle("dark", theme === "dark")
			return
		}
		document.documentElement.classList.toggle("dark", appliedTheme === "dark")
	}, [appliedTheme, fetcher.data?.errorKey, fetcher.state, theme])

	return (
		<button
			type="button"
			className="jaf-toggle"
			style={{ minHeight: 44 }}
			aria-pressed={appliedTheme === "dark"}
			onClick={() =>
				fetcher.submit(
					{ intent: "updateTheme", theme: next },
					{ method: "post", action: "/account" },
				)
			}
		>
			{appliedTheme === "dark"
				? t("ds.shell.theme_light")
				: t("ds.shell.theme_dark")}
		</button>
	)
}

export function DsLanguageToggle() {
	const { t, i18n } = useTranslation()
	const navigate = useNavigate()
	const location = useLocation()

	return (
		// biome-ignore lint/a11y/useSemanticElements: fieldset adds unwanted default border in the rail foot
		<div
			className="jaf-toggles"
			role="group"
			aria-label={t("language.switcher_label")}
		>
			{supportedLanguages.map((language) => {
				const active = i18n.language === language
				return (
					<button
						key={language}
						type="button"
						className="jaf-toggle"
						style={{ minHeight: 44 }}
						aria-pressed={active}
						lang={language}
						onClick={() => {
							i18n.changeLanguage(language)
							navigate(`${location.pathname}?lng=${language}`, {
								replace: true,
							})
						}}
					>
						{LANGUAGE_LABELS[language]}
					</button>
				)
			})}
		</div>
	)
}

export function DsOfflineIndicator() {
	const online = useOnline()
	const { t } = useTranslation()
	const [pendingCount, setPendingCount] = useState(0)

	useEffect(() => {
		if (typeof window === "undefined") return
		let mounted = true
		const refresh = async () => {
			const { getQueuedActions } = await import("~/lib/offline-store")
			const actions = await getQueuedActions()
			if (mounted) setPendingCount(actions.length)
		}
		refresh()
		if (online) refresh()
		const interval = setInterval(refresh, 5_000)
		window.addEventListener("focus", refresh)
		return () => {
			mounted = false
			clearInterval(interval)
			window.removeEventListener("focus", refresh)
		}
	}, [online])

	if (online && pendingCount === 0) return null

	return (
		<div
			className="jaf-note jaf-neutral"
			role="status"
			aria-live="polite"
			style={{ padding: "6px 10px", fontSize: 12 }}
		>
			{online
				? t("offline_indicator.sync_pending", { count: pendingCount })
				: t("offline_indicator.offline")}
		</div>
	)
}
