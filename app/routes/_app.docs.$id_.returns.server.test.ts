import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { getBulkOnHand } from "~/lib/warehouse-stock.server"
import {
	makeTracker,
	runToken,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.docs.$id_.returns"

const t = makeTracker()
afterAll(async () => {
	await t.cleanup()
})

type Line = { serviceCodeId: string; qty: number }

/** Seed a FIELD_UPDATED doc with `materialsTaken`/`materialsUsed`, plus the
 * pickup warehouse and a ServiceCode row per referenced serviceCodeId (so the
 * action's active-service-code check passes for literal ids like "1005803"). */
async function seedFieldUpdatedDoc(opts: {
	taken: Line[]
	used: Line[]
	fieldMaterials?: {
		serviceCodeId: string
		used: number
		returned: number
		source: "WAREHOUSE" | "BRIGADE_STOCK"
	}[]
}) {
	const warehouse = t.track("warehouse", await seedWarehouse())
	const supervisor = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
	const serviceCodeIds = new Set([
		...opts.taken.map((l) => l.serviceCodeId),
		...opts.used.map((l) => l.serviceCodeId),
	])
	for (const id of serviceCodeIds) {
		t.track(
			"serviceCode",
			await db.serviceCode.upsert({
				where: { id },
				update: { active: true },
				create: {
					id,
					claroCode: runToken(`CC-${id}`),
					name: `Test ${id}`,
					unitPrice: 0,
					active: true,
				},
			}),
		)
	}
	const doc = t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: runToken("JAF"),
				status: "FIELD_UPDATED",
				jobType: "INSTALL",
				jobAddressEstimated: "123 Test St",
				estimatedMaterials: [],
				assignedCrewIds: [],
				supervisorId: supervisor.id,
				warehouseId: warehouse.id,
				materialsTaken: opts.taken,
				materialsUsed: opts.used,
				...(opts.fieldMaterials ? { fieldMaterials: opts.fieldMaterials } : {}),
			},
		}),
	)
	return { doc, warehouse, supervisor, user }
}

/** Seed a FIELD_UPDATED doc (no bulk lines) plus SerialLocation rows already in
 * RETURNED status — the pre-condition set by the existing scan-in flow before
 * this route's action ever runs. */
async function seedFieldUpdatedDocWithSerials(serials: string[]) {
	const sc = t.track("serviceCode", await seedMaterial({ serialized: true }))
	const { doc, warehouse, supervisor, user } = await seedFieldUpdatedDoc({
		taken: [],
		used: [],
	})
	for (const serial of serials) {
		t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: sc.id,
					status: "RETURNED",
					currentRef: warehouse.id,
				},
			}),
		)
	}
	return { doc, warehouse, supervisor, user, serviceCode: sc }
}

function formFor(body: Record<string, unknown>) {
	const form = new URLSearchParams()
	form.set("idempotencyKey", String(body.idempotencyKey ?? ""))
	form.set("returnWarehouseId", String(body.returnWarehouseId ?? ""))
	form.set("lines", JSON.stringify(body.lines ?? []))
	form.set("serialLines", JSON.stringify(body.serialLines ?? []))
	if (body.returnNote) form.set("returnNote", String(body.returnNote))
	return form
}

/**
 * Run the confirm action. A SUCCESSFUL confirm now ends in a post-save
 * `throw redirect("/docs/:id")` (pre-branch behaviour, restored so a second
 * click can't resubmit the same payload under a fresh idempotency key), so the
 * thrown Response is caught and surfaced as `{ redirectedTo }`.
 */
async function confirmReturns(
	doc: { id: string },
	body: Record<string, unknown>,
): Promise<{
	errorKey?: string
	errorParams?: Record<string, string>
	redirectedTo?: string
}> {
	try {
		return (await action({
			request: new Request(`http://x/docs/${doc.id}/returns`, {
				method: "POST",
				body: formFor(body),
			}),
			params: { id: doc.id },
			context: {},
		} as never)) as { errorKey?: string }
	} catch (e) {
		if (e instanceof Response)
			return { redirectedTo: e.headers.get("location") ?? "" }
		throw e
	}
}

describe("returns: pre-fill", () => {
	afterAll(() => vi.clearAllMocks())

	it("pre-fills expected-back as taken - used (never 0)", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "irrelevant", role: "WAREHOUSE" },
		})
		const { doc } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 300 }],
			used: [{ serviceCodeId: "1005803", qty: 260 }],
		})
		const data = await loader({
			request: new Request(`http://x/docs/${doc.id}/returns`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(
			data.lines.find((l) => l.serviceCodeId === "1005803")?.expectedBack,
		).toBe(40)
	})
})

describe("returns: brigade's own stock is not expected back", () => {
	afterAll(() => vi.clearAllMocks())

	// 10 signed out; the Field table says 6 used from that stock and 4 from the
	// brigade's own. This row was saved before the brigade-stock ruling, so
	// materialsUsed holds the total 10, but 4 of the warehouse's 10 are still
	// owed back.
	const split = {
		taken: [{ serviceCodeId: "1005803", qty: 10 }],
		used: [{ serviceCodeId: "1005803", qty: 10 }],
		fieldMaterials: [
			{
				serviceCodeId: "1005803",
				used: 6,
				returned: 4,
				source: "WAREHOUSE" as const,
			},
			{
				serviceCodeId: "1005803",
				used: 4,
				returned: 0,
				source: "BRIGADE_STOCK" as const,
			},
		],
	}

	it("expects 4 back, not 0", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "irrelevant", role: "WAREHOUSE" },
		})
		const { doc } = await seedFieldUpdatedDoc(split)
		const data = await loader({
			request: new Request(`http://x/docs/${doc.id}/returns`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(data.lines).toEqual([
			{ serviceCodeId: "1005803", takenQty: 10, usedQty: 6, expectedBack: 4 },
		])
		expect(data.materialsUsed).toEqual([{ serviceCodeId: "1005803", qty: 6 }])
	})

	it("records fewer than those 4 coming back without a note", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc(split)
		mocks.requireRole.mockResolvedValue({ user })
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("idem"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 0 }],
		})
		expect(res.errorKey).toBeUndefined()
		expect(res.redirectedTo).toBe(`/docs/${doc.id}`)
	})

	it("a Field save under the ruling (materialsUsed = 6) also expects 4 back", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "irrelevant", role: "WAREHOUSE" },
		})
		const { doc } = await seedFieldUpdatedDoc({
			...split,
			used: [{ serviceCodeId: "1005803", qty: 6 }],
		})
		const data = await loader({
			request: new Request(`http://x/docs/${doc.id}/returns`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(data.lines).toEqual([
			{ serviceCodeId: "1005803", takenQty: 10, usedQty: 6, expectedBack: 4 },
		])
	})

	it("a legacy job with no Field table still uses materialsUsed", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "irrelevant", role: "WAREHOUSE" },
		})
		const { doc } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 10 }],
			used: [{ serviceCodeId: "1005803", qty: 7 }],
		})
		const data = await loader({
			request: new Request(`http://x/docs/${doc.id}/returns`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(
			data.lines.find((l) => l.serviceCodeId === "1005803")?.expectedBack,
		).toBe(3)
	})
})

describe("returns: confirm action", () => {
	afterAll(() => vi.clearAllMocks())

	it("posts RETURN(+received) when received < expected, with no note required", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 300 }],
			used: [{ serviceCodeId: "1005803", qty: 260 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const ok = await confirmReturns(doc, {
			idempotencyKey: runToken("r2"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 30 }],
		})
		expect(ok.redirectedTo).toBe(`/docs/${doc.id}`)
		expect(await getBulkOnHand(db, warehouse.id, "1005803")).toBe(30)
	})

	it("requires a note for a LOST/DAMAGED serialized line (spec §7 shrinkage)", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDocWithSerials([
			`${runToken("S")}-NONOTE`,
		])
		mocks.requireRole.mockResolvedValue({ user })
		const serial = (
			await db.serialLocation.findFirstOrThrow({
				where: { currentRef: warehouse.id, status: "RETURNED" },
			})
		).serial
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("r-serial-nonote"),
			returnWarehouseId: warehouse.id,
			lines: [],
			serialLines: [{ serial, reason: "LOST" }],
		})
		expect(res.errorKey).toBe("returns.note_required")
		expect(
			(await db.serialLocation.findUniqueOrThrow({ where: { serial } })).status,
		).toBe("RETURNED")
	})

	it("routes a damaged serialized line to Spec A triage and a lost one to LOST", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDocWithSerials([
			"S-DMG",
			"S-LOST",
		])
		mocks.requireRole.mockResolvedValue({ user })
		await confirmReturns(doc, {
			idempotencyKey: runToken("r3"),
			returnWarehouseId: warehouse.id,
			lines: [],
			serialLines: [
				{ serial: "S-DMG", reason: "DAMAGED" },
				{ serial: "S-LOST", reason: "LOST" },
			],
			returnNote: "1 damaged, 1 never came back",
		})
		// dispositionSerial's compare-and-swap moves a FAILED-triaged serial from
		// RETURNED -> AWAITING_REPAIR (repair.server.ts DISPO_TO_STATUS), not a
		// no-op on RETURNED — the brief's own literal assertion here was stale
		// (an earlier draft's imagined helper), per the task's correction notice.
		expect(
			(
				await db.serialLocation.findUniqueOrThrow({
					where: { serial: "S-DMG" },
				})
			).status,
		).toBe("AWAITING_REPAIR")
		expect(
			(
				await db.serialLocation.findUniqueOrThrow({
					where: { serial: "S-LOST" },
				})
			).status,
		).toBe("LOST")
	})

	// The ownership check inside `dispositionSerial` requires the serial's own
	// `currentRef` to equal the `warehouseId` it is called with. `returnWarehouseId`
	// is a DIFFERENT concept — the counter's chosen destination for the BULK
	// credit, which spec §9 explicitly permits to differ from where the unit
	// physically sits — so passing it here made a legitimate cross-warehouse
	// return throw an uncaught Error (a raw 500). A physical serial's disposition
	// must always be scoped to the serial's OWN location (set by scan-in).
	it("dispositions a DAMAGED serial under its OWN warehouse while crediting the chosen one", async () => {
		const sc = t.track("serviceCode", await seedMaterial({ serialized: true }))
		const {
			doc,
			warehouse: serialWh,
			user,
		} = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 10 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		// The bulk credit is routed somewhere OTHER than where the serial lives.
		const creditWh = t.track("warehouse", await seedWarehouse())
		mocks.requireRole.mockResolvedValue({ user })
		const serial = runToken("S-XWH")
		t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: sc.id,
					status: "RETURNED",
					currentRef: serialWh.id, // scanned in at the PICKUP warehouse
				},
			}),
		)
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("r-xwh"),
			returnWarehouseId: creditWh.id,
			lines: [{ serviceCodeId: "1005803", received: 10 }],
			serialLines: [{ serial, reason: "DAMAGED" }],
			returnNote: "damaged, credit routed to the other warehouse",
		})
		// Used to escape as a raw 500 rather than redirect.
		expect(res.redirectedTo).toBe(`/docs/${doc.id}`)

		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("AWAITING_REPAIR")
		expect(sl.currentRef).toBe(serialWh.id) // stays with its own warehouse
		const dispo = await db.stockMovement.findFirstOrThrow({
			where: { serial, type: "DISPOSITION" },
		})
		expect(dispo.warehouseId).toBe(serialWh.id)
		// ...and the bulk credit still lands at the CHOSEN warehouse, same txn.
		const bulk = await db.stockMovement.findFirstOrThrow({
			where: { type: "RETURN", refDocId: doc.id, kind: "BULK" },
		})
		expect(bulk.warehouseId).toBe(creditWh.id)
		expect(await getBulkOnHand(db, creditWh.id, "1005803")).toBe(10)
	})

	it("dedupes a replayed confirm", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 10 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const key = runToken("r4")
		const body = {
			idempotencyKey: key,
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 10 }],
		}
		await confirmReturns(doc, body)
		await confirmReturns(doc, body)
		expect(
			await db.stockMovement.count({
				where: { type: "RETURN", refDocId: doc.id },
			}),
		).toBe(1)
	})

	// The review's Critical B: the reset-on-success rotates the idempotency key,
	// so a second click is NOT a replay — nothing deduped it, and it posted a
	// complete second set of RETURN credits. The action must refuse outright
	// once the doc has returns recorded (there is no amend flow in the spec).
	it("refuses a second confirm under a DIFFERENT idempotency key (no double-credit)", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 10 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const lines = [{ serviceCodeId: "1005803", received: 10 }]
		const first = await confirmReturns(doc, {
			idempotencyKey: runToken("r5a"),
			returnWarehouseId: warehouse.id,
			lines,
		})
		expect(first.redirectedTo).toBe(`/docs/${doc.id}`)
		const second = await confirmReturns(doc, {
			idempotencyKey: runToken("r5b"), // a FRESH key — runOnce cannot dedupe it
			returnWarehouseId: warehouse.id,
			lines,
		})
		expect(second.errorKey).toBe("docs_returns.errors.already_recorded")
		expect(
			await db.stockMovement.count({
				where: { type: "RETURN", refDocId: doc.id },
			}),
		).toBe(1)
		expect(await getBulkOnHand(db, warehouse.id, "1005803")).toBe(10)
	})

	it("re-shows the SAVED returns on a revisit, not a blank full-expected form", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 10 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		await confirmReturns(doc, {
			idempotencyKey: runToken("r6"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 6 }],
			returnNote: "4 short",
		})
		const data = await loader({
			request: new Request(`http://x/docs/${doc.id}/returns`),
			params: { id: doc.id },
			context: {},
		} as never)
		expect(data.alreadyRecorded).toBe(true)
		expect(
			data.savedReturns.find((r) => r.serviceCodeId === "1005803")?.returnedQty,
		).toBe(6)
	})
})

describe("returns: action-level validation (review fixes)", () => {
	afterAll(() => vi.clearAllMocks())

	it("rejects a fabricated / inactive returnWarehouseId", async () => {
		const { doc, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 5 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("r7"),
			returnWarehouseId: "definitely-not-a-warehouse",
			lines: [{ serviceCodeId: "1005803", received: 5 }],
		})
		expect(res.errorKey).toBe("docs_returns.errors.invalid_warehouse")
		expect(await db.stockMovement.count({ where: { refDocId: doc.id } })).toBe(
			0,
		)
	})

	it("rejects a negative received qty instead of Math.abs-ing it into a credit", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 5 }],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("r8"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: -5 }],
			returnNote: "nonsense",
		})
		expect(res.errorKey).toBe("docs_returns.errors.invalid_received_qty")
		expect(await getBulkOnHand(db, warehouse.id, "1005803")).toBe(0)
	})

	it("records an OMITTED expected line as returned 0, without a note", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [
				{ serviceCodeId: "1005803", qty: 10 },
				{ serviceCodeId: "1005804", qty: 4 },
			],
			used: [{ serviceCodeId: "1005803", qty: 0 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		// The client submits only the first line — the second (expected back 4)
		// is recorded as returned 0 rather than vanishing.
		const res = await confirmReturns(doc, {
			idempotencyKey: runToken("r9"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 10 }],
		})
		expect(res.errorKey).toBeUndefined()
		const saved = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
			select: { materialsReturned: true },
		})
		expect(saved.materialsReturned).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ serviceCodeId: "1005804", returnedQty: 0 }),
			]),
		)
	})
})
