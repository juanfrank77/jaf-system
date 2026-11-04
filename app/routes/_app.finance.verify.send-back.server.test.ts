import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

// Integration test against the shadow Postgres DB: Finance's send_back on a
// packet, and what the supervisor's side reads back from it (S4, "Returned
// packets must say Returned").

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
	requireSession: vi.fn(),
}))
vi.mock("~/lib/email.server", () => ({ sendInternalEmail: vi.fn() }))
// The photo rows below have no files on disk; the gate only needs the tags.
vi.mock("~/lib/uploads.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/uploads.server")>()),
	photosThatLoad: vi.fn(async (_docId: string, photos: unknown[]) => photos),
}))

import { loadNavCounts } from "~/lib/nav-counts.server"
import { openJobLabel } from "~/lib/open-job-label"
import { requireRole, requireSession } from "~/lib/permissions.server"
import {
	isResent,
	isReturned,
	latestReturn,
	returnHistory,
} from "~/lib/returned-packet"
import { deriveSupervisorStage } from "~/lib/supervisor-stage"
import { loader as dashboardLoader } from "./_app.dashboard"
import { action as reviewAction } from "./_app.docs.$id_.review"
import { action } from "./_app.finance.verify.$id"

const tracker = makeTracker()
const docIds: string[] = []
const signedSheet = { sigSupervisorAt: new Date(), sigSubcontractorAt: null }

afterAll(async () => {
	// Release fans a notification out to every active Finance user, tracked
	// or not; the sheets and photos hang off the jobs.
	await db.notification.deleteMany({ where: { docId: { in: docIds } } })
	await db.preCertSheet.deleteMany({ where: { docId: { in: docIds } } })
	await db.photo.deleteMany({ where: { docId: { in: docIds } } })
	await tracker.cleanup()
})

async function sendBack(docId: string, financeId: string, note: string) {
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: financeId, role: "FINANCE" },
	} as never)
	const form = new FormData()
	form.set("intent", "send_back")
	form.set("note", note)
	try {
		await action({
			request: new Request(`http://localhost/finance/verify/${docId}`, {
				method: "POST",
				body: form,
			}),
			params: { id: docId },
		} as never)
	} catch (e) {
		if (!(e instanceof Response)) throw e
	}
}

describe("Finance send_back: what the supervisor sees (characterisation)", () => {
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

	it("a released packet sent back keeps releasedToFinanceAt (stage was RELEASED before S4); it now reads Returned on his Release step", async () => {
		const doc = tracker.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				supervisorId,
				pbccRequestSentAt: null,
				releasedToFinanceAt: new Date("2026-10-26T14:00:00Z"),
			}),
		)
		docIds.push(doc.id)
		await sendBack(doc.id, financeId, "Aviso 10359868 lists the wrong pole")

		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		// The facts send_back leaves behind.
		expect(after.releasedToFinanceAt).toEqual(new Date("2026-10-26T14:00:00Z"))
		expect(after.financeVerifiedAt).toBeNull()
		expect(after.financeSendBackNotes).toEqual([
			expect.objectContaining({
				note: "Aviso 10359868 lists the wrong pole",
				byUserId: financeId,
			}),
		])
		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "FINANCE_SEND_BACK" },
		})
		expect(audit.map((a) => a.diffJson)).toEqual([
			{ note: "Aviso 10359868 lists the wrong pole" },
		])
		// The bell notification carries the note word for word.
		const bell = await db.notification.findMany({
			where: { docId: doc.id, userId: supervisorId },
		})
		expect(bell.map((n) => n.message)).toEqual([
			`Finance returned job ${doc.controlNumber} for Aviso correction: Aviso 10359868 lists the wrong pole`,
		])
		// Regression anchor: nothing on the supervisor's chip said "Returned".
		// S4 turns the label into RETURNED and sends the job back to his
		// Release step, where he can fix and resend it.
		expect(deriveSupervisorStage(after, signedSheet)).toBe("RELEASE")
		expect(openJobLabel(after, signedSheet)).toBe("RETURNED")
	})

	it("a job never released can no longer be sent back (before S4 it then showed the orange Release chip: Kay's MAINT261026004)", async () => {
		const doc = tracker.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				supervisorId,
				pbccRequestSentAt: null,
				releasedToFinanceAt: null,
			}),
		)
		docIds.push(doc.id)
		await sendBack(doc.id, financeId, "Missing the Aviso PDF page 2")

		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.financeSendBackNotes).toBeNull()
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "FINANCE_SEND_BACK" },
			}),
		).toBe(0)
		// A return already on record from before the guard (the demo's
		// MAINT261026004) no longer counts: a return is only live on a
		// released packet, so the job is on its own Release step.
		const legacy = await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				financeSendBackNotes: [
					{
						note: "Missing the Aviso PDF page 2",
						byUserId: financeId,
						createdAt: "2026-10-26T14:00:00.000Z",
					},
				],
			},
		})
		expect(deriveSupervisorStage(legacy, signedSheet)).toBe("RELEASE")
		expect(openJobLabel(legacy, signedSheet)).toBe("RELEASE")
	})
})

/** A released packet that passes the release gate (work order PDF, Aviso,
 * supervisor-signed Pre-cert, before and after photos). */
async function seedReleasedPacket(supervisorId: string) {
	const doc = tracker.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			supervisorId,
			pbccRequestSentAt: null,
			releasedToFinanceAt: new Date("2026-10-26T14:00:00Z"),
		}),
	)
	docIds.push(doc.id)
	await db.jafInvoice.update({
		where: { id: doc.id },
		data: {
			supervisorApprovedAt: new Date("2026-10-20T12:00:00Z"),
			jafInvoiceGeneratedAt: new Date("2026-10-21T12:00:00Z"),
			jafInvoicePdfPath: `/var/jaf/uploads/packets/${doc.id}-packet-1.pdf`,
		},
	})
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
	await db.photo.createMany({
		data: (["BEFORE", "AFTER"] as const).map((tag) => ({
			docId: doc.id,
			uploadedById: supervisorId,
			localPath: `${tag}.jpg`,
			tag,
		})),
	})
	return doc
}

async function resend(docId: string, supervisorId: string) {
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: supervisorId, role: "SUPERVISOR", name: "Charlie" },
		session: {},
	} as never)
	const form = new FormData()
	form.set("intent", "release_to_finance")
	return reviewAction({
		request: new Request(`http://localhost/docs/${docId}/review`, {
			method: "POST",
			body: form,
		}),
		params: { id: docId },
	} as never).catch((r) => r)
}

describe("Returned packet round trip (S4)", () => {
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

	it("send_back leaves the packet returned, out of Released to Finance and in Returned (n)", async () => {
		const doc = await seedReleasedPacket(supervisorId)
		const user = { id: supervisorId, role: "SUPERVISOR" as const }
		const before = await loadNavCounts(user)
		expect(before["/dashboard?stage=released"].value).toBe(1)
		expect(before["/dashboard?stage=returned"].value).toBe(0)

		await sendBack(doc.id, financeId, "Aviso 10359868: wrong pole count")

		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(isReturned(after)).toBe(true)
		const counts = await loadNavCounts(user)
		expect(counts["/dashboard?stage=released"].value).toBe(0)
		expect(counts["/dashboard?stage=returned"]).toEqual({
			value: 1,
			tone: "critical",
		})

		vi.mocked(requireSession).mockResolvedValue({
			user: { id: supervisorId },
		} as never)
		const dash = await dashboardLoader({
			request: new Request("http://localhost/dashboard"),
			params: {},
		} as never)
		expect(dash.supervisorQueues?.returned).toEqual([
			expect.objectContaining({
				id: doc.id,
				stage: "RELEASE",
				openLabel: "RETURNED",
				note: "Aviso 10359868: wrong pole count",
			}),
		])
		const returnedList = await dashboardLoader({
			request: new Request("http://localhost/dashboard?stage=returned"),
			params: {},
		} as never)
		expect(returnedList.docs.map((d) => [d.id, d.stage, d.openLabel])).toEqual([
			[doc.id, "RELEASE", "RETURNED"],
		])
		const releasedList = await dashboardLoader({
			request: new Request("http://localhost/dashboard?stage=released"),
			params: {},
		} as never)
		expect(releasedList.docs).toEqual([])
	})

	it("the supervisor's resend stamps resentAt, logs FINANCE_RESEND with the note and releases again", async () => {
		const doc = await seedReleasedPacket(supervisorId)
		await sendBack(doc.id, financeId, "First: Aviso PDF is blurry")
		await sendBack(doc.id, financeId, "Second: crew signature missing")

		const res = await resend(doc.id, supervisorId)
		expect(res.status).toBe(302)

		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(isReturned(after)).toBe(false)
		expect(isResent(after)).toBe(true)
		expect(latestReturn(after)).toMatchObject({
			note: "Second: crew signature missing",
			resentAt: expect.any(String),
		})
		expect(after.releasedToFinanceById).toBe(supervisorId)
		expect(after.releasedToFinanceAt?.getTime()).toBeGreaterThan(
			new Date("2026-10-26T14:00:00Z").getTime(),
		)
		const trail = await db.auditTrail.findMany({
			where: {
				docId: doc.id,
				action: { in: ["FINANCE_SEND_BACK", "FINANCE_RESEND"] },
			},
			orderBy: { timestamp: "asc" },
		})
		expect(trail.map((a) => [a.action, a.userId, a.diffJson])).toEqual([
			["FINANCE_SEND_BACK", financeId, { note: "First: Aviso PDF is blurry" }],
			[
				"FINANCE_SEND_BACK",
				financeId,
				{ note: "Second: crew signature missing" },
			],
			[
				"FINANCE_RESEND",
				supervisorId,
				{
					note: "Second: crew signature missing",
					// The release gate it passed again, as on a first release.
					rows: expect.arrayContaining([
						{ key: "precert_signed", ok: true, detail: null },
					]),
				},
			],
		])
		const sheet = await db.preCertSheet.findFirstOrThrow({
			where: { docId: doc.id },
		})
		expect(deriveSupervisorStage(after, sheet)).toBe("RELEASED")
		expect(openJobLabel(after, sheet)).toBe("RELEASED")

		// A second click is a no-op: the packet is with Finance again.
		await resend(doc.id, supervisorId)
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "FINANCE_RESEND" },
			}),
		).toBe(1)
	})

	it("return, resend, return again: returned again with the new note; history keeps all three; a second resend stamps only the new one", async () => {
		const doc = await seedReleasedPacket(supervisorId)
		await sendBack(doc.id, financeId, "One: Aviso PDF is blurry")
		await sendBack(doc.id, financeId, "Two: crew signature missing")
		expect((await resend(doc.id, supervisorId)).status).toBe(302)
		const firstResentAt = latestReturn(
			await db.jafInvoice.findUniqueOrThrow({ where: { id: doc.id } }),
		)?.resentAt

		await sendBack(doc.id, financeId, "Three: wrong pole count")
		const again = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(isReturned(again)).toBe(true)
		expect(latestReturn(again)).toMatchObject({
			note: "Three: wrong pole count",
		})
		expect(latestReturn(again)?.resentAt).toBeUndefined()
		expect(
			returnHistory(again.financeSendBackNotes).map((e) => e.note),
		).toEqual([
			"One: Aviso PDF is blurry",
			"Two: crew signature missing",
			"Three: wrong pole count",
		])

		expect((await resend(doc.id, supervisorId)).status).toBe(302)
		const history = returnHistory(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: doc.id } }))
				.financeSendBackNotes,
		)
		expect(history.map((e) => e.resentAt)).toEqual([
			undefined,
			firstResentAt,
			expect.any(String),
		])
		expect(history[2].resentAt).not.toBe(firstResentAt)
		const resends = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "FINANCE_RESEND" },
			orderBy: { timestamp: "asc" },
		})
		expect(resends.map((a) => (a.diffJson as { note: string }).note)).toEqual([
			"Two: crew signature missing",
			"Three: wrong pole count",
		])
	})

	it("a never-released job with an unanswered legacy return: its first release answers it, so Finance can verify", async () => {
		const doc = await seedReleasedPacket(supervisorId)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				releasedToFinanceAt: null,
				financeSendBackNotes: [
					{
						note: "Legacy: missing the Aviso PDF page 2",
						byUserId: financeId,
						createdAt: "2026-10-20T14:00:00.000Z",
					},
				],
			},
		})
		expect((await resend(doc.id, supervisorId)).status).toBe(302)

		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.releasedToFinanceAt).not.toBeNull()
		expect(isReturned(after)).toBe(false)
		expect(latestReturn(after)?.resentAt).toEqual(
			after.releasedToFinanceAt?.toISOString(),
		)
		const sheet = await db.preCertSheet.findFirstOrThrow({
			where: { docId: doc.id },
		})
		expect(openJobLabel(after, sheet)).toBe("RELEASED")
		// One audit row, with the note answered and the gate it passed.
		const trail = await db.auditTrail.findMany({
			where: {
				docId: doc.id,
				action: { in: ["RELEASED_TO_FINANCE", "FINANCE_RESEND"] },
			},
		})
		expect(trail.map((a) => [a.action, a.diffJson])).toEqual([
			[
				"FINANCE_RESEND",
				{
					note: "Legacy: missing the Aviso PDF page 2",
					rows: expect.arrayContaining([
						{ key: "precert_signed", ok: true, detail: null },
					]),
				},
			],
		])

		// Finance can verify it straight away.
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: financeId, role: "FINANCE" },
		} as never)
		const form = new FormData()
		form.set("intent", "verify")
		const res = await action({
			request: new Request(`http://localhost/finance/verify/${doc.id}`, {
				method: "POST",
				body: form,
			}),
			params: { id: doc.id },
		} as never).catch((r) => r)
		expect(res).toBeInstanceOf(Response)
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: doc.id } }))
				.financeVerifiedAt,
		).not.toBeNull()
	})
})
