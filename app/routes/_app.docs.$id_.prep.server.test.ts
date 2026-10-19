import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { getPrepAvailable } from "~/lib/warehouse-stock.server"
import { makeTracker, runToken, seedUser, seedWarehouse } from "~/test/helpers"
import type { Prisma } from "../../generated/prisma/client"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action } from "./_app.docs.$id_.prep"

const t = makeTracker()
afterAll(async () => {
	await t.cleanup()
})

type PrepLineInput = {
	_key: string
	serviceCodeId: string
	estimatedQty: number
	preppedQty: number
	substitutedWith: string | null
	missing: boolean
	notes: string
}

/**
 * Seed a JafInvoice with the real shape a `prep`-stage doc actually has:
 * no `warehouseId` (null pre-sign — the reason this task exists at all), and
 * `preppedMaterials` stored as full PrepLine[] (with `preppedQty`, not the
 * brief's shorthand `qty`) exactly as `prep.tsx`'s action writes it.
 */
async function seedDoc(
	opts: {
		status?: string
		estimated?: { serviceCodeId: string; qty: number }[]
		prepped?: PrepLineInput[]
		crewIds?: string[]
	} = {},
) {
	const supervisor = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const doc = t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: runToken("JAF"),
				status: (opts.status ?? "CREATED") as never,
				jobType: "INSTALL",
				jobAddressEstimated: "123 Test St",
				estimatedMaterials: (opts.estimated ??
					[]) as unknown as Prisma.InputJsonValue,
				assignedCrewIds: opts.crewIds ?? [],
				supervisorId: supervisor.id,
				preppedMaterials: opts.prepped
					? (opts.prepped as unknown as Prisma.InputJsonValue)
					: undefined,
				// no warehouseId — matches the real doc shape at prep.
			},
		}),
	)
	return { doc, supervisor }
}

async function seedPreppedDoc(
	prepped: { serviceCodeId: string; qty: number }[],
) {
	const lines: PrepLineInput[] = prepped.map((p) => ({
		_key: `k-${p.serviceCodeId}`,
		serviceCodeId: p.serviceCodeId,
		estimatedQty: p.qty,
		preppedQty: p.qty,
		substitutedWith: null,
		missing: false,
		notes: "",
	}))
	return seedDoc({
		status: "PREPPED",
		estimated: prepped,
		prepped: lines,
	})
}

async function prepAction(doc: { id: string }, lines: PrepLineInput[]) {
	const form = new URLSearchParams()
	form.set("preppedMaterials", JSON.stringify(lines))
	return action({
		request: new Request(`http://x/docs/${doc.id}/prep`, {
			method: "POST",
			body: form,
		}),
		params: { id: doc.id },
		context: {},
	} as never)
}

describe("getPrepAvailable", () => {
	it("subtracts prepped-not-released quantities across all warehouses (doc has no warehouseId pre-sign)", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const u = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		await db.stockMovement.create({
			data: {
				kind: "BULK",
				warehouseId: wh.id,
				serviceCodeId: "1005803",
				qty: 100,
				type: "STARTING_BALANCE",
				byUserId: u.id,
			},
		})
		await seedPreppedDoc([{ serviceCodeId: "1005803", qty: 30 }])
		expect(await getPrepAvailable(db, wh.id, "1005803")).toBe(70)
	})
})

describe("prep action: flag_missing", () => {
	afterAll(() => vi.clearAllMocks())

	it("notifies the supervisor and does not block release", async () => {
		const { doc, supervisor } = await seedDoc({
			estimated: [{ serviceCodeId: "1005855", qty: 5 }],
		})
		const actor = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		mocks.requireRole.mockResolvedValue({ user: actor })
		const res = (await prepAction(doc, [
			{
				_key: "k1",
				serviceCodeId: "1005855",
				estimatedQty: 5,
				preppedQty: 0,
				substitutedWith: null,
				missing: true,
				notes: "4 short",
			},
		])) as { blocksRelease?: boolean; missingFlagged?: boolean }
		expect(
			await db.notification.count({ where: { userId: supervisor.id } }),
		).toBeGreaterThan(0)
		// release path is still reachable (status not forced to a blocking state)
		expect(res.blocksRelease).toBe(false)
	})
})

describe("prep action: completing prep", () => {
	afterAll(() => vi.clearAllMocks())

	it("alerts the supervisor, not the crew", async () => {
		const crew = t.track("user", await seedUser({ role: "CREW" }))
		const { doc, supervisor } = await seedDoc({
			estimated: [{ serviceCodeId: "1005855", qty: 5 }],
			crewIds: [crew.id],
		})
		const actor = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		mocks.requireRole.mockResolvedValue({ user: actor })
		await expect(
			prepAction(doc, [
				{
					_key: "k1",
					serviceCodeId: "1005855",
					estimatedQty: 5,
					preppedQty: 5,
					substitutedWith: null,
					missing: false,
					notes: "",
				},
			]),
		).rejects.toMatchObject({ status: 302 })
		const sup = await db.notification.findMany({
			where: { userId: supervisor.id, docId: doc.id },
		})
		expect(sup.map((n) => n.message)).toEqual([
			`Job ${doc.controlNumber} is ready for pickup.`,
		])
		expect(await db.notification.count({ where: { userId: crew.id } })).toBe(0)
	})
})
