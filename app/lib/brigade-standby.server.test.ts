import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedBrigade, seedUser } from "~/test/helpers"
import { pickableBrigades, pickerState } from "./brigade-picker"
import { standByBrigade } from "./brigade-standby.server"

const t = makeTracker()
afterAll(() => t.cleanup())

async function supervisor(areas: string[] = []) {
	const u = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	await db.user.update({
		where: { id: u.id },
		data: { supervisorAreas: areas },
	})
	return u
}

async function brigade(o: Parameters<typeof seedBrigade>[0] = {}) {
	return t.track("brigade", await seedBrigade(o))
}

async function jobOn(
	b: { id: string },
	supervisorId: string,
	status: "CREATED" | "FIELD_UPDATED" | "SUPERVISOR_APPROVED",
	history: unknown = null,
) {
	return t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: runToken("JAF"),
				status,
				jobType: "INSTALL",
				jobAddressEstimated: "1 Test St",
				estimatedMaterials: [],
				assignedCrewIds: [],
				brigadeId: b.id,
				supervisorId,
				...(history ? { crewAssignmentHistory: history as never } : {}),
			},
		}),
	)
}

describe("standByBrigade", () => {
	it("stands an idle own brigade by: inactive, no supervisor, logged, account kept, still pickable", async () => {
		const sup = await supervisor(["SUR"])
		const b = await brigade({ area: null, supervisorId: sup.id })
		const acct = t.track(
			"contractorAccount",
			await db.contractorAccount.create({
				data: { code: b.code as string, label: b.name, brigadeId: b.id },
			}),
		)
		const res = await standByBrigade(db, {
			brigadeId: b.id,
			viewerId: sup.id,
		})
		expect(res).toEqual({ ok: true })
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after.active).toBe(false)
		expect(after.supervisorId).toBeNull()
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: b.id },
		})
		expect(events).toHaveLength(1)
		expect(events[0]).toMatchObject({
			action: "BRIGADE_STANDBY",
			userId: sup.id,
			docId: null,
			diffJson: {
				before: { active: true, supervisorId: sup.id },
				after: { active: false, supervisorId: null },
			},
		})
		const kept = await db.contractorAccount.findUniqueOrThrow({
			where: { id: acct.id },
		})
		expect(kept.brigadeId).toBe(b.id)
		// Picker search still finds it, for the same and for another supervisor.
		for (const viewer of [
			{ id: sup.id, role: "SUPERVISOR", areas: ["SUR"] },
			{ id: "someone-else", role: "SUPERVISOR", areas: ["NORTE"] },
		]) {
			expect(pickerState(after, viewer)).toBe("inactive")
			expect(pickableBrigades([after], viewer)).toHaveLength(1)
		}
	})

	it("is idempotent: a second call writes no second event", async () => {
		const sup = await supervisor()
		const b = await brigade({ supervisorId: sup.id })
		await standByBrigade(db, { brigadeId: b.id, viewerId: sup.id })
		const again = await standByBrigade(db, {
			brigadeId: b.id,
			viewerId: sup.id,
		})
		expect(again).toEqual({ ok: true })
		expect(await db.brigadeEvent.count({ where: { brigadeId: b.id } })).toBe(1)
	})

	it("lets a supervisor of the brigade's area stand it by", async () => {
		const sup = await supervisor(["SUR"])
		const b = await brigade({ area: "SUR", supervisorId: null })
		expect(
			await standByBrigade(db, { brigadeId: b.id, viewerId: sup.id }),
		).toEqual({ ok: true })
	})

	it("refuses another supervisor (not owner, not area)", async () => {
		const owner = await supervisor(["SUR"])
		const other = await supervisor(["NORTE"])
		const b = await brigade({ area: "SUR", supervisorId: owner.id })
		expect(
			await standByBrigade(db, { brigadeId: b.id, viewerId: other.id }),
		).toEqual({ ok: false, errorKey: "supervisor_brigades.errors.not_yours" })
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after.active).toBe(true)
		expect(after.supervisorId).toBe(owner.id)
	})

	it("refuses an unknown, equipment or terminated brigade", async () => {
		const sup = await supervisor()
		const notFound = {
			ok: false,
			errorKey: "supervisor_brigades.errors.not_found",
		}
		expect(
			await standByBrigade(db, { brigadeId: "nope", viewerId: sup.id }),
		).toEqual(notFound)
		const d = await brigade({ supervisorId: sup.id, isEquipmentAccount: true })
		expect(
			await standByBrigade(db, { brigadeId: d.id, viewerId: sup.id }),
		).toEqual(notFound)
		const gone = await brigade({
			supervisorId: sup.id,
			terminatedAt: new Date(),
		})
		expect(
			await standByBrigade(db, { brigadeId: gone.id, viewerId: sup.id }),
		).toEqual(notFound)
	})

	it("refuses while the brigade is on a job in progress, as lead or in the assignment", async () => {
		const sup = await supervisor()
		const onJob = { ok: false, errorKey: "supervisor_brigades.errors.on_a_job" }
		const lead = await brigade({ supervisorId: sup.id })
		await jobOn(lead, sup.id, "CREATED")
		expect(
			await standByBrigade(db, { brigadeId: lead.id, viewerId: sup.id }),
		).toEqual(onJob)

		const helper = await brigade({ supervisorId: sup.id })
		const other = await brigade()
		await jobOn(other, sup.id, "FIELD_UPDATED", [
			{ brigadeIds: [other.id, helper.id] },
		])
		expect(
			await standByBrigade(db, { brigadeId: helper.id, viewerId: sup.id }),
		).toEqual(onJob)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: helper.id },
		})
		expect(after.active).toBe(true)
		expect(
			await db.brigadeEvent.count({ where: { brigadeId: helper.id } }),
		).toBe(0)
	})

	it("allows stand-by once the job is past the field update", async () => {
		const sup = await supervisor()
		const b = await brigade({ supervisorId: sup.id })
		await jobOn(b, sup.id, "SUPERVISOR_APPROVED")
		expect(
			await standByBrigade(db, { brigadeId: b.id, viewerId: sup.id }),
		).toEqual({ ok: true })
	})
})
