import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.warehouse.repairs"

const RUN = runToken("RP")
const t = makeTracker()
let SC_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009642")).id
})
afterAll(() => t.cleanup())

describe("warehouse repairs route", () => {
	it("correct_triage moves an AWAITING_REPAIR unit back to WAREHOUSE", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-wh`, zone: "R" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}@x`, role: "WAREHOUSE", name: "R" },
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
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const req = new Request("http://localhost/warehouse/repairs", {
			method: "POST",
			body: new URLSearchParams({
				intent: "correct_triage",
				serial,
				reason: "not failed",
			}),
		})
		await action({ request: req, params: {}, context: {} } as never)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})

	it("rejects correct_triage from a non-lead warehouse user (lead gate)", async () => {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-ng`, zone: "R" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}-ng@x`, role: "WAREHOUSE", name: "NG" },
			}),
		)
		await t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: user.id, warehouseId: wh.id, isLead: false },
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })
		const serial = `${RUN}-ng-1`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					status: "AWAITING_REPAIR",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const req = new Request("http://localhost/warehouse/repairs", {
			method: "POST",
			body: new URLSearchParams({
				intent: "correct_triage",
				serial,
				reason: "x",
			}),
		})
		await expect(
			action({ request: req, params: {}, context: {} } as never),
		).rejects.toBeDefined()
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("AWAITING_REPAIR") // unchanged — gate blocked it
	})
})

// Review finding I: the service layer throws plain Errors for every domain
// rejection (CAS drift, void-blocked, missing reason, cross-warehouse) and
// nothing caught them — they reached the error boundary as raw 500s instead of
// the "clear, actionable message" the spec asks for.
describe("warehouse repairs route: action errors surface as errorKey", () => {
	async function leadAt(tag: string) {
		const wh = t.track(
			"warehouse",
			await db.warehouse.create({ data: { name: `${RUN}-${tag}`, zone: "R" } }),
		)
		const user = t.track(
			"user",
			await db.user.create({
				data: { email: `${RUN}-${tag}@x`, role: "WAREHOUSE", name: tag },
			}),
		)
		await t.track(
			"warehouseAssignment",
			await db.warehouseAssignment.create({
				data: { userId: user.id, warehouseId: wh.id, isLead: true },
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })
		return { wh, user }
	}

	function post(fields: Record<string, string>) {
		return action({
			request: new Request("http://localhost/warehouse/repairs", {
				method: "POST",
				body: new URLSearchParams(fields),
			}),
			params: {},
			context: {},
		} as never) as Promise<{ errorKey?: string; errorDetail?: string | null }>
	}

	it("returns a translatable errorKey + detail on a CAS drift instead of throwing", async () => {
		const { wh } = await leadAt("ERR1")
		const serial = `${RUN}-ERR1-1`
		await t.track(
			"serialLocation",
			await db.serialLocation.create({
				data: {
					serial,
					serviceCodeId: SC_ID,
					// NOT in the repair pool → correctTriage's CAS must reject it.
					status: "WAREHOUSE",
					condition: "NEW",
					currentRef: wh.id,
					since: new Date(),
				},
			}),
		)
		const res = await post({ intent: "correct_triage", serial, reason: "x" })
		expect(res.errorKey).toBe("repairs.action_failed")
		// The message must name the drifted serial (spec: "a structured error
		// naming the drifted serial").
		expect(res.errorDetail).toContain(serial)
	})

	it("returns an errorKey when a required reason is missing (void)", async () => {
		await leadAt("ERR2")
		const res = await post({
			intent: "void_batch",
			batchId: "no-such-batch",
			reason: "   ",
		})
		expect(res.errorKey).toBe("repairs.action_failed")
		expect(res.errorDetail).toMatch(/reason/)
	})
})
