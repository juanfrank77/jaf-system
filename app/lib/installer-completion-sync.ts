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

export async function syncOne(
	a: QueuedAction,
): Promise<{ ok: boolean; conflict?: SyncConflict; error?: string }> {
	const fd = new FormData()
	for (const [k, v] of Object.entries(a.payload))
		fd.set(k, typeof v === "string" ? v : JSON.stringify(v))
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
