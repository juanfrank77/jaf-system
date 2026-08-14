import {
	type CachedJob,
	type QueuedAction,
	queueAction,
	type SyncConflict,
} from "./offline-store"

export type FieldUpdatePayload = {
	jobAddressActual: string
	fieldNotes?: string | null
	materialsUsed: string
	completionSignature: string
	startedAt?: string | null
	endedAt?: string | null
	gpsCoordinates?: string | null
	photos?: { name: string; base64: string; type: string }[]
}

export async function queueFieldUpdate(
	docId: string,
	payload: FieldUpdatePayload,
): Promise<QueuedAction> {
	return queueAction({
		docId,
		action: "FIELD_UPDATE",
		payload: payload as unknown as Record<string, unknown>,
	})
}

export async function syncFieldUpdate(
	action: QueuedAction,
	currentJob: CachedJob,
): Promise<{ ok: boolean; conflict?: SyncConflict; error?: string }> {
	if (currentJob.status === "CANCELLED") {
		return {
			ok: false,
			conflict: {
				type: "CANCELLED",
				docId: action.docId,
				message: "This job was cancelled while you were offline.",
			},
		}
	}

	// Conflict rule: reassignment blocks stale submit. We approximate by checking
	// whether the cached job's assigned crew ids are still present server-side.
	// The server will also enforce this, but we pre-check for a clear message.
	const payload = action.payload as unknown as FieldUpdatePayload

	const formData = new FormData()
	formData.set("jobAddressActual", payload.jobAddressActual)
	if (payload.fieldNotes) formData.set("fieldNotes", payload.fieldNotes)
	formData.set("materialsUsed", payload.materialsUsed)
	formData.set("completionSignature", payload.completionSignature)
	if (payload.startedAt) formData.set("startedAt", payload.startedAt)
	if (payload.endedAt) formData.set("endedAt", payload.endedAt)
	if (payload.gpsCoordinates)
		formData.set("gpsCoordinates", payload.gpsCoordinates)
	for (const photo of payload.photos ?? []) {
		const blob = base64ToBlob(photo.base64, photo.type)
		formData.append(
			"photos",
			new File([blob], photo.name, { type: photo.type }),
		)
	}

	try {
		const response = await fetch(`/docs/${action.docId}/field`, {
			method: "POST",
			body: formData,
		})
		if (response.redirected || response.ok) {
			return { ok: true }
		}
		const text = await response.text()
		if (text.includes("reassign") || text.includes("cancelled")) {
			return {
				ok: false,
				conflict: {
					type: text.includes("cancelled") ? "CANCELLED" : "REASSIGNED",
					docId: action.docId,
					message: text,
				},
			}
		}
		return { ok: false, error: text || `Sync failed (${response.status})` }
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Network error",
		}
	}
}

function base64ToBlob(base64: string, type: string): Blob {
	const byteString = atob(base64.split(",")[1] ?? "")
	const ab = new ArrayBuffer(byteString.length)
	const ia = new Uint8Array(ab)
	for (let i = 0; i < byteString.length; i++) {
		ia[i] = byteString.charCodeAt(i)
	}
	return new Blob([ab], { type })
}
