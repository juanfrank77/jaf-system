import { Moon02Icon, Sun01Icon } from "@hugeicons/core-free-icons"
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

export function ThemeToggle() {
	const { t } = useTranslation()
	// null until mounted: the head init script already applied the stored theme,
	// so we must not re-apply the default on the first render.
	const [preference, setPreference] = useState<ThemePreference | null>(null)

	useEffect(() => {
		setPreference(readStoredTheme())
	}, [])

	useEffect(() => {
		if (preference === null) return
		applyTheme(preference)
	}, [preference])

	const current = preference ?? "light"
	// The icon and label describe the action a click performs.
	const isDark = current === "dark"
	return (
		<button
			type="button"
			aria-label={t(
				isDark
					? "app_shell.theme.switch_to_light"
					: "app_shell.theme.switch_to_dark",
			)}
			onClick={() => {
				const next = nextTheme(current)
				writeStoredTheme(next)
				setPreference(next)
			}}
			className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
		>
			<HugeiconsIcon
				icon={isDark ? Sun01Icon : Moon02Icon}
				strokeWidth={2}
				className="size-5"
			/>
		</button>
	)
}
