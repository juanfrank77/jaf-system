import { useEffect } from "react"
import { useOnline } from "~/hooks/use-online"
import { syncFieldUpdate } from "~/lib/field-sync"
import {
	type CachedJob,
	getCachedJob,
	getQueuedActions,
	syncQueuedActions,
} from "~/lib/offline-store"

export function SyncManager() {
	const online = useOnline()

	useEffect(() => {
		if (!online || typeof window === "undefined") return

		async function runSync() {
			await syncQueuedActions({
				async syncOne(action) {
					const cached = await getCachedJob(action.docId)
					if (!cached) {
						// We don't have a cached copy to check conflicts; attempt anyway.
						return syncFieldUpdate(action, {
							id: action.docId,
							controlNumber: "",
							status: "SIGNED",
							jobType: "",
							jobAddressEstimated: "",
							assignedCrewIds: [],
							updatedAt: new Date().toISOString(),
						} satisfies CachedJob)
					}
					return syncFieldUpdate(action, cached)
				},
			})
		}

		runSync()
	}, [online])

	return null
}
