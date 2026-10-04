import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useOnline } from "~/hooks/use-online"
import { getQueuedActions } from "~/lib/offline-store"

export function OfflineIndicator() {
	const online = useOnline()
	const { t } = useTranslation()
	const [pendingCount, setPendingCount] = useState(0)

	useEffect(() => {
		if (typeof window === "undefined") return
		let mounted = true
		const refresh = async () => {
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
			className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full ${
				online
					? "bg-status-warn-soft text-status-warn"
					: "bg-status-danger-soft text-status-danger"
			}`}
			role="status"
			aria-live="polite"
		>
			<span
				className={`size-2 rounded-full ${online ? "bg-status-warn" : "bg-status-danger-solid"}`}
			/>
			{online
				? t("offline_indicator.sync_pending", { count: pendingCount })
				: t("offline_indicator.offline")}
		</div>
	)
}
