import { ComputerIcon, Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	applyTheme,
	nextTheme,
	readStoredTheme,
	type ThemePreference,
	writeStoredTheme,
} from "~/lib/theme"

const ICON = { system: ComputerIcon, light: Sun01Icon, dark: Moon02Icon }
const LABEL_KEY = {
	system: "app_shell.theme.system",
	light: "app_shell.theme.light",
	dark: "app_shell.theme.dark",
} as const

export function ThemeToggle() {
	const { t } = useTranslation()
	// null until mounted: the head init script already applied the stored theme,
	// so we must not re-apply "system" on the first render.
	const [preference, setPreference] = useState<ThemePreference | null>(null)

	useEffect(() => {
		setPreference(readStoredTheme())
	}, [])

	useEffect(() => {
		if (preference === null) return
		applyTheme(preference)
		if (preference !== "system") return
		const query = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = () => applyTheme("system")
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [preference])

	const current = preference ?? "system"
	return (
		<button
			type="button"
			aria-label={`${t("app_shell.theme.label")}: ${t(LABEL_KEY[current])}`}
			onClick={() => {
				const next = nextTheme(current)
				writeStoredTheme(next)
				setPreference(next)
			}}
			className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
		>
			<HugeiconsIcon icon={ICON[current]} strokeWidth={2} className="size-5" />
		</button>
	)
}
