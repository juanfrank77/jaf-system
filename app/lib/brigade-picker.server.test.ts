import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedBrigade, seedUser } from "~/test/helpers"
import {
	assignBrigades,
	assignBrigadesOrThrow,
	BRIGADE_INVALID,
	pickerViewer,
} from "./brigade-picker.server"
import { standByBrigade } from "./brigade-standby.server"

const t = makeTracker()
afterAll(() => t.cleanup())

async function supervisor(areas: string[] = []) {
	const u = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	await db.user.update({
		where: { id: u.id },
		data: { supervisorAreas: areas },
	})
	return { id: u.id, role: "SUPERVISOR", areas }
}

async function job(supervisorId: string) {
	return t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: runToken("JAF"),
				status: "CREATED",
				jobType: "INSTALL",
				jobAddressEstimated: "1 Test St",
				estimatedMaterials: [],
				assignedCrewIds: [],
				supervisorId,
			},
		}),
	)
}

async function brigade(
	overrides: Parameters<typeof seedBrigade>[0] = {},
): Promise<{ id: string; code: string | null }> {
	return t.track("brigade", await seedBrigade(overrides))
}

function assign(
	viewer: { id: string; role: string; areas: string[] },
	brigadeIds: string[],
	docId: string | null = null,
) {
	return db.$transaction((tx) =>
		assignBrigades(tx, { docId, viewer, brigadeIds }),
	)
}

describe("assignBrigades", () => {
	it("rejects an equipment (D) account, even the viewer's own", async () => {
		const sup = await supervisor(["SUR"])
		const b = await brigade({
			area: "SUR",
			supervisorId: sup.id,
			isEquipmentAccount: true,
		})
		expect(await assign(sup, [b.id])).toEqual({
			ok: false,
			errorKey: BRIGADE_INVALID,
		})
	})

	it("rejects a terminated brigade, even an inactive one", async () => {
		const sup = await supervisor(["SUR"])
		const b = await brigade({
			active: false,
			terminatedAt: new Date(),
		})
		expect(await assign(sup, [b.id])).toEqual({
			ok: false,
			errorKey: BRIGADE_INVALID,
		})
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after.active).toBe(false)
	})

	it("rejects equipment and terminated brigades for an Admin too", async () => {
		const admin = { id: "admin-x", role: "ADMIN", areas: [] }
		const d = await brigade({ isEquipmentAccount: true })
		const gone = await brigade({ terminatedAt: new Date() })
		expect(await assign(admin, [d.id])).toEqual({
			ok: false,
			errorKey: BRIGADE_INVALID,
		})
		expect(await assign(admin, [gone.id])).toEqual({
			ok: false,
			errorKey: BRIGADE_INVALID,
		})
	})

	it("rejects an unknown brigade id", async () => {
		const sup = await supervisor(["SUR"])
		expect(await assign(sup, ["no-such-brigade"])).toEqual({
			ok: false,
			errorKey: BRIGADE_INVALID,
		})
	})

	it("lets a supervisor add another supervisor's active brigade: no event, the owner keeps it", async () => {
		const sup = await supervisor(["SUR"])
		const other = await supervisor(["METRO"])
		const b = await brigade({ area: "METRO", supervisorId: other.id })
		expect(await assign(sup, [b.id])).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after).toMatchObject({ active: true, supervisorId: other.id })
		expect(await db.brigadeEvent.count({ where: { brigadeId: b.id } })).toBe(0)
	})

	it("activates an inactive brigade for the viewer and logs it with the doc id", async () => {
		const sup = await supervisor(["SUR"])
		const doc = await job(sup.id)
		const b = await brigade({ active: false, area: null, supervisorId: null })
		expect(await assign(sup, [b.id], doc.id)).toEqual({ ok: true })

		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after.active).toBe(true)
		expect(after.supervisorId).toBe(sup.id)
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: b.id },
		})
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			userId: sup.id,
			docId: doc.id,
			action: "BRIGADE_ACTIVATED",
			diffJson: {
				before: { active: false, supervisorId: null },
				after: { active: true, supervisorId: sup.id },
			},
		})
		// The brigade's payee account follows it into service.
		const account = await db.contractorAccount.findUniqueOrThrow({
			where: { code: b.code as string },
		})
		expect(account).toMatchObject({ brigadeId: b.id, active: true })
	})

	it("passes the viewer's own active brigade with no event", async () => {
		const sup = await supervisor(["SUR"])
		const mine = await brigade({ area: "METRO", supervisorId: sup.id })
		const inArea = await brigade({ area: "SUR", supervisorId: null })
		expect(await assign(sup, [mine.id, inArea.id])).toEqual({ ok: true })
		expect(
			await db.brigadeEvent.count({
				where: { brigadeId: { in: [mine.id, inArea.id] } },
			}),
		).toBe(0)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: inArea.id },
		})
		expect(after.supervisorId).toBeNull()
	})

	it("two supervisors activating the same brigade at once: one logs the activation and owns it, the other still gets the brigade", async () => {
		const a = await supervisor(["SUR"])
		const b = await supervisor(["OESTE"])
		const target = await brigade({
			active: false,
			area: null,
			supervisorId: null,
		})
		const results = await Promise.all([
			assign(a, [target.id]),
			assign(b, [target.id]),
		])
		expect(results).toEqual([{ ok: true }, { ok: true }])

		const after = await db.brigade.findUniqueOrThrow({
			where: { id: target.id },
		})
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: target.id },
		})
		expect(events).toHaveLength(1)
		expect(after).toMatchObject({
			active: true,
			supervisorId: events[0].userId,
		})
	})
})

describe("assignBrigades — unowned and lost claims", () => {
	it("passes an unowned active brigade outside the viewer's areas, with no event and no change of owner", async () => {
		const sup = await supervisor(["SUR"])
		const b = await brigade({ area: "METRO", supervisorId: null })
		expect(await assign(sup, [b.id])).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after).toMatchObject({ active: true, supervisorId: null })
		expect(await db.brigadeEvent.count({ where: { brigadeId: b.id } })).toBe(0)
	})

	it("a claim that loses the row lock matches no rows, so it adds no second event and still succeeds", async () => {
		const a = await supervisor(["SUR"])
		const b = await supervisor(["OESTE"])
		const target = await brigade({
			active: false,
			area: null,
			supervisorId: null,
		})

		// A claims the brigade and holds its transaction open.
		let releaseA = () => {}
		const aHolds = new Promise<void>((r) => {
			releaseA = r
		})
		let aClaimed = () => {}
		const aHasClaimed = new Promise<void>((r) => {
			aClaimed = r
		})
		const runA = db.$transaction(
			async (tx) => {
				const result = await assignBrigades(tx, {
					docId: null,
					viewer: a,
					brigadeIds: [target.id],
				})
				aClaimed()
				await aHolds
				return result
			},
			{ timeout: 15000 },
		)
		await aHasClaimed

		// B reads the brigade as still inactive (A has not committed), so it
		// passes the checks and reaches its conditional update, which waits on
		// A's row lock.
		const bCounts: number[] = []
		let bAtUpdate = () => {}
		const bReachedUpdate = new Promise<void>((r) => {
			bAtUpdate = r
		})
		const runB = db.$transaction(
			async (tx) => {
				const spied = {
					brigade: {
						findMany: tx.brigade.findMany.bind(tx.brigade),
						updateMany: async (args: any) => {
							bAtUpdate()
							const res = await tx.brigade.updateMany(args)
							bCounts.push(res.count)
							return res
						},
					},
					brigadeEvent: tx.brigadeEvent,
					contractorAccount: tx.contractorAccount,
				} as any
				return assignBrigades(spied, {
					docId: null,
					viewer: b,
					brigadeIds: [target.id],
				})
			},
			{ timeout: 15000 },
		)
		await bReachedUpdate
		// Give B's UPDATE time to reach the database and queue on the lock.
		await new Promise((r) => setTimeout(r, 300))
		releaseA()

		expect(await runA).toEqual({ ok: true })
		expect(await runB).toEqual({ ok: true })
		expect(bCounts).toEqual([0])
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: target.id },
		})
		expect(events.map((e) => e.userId)).toEqual([a.id])
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: target.id },
		})
		expect(after).toMatchObject({ active: true, supervisorId: a.id })
	})

	it("count 0 from the conditional update carries on, with no event or account sync", async () => {
		const fake = {
			brigade: {
				findMany: vi.fn(async () => [
					{
						id: "b-idle",
						name: "IDLE",
						code: "900",
						area: null,
						active: false,
						supervisorId: null,
						isEquipmentAccount: false,
						terminatedAt: null,
					},
				]),
				updateMany: vi.fn(async () => ({ count: 0 })),
			},
			brigadeEvent: { create: vi.fn() },
			contractorAccount: { upsert: vi.fn() },
		}
		expect(
			await assignBrigades(fake as any, {
				docId: "doc-1",
				viewer: { id: "sup-1", role: "SUPERVISOR", areas: [] },
				brigadeIds: ["b-idle"],
			}),
		).toEqual({ ok: true })
		expect(fake.brigadeEvent.create).not.toHaveBeenCalled()
		expect(fake.contractorAccount.upsert).not.toHaveBeenCalled()
	})
})

describe("assignBrigades — inactive brigades with a supervisor", () => {
	async function untouched(id: string, supervisorId: string) {
		const after = await db.brigade.findUniqueOrThrow({ where: { id } })
		expect(after).toMatchObject({ active: false, supervisorId })
		expect(await db.brigadeEvent.count({ where: { brigadeId: id } })).toBe(0)
	}

	it("a supervisor activates another supervisor's inactive brigade: it goes active, stays with its owner, and is logged", async () => {
		const a = await supervisor(["NORTE"])
		const b = await supervisor(["NORTE"])
		const doc = await job(b.id)
		const target = await brigade({
			active: false,
			area: "NORTE",
			supervisorId: a.id,
		})
		expect(await assign(b, [target.id], doc.id)).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: target.id },
		})
		expect(after).toMatchObject({ active: true, supervisorId: a.id })
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: target.id },
		})
		expect(events).toEqual([
			expect.objectContaining({
				userId: b.id,
				docId: doc.id,
				action: "BRIGADE_ACTIVATED",
				diffJson: {
					before: { active: false, supervisorId: a.id },
					after: { active: true, supervisorId: a.id },
				},
			}),
		])
	})

	it("a claim that lists a free brigade and another's inactive one activates both, in one transaction", async () => {
		const a = await supervisor(["NORTE"])
		const b = await supervisor(["SUR"])
		const free = await brigade({
			active: false,
			area: null,
			supervisorId: null,
		})
		const theirs = await brigade({
			active: false,
			area: null,
			supervisorId: a.id,
		})
		await db.$transaction(async (tx) => {
			await assignBrigadesOrThrow(tx, {
				docId: null,
				viewer: b,
				brigadeIds: [free.id, theirs.id],
			})
		})
		expect(
			await db.brigade.findUniqueOrThrow({ where: { id: free.id } }),
		).toMatchObject({ active: true, supervisorId: b.id })
		expect(
			await db.brigade.findUniqueOrThrow({ where: { id: theirs.id } }),
		).toMatchObject({ active: true, supervisorId: a.id })
	})

	it("a supervisor reactivates his own inactive brigade and it is logged", async () => {
		const sup = await supervisor(["SUR"])
		const mine = await brigade({
			active: false,
			area: "METRO",
			supervisorId: sup.id,
		})
		expect(await assign(sup, [mine.id])).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({ where: { id: mine.id } })
		expect(after).toMatchObject({ active: true, supervisorId: sup.id })
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: mine.id },
		})
		expect(events).toEqual([
			expect.objectContaining({
				userId: sup.id,
				action: "BRIGADE_ACTIVATED",
				diffJson: {
					before: { active: false, supervisorId: sup.id },
					after: { active: true, supervisorId: sup.id },
				},
			}),
		])
	})

	it("a stood-by brigade went back to the pool: another supervisor may claim it", async () => {
		const a = await supervisor(["NORTE"])
		const b = await supervisor(["SUR"])
		const target = await brigade({ area: "NORTE", supervisorId: a.id })
		expect(
			await standByBrigade(db, { brigadeId: target.id, viewerId: a.id }),
		).toEqual({ ok: true })

		expect(await assign(b, [target.id])).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: target.id },
		})
		expect(after).toMatchObject({ active: true, supervisorId: b.id })
	})

	it("Admin assigning another supervisor's inactive brigade changes nothing on it", async () => {
		const a = await supervisor(["NORTE"])
		const admin = { id: "admin-x", role: "ADMIN", areas: [] }
		const target = await brigade({
			active: false,
			area: "NORTE",
			supervisorId: a.id,
		})
		expect(await assign(admin, [target.id])).toEqual({ ok: true })
		await untouched(target.id, a.id)
	})
})

describe("pickerViewer", () => {
	it("carries a SUPERVISOR's admin-assigned areas", async () => {
		const fakeDb = {
			user: { findUnique: async () => ({ supervisorAreas: ["SUR"] }) },
		} as any
		expect(
			await pickerViewer(fakeDb, { id: "sup-1", role: "SUPERVISOR" }),
		).toEqual({ id: "sup-1", role: "SUPERVISOR", areas: ["SUR"] })
	})

	it("gives other roles no areas, without a lookup", async () => {
		const fakeDb = {
			user: {
				findUnique: vi.fn(async () => ({ supervisorAreas: ["SUR"] })),
			},
		} as any
		expect(await pickerViewer(fakeDb, { id: "a-1", role: "ADMIN" })).toEqual({
			id: "a-1",
			role: "ADMIN",
			areas: [],
		})
		expect(fakeDb.user.findUnique).not.toHaveBeenCalled()
	})
})
