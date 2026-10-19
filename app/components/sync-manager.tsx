import { useEffect } from "react"
import { useOnline } from "~/hooks/use-online"
import { syncCompletionActions } from "~/lib/installer-completion-sync"
import { getQueuedActions } from "~/lib/offline-store"

/** Replays the installer's queued completions once the device is back online. */
export function SyncManager() {
	const online = useOnline()

	useEffect(() => {
		if (!online || typeof window === "undefined") return
		getQueuedActions()
			.then((actions) => (actions.length > 0 ? syncCompletionActions() : null))
			.catch(() => {})
	}, [online])

	return null
}
