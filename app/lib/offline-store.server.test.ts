import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	type CachedJob,
	cacheJobs,
	getCachedJob,
	getCachedJobs,
	getQueuedActions,
	queueAction,
	removeQueuedAction,
	resetDbPromise,
	syncQueuedActions,
} from "./offline-store"

function createMockIdb() {
	const stores: Record<string, Map<string, unknown>> = {}

	const getStore = (name: string) => {
		if (!stores[name]) stores[name] = new Map()
		return stores[name]
	}

	const createRequest = <T>(result: T): IDBRequest<T> => {
		const listeners: Record<string, ((event: Event) => void)[]> = {}
		const request = {
			result,
			error: null as Error | null,
			source: null as unknown,
			transaction: null as IDBTransaction | null,
			readyState: "done" as const,
			onerror: null as ((this: IDBRequest<T>, ev: Event) => unknown) | null,
			onsuccess: null as ((this: IDBRequest<T>, ev: Event) => unknown) | null,
			addEventListener: (type: string, listener: (event: Event) => void) => {
				if (!listeners[type]) listeners[type] = []
				listeners[type].push(listener)
			},
			removeEventListener: () => {},
			dispatchEvent: (event: Event) => {
				listeners[event.type]?.forEach((l) => {
					l(event)
				})
				return true
			},
		} as unknown as IDBRequest<T>
		queueMicrotask(() => {
			request.onsuccess?.(new Event("success"))
		})
		return request
	}

	const createStore = (name: string): IDBObjectStore =>
		({
			name,
			put: (value: unknown) => {
				const record = value as Record<string, unknown>
				getStore(name).set(String(record.id), record)
				return createRequest(record)
			},
			get: (key: IDBValidKey) => {
				return createRequest(getStore(name).get(String(key)))
			},
			getAll: () => {
				return createRequest(Array.from(getStore(name).values()))
			},
			delete: (key: IDBValidKey) => {
				getStore(name).delete(String(key))
				return createRequest(undefined)
			},
			transaction: null as unknown as IDBTransaction,
		}) as unknown as IDBObjectStore

	const db = {
		objectStoreNames: {
			contains: (_name: string) => true,
		},
		transaction: (name: string, _mode: IDBTransactionMode) => {
			return {
				objectStore: () => createStore(name),
				onerror: null,
			} as unknown as IDBTransaction
		},
	} as unknown as IDBDatabase

	const factory = {
		open: (_name: string, _version: number) => {
			const _listeners: Record<string, ((event: Event) => void)[]> = {}
			const request = {
				result: db,
				error: null as Error | null,
				source: null as unknown,
				transaction: null as IDBTransaction | null,
				readyState: "done" as const,
				onerror: null,
				get onsuccess() {
					return null
				},
				set onsuccess(value:
					| ((this: IDBOpenDBRequest, ev: Event) => unknown)
					| null,) {
					queueMicrotask(() =>
						value?.call(request as any, new Event("success")),
					)
				},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => true,
			} as unknown as IDBOpenDBRequest
			return request
		},
	}

	return { factory, stores: () => stores }
}

describe("offline-store", () => {
	const mock = createMockIdb()

	beforeEach(() => {
		for (const store of Object.values(mock.stores())) {
			store.clear()
		}
		vi.stubGlobal("indexedDB", mock.factory)
		vi.stubGlobal("window", { indexedDB: mock.factory })
		resetDbPromise()
	})

	describe("cacheJobs and getCachedJobs", () => {
		it("caches and retrieves jobs", async () => {
			const jobs: CachedJob[] = [
				{
					id: "doc1",
					controlNumber: "JAF-1001",
					status: "SIGNED",
					jobType: "Repair",
					jobAddressEstimated: "Cupey",
					assignedCrewIds: ["crew1"],
					updatedAt: new Date().toISOString(),
				},
			]
			await cacheJobs(jobs)
			const cached = await getCachedJobs()
			expect(cached).toHaveLength(1)
			expect(cached[0].controlNumber).toBe("JAF-1001")
		})

		it("retrieves a single cached job by id", async () => {
			const jobs: CachedJob[] = [
				{
					id: "doc2",
					controlNumber: "JAF-1002",
					status: "PREPPED",
					jobType: "Install",
					jobAddressEstimated: "Santurce",
					assignedCrewIds: ["crew1"],
					updatedAt: new Date().toISOString(),
				},
			]
			await cacheJobs(jobs)
			const cached = await getCachedJob("doc2")
			expect(cached?.controlNumber).toBe("JAF-1002")
		})
	})

	describe("queueAction and getQueuedActions", () => {
		it("queues a field update action", async () => {
			const action = await queueAction({
				docId: "doc1",
				action: "FIELD_UPDATE",
				payload: { notes: "done" },
			})
			expect(action.id).toBeTruthy()
			expect(action.docId).toBe("doc1")
			const queued = await getQueuedActions()
			expect(queued).toHaveLength(1)
		})

		it("removes a queued action by id", async () => {
			const action = await queueAction({
				docId: "doc1",
				action: "FIELD_UPDATE",
				payload: {},
			})
			await removeQueuedAction(action.id)
			const queued = await getQueuedActions()
			expect(queued).toHaveLength(0)
		})
	})

	describe("syncQueuedActions", () => {
		it("syncs queued actions in order and removes them", async () => {
			await queueAction({ docId: "doc1", action: "FIELD_UPDATE", payload: {} })
			await queueAction({ docId: "doc2", action: "FIELD_UPDATE", payload: {} })
			const syncOne = vi.fn().mockResolvedValue({ ok: true })
			const result = await syncQueuedActions({ syncOne })
			expect(result.synced).toBe(2)
			expect(result.conflicts).toHaveLength(0)
			expect(await getQueuedActions()).toHaveLength(0)
		})

		it("reports conflicts and removes conflicting actions", async () => {
			await queueAction({ docId: "doc1", action: "FIELD_UPDATE", payload: {} })
			const syncOne = vi.fn().mockResolvedValue({
				ok: false,
				conflict: {
					type: "REASSIGNED" as const,
					docId: "doc1",
					message: "Job was reassigned",
				},
			})
			const result = await syncQueuedActions({ syncOne })
			expect(result.conflicts).toHaveLength(1)
			expect(result.conflicts[0].type).toBe("REASSIGNED")
			expect(await getQueuedActions()).toHaveLength(0)
		})

		it("keeps failed actions in the queue when no conflict", async () => {
			await queueAction({ docId: "doc1", action: "FIELD_UPDATE", payload: {} })
			const syncOne = vi.fn().mockResolvedValue({ ok: false, error: "network" })
			const result = await syncQueuedActions({ syncOne })
			expect(result.synced).toBe(0)
			expect(result.errors).toContain("network")
			expect(await getQueuedActions()).toHaveLength(1)
		})

		it("marks a validation-rejected action, keeps it, and never retries it", async () => {
			await queueAction({ docId: "doc1", action: "FIELD_UPDATE", payload: {} })
			const rejecting = vi.fn().mockResolvedValue({
				ok: false,
				rejected: { errorKey: "docs_field.errors.used_exceeds_took" },
			})
			const first = await syncQueuedActions({ syncOne: rejecting })
			expect(first.rejected).toBe(1)
			expect(first.errors).toHaveLength(0)
			const queue = await getQueuedActions()
			expect(queue).toHaveLength(1)
			expect(queue[0].rejection?.errorKey).toBe(
				"docs_field.errors.used_exceeds_took",
			)

			const again = vi.fn().mockResolvedValue({ ok: true })
			const second = await syncQueuedActions({ syncOne: again })
			expect(again).not.toHaveBeenCalled()
			expect(second.synced).toBe(0)
			expect(await getQueuedActions()).toHaveLength(1)
		})
	})
})
