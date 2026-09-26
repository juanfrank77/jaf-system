const DB_NAME = "jaf-operations"
const DB_VERSION = 1
const JOBS_STORE = "jobs"
const QUEUE_STORE = "queue"

export type QueuedAction = {
	id: string
	docId?: string
	action: "FIELD_UPDATE"
	payload: Record<string, unknown>
	createdAt: string
}

export type CachedJob = {
	id: string
	controlNumber: string
	status: string
	jobType: string
	jobAddressEstimated: string
	jobAddressActual?: string | null
	assignedCrewIds: string[]
	materialsTaken?: unknown
	sendBackHistory?: unknown
	avisoNumber?: string | null
	updatedAt: string
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
			if (!db.objectStoreNames.contains(JOBS_STORE)) {
				db.createObjectStore(JOBS_STORE, { keyPath: "id" })
			}
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

export async function cacheJobs(jobs: CachedJob[]): Promise<void> {
	try {
		const store = await withStore(JOBS_STORE, "readwrite")
		for (const job of jobs) {
			await requestToPromise(store.put(job))
		}
	} catch {
		// Ignore in environments without IndexedDB
	}
}

export async function getCachedJob(id: string): Promise<CachedJob | undefined> {
	try {
		const store = await withStore(JOBS_STORE, "readonly")
		return (await requestToPromise(store.get(id))) as CachedJob | undefined
	} catch {
		return undefined
	}
}

export async function getCachedJobs(): Promise<CachedJob[]> {
	try {
		const store = await withStore(JOBS_STORE, "readonly")
		return (await requestToPromise(store.getAll())) as CachedJob[]
	} catch {
		return []
	}
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
	syncOne: (
		action: QueuedAction,
	) => Promise<{ ok: boolean; conflict?: SyncConflict; error?: string }>
	onConflict?: (conflict: SyncConflict) => void
}): Promise<{ synced: number; conflicts: SyncConflict[]; errors: string[] }> {
	const actions = await getQueuedActions()
	const sorted = actions.sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	)
	let synced = 0
	const conflicts: SyncConflict[] = []
	const errors: string[] = []

	for (const action of sorted) {
		const result = await syncOne(action)
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

	return { synced, conflicts, errors }
}
