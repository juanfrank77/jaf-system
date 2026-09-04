import type { QueuedAction, SyncConflict } from "./offline-store"

type InstallerRestockPayload = {
	warehouseId: string
	items: { serviceCodeId: string; qty: number }[]
}

type InstallerInstallPayload = {
	claroJobReference: string
	serviceType: string
	date: string
	items: { serviceCodeId: string; qty: number }[]
	notes?: string | null
}

export async function queueInstallerRestock(
	payload: InstallerRestockPayload,
): Promise<void> {
	const { queueAction } = await import("./offline-store")
	await queueAction({
		docId: undefined,
		action: "INSTALLER_RESTOCK",
		payload: payload as unknown as Record<string, unknown>,
	})
}

export async function queueInstallerInstall(
	payload: InstallerInstallPayload,
): Promise<void> {
	const { queueAction } = await import("./offline-store")
	await queueAction({
		docId: undefined,
		action: "INSTALLER_INSTALL",
		payload: payload as unknown as Record<string, unknown>,
	})
}

export async function syncInstallerRestock(
	action: QueuedAction,
): Promise<{ ok: boolean; conflict?: SyncConflict; error?: string }> {
	try {
		const payload = action.payload as unknown as InstallerRestockPayload
		const formData = new FormData()
		formData.set("warehouseId", payload.warehouseId)
		formData.set("items", JSON.stringify(payload.items))

		const response = await fetch("/installer/restock", {
			method: "POST",
			body: formData,
			headers: { "X-Offline-Sync": "true" },
		})

		if (response.status === 409) {
			const body = (await response.json().catch(() => ({}))) as {
				conflict?: string
			}
			const conflictType = (body.conflict ?? "INVALID_STATE") as
				| "REASSIGNED"
				| "CANCELLED"
				| "VAN_INACTIVE"
				| "WAREHOUSE_INACTIVE"
				| "INVALID_STATE"
			return {
				ok: false,
				conflict: {
					type: conflictType,
					message:
						conflictType === "VAN_INACTIVE"
							? "Your van is no longer active. Please contact your supervisor."
							: conflictType === "WAREHOUSE_INACTIVE"
								? "The selected warehouse is no longer available."
								: "This action could not be completed because the installer state changed while you were offline.",
				},
			}
		}

		if (response.redirected || response.ok) {
			return { ok: true }
		}

		const text = await response.text()
		return { ok: false, error: text || `Sync failed (${response.status})` }
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Network error",
		}
	}
}

export async function syncInstallerInstall(
	action: QueuedAction,
): Promise<{ ok: boolean; conflict?: SyncConflict; error?: string }> {
	try {
		const payload = action.payload as unknown as InstallerInstallPayload
		const formData = new FormData()
		formData.set("claroJobReference", payload.claroJobReference)
		formData.set("serviceType", payload.serviceType)
		formData.set("date", payload.date)
		formData.set("items", JSON.stringify(payload.items))
		if (payload.notes) formData.set("notes", payload.notes)

		const response = await fetch("/installer/install", {
			method: "POST",
			body: formData,
			headers: { "X-Offline-Sync": "true" },
		})

		if (response.status === 409) {
			const body = (await response.json().catch(() => ({}))) as {
				conflict?: string
			}
			const conflictType = (body.conflict ?? "INVALID_STATE") as
				| "REASSIGNED"
				| "CANCELLED"
				| "VAN_INACTIVE"
				| "WAREHOUSE_INACTIVE"
				| "INVALID_STATE"
			return {
				ok: false,
				conflict: {
					type: conflictType,
					message:
						conflictType === "VAN_INACTIVE"
							? "Your van is no longer active. Please contact your supervisor."
							: "This action could not be completed because the installer state changed while you were offline.",
				},
			}
		}

		if (response.redirected || response.ok) {
			return { ok: true }
		}

		const text = await response.text()
		return { ok: false, error: text || `Sync failed (${response.status})` }
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Network error",
		}
	}
}

export async function syncInstallerActions(): Promise<{
	synced: number
	conflicts: SyncConflict[]
	errors: string[]
}> {
	const { syncQueuedActions } = await import("./offline-store")

	return syncQueuedActions({
		async syncOne(action) {
			if (action.action === "INSTALLER_RESTOCK") {
				return syncInstallerRestock(action)
			}
			if (action.action === "INSTALLER_INSTALL") {
				return syncInstallerInstall(action)
			}
			return { ok: false, error: `Unknown action: ${action.action}` }
		},
	})
}
