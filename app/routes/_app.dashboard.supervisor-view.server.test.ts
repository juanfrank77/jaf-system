import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"

// Integration test against the real (test) Postgres DB. The supervisor
// dashboard now renders the same stat tiles / filters / list as the other
// roles, so the loader must hand the supervisor path real stats (it used to
// return an empty set) and enrich each queue row with its age and a
// quantity-discrepancy flag.

vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))

import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const suffix = `sv${Date.now()}`
const control = (tag: string) => `DASH-SV-${tag}-${suffix}`

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

const baseInvoice = {
	jobType: "Install",
	jobAddressEstimated: "123 Main",
	estimatedMaterials: {},
	assignedCrewIds: [] as string[],
}

describe("dashboard supervisor view data (integration)", () => {
	let supervisorId: string
	// The dev DB already holds the real CENTRAL brigades, so count relative
	// to what was there before this suite added its own.
	let baselineBrigades = 0
	let discrepancyDocId: string
	let cleanDocId: string
	let sentBackDocId: string
	let approvedDocId: string
	const submittedAt = new Date("2026-09-01T12:00:00Z")
	const returnedAt = "2026-09-02T12:00:00.000Z"
	const approvedAt = new Date("2026-09-03T12:00:00Z")

	beforeAll(async () => {
		baselineBrigades = await db.brigade.count({
			where: { active: true, area: "CENTRAL" },
		})
		supervisorId = (
			await db.user.create({
				data: {
					email: `dash-sv-${suffix}@x.com`,
					name: "SvSup",
					role: "SUPERVISOR",
					supervisorAreas: ["CENTRAL"],
				},
			})
		).id
		await db.brigade.create({
			data: { name: `SV-Brigade-A-${suffix}`, area: "CENTRAL", active: true },
		})
		await db.brigade.create({
			data: { name: `SV-Brigade-B-${suffix}`, area: "CENTRAL", active: true },
		})
		await db.brigade.create({
			data: { name: `SV-Brigade-C-${suffix}`, area: "CENTRAL", active: false },
		})

		discrepancyDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("disc"),
					supervisorId,
					status: "FIELD_UPDATED",
					fieldSubmittedAt: submittedAt,
					materialsTaken: [{ serviceCodeId: "s1", qty: 2 }],
					materialsUsed: [{ serviceCodeId: "s1", qty: 1 }],
				},
			})
		).id
		cleanDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("clean"),
					supervisorId,
					status: "FIELD_UPDATED",
					fieldSubmittedAt: submittedAt,
					materialsTaken: [{ serviceCodeId: "s1", qty: 1 }],
					materialsUsed: [{ serviceCodeId: "s1", qty: 1 }],
				},
			})
		).id
		sentBackDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("sent-back"),
					supervisorId,
					status: "SIGNED",
					sendBackHistory: [{ note: "retake photos", createdAt: returnedAt }],
				},
			})
		).id
		approvedDocId = (
			await db.jafInvoice.create({
				data: {
					...baseInvoice,
					controlNumber: control("approved"),
					supervisorId,
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: approvedAt,
					jafInvoiceLineTotal: 100,
				},
			})
		).id
	})

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: suffix } },
		})
		await db.brigade.deleteMany({ where: { name: { endsWith: suffix } } })
		await db.user.delete({ where: { id: supervisorId } })
	})

	it("returns real stat tiles and the approval alert for a supervisor", async () => {
		const data = await runLoaderAs(supervisorId)
		expect(data.stats).toHaveLength(12)
		expect(data.stats.slice(0, 3).map((s) => s.labelKey)).toEqual([
			"dashboard.stat.awaiting_warehouse",
			"dashboard.stat.awaiting_crew",
			"dashboard.stat.pending_review",
		])
		expect(data.alert).toMatchObject({
			key: "dashboard.alert.pending_review",
			count: 2,
		})
	})

	it("keeps the tiles on the full scope when a filter narrows the list", async () => {
		const data = await runLoaderAs(supervisorId, "status=SIGNED")
		expect(data.docs.map((d) => d.id)).toEqual([sentBackDocId])
		const pending = data.stats.find(
			(s) => s.labelKey === "dashboard.stat.pending_review",
		)
		expect(pending?.value).toBe(2)
	})

	it("reports the supervisor's areas and active brigade count", async () => {
		const data = await runLoaderAs(supervisorId)
		expect(data.supervisorScope).toEqual({
			areas: ["CENTRAL"],
			brigadeCount: baselineBrigades + 2,
		})
	})

	it("carries the submitted time on pending-review rows and never tags a used-vs-issued difference", async () => {
		const data = await runLoaderAs(supervisorId)
		const rows = data.supervisorQueues?.pendingReview ?? []
		const disc = rows.find((r) => r.id === discrepancyDocId)
		const clean = rows.find((r) => r.id === cleanDocId)
		expect(disc).toBeDefined()
		expect(clean).toBeDefined()
		expect(disc).not.toHaveProperty("qtyDiscrepancy")
		expect(clean).not.toHaveProperty("qtyDiscrepancy")
		expect(new Date(disc?.since as Date).toISOString()).toBe(
			submittedAt.toISOString(),
		)
	})

	it("carries the approval time on the missing-Aviso queue", async () => {
		const data = await runLoaderAs(supervisorId)
		const missing = data.supervisorQueues?.missingAviso.find(
			(r) => r.id === approvedDocId,
		)
		expect(new Date(missing?.since as Date).toISOString()).toBe(
			approvedAt.toISOString(),
		)
	})
	it("narrows the list to a sidebar queue with ?stage=, and leaves the tiles on the full scope", async () => {
		const review = await runLoaderAs(supervisorId, "stage=review")
		expect(review.docs.map((d) => d.id).sort()).toEqual(
			[discrepancyDocId, cleanDocId].sort(),
		)
		expect(review.stageQueue).toBe("review")
		const pending = review.stats.find(
			(s) => s.labelKey === "dashboard.stat.pending_review",
		)
		expect(pending?.value).toBe(2)

		const invoice = await runLoaderAs(supervisorId, "stage=invoice")
		expect(invoice.docs.map((d) => d.id)).toEqual([approvedDocId])

		const aviso = await runLoaderAs(supervisorId, "stage=aviso")
		expect(aviso.docs).toEqual([])

		const all = await runLoaderAs(supervisorId, "stage=all")
		expect(all.docs).toHaveLength(4)
	})

	it("ignores an unknown ?stage= value", async () => {
		const data = await runLoaderAs(supervisorId, "stage=bogus")
		expect(data.stageQueue).toBeNull()
		expect(data.docs).toHaveLength(4)
	})
})

describe("Packets to Claro queue (integration)", () => {
	const tag = `pk${Date.now()}`
	let supId: string
	let unsentId: string
	let sentId: string
	let attemptedId: string

	beforeAll(async () => {
		supId = (
			await db.user.create({
				data: {
					email: `dash-pk-${tag}@x.com`,
					name: "PkSup",
					role: "SUPERVISOR",
					supervisorAreas: [],
				},
			})
		).id
		const make = (name: string, data: Record<string, unknown>) =>
			db.jafInvoice
				.create({
					data: {
						...baseInvoice,
						controlNumber: `DASH-PK-${name}-${tag}`,
						supervisorId: supId,
						status: "SUPERVISOR_APPROVED",
						supervisorApprovedAt: new Date("2026-10-18T10:00:00Z"),
						...data,
					},
				})
				.then((d) => d.id)
		unsentId = await make("unsent", {})
		// An UNCONFIGURED attempt stores the PDF but is not a send.
		attemptedId = await make("attempted", {
			jafInvoicePdfPath: "/uploads/packets/x-packet-1.pdf",
		})
		sentId = await make("sent", {
			jafInvoiceGeneratedAt: new Date("2026-10-18T12:00:00Z"),
			jafInvoicePdfPath: "/uploads/packets/y-packet-2.pdf",
		})
	})

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: tag } },
		})
		await db.user.delete({ where: { id: supId } })
	})

	it("lists sent and not-sent jobs, with sent derived from jafInvoiceGeneratedAt only", async () => {
		const data = await runLoaderAs(supId, "stage=invoice")
		const byId = new Map(data.docs.map((d) => [d.id, d]))
		expect([...byId.keys()].sort()).toEqual(
			[unsentId, attemptedId, sentId].sort(),
		)
		expect(byId.get(sentId)?.jafInvoiceGeneratedAt).toBeInstanceOf(Date)
		expect(byId.get(unsentId)?.jafInvoiceGeneratedAt).toBeNull()
		expect(byId.get(attemptedId)?.jafInvoiceGeneratedAt).toBeNull()
		expect(byId.get(sentId)?.openLabel).toBe("SENT_WAITING_AVISO")
		expect(byId.get(attemptedId)?.openLabel).toBe("READY_TO_SEND")
	})
})

describe("Aviso discrepancy: Action needed card and the admin alert (integration)", () => {
	const tag = `ad${Date.now()}`
	const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000)
	const discrepancy = (days: number, note: string | null) => ({
		detectedAt: daysAgo(days).toISOString(),
		differences: [
			{ claroCode: "4003587", name: "POSTE", workOrder: 3, aviso: 2 },
		],
		note,
		noteAt: note ? daysAgo(days).toISOString() : null,
		noteById: null,
	})
	let supId: string
	let adminId: string
	let notedId: string
	let freshId: string
	let cleanId: string
	let releasedId: string
	let baselineStale = 0

	const staleCount = (data: Awaited<ReturnType<typeof runLoaderAs>>) =>
		data.alert?.key === "dashboard.alert.stale_aviso_discrepancy"
			? data.alert.count
			: 0

	beforeAll(async () => {
		adminId = (
			await db.user.create({
				data: {
					email: `dash-ad-admin-${tag}@x.com`,
					name: "AdAdmin",
					role: "ADMIN",
				},
			})
		).id
		baselineStale = staleCount(await runLoaderAs(adminId))
		supId = (
			await db.user.create({
				data: {
					email: `dash-ad-${tag}@x.com`,
					name: "AdSup",
					role: "SUPERVISOR",
					supervisorAreas: [],
				},
			})
		).id
		const make = (name: string, data: Record<string, unknown>) =>
			db.jafInvoice
				.create({
					data: {
						...baseInvoice,
						controlNumber: `DASH-AD-${name}-${tag}`,
						supervisorId: supId,
						status: "CLARO_UPLOADED",
						supervisorApprovedAt: daysAgo(10),
						jafInvoiceGeneratedAt: daysAgo(9),
						avisoNumber: "10354739",
						avisoDocPath: "/uploads/aviso-docs/x-aviso.pdf",
						...data,
					},
				})
				.then((d) => d.id)
		// Continued with a note: the card stays until a clean Aviso.
		notedId = await make("noted", { avisoDiscrepancy: discrepancy(4, "noted") })
		freshId = await make("fresh", { avisoDiscrepancy: discrepancy(1, null) })
		cleanId = await make("clean", {})
		releasedId = await make("released", {
			avisoDiscrepancy: discrepancy(5, "noted"),
			releasedToFinanceAt: daysAgo(1),
		})
	})

	afterAll(async () => {
		await db.jafInvoice.deleteMany({
			where: { controlNumber: { endsWith: tag } },
		})
		await db.user.deleteMany({ where: { id: { in: [supId, adminId] } } })
	})

	it("lists the supervisor's unreleased jobs with a discrepancy, with days open", async () => {
		const data = await runLoaderAs(supId)
		const rows = data.supervisorQueues?.actionNeeded ?? []
		const byId = new Map(rows.map((r) => [r.id, r]))
		expect([...byId.keys()].sort()).toEqual([notedId, freshId].sort())
		expect(byId.get(notedId)?.daysOpen).toBe(4)
		expect(byId.get(freshId)?.daysOpen).toBe(1)
		expect(byId.has(cleanId)).toBe(false)
		expect(byId.has(releasedId)).toBe(false)
	})

	it("alerts the admin on stale discrepancies, released or not", async () => {
		const data = await runLoaderAs(adminId)
		// noted (4 days) and released (5 days); fresh (1 day) is not stale.
		expect(staleCount(data)).toBe(baselineStale + 2)
	})
})
