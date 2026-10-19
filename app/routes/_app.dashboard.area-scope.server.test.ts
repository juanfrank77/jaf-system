import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
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

async function runLoaderAs(userId: string, searchParams?: string) {
	vi.mocked(requireSession).mockResolvedValue({
		user: { id: userId },
	} as any)
	return loader({
		request: new Request(
			`http://localhost/dashboard${searchParams ? `?${searchParams}` : ""}`,
		),
		params: {},
	} as any)
}

describe("dashboard supervisor queues — area scoping (integration)", () => {
	let supervisorId: string
	let otherSupervisorId: string
	let ownDocId: string
	let secondAreaDocId: string
	let outsideDocId: string
	let missingAvisoSecondAreaId: string

	let emptyBrigadeSupervisorId: string
	let emptyBrigadeOwnDocId: string

	const searchToken = `SEARCHTOK${suffix}`
	let searchOwnDocId: string
	let searchOutsideDocId: string

	beforeAll(async () => {
		// supervisorAreas is admin-managed (User.supervisorAreas), never
		// derived from which brigades a supervisor happens to own — set it
		// directly here, the same way an admin would via /admin/users.
		const supervisor = await db.user.create({
			data: {
				email: email("sup"),
				name: "Sup",
				role: "SUPERVISOR",
				supervisorAreas: ["SUR"],
			},
		})
		supervisorId = supervisor.id

		const otherSupervisor = await db.user.create({
			data: { email: email("other-sup"), name: "OtherSup", role: "SUPERVISOR" },
		})
		otherSupervisorId = otherSupervisor.id

		// A brigade in this supervisor's admin-assigned area (SUR) that they
		// do NOT own directly, plus one in an area they don't cover (NORTE).
		// Brigade.supervisorId is informational only now — it plays no role
		// in authorization scope.
		const brigadeSecondArea = await db.brigade.create({
			data: {
				name: `Brigade-SUR-${suffix}`,
				area: "SUR",
				supervisorId: otherSupervisorId,
			},
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

		// Regression: a search filter must narrow the supervisor's own scope,
		// never replace it — both docs share a search token, but one is owned
		// by this supervisor and the other belongs to a different supervisor,
		// in an area this supervisor does not cover.
		searchOwnDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("search-own"),
					supervisorId,
					jobAddressEstimated: `${searchToken} own address`,
					status: "FIELD_UPDATED",
				},
			})
		).id
		searchOutsideDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("search-outside"),
					supervisorId: otherSupervisorId,
					brigadeId: brigadeOutside.id,
					jobAddressEstimated: `${searchToken} outside address`,
					status: "FIELD_UPDATED",
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

	// Everything this suite creates is tagged with `suffix`; delete it so the
	// shared test DB does not accumulate fixtures across runs. FK order:
	// docs → brigades → users.
	afterAll(async () => {
		const docs = await db.jafInvoice.findMany({
			where: {
				controlNumber: { endsWith: `-${suffix}`, startsWith: "DASH-SCOPE-" },
			},
			select: { id: true },
		})
		const docIds = docs.map((d) => d.id)
		await db.$transaction([
			db.auditTrail.deleteMany({ where: { docId: { in: docIds } } }),
			db.jafInvoice.deleteMany({ where: { id: { in: docIds } } }),
			db.brigade.deleteMany({
				where: {
					OR: [
						{ name: `Brigade-SUR-${suffix}` },
						{ name: `Brigade-NORTE-${suffix}` },
					],
				},
			}),
			db.user.deleteMany({
				where: {
					email: { startsWith: "dash-scope-", endsWith: `-${suffix}@x.com` },
				},
			}),
		])
	})

	it("includes docs owned directly and docs in a supervised (non-owned) brigade area, excludes out-of-area docs, in pendingReview", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.supervisorQueues?.pendingReview.map((r) => r.id) ?? []
		expect(ids).toContain(ownDocId)
		expect(ids).toContain(secondAreaDocId)
		expect(ids).not.toContain(outsideDocId)
	})

	it("applies the area union to the missingAviso queue", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.supervisorQueues?.missingAviso.map((r) => r.id) ?? []
		expect(ids).toContain(missingAvisoSecondAreaId)
	})

	it("a supervisor who owns zero brigades still gets their own docs", async () => {
		const data = await runLoaderAs(emptyBrigadeSupervisorId)
		expect(data.supervisorQueues).not.toBeNull()
		const ids = data.supervisorQueues?.pendingReview.map((r) => r.id) ?? []
		expect(ids).toEqual([emptyBrigadeOwnDocId])
	})

	it("the main doc list (buildBaseWhere) uses the same area union as the queues — includes an in-area, not-owned doc", async () => {
		const data = await runLoaderAs(supervisorId)
		const ids = data.docs.map((d) => d.id)
		expect(ids).toContain(ownDocId)
		expect(ids).toContain(secondAreaDocId)
		expect(ids).not.toContain(outsideDocId)
	})

	it("regression: a search filter narrows a supervisor's scope, it does not replace/drop it — an out-of-area doc matching the search term must not appear", async () => {
		const data = await runLoaderAs(supervisorId, `search=${searchToken}`)
		const ids = data.docs.map((d) => d.id)
		expect(ids).toContain(searchOwnDocId)
		expect(ids).not.toContain(searchOutsideDocId)
	})
})
