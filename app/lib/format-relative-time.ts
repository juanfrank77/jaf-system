import type { TFunction } from "i18next"

export function formatRelativeTime(date: Date, t: TFunction) {
	const diffMs = Date.now() - date.getTime()
	const diffMinutes = Math.round(diffMs / 60000)
	if (diffMinutes < 1) return t("app_shell.notifications.time.just_now")
	if (diffMinutes < 60) {
		return t("app_shell.notifications.time.minutes_ago", {
			count: diffMinutes,
		})
	}
	const diffHours = Math.round(diffMinutes / 60)
	if (diffHours < 24) {
		return t("app_shell.notifications.time.hours_ago", { count: diffHours })
	}
	const diffDays = Math.round(diffHours / 24)
	return t("app_shell.notifications.time.days_ago", { count: diffDays })
}
