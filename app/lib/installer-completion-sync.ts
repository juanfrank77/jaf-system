import {
	type QueuedAction,
	queueAction,
	type SyncConflict,
	syncQueuedActions,
} from "./offline-store"

export async function queueCompletion(
	payload: Record<string, unknown>,
): Promise<void> {
	await queueAction({
		docId: undefined,
		action: "INSTALLER_COMPLETION",
		payload,
	})
}

function base64ToFile(dataUrl: string, name: string, type: string): File {
	const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl
	const binary = atob(base64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
	return new File([bytes], name, { type })
}

export async function syncOne(a: QueuedAction): Promise<{
	ok: boolean
	conflict?: SyncConflict
	error?: string
	rejected?: { errorKey?: string; message?: string }
}> {
	const fd = new FormData()
	const { formPhotoBase64, formPhotoName, formPhotoType, ...rest } =
		a.payload as Record<string, unknown>
	for (const [k, v] of Object.entries(rest))
		fd.set(k, typeof v === "string" ? v : JSON.stringify(v))
	if (typeof formPhotoBase64 === "string" && formPhotoBase64) {
		fd.set(
			"formPhoto",
			base64ToFile(
				formPhotoBase64,
				typeof formPhotoName === "string" ? formPhotoName : "photo.jpg",
				typeof formPhotoType === "string" ? formPhotoType : "image/jpeg",
			),
		)
	}
	const res = await fetch("/installer/completion/new", {
		method: "POST",
		body: fd,
		headers: { "X-Offline-Sync": "true" },
	})
	if (res.status === 409) {
		const body = (await res.json().catch(() => ({}))) as { conflict?: string }
		return {
			ok: false,
			conflict: {
				type: (body.conflict ?? "INVALID_STATE") as SyncConflict["type"],
				message: "Installer state changed while offline.",
			},
		}
	}
	if (res.status === 422) {
		const body = (await res.json().catch(() => ({}))) as {
			validationError?: string
			validationMessage?: string
		}
		if (body.validationError)
			return { ok: false, rejected: { errorKey: body.validationError } }
		if (body.validationMessage)
			return { ok: false, rejected: { message: body.validationMessage } }
	}
	return res.ok || res.redirected
		? { ok: true }
		: { ok: false, error: `Sync failed (${res.status})` }
}

export async function syncCompletionActions() {
	return syncQueuedActions({
		syncOne: (a) =>
			a.action === "INSTALLER_COMPLETION"
				? syncOne(a)
				: Promise.resolve({ ok: false, error: "unknown" }),
	})
}
