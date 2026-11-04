import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

// Integration test against the shadow Postgres DB. Master's send_back wrote
// `financeSendBackNotes` entries {note, byUserId, createdAt} with no
// `resentAt`, and Finance verified those jobs after the supervisor's fix. A
// return only counts while the packet is released, unverified and has no LC
// request sent: such a legacy job must not read "Returned" anywhere.

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
	requireSession: vi.fn(),
}))
vi.mock("~/lib/email.server", () => ({ sendInternalEmail: vi.fn() }))

import { financeSendBackIds } from "~/lib/finance-stages.server"
import { loadNavCounts } from "~/lib/nav-counts.server"
import { openJobLabel } from "~/lib/open-job-label"
import { requireRole, requireSession } from "~/lib/permissions.server"
import { deriveSupervisorStage } from "~/lib/supervisor-stage"
import { loader as dashboardLoader } from "./_app.dashboard"
import { action as reviewAction } from "./_app.docs.$id_.review"
import { loader as queueLoader } from "./_app.finance.queue"
import { loader as receivablesLoader } from "./_app.finance.receivables"

const tracker = makeTracker()
const docIds: string[] = []
const signedSheet = { sigSupervisorAt: new Date(), sigSubcontractorAt: null }

afterAll(async () => {
	await db.preCertSheet.deleteMany({ where: { docId: { in: docIds } } })
	await tracker.cleanup()
})

let financeId: string
let supervisorId: string

beforeAll(async () => {
	financeId = tracker.track(
		"user",
		await seedUser({ role: "FINANCE", name: "Lissette" }),
	).id
	supervisorId = tracker.track(
		"user",
		await seedUser({ role: "SUPERVISOR", name: "Charlie" }),
	).id
})

/** A released packet carrying one master-era return (no resentAt). */
async function seedLegacyReturn(data: {
	financeVerifiedAt?: Date | null
	pbccRequestSentAt?: Date | null
}) {
	const doc = tracker.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			status: "CLARO_UPLOADED",
			supervisorId,
			pbccRequestSentAt: data.pbccRequestSentAt ?? null,
			releasedToFinanceAt: new Date("2026-10-20T14:00:00Z"),
		}),
	)
	docIds.push(doc.id)
	await db.preCertSheet.create({
		data: {
			docId: doc.id,
			version: 1,
			certifiedAddress: "123 Test St",
			title: "Pre-cert",
			issuedOn: new Date(),
			lines: [],
			total: 0,
			sigSupervisorAt: new Date(),
			issuedById: supervisorId,
		},
	})
	return db.jafInvoice.update({
		where: { id: doc.id },
		data: {
			supervisorApprovedAt: new Date("2026-10-18T12:00:00Z"),
			jafInvoiceGeneratedAt: new Date("2026-10-19T12:00:00Z"),
			financeVerifiedAt: data.financeVerifiedAt ?? null,
			financeVerifiedById: data.financeVerifiedAt ? financeId : null,
			financeSendBackNotes: [
				{
					note: "Aviso PDF is the wrong job",
					byUserId: financeId,
					createdAt: "2026-10-21T09:00:00.000Z",
				},
			],
		},
	})
}

function asSupervisor() {
	vi.mocked(requireSession).mockResolvedValue({
		user: { id: supervisorId },
	} as never)
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: supervisorId, role: "SUPERVISOR", name: "Charlie" },
		session: {},
	} as never)
}

function asFinance() {
	vi.mocked(requireSession).mockResolvedValue({
		user: { id: financeId },
	} as never)
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: financeId, role: "FINANCE", name: "Lissette" },
		session: {},
	} as never)
}

async function dashboard(query = "") {
	return dashboardLoader({
		request: new Request(`http://localhost/dashboard${query}`),
		params: {},
	} as never)
}

async function postReview(docId: string, intent: string) {
	const form = new FormData()
	form.set("intent", intent)
	form.set("replaceReason", "Finance asked")
	form.set("avisoNumber", "10353961")
	return reviewAction({
		request: new Request(`http://localhost/docs/${docId}/review`, {
			method: "POST",
			body: form,
		}),
		params: { id: docId },
	} as never).catch((r) => r)
}

describe("legacy send-back entries (no resentAt)", () => {
	it("a legacy return Finance already verified is not Returned anywhere", async () => {
		const doc = await seedLegacyReturn({
			financeVerifiedAt: new Date("2026-10-22T10:00:00Z"),
		})

		// Supervisor chip and step.
		expect(openJobLabel(doc, signedSheet)).toBe("RELEASED")
		expect(deriveSupervisorStage(doc, signedSheet)).toBe("RELEASED")

		// Supervisor sidebar counts, Returned box and lists.
		const counts = await loadNavCounts({ id: supervisorId, role: "SUPERVISOR" })
		expect(counts["/dashboard?stage=returned"].value).toBe(0)
		expect(counts["/dashboard?stage=released"].value).toBe(1)
		asSupervisor()
		const dash = await dashboard()
		expect(dash.supervisorQueues?.returned).toEqual([])
		expect((await dashboard("?stage=returned")).docs).toEqual([])
		expect(
			(await dashboard("?stage=released")).docs.map((d) => [d.id, d.openLabel]),
		).toEqual([[doc.id, "RELEASED"]])

		// Finance: not in Returned, not hidden from receivables.
		const sent = await financeSendBackIds()
		expect(sent.returned).not.toContain(doc.id)
		expect(sent.resent).not.toContain(doc.id)
		asFinance()
		const financeNav = await loadNavCounts({ id: financeId, role: "FINANCE" })
		expect(financeNav["/finance/queue?stage=returned"].value).toBe(
			sent.returned.length,
		)
		const queue = await queueLoader({
			request: new Request("http://localhost/finance/queue?stage=returned"),
			params: {},
		} as never)
		expect(queue.jobs.map((j) => j.id)).not.toContain(doc.id)
		const receivables = (await receivablesLoader({
			request: new Request("http://localhost/finance/receivables"),
			params: {},
		} as never)) as { rows: { id: string }[] }
		expect(receivables.rows.map((r) => r.id)).toContain(doc.id)
		const financeDash = await dashboard()
		expect(financeDash.docs.map((d) => d.id)).toContain(doc.id)

		// Review page stays locked: no Aviso replace, no Pre-cert regeneration.
		asSupervisor()
		for (const intent of ["replace_aviso", "generate_precert"]) {
			const res = await postReview(doc.id, intent)
			expect(res, intent).toBeInstanceOf(Response)
			expect((res as Response).status).toBe(302)
		}
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "AVISO_REPLACED" },
			}),
		).toBe(0)
		expect(await db.preCertSheet.count({ where: { docId: doc.id } })).toBe(1)
	})

	it("a legacy return on a job whose LC request went out is not Returned", async () => {
		const doc = await seedLegacyReturn({
			pbccRequestSentAt: new Date("2026-10-23T10:00:00Z"),
		})
		expect(openJobLabel(doc, signedSheet)).toBe("RELEASED")
		const sent = await financeSendBackIds()
		expect(sent.returned).not.toContain(doc.id)
		const counts = await loadNavCounts({ id: supervisorId, role: "SUPERVISOR" })
		expect(counts["/dashboard?stage=returned"].value).toBe(0)
	})

	it("the same legacy return on an unverified packet IS Returned", async () => {
		const doc = await seedLegacyReturn({ financeVerifiedAt: null })
		expect(openJobLabel(doc, signedSheet)).toBe("RETURNED")
		expect(deriveSupervisorStage(doc, signedSheet)).toBe("RELEASE")
		const counts = await loadNavCounts({ id: supervisorId, role: "SUPERVISOR" })
		expect(counts["/dashboard?stage=returned"].value).toBe(1)
		asSupervisor()
		expect(
			(await dashboard()).supervisorQueues?.returned.map((r) => r.id),
		).toEqual([doc.id])
		expect((await financeSendBackIds()).returned).toContain(doc.id)
		asFinance()
		const queue = await queueLoader({
			request: new Request("http://localhost/finance/queue?stage=returned"),
			params: {},
		} as never)
		expect(queue.jobs.map((j) => j.id)).toContain(doc.id)
		const receivables = (await receivablesLoader({
			request: new Request("http://localhost/finance/receivables"),
			params: {},
		} as never)) as { rows: { id: string }[] }
		expect(receivables.rows.map((r) => r.id)).not.toContain(doc.id)
	})
})
