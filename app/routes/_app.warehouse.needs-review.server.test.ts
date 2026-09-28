import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedServiceCode } from "~/test/helpers"

// Follow the repo convention: route tests mock the auth boundary rather than
// mint a real better-auth session. Warehouse scoping and the lead gate are
// left real and resolve against real WarehouseAssignment rows.
const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.warehouse.needs-review"

const RUN = runToken("NR")
const t = makeTracker()
let SC_ID: string

beforeAll(async () => {
	SC_ID = (await seedServiceCode("4009643")).id
})
afterAll(() => t.cleanup())

/** A lead on a fresh warehouse, with `requireRole` mocked to that user. */
async function seedLead(tag: string) {
	const wh = t.track(
		"warehouse",
		await db.warehouse.create({ data: { name: `${RUN}-${tag}`, zone: "T" } }),
	)
	const user = t.track(
		"user",
		await db.user.create({
			data: { email: `${RUN}-${tag}@x`, role: "WAREHOUSE", name: "WH" },
		}),
	)
	t.track(
		"warehouseAssignment",
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead: true },
		}),
	)
	mocks.requireRole.mockResolvedValue({ user })
	return { wh, user }
}

async function seedSerial(
	wh: { id: string },
	serial: string,
	status: "NEEDS_REVIEW" | "WAREHOUSE",
) {
	t.track(
		"serialLocation",
		await db.serialLocation.create({
			data: {
				serial,
				serviceCodeId: SC_ID,
				status,
				condition: "NEW",
				currentRef: wh.id,
				since: new Date(),
			},
		}),
	)
	return serial
}

function post(body: Record<string, string>) {
	return action({
		request: new Request("http://localhost/warehouse/needs-review", {
			method: "POST",
			body: new URLSearchParams(body),
		}),
		params: {},
		context: {},
	} as never)
}

describe("warehouse needs-review route", () => {
	it("resolves a held unit back to stock (GOOD → WAREHOUSE)", async () => {
		const { wh } = await seedLead("ok")
		const serial = await seedSerial(wh, `${RUN}-ok-1`, "NEEDS_REVIEW")
		const res = await post({ serial, decision: "GOOD" })
		expect(res.ok).toBe(true)
		const sl = await db.serialLocation.findUniqueOrThrow({ where: { serial } })
		expect(sl.status).toBe("WAREHOUSE")
	})

	// Same bug class already fixed on the repairs route: `resolveNeedsReview`
	// throws a plain Error for CAS drift (a concurrent action already resolved
	// the hold) and for cross-warehouse ownership. Nothing caught it here, so it
	// reached the error boundary as a raw 500 instead of a clear message.
	it("returns a structured error on CAS drift instead of throwing a raw 500", async () => {
		const { wh } = await seedLead("drift")
		// Already resolved by a concurrent action — no longer NEEDS_REVIEW.
		const serial = await seedSerial(wh, `${RUN}-drift-1`, "WAREHOUSE")
		const res = await post({ serial, decision: "FAILED" })
		expect(res.errorKey).toBe("needs_review.action_failed")
		expect(res.errorDetail).toContain(serial)
	})
})
