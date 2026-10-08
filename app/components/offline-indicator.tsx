import type { TFunction } from "i18next"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useOnline } from "~/hooks/use-online"
import { getQueuedActions } from "~/lib/offline-store"
import { cn } from "~/lib/utils"

type ConnectionState = { online: boolean; pendingCount: number }

type DotState = "synced" | "pending" | "offline"

const dotState = ({ online, pendingCount }: ConnectionState): DotState =>
	!online ? "offline" : pendingCount > 0 ? "pending" : "synced"

/** Polls the offline queue. Call once (AppShell) and pass the result down. */
export function useConnectionState(): ConnectionState {
	const online = useOnline()
	const [pendingCount, setPendingCount] = useState(0)

	useEffect(() => {
		if (typeof window === "undefined") return
		let mounted = true
		const refresh = async () => {
			const actions = await getQueuedActions()
			// A refused update is waiting on the crew, not on the network.
			if (mounted) setPendingCount(actions.filter((a) => !a.rejection).length)
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

	return { online, pendingCount }
}

const TONE: Record<DotState, string> = {
	synced: "bg-status-ok-soft text-status-ok",
	pending: "bg-status-warn-soft text-status-warn",
	offline: "bg-status-warn-soft text-status-warn",
}

const DOT: Record<DotState, string> = {
	synced: "bg-status-ok",
	pending: "bg-status-warn",
	offline: "bg-status-danger-solid",
}

const connectionText = (state: ConnectionState, t: TFunction): string => {
	const kind = dotState(state)
	return kind === "synced"
		? t("offline_indicator.synced")
		: kind === "pending"
			? t("offline_indicator.sync_pending", { count: state.pendingCount })
			: state.pendingCount > 0
				? t("offline_indicator.offline_pending", {
						count: state.pendingCount,
					})
				: t("offline_indicator.offline")
}

/** Always-visible bar under the header: the crew needs to see "offline" and
 * "N updates waiting" most when the signal is bad. */
export function ConnectionBar({ state }: { state: ConnectionState }) {
	const { t } = useTranslation()
	const kind = dotState(state)
	const text = connectionText(state, t)
	return (
		<div
			role="status"
			aria-live="polite"
			data-state={kind}
			className={cn(
				"flex items-center gap-2 px-4 py-1.5 text-xs font-medium",
				TONE[kind],
			)}
		>
			<span className={cn("size-2 shrink-0 rounded-full", DOT[kind])} />
			<span className="min-w-0 truncate" title={text}>
				{text}
			</span>
		</div>
	)
}

/** The only connection cue left in the header. The bar carries the words. */
export function ConnectionDot({ state }: { state: ConnectionState }) {
	const { t } = useTranslation()
	const kind = dotState(state)
	return (
		<span
			title={connectionText(state, t)}
			data-slot="connection-dot"
			data-state={kind}
			aria-hidden="true"
			className={cn("size-2 shrink-0 rounded-full", DOT[kind])}
		/>
	)
}
