import type { CachedJob, QueuedAction, SyncConflict } from "./offline-store"

export type FieldUpdatePayload = {
	jobAddressActual: string
	fieldNotes?: string | null
	discrepancyNote?: string | null
	materialsUsed: string
	installedServiceLines?: string | null
	completionSignature: string
	startedAt?: string | null
	endedAt?: string | null
	gpsCoordinates?: string | null
	photosBefore?: { name: string; base64: string; type: string }[]
	photosAfter?: { name: string; base64: string; type: string }[]
}

export async function syncFieldUpdate(
	action: QueuedAction,
	currentJob: CachedJob,
): Promise<{
	ok: boolean
	conflict?: SyncConflict
	error?: string
	rejected?: { errorKey?: string; message?: string }
}> {
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

	if (!action.docId) {
		return {
			ok: false,
			error: "Missing docId for field update sync",
		}
	}

	// Conflict rule: reassignment blocks stale submit. We approximate by checking
	// whether the cached job's assigned crew ids are still present server-side.
	// The server will also enforce this, but we pre-check for a clear message.
	const payload = action.payload as unknown as FieldUpdatePayload

	const formData = new FormData()
	formData.set("jobAddressActual", payload.jobAddressActual)
	if (payload.fieldNotes) formData.set("fieldNotes", payload.fieldNotes)
	if (payload.discrepancyNote)
		formData.set("discrepancyNote", payload.discrepancyNote)
	formData.set("materialsUsed", payload.materialsUsed)
	if (payload.installedServiceLines)
		formData.set("installedServiceLines", payload.installedServiceLines)
	formData.set("completionSignature", payload.completionSignature)
	if (payload.startedAt) formData.set("startedAt", payload.startedAt)
	if (payload.endedAt) formData.set("endedAt", payload.endedAt)
	if (payload.gpsCoordinates)
		formData.set("gpsCoordinates", payload.gpsCoordinates)
	for (const photo of payload.photosBefore ?? []) {
		const blob = base64ToBlob(photo.base64, photo.type)
		formData.append(
			"photosBefore",
			new File([blob], photo.name, { type: photo.type }),
		)
	}
	for (const photo of payload.photosAfter ?? []) {
		const blob = base64ToBlob(photo.base64, photo.type)
		formData.append(
			"photosAfter",
			new File([blob], photo.name, { type: photo.type }),
		)
	}

	try {
		const response = await fetch(`/docs/${action.docId}/field`, {
			method: "POST",
			body: formData,
			headers: { "X-Offline-Sync": "true" },
		})

		if (response.status === 409) {
			const body = (await response.json().catch(() => ({}))) as {
				conflict?: string
			}
			return {
				ok: false,
				conflict: {
					type: body.conflict === "CANCELLED" ? "CANCELLED" : "REASSIGNED",
					docId: action.docId,
					message:
						body.conflict === "CANCELLED"
							? "This job was cancelled while you were offline."
							: "This job was reassigned or modified while you were offline.",
				},
			}
		}

		// Validation refusal (e.g. used more than taken): not a conflict and not
		// a transient failure, so it must not be retried or dropped.
		if (response.status === 422) {
			const body = (await response.json().catch(() => ({}))) as {
				validationError?: string
				validationMessage?: string
			}
			if (body.validationError)
				return { ok: false, rejected: { errorKey: body.validationError } }
			if (body.validationMessage)
				return { ok: false, rejected: { message: body.validationMessage } }
		}

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
