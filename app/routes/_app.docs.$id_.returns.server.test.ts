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
async function seedFieldUpdatedDoc(opts: { taken: Line[]; used: Line[] }) {
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
	if (body.discrepancyNote)
		form.set("discrepancyNote", String(body.discrepancyNote))
	return form
}

async function confirmReturns(
	doc: { id: string },
	body: Record<string, unknown>,
) {
	return action({
		request: new Request(`http://x/docs/${doc.id}/returns`, {
			method: "POST",
			body: formFor(body),
		}),
		params: { id: doc.id },
		context: {},
	} as never)
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

describe("returns: confirm action", () => {
	afterAll(() => vi.clearAllMocks())

	it("requires a note when received < expected and posts RETURN(+received)", async () => {
		const { doc, warehouse, user } = await seedFieldUpdatedDoc({
			taken: [{ serviceCodeId: "1005803", qty: 300 }],
			used: [{ serviceCodeId: "1005803", qty: 260 }],
		})
		mocks.requireRole.mockResolvedValue({ user })
		const noNote = (await confirmReturns(doc, {
			idempotencyKey: runToken("r1"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 30 }],
		})) as { errorKey?: string }
		expect(noNote.errorKey).toBe("returns.note_required")

		const ok = (await confirmReturns(doc, {
			idempotencyKey: runToken("r2"),
			returnWarehouseId: warehouse.id,
			lines: [{ serviceCodeId: "1005803", received: 30 }],
			discrepancyNote: "1 damaged on site",
		})) as { ok?: boolean }
		expect(ok.ok).toBe(true)
		expect(await getBulkOnHand(db, warehouse.id, "1005803")).toBe(30)
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
})
