/**
 * A service added in the Field step (Ordered 0) must reach every consumer of
 * the installed lines: the work order / Claro packet PDF, the invoice lines
 * locked at the send, the pre-cert sheet, Lissette's verify page and priced
 * invoice, the brigade's pay and the PBCC (bank) invoice. One job is walked
 * through them on the real (shadow) database, in order.
 */
import { redirect } from "react-router"
import { extractText, getDocumentProxy } from "unpdf"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/permissions.server")>()),
	requireRole: vi.fn(),
}))

import { readFile } from "node:fs/promises"
import {
	computeContractorPayment,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { type MailTransport, setMailTransport } from "~/lib/packet-mail.server"
import { buildPacketInput, sendPacket } from "~/lib/packet-send.server"
import { rowAmounts } from "~/lib/pbcc-batch.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"
import { requireRole } from "~/lib/permissions.server"
import { createPreCertSheet } from "~/lib/pre-cert.server"
import {
	buildInvoiceLines,
	type InvoiceLine,
	type PreCertLine,
	type ServiceLine,
} from "~/lib/service-lines"
import { makeTracker, seedBrigade, seedUser } from "~/test/helpers"
import { action as fieldAction } from "../routes/_app.docs.$id_.field"
import { loader as verifyLoader } from "../routes/_app.finance.verify.$id"
import { loader as invoiceLoader } from "../routes/_app.finance.verify.$id.invoice"

const HOOK_TIMEOUT = 60_000
const t = makeTracker()
const claroIds: string[] = []

let sup: { id: string; name: string }
let admin: { id: string; name: string }
let ordered: { id: string; claroCode: string; name: string }
let added: { id: string; claroCode: string; name: string }
let docId: string

const digits = () => String(Math.floor(Math.random() * 1e7)).padStart(7, "0")

function as(user: { id: string }, role: string) {
	vi.mocked(requireRole).mockImplementation(async (_req, roles) => {
		if (!(roles as string[]).includes(role)) throw redirect("/dashboard")
		return { user: { ...user, role }, session: {} } as never
	})
}

async function pdfText(pdf: Uint8Array): Promise<string> {
	// A Buffer is not accepted: copy into a plain Uint8Array.
	const proxy = await getDocumentProxy(new Uint8Array(pdf))
	const { text } = await extractText(proxy, { mergePages: true })
	return text
}

function field(intent: string, extra: Record<string, string> = {}) {
	const form = new FormData()
	form.set("intent", intent)
	for (const [k, v] of Object.entries(extra)) form.set(k, v)
	return fieldAction({
		request: new Request(`http://localhost/docs/${docId}/field`, {
			method: "POST",
			body: form,
		}),
		params: { id: docId },
	} as never).catch((r: unknown) => r) as Promise<unknown>
}

const reload = () => db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })

beforeAll(async () => {
	sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	admin = t.track("user", await seedUser({ role: "ADMIN" }))
	ordered = t.track(
		"serviceCode",
		await db.serviceCode.create({
			data: {
				claroCode: `O${digits()}`,
				name: "TRANSFER ATTCH",
				kind: "SERVICE",
				unit: "EA",
				unitPrice: "10.5",
				accountCode: "610",
			},
		}),
	)
	added = t.track(
		"serviceCode",
		await db.serviceCode.create({
			data: {
				claroCode: `R${digits()}`,
				name: "RETENSAR MENSAJERO MO",
				kind: "SERVICE",
				unit: "EA",
				unitPrice: "7.75",
				accountCode: "610",
			},
		}),
	)
	const claro = await db.claroSupervisor.create({
		data: { name: "Claro Ana", email: `claro-${digits()}@claro.test` },
	})
	claroIds.push(claro.id)
	const brigade = t.track("brigade", await seedBrigade({ area: "NORTE" }))
	const orderedLine = {
		serviceCodeId: ordered.id,
		claroCode: ordered.claroCode,
		accountCode: "610",
		name: ordered.name,
		qty: 2,
	}
	const doc = t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: `AIF-${digits()}`,
				jobType: "Mantenimiento",
				jobAddressEstimated: "Calle 1, Sector",
				estimatedMaterials: [],
				supervisorId: sup.id,
				brigadeId: brigade.id,
				claroSupervisorId: claro.id,
				status: "SIGNED",
				serviceLines: [orderedLine],
				installedServiceLines: [orderedLine],
			},
		}),
	)
	docId = doc.id
}, HOOK_TIMEOUT)

afterAll(async () => {
	setMailTransport(null)
	await db.packetSend.deleteMany({ where: { docId } })
	await db.preCertSheet.deleteMany({ where: { docId } })
	await t.cleanup()
	await db.claroSupervisor.deleteMany({ where: { id: { in: claroIds } } })
}, HOOK_TIMEOUT)

describe("a service added in the Field step", { timeout: HOOK_TIMEOUT }, () => {
	it("Field: Add service writes it to the installed lines (Ordered 0) and audits it", async () => {
		as(sup, "SUPERVISOR")
		expect(
			await field("add_service", { serviceCodeId: added.id, qty: "1" }),
		).toEqual({ ok: true })
		const doc = await reload()
		expect(doc.serviceLines).toEqual([
			expect.objectContaining({ serviceCodeId: ordered.id, qty: 2 }),
		])
		expect(doc.installedServiceLines).toEqual([
			expect.objectContaining({ serviceCodeId: ordered.id, qty: 2 }),
			{
				serviceCodeId: added.id,
				claroCode: added.claroCode,
				accountCode: "610",
				name: "RETENSAR MENSAJERO MO",
				qty: 1,
				addedInField: true,
			},
		])
		const audit = await db.auditTrail.findMany({
			where: { docId, action: "SERVICE_ADDED_IN_FIELD" },
		})
		expect(audit).toHaveLength(1)
		expect(audit[0]).toMatchObject({
			userId: sup.id,
			diffJson: { code: added.claroCode, qty: 1 },
		})
		expect(audit[0].timestamp).toBeInstanceOf(Date)

		// Sign-off (step 4), as the review route stores it.
		const now = new Date()
		await db.jafInvoice.update({
			where: { id: docId },
			data: {
				status: "SUPERVISOR_APPROVED",
				supervisorApprovedAt: now,
				completedById: sup.id,
				completionSignedAt: now,
			},
		})
	})

	it("work order / Claro packet PDF: lists it with its installed qty and no price", async () => {
		const input = await buildPacketInput(docId)
		expect(input.document.services).toEqual([
			{ code: ordered.claroCode, description: ordered.name, qty: 2 },
			{ code: added.claroCode, description: "RETENSAR MENSAJERO MO", qty: 1 },
		])
		const text = await pdfText(await generateClaroPacketPdf(input))
		expect(text).toContain(added.claroCode)
		expect(text).toContain("RETENSAR MENSAJERO")
		expect(text).not.toContain("7.75")
	})

	it("packet send: locks it into the invoice lines, priced from the catalog", async () => {
		process.env.PACKET_EMAIL_ENABLED = "true"
		const ok: MailTransport = async () => {}
		setMailTransport(ok)
		expect(
			await sendPacket({
				docId,
				actor: { ...sup, role: "SUPERVISOR" },
				mode: "email",
			}),
		).toEqual({ ok: true, outcome: "SENT" })
		const doc = await reload()
		expect(doc.jafInvoiceGeneratedAt).not.toBeNull()
		expect(doc.jafInvoiceLines as InvoiceLine[]).toEqual([
			expect.objectContaining({ serviceCodeId: ordered.id, lineAmount: 21 }),
			{
				serviceCodeId: added.id,
				claroCode: added.claroCode,
				accountCode: "610",
				name: "RETENSAR MENSAJERO MO",
				qty: 1,
				unit: "EA",
				unitPrice: 7.75,
				lineAmount: 7.75,
			},
		])
		expect(Number(doc.jafInvoiceLineTotal)).toBe(28.75)
	})

	it("Field: once the packet is out, nobody can add or remove a service", async () => {
		// The Admin override keeps the Field step open after sign-off.
		as(admin, "ADMIN")
		expect(
			await field("remove_added_service", { serviceCodeId: added.id }),
		).toEqual({ errorKey: "docs_field.errors.service_packet_sent" })
		expect(
			await field("add_service", { serviceCodeId: added.id, qty: "1" }),
		).toEqual({ errorKey: "docs_field.errors.service_packet_sent" })
		expect((await reload()).installedServiceLines).toHaveLength(2)
	})

	it("pre-cert sheet: certifies it at its installed qty, priced from the catalog", async () => {
		await createPreCertSheet({
			docId,
			actor: { id: sup.id, role: "SUPERVISOR" },
		})
		const sheet = await db.preCertSheet.findFirstOrThrow({ where: { docId } })
		expect((sheet.lines as PreCertLine[])[1]).toEqual({
			serviceCodeId: added.id,
			claroCode: added.claroCode,
			accountCode: "610",
			description: "RETENSAR MENSAJERO MO",
			installedQty: 1,
			certifiedQty: 1,
			unit: "EA",
			unitPrice: 7.75,
			lineAmount: 7.75,
		})
		expect(Number(sheet.total)).toBe(28.75)
		const text = await pdfText(
			new Uint8Array(await readFile(sheet.pdfPath as string)),
		)
		expect(text).toContain(added.claroCode)
	})

	it("Lissette's verify page and priced invoice include it", async () => {
		await db.jafInvoice.update({
			where: { id: docId },
			data: {
				releasedToFinanceAt: new Date(),
				avisoNumber: `9${digits()}`,
				jobAddressActual: "Calle Luna 55, Mayagüez PR 00680",
			},
		})
		as(admin, "FINANCE")
		const page = (await verifyLoader({
			request: new Request(`http://localhost/finance/verify/${docId}`),
			params: { id: docId },
		} as never)) as {
			totals: { subtotal: number }
			invoiceLines: { claroCode: string }[]
			pricedInvoiceHref: string
		}
		expect(page.totals.subtotal).toBe(28.75)
		expect(page.invoiceLines.map((l) => l.claroCode)).toContain(added.claroCode)
		expect(page.pricedInvoiceHref).toBe(`/finance/verify/${docId}/invoice.pdf`)

		const res = (await invoiceLoader({
			request: new Request(
				`http://localhost/finance/verify/${docId}/invoice.pdf`,
			),
			params: { id: docId },
		} as never)) as Response
		const text = await pdfText(new Uint8Array(await res.arrayBuffer()))
		expect(text).toContain(added.claroCode)
		expect(text).toContain("7.75")
	})

	it("brigade pay: the added line is part of the brigade's share", async () => {
		const doc = await reload()
		const pay = computeContractorPayment(
			toContractorPaymentLines(doc.jafInvoiceLines),
		)
		expect(pay.contractorShareLines.map((l) => l.serviceCodeId)).toEqual([
			ordered.id,
			added.id,
		])
		expect(pay.contractorShareLines[1]).toMatchObject({
			qty: 1,
			jafPrice: 7.75,
			gross: 7.75,
		})
	})

	it("PBCC (bank) invoice: its row and lines carry it at the catalog price", async () => {
		// The PBCC batch row bills `rowAmounts`, and the PBCC invoice PDF lists
		// the invoice record's lines one for one (`pbcc-batch.server`).
		const doc = await reload()
		expect(rowAmounts(doc).subtotal).toBe(28.75)
		expect(doc.jafInvoiceLines as InvoiceLine[]).toEqual([
			expect.objectContaining({ claroCode: ordered.claroCode, lineAmount: 21 }),
			expect.objectContaining({
				claroCode: added.claroCode,
				name: "RETENSAR MENSAJERO MO",
				qty: 1,
				unitPrice: 7.75,
				lineAmount: 7.75,
			}),
		])
	})
})

describe("a fractional qty added in the Field step", {
	timeout: HOOK_TIMEOUT,
}, () => {
	it("stores 2.5 (not 25) and bills 2.5 x the catalog price", async () => {
		const brigade = t.track("brigade", await seedBrigade({ area: "NORTE" }))
		const own = t.track(
			"jafInvoice",
			await db.jafInvoice.create({
				data: {
					controlNumber: `AIF-${digits()}`,
					jobType: "Mantenimiento",
					jobAddressEstimated: "Calle 2, Sector",
					estimatedMaterials: [],
					supervisorId: sup.id,
					brigadeId: brigade.id,
					status: "SIGNED",
					serviceLines: [],
					installedServiceLines: [],
				},
			}),
		)
		as(sup, "SUPERVISOR")
		const form = new FormData()
		form.set("intent", "add_service")
		form.set("serviceCodeId", added.id)
		form.set("qty", "2.5")
		expect(
			await fieldAction({
				request: new Request(`http://localhost/docs/${own.id}/field`, {
					method: "POST",
					body: form,
				}),
				params: { id: own.id },
			} as never).catch((r: unknown) => r),
		).toEqual({ ok: true })
		const installed = (
			await db.jafInvoice.findUniqueOrThrow({ where: { id: own.id } })
		).installedServiceLines as ServiceLine[]
		expect(installed).toEqual([
			expect.objectContaining({ serviceCodeId: added.id, qty: 2.5 }),
		])
		const catalog = await db.serviceCode.findMany({ where: { id: added.id } })
		const lines = buildInvoiceLines(
			installed,
			Object.fromEntries(catalog.map((c) => [c.id, c])),
		)
		// 2.5 x 7.75 = 19.375, rounded to cents.
		expect(lines).toEqual([
			expect.objectContaining({ qty: 2.5, unitPrice: 7.75, lineAmount: 19.38 }),
		])
	})
})
