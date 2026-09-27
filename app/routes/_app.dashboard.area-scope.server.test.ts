import { beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"

// Integration test against the real (test) Postgres DB — the dashboard's
// supervisor queues mix Prisma `findMany` filters with a raw `$queryRaw`
// (sentBack). Mocking `$queryRaw` can't prove the area-scoping actually
// works against Postgres, especially the `ANY(${areas})` array parameter
// with an empty array, so this exercises the loader end to end.

vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))

import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const suffix = Date.now()
const email = (tag: string) => `dash-scope-${tag}-${suffix}@x.com`
const control = (tag: string) => `DASH-SCOPE-${tag}-${suffix}`

const baseInvoice = {
	jobType: "Install",
	jobAddressEstimated: "123 Main",
	estimatedMaterials: {},
	assignedCrewIds: [] as string[],
}

async function runLoaderAs(userId: string) {
	vi.mocked(requireSession).mockResolvedValue({
		user: { id: userId },
	} as any)
	return loader({
		request: new Request("http://localhost/dashboard"),
		params: {},
	} as any)
}

describe("dashboard supervisor queues — area scoping (integration)", () => {
	let supervisorId: string
	let otherSupervisorId: string
	let ownDocId: string
	let secondAreaDocId: string
	let outsideDocId: string
	let sentBackOwnId: string
	let sentBackSecondAreaId: string
	let sentBackOutsideId: string
	let missingAvisoSecondAreaId: string

	let emptyBrigadeSupervisorId: string
	let emptyBrigadeOwnDocId: string

	beforeAll(async () => {
		const supervisor = await db.user.create({
			data: { email: email("sup"), name: "Sup", role: "SUPERVISOR" },
		})
		supervisorId = supervisor.id

		const otherSupervisor = await db.user.create({
			data: { email: email("other-sup"), name: "OtherSup", role: "SUPERVISOR" },
		})
		otherSupervisorId = otherSupervisor.id

		// Two brigades this supervisor supervises (multi-area union), plus one
		// they do NOT supervise, all in different areas.
		const brigadeSecondArea = await db.brigade.create({
			data: { name: `Brigade-SUR-${suffix}`, area: "SUR", supervisorId },
		})
		const brigadeOutside = await db.brigade.create({
			data: {
				name: `Brigade-NORTE-${suffix}`,
				area: "NORTE",
				supervisorId: otherSupervisorId,
			},
		})

		// (1) Owned directly via supervisorId — no brigade involved.
		const ownDoc = await db.jafInvoice.create({
			data: {
				...baseInvoice,
				controlNumber: control("own"),
				supervisorId,
				status: "FIELD_UPDATED",
			},
		})
		ownDocId = ownDoc.id

		// (2) NOT owned via supervisorId, but its brigade is in an area this
		// supervisor supervises — must be included via the area union.
		const secondAreaDoc = await db.jafInvoice.create({
			data: {
				...baseInvoice,
				controlNumber: control("second-area"),
				supervisorId: otherSupervisorId,
				brigadeId: brigadeSecondArea.id,
				status: "FIELD_UPDATED",
			},
		})
		secondAreaDocId = secondAreaDoc.id

		// (3) Neither owned nor in a supervised area — must be excluded.
		const outsideDoc = await db.jafInvoice.create({
			data: {
				...baseInvoice,
				controlNumber: control("outside"),
				supervisorId: otherSupervisorId,
				brigadeId: brigadeOutside.id,
				status: "FIELD_UPDATED",
			},
		})
		outsideDocId = outsideDoc.id

		// Same three scenarios again, but hitting the raw-SQL sentBack query
		// (status SIGNED with non-empty sendBackHistory).
		const sendBackHistory = [{ note: "fix address" }]
		sentBackOwnId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("sentback-own"),
					supervisorId,
					status: "SIGNED",
					sendBackHistory,
				},
			})
		).id
		sentBackSecondAreaId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("sentback-second-area"),
					supervisorId: otherSupervisorId,
					brigadeId: brigadeSecondArea.id,
					status: "SIGNED",
					sendBackHistory,
				},
			})
		).id
		sentBackOutsideId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("sentback-outside"),
					supervisorId: otherSupervisorId,
					brigadeId: brigadeOutside.id,
					status: "SIGNED",
					sendBackHistory,
				},
			})
		).id

		// Approved-but-missing-aviso, reached via the second supervised area.
		missingAvisoSecondAreaId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("missing-aviso-second-area"),
					supervisorId: otherSupervisorId,
					brigadeId: brigadeSecondArea.id,
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: new Date(),
					jafInvoiceLineTotal: 100,
				},
			})
		).id

		// A supervisor who owns zero brigades — areas = [] must not break the
		// raw-SQL `ANY(${areas})` path, and must still return their own doc.
		const emptyBrigadeSupervisor = await db.user.create({
			data: { email: email("empty-sup"), name: "EmptySup", role: "SUPERVISOR" },
		})
		emptyBrigadeSupervisorId = emptyBrigadeSupervisor.id
		emptyBrigadeOwnDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("empty-brigades-own"),
					supervisorId: emptyBrigadeSupervisorId,
					status: "FIELD_UPDATED",
				},
			})
		).id
	})

	it("includes docs owned directly and docs in a supervised (non-owned) brigade area, excludes out-of-area docs, in pendingReview", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.supervisorQueues?.pendingReview.map((r) => r.id) ?? []
		expect(ids).toContain(ownDocId)
		expect(ids).toContain(secondAreaDocId)
		expect(ids).not.toContain(outsideDocId)
	})

	it("applies the same area union to the raw-SQL sentBack queue", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.supervisorQueues?.sentBack.map((r) => r.id) ?? []
		expect(ids).toContain(sentBackOwnId)
		expect(ids).toContain(sentBackSecondAreaId)
		expect(ids).not.toContain(sentBackOutsideId)
	})

	it("applies the area union to the missingAviso queue", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.supervisorQueues?.missingAviso.map((r) => r.id) ?? []
		expect(ids).toContain(missingAvisoSecondAreaId)
	})

	it("a supervisor who owns zero brigades still gets their own docs without the empty-array raw SQL erroring", async () => {
		const data = await runLoaderAs(emptyBrigadeSupervisorId)
		expect(data.supervisorQueues).not.toBeNull()
		const ids = data.supervisorQueues?.pendingReview.map((r) => r.id) ?? []
		expect(ids).toEqual([emptyBrigadeOwnDocId])
		// The raw-SQL sentBack query must not throw with areas = [].
		expect(data.supervisorQueues?.sentBack).toEqual([])
	})

	it("the main doc list (buildBaseWhere) uses the same area union as the queues — includes an in-area, not-owned doc", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.docs.map((d) => d.id)
		expect(ids).toContain(ownDocId)
		expect(ids).toContain(secondAreaDocId)
		expect(ids).not.toContain(outsideDocId)
	})
})
