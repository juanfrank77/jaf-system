import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

// Follow the repo convention: route tests mock the auth boundary rather than
// mint a real better-auth session. Warehouse scoping is left real and resolves
// against real WarehouseAssignment rows + the `wh` cookie.
const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.warehouse.triage"

const RUN = runToken("TQ")
const t = makeTracker()
let SC_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
})
afterAll(() => t.cleanup())

describe("warehouse triage route", () => {
	it("dispositions a RETURNED unit as GOOD → WAREHOUSE", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "T" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "WH" },
			}),
		)
		await t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: user.id, warehouseId: wh.id, isLead: true },
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })
		const serial = `${RUN}-1`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "RETURNED",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const req = new Request("http://localhost/warehouse/triage", {
			method: "POST",
			body: new URLSearchParams({ serial, disposition: "GOOD" }),
		})
		await action({ request: req, params: {}, context: {} } as never)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})

	// Same bug class already fixed on the repairs route: `dispositionSerial`
	// throws a plain Error for every domain rejection (CAS drift after a
	// concurrent action, cross-warehouse ownership), and nothing caught it here
	// — it reached the error boundary as a raw 500 instead of a clear message.
	it("returns a structured error on CAS drift instead of throwing a raw 500", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-drift`, zone: "T" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}-drift@x`, role: "WAREHOUSE", name: "WH" },
			}),
		)
		t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: user.id, warehouseId: wh.id, isLead: true },
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })
		const serial = `${RUN}-drift-1`
		t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					// Already dispositioned by a concurrent action — no longer RETURNED.
					status: "WAREHOUSE",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const res = await action({
			request: new Request("http://localhost/warehouse/triage", {
				method: "POST",
				body: new URLSearchParams({ serial, disposition: "GOOD" }),
			}),
			params: {},
			context: {},
		} as never)
		expect(res.errorKey).toBe("triage.action_failed")
		expect(res.errorDetail).toContain(serial)
	})
})

// Review finding F: Spec A's screens resolved the acting warehouse via a
// helper that read the FIRST assignment and ignored the `wh` cookie the header
// switch writes — so a lead who switched to warehouse B kept operating on A,
// and a disposition here wrote the serial under the WRONG warehouse. There was
// no true second-warehouse test case, which is exactly why it survived.
describe("warehouse triage honors the header warehouse switch", () => {
	async function twoWarehouseUser(tag: string) {
		const a = t.track(
			"warehouse",
			await db.warehouse.create({
				data: { name: `${RUN}-${tag}-A`, zone: "T" },
			}),
		)
		const b = t.track(
			"warehouse",
			await db.warehouse.create({
				data: { name: `${RUN}-${tag}-B`, zone: "T" },
			}),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}-${tag}@x`, role: "WAREHOUSE", name: "WH2" },
			}),
		)
		for (const wh of [a, b])
			t.track(
				"warehouseAssignment",
				await db.warehouseAssignment.create({
					data: { userId: user.id, warehouseId: wh.id, isLead: true },
				}),
			)
		mocks.requireRole.mockResolvedValue({ user })
		return { a, b, user }
	}

	it("lists the SELECTED warehouse's queue, not the first assignment's", async () => {
		const { a, b } = await twoWarehouseUser("SW")
		const inA = `${RUN}-SW-a`
		const inB = `${RUN}-SW-b`
		for (const [serial, wh] of [
			[inA, a],
			[inB, b],
		] as const)
			t.track(
				"serialLocation",
				await db.serialLocation.create({
					data: {
						serial,
						serviceCodeId: SC_ID,
						status: "RETURNED",
						condition: "NEW",
						currentRef: wh.id,
						since: new Date(),
					},
				}),
			)
		const data = await loader({
			request: new Request("http://localhost/warehouse/triage", {
				headers: { cookie: `wh=${b.id}` },
			}),
			params: {},
			context: {},
		} as never)
		const serials = data.units.map((u) => u.serial)
		expect(serials).toContain(inB)
		expect(serials).not.toContain(inA)
	})

	it("dispositions under the SELECTED warehouse, not the first assignment's", async () => {
		const { b } = await twoWarehouseUser("SD")
		const serial = `${RUN}-SD-1`
		t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "RETURNED",
					condition: "NEW",
					currentRef: b.id,
					since: new Date(),
				},
			}),
		)
		await action({
			request: new Request("http://localhost/warehouse/triage", {
				method: "POST",
				headers: { cookie: `wh=${b.id}` },
				body: new URLSearchParams({ serial, disposition: "GOOD" }),
			}),
			params: {},
			context: {},
		} as never)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
		expect(sl.currentRef).toBe(b.id) // the SELECTED warehouse
		const move = await db.stockMovement.findFirstOrThrow({
			where: { serial, type: "DISPOSITION" },
		})
		expect(move.warehouseId).toBe(b.id)
	})
})
