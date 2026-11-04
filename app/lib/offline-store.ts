const DB_NAME = "jaf-operations"
const DB_VERSION = 1
const QUEUE_STORE = "queue"

export type QueuedAction = {
	id: string
	docId?: string
	action: "INSTALLER_COMPLETION"
	payload: Record<string, unknown>
	createdAt: string
	/** Set when the server refused the action on validation. It stays in the
	 * queue but is never retried; the installer has to fix it and send again. */
	rejection?: { errorKey?: string; message?: string; at: string }
}

let dbPromise: Promise<IDBDatabase> | null = null

export function resetDbPromise(): void {
	dbPromise = null
}

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise
	dbPromise = new Promise((resolve, reject) => {
		if (typeof window === "undefined" || !("indexedDB" in window)) {
			reject(new Error("IndexedDB not available"))
			return
		}
		const request = indexedDB.open(DB_NAME, DB_VERSION)
		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve(request.result)
		request.onupgradeneeded = () => {
			const db = request.result
			if (!db.objectStoreNames.contains(QUEUE_STORE)) {
				db.createObjectStore(QUEUE_STORE, { keyPath: "id" })
			}
		}
	})
	return dbPromise
}

function withStore<_T>(
	storeName: string,
	mode: IDBTransactionMode,
): Promise<IDBObjectStore> {
	return openDb().then(
		(db) =>
			new Promise((resolve, reject) => {
				const tx = db.transaction(storeName, mode)
				tx.onerror = () => reject(tx.error)
				resolve(tx.objectStore(storeName))
			}),
	)
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve(request.result)
	})
}

export async function queueAction(
	action: Omit<QueuedAction, "id" | "createdAt">,
): Promise<QueuedAction> {
	const fullAction: QueuedAction = {
		...action,
		id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
		createdAt: new Date().toISOString(),
	}
	const store = await withStore(QUEUE_STORE, "readwrite")
	await requestToPromise(store.put(fullAction))
	return fullAction
}

export async function getQueuedActions(): Promise<QueuedAction[]> {
	const store = await withStore(QUEUE_STORE, "readonly")
	return (await requestToPromise(store.getAll())) as QueuedAction[]
}

export async function removeQueuedAction(id: string): Promise<void> {
	const store = await withStore(QUEUE_STORE, "readwrite")
	await requestToPromise(store.delete(id))
}

/**
 * Crews no longer submit the Field step (the supervisor enters it), so a
 * crew FIELD_UPDATE a browser queued before that change is dropped, never
 * replayed: it would only be refused by the supervisor-only route.
 */
export async function dropRetiredActions(): Promise<void> {
	for (const action of await getQueuedActions()) {
		if ((action.action as string) !== "INSTALLER_COMPLETION")
			await removeQueuedAction(action.id)
	}
}

async function markActionRejected(
	id: string,
	reason: { errorKey?: string; message?: string },
): Promise<void> {
	const store = await withStore(QUEUE_STORE, "readwrite")
	const action = (await requestToPromise(store.get(id))) as
		| QueuedAction
		| undefined
	if (!action) return
	await requestToPromise(
		store.put({
			...action,
			rejection: { ...reason, at: new Date().toISOString() },
		}),
	)
}

export type SyncConflict = {
	type:
		| "REASSIGNED"
		| "CANCELLED"
		| "VAN_INACTIVE"
		| "WAREHOUSE_INACTIVE"
		| "INVALID_STATE"
	docId?: string
	message: string
}

export async function syncQueuedActions({
	syncOne,
	onConflict,
}: {
	syncOne: (action: QueuedAction) => Promise<{
		ok: boolean
		conflict?: SyncConflict
		error?: string
		rejected?: { errorKey?: string; message?: string }
	}>
	onConflict?: (conflict: SyncConflict) => void
}): Promise<{
	synced: number
	conflicts: SyncConflict[]
	errors: string[]
	rejected: number
}> {
	// A rejected action waits for the installer; retrying it would only be refused again.
	const actions = (await getQueuedActions()).filter((a) => !a.rejection)
	const sorted = actions.sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	)
	let synced = 0
	const conflicts: SyncConflict[] = []
	const errors: string[] = []
	let rejected = 0

	for (const action of sorted) {
		const result = await syncOne(action)
		if (result.rejected) {
			rejected++
			await markActionRejected(action.id, result.rejected)
			continue
		}
		if (result.conflict) {
			conflicts.push(result.conflict)
			onConflict?.(result.conflict)
			await removeQueuedAction(action.id)
			continue
		}
		if (result.ok) {
			synced++
			await removeQueuedAction(action.id)
		} else {
			errors.push(result.error ?? `Failed to sync ${action.id}`)
		}
	}

	return { synced, conflicts, errors, rejected }
}
