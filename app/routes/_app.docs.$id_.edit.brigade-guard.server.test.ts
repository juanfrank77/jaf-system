import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// Real database: the edit's brigade guard and any activation run inside the
// save transaction. Brigades already on the job pass through unchanged; only
// newly added ones go through the picker rules.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { makeTracker, runToken, seedBrigade, seedUser } from "~/test/helpers"
import { action } from "./_app.docs.$id_.edit"

const t = makeTracker()
afterAll(() => t.cleanup())

let supId = ""

beforeEach(async () => {
	vi.clearAllMocks()
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	await db.user.update({
		where: { id: sup.id },
		data: { supervisorAreas: ["SUR"] },
	})
	supId = sup.id
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: sup.id, role: "SUPERVISOR" },
		session: {},
	} as any)
})

async function brigade(overrides: Parameters<typeof seedBrigade>[0] = {}) {
	return t.track("brigade", await seedBrigade(overrides))
}

/** A CREATED job of this supervisor's, with `keptId` as its only brigade. */
async function jobWith(keptId: string) {
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
				supervisorId: supId,
				brigadeId: keptId,
				materialsFromWarehouse: true,
				prefieldNeeded: false,
				crewAssignmentHistory: [{ brigadeId: keptId, brigadeIds: [keptId] }],
			},
		}),
	)
}

function edit(docId: string, brigadeIds: string[], address = "2 New St") {
	const form = new FormData()
	form.set("jobType", "INSTALL")
	form.set("jobAddressEstimated", address)
	form.set("materials", "[]")
	form.set("materialsFromWarehouse", "yes")
	form.set("prefieldNeeded", "not_needed")
	for (const id of brigadeIds) form.append("brigadeId", id)
	return action({
		request: new Request(`http://localhost/docs/${docId}/edit`, {
			method: "POST",
			body: form,
		}),
		params: { id: docId },
	} as any).catch((r) => r)
}

describe("POST /docs/:id/edit — kept vs added brigades (real DB)", () => {
	it("a kept brigade that has gone inactive is not activated: no event, the edit saves", async () => {
		const other = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const kept = await brigade({ active: false, supervisorId: other.id })
		const doc = await jobWith(kept.id)

		const res = await edit(doc.id, [kept.id])

		expect(res.status).toBe(302)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: kept.id },
		})
		expect(after).toMatchObject({ active: false, supervisorId: other.id })
		expect(await db.brigadeEvent.count({ where: { brigadeId: kept.id } })).toBe(
			0,
		)
		const saved = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(saved.jobAddressEstimated).toBe("2 New St")
	})

	it("a kept brigade that has since been terminated does not block the edit", async () => {
		const kept = await brigade({ area: "SUR", terminatedAt: new Date() })
		const doc = await jobWith(kept.id)
		const res = await edit(doc.id, [kept.id])
		expect(res.status).toBe(302)
	})

	it("a kept brigade now with another supervisor does not block the edit", async () => {
		const other = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const kept = await brigade({ area: "METRO", supervisorId: other.id })
		const doc = await jobWith(kept.id)
		const res = await edit(doc.id, [kept.id])
		expect(res.status).toBe(302)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: kept.id },
		})
		expect(after.supervisorId).toBe(other.id)
	})

	it("an added inactive brigade is activated under the supervisor and logged with the doc id", async () => {
		const kept = await brigade({ area: "SUR" })
		const added = await brigade({
			active: false,
			area: null,
			supervisorId: null,
		})
		const doc = await jobWith(kept.id)

		const res = await edit(doc.id, [kept.id, added.id])

		expect(res.status).toBe(302)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: added.id },
		})
		expect(after).toMatchObject({ active: true, supervisorId: supId })
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: { in: [kept.id, added.id] } },
		})
		expect(events).toEqual([
			expect.objectContaining({
				brigadeId: added.id,
				userId: supId,
				docId: doc.id,
				action: "BRIGADE_ACTIVATED",
			}),
		])
	})

	it.each([
		[
			"an equipment (D) account",
			{ area: "SUR", isEquipmentAccount: true },
			"docs_edit.errors.brigade_invalid",
		],
		[
			"a terminated brigade",
			{ active: false, terminatedAt: new Date() },
			"docs_edit.errors.brigade_invalid",
		],
	] as const)(
		"refuses adding %s and saves nothing",
		async (_label, overrides, errorKey) => {
			const kept = await brigade({ area: "SUR" })
			let supervisorId: string | null = null
			if ("supervisorId" in overrides)
				supervisorId = t.track(
					"user",
					await seedUser({ role: "SUPERVISOR" }),
				).id
			const added = await brigade({ ...overrides, supervisorId })
			const doc = await jobWith(kept.id)

			const res = await edit(doc.id, [kept.id, added.id])

			expect(res).toEqual({ errorKey })
			const saved = await db.jafInvoice.findUniqueOrThrow({
				where: { id: doc.id },
			})
			expect(saved.jobAddressEstimated).toBe("1 Test St")
			expect(saved.brigadeId).toBe(kept.id)
			expect(
				await db.brigadeEvent.count({ where: { brigadeId: added.id } }),
			).toBe(0)
			const after = await db.brigade.findUniqueOrThrow({
				where: { id: added.id },
			})
			expect(after.supervisorId).toBe(supervisorId)
			expect(after.active).toBe("active" in overrides ? overrides.active : true)
		},
	)

	it("adds another supervisor's brigade, active or inactive, and leaves it with its owner", async () => {
		const owner = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const kept = await brigade({ area: "SUR" })
		const active = await brigade({ area: "METRO", supervisorId: owner.id })
		const idle = await brigade({
			active: false,
			area: "SUR",
			supervisorId: owner.id,
		})
		const doc = await jobWith(kept.id)

		const res = await edit(doc.id, [kept.id, active.id, idle.id])

		expect(res.status).toBe(302)
		for (const b of [active, idle]) {
			const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
			expect(after).toMatchObject({ active: true, supervisorId: owner.id })
		}
		// Only the activation is logged.
		expect(
			await db.brigadeEvent.count({
				where: { brigadeId: { in: [active.id, idle.id] } },
			}),
		).toBe(1)
	})
})
