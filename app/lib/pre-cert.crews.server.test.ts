/**
 * A job with several crews gets one pre-cert sheet per crew, each built from
 * that crew's own installed lines (real shadow database).
 */
import { readFile } from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { db } from "~/lib/db.server"
import {
	activeSheet,
	activeSheetById,
	activeSheets,
	createPreCertSheet,
} from "~/lib/pre-cert.server"
import type { PreCertLine } from "~/lib/service-lines"
import { makeTracker, runToken, seedBrigade, seedUser } from "~/test/helpers"

const HOOK_TIMEOUT = 60_000
const t = makeTracker()
const digits = () => runToken("C").replace(/\D/g, "").slice(-8)

let sup: { id: string }
let fiber: { id: string; claroCode: string; name: string }
let digger: { id: string; claroCode: string; name: string }
let angel: { id: string; name: string; code: string | null }
let jesus: { id: string; name: string; code: string | null }
let docId: string

const line = (
	code: { id: string; claroCode: string; name: string },
	qty: number,
) => ({
	serviceCodeId: code.id,
	claroCode: code.claroCode,
	accountCode: "610",
	name: code.name,
	qty,
})

beforeAll(async () => {
	sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	fiber = t.track(
		"serviceCode",
		await db.serviceCode.create({
			data: {
				claroCode: `F${digits()}`,
				name: "INST FIBERS",
				kind: "SERVICE",
				unit: "FT",
				unitPrice: "2",
				accountCode: "610",
			},
		}),
	)
	digger = t.track(
		"serviceCode",
		await db.serviceCode.create({
			data: {
				claroCode: `D${digits()}`,
				name: "DIGGER Equipment",
				kind: "SERVICE",
				unit: "Full day",
				unitPrice: "500",
				accountCode: "610",
			},
		}),
	)
	angel = t.track("brigade", await seedBrigade({ area: "NORTE" }))
	jesus = t.track("brigade", await seedBrigade({ area: "NORTE" }))
	const doc = t.track(
		"jafInvoice",
		await db.jafInvoice.create({
			data: {
				controlNumber: `CRW-${digits()}`,
				jobType: "Mantenimiento",
				jobAddressEstimated: "Calle 1, Sector",
				estimatedMaterials: [],
				supervisorId: sup.id,
				brigadeId: angel.id,
				crewAssignmentHistory: [
					{ brigadeId: angel.id, brigadeIds: [angel.id, jesus.id] },
				],
				status: "SIGNED",
				avisoNumber: "10359868",
				serviceLines: [line(fiber, 1000)],
				installedServiceLines: [line(fiber, 1000), line(digger, 1)],
				crewServiceLines: [
					{ brigadeId: jesus.id, lines: [line(fiber, 400)] },
					{ brigadeId: angel.id, lines: [line(fiber, 600), line(digger, 1)] },
				],
			},
		}),
	)
	docId = doc.id
}, HOOK_TIMEOUT)

afterAll(async () => {
	await db.preCertSheet.deleteMany({ where: { docId } })
	await t.cleanup()
}, HOOK_TIMEOUT)

const actor = () => ({ id: sup.id, role: "SUPERVISOR" as const })

describe("createPreCertSheet — one certificate per crew", {
	timeout: HOOK_TIMEOUT,
}, () => {
	it("issues one per crew, lead first, each priced from its own crew's lines", async () => {
		const res = await createPreCertSheet({ docId, actor: actor() })
		expect(res).toEqual({ version: 1, count: 2 })
		const sheets = await activeSheets(docId)
		expect(sheets.map((s) => [s.version, s.brigadeId])).toEqual([
			[1, angel.id],
			[2, jesus.id],
		])
		const [a, j] = sheets
		expect(a.brigadeName).toBe(angel.name)
		expect(a.brigadeCode).toBe(angel.code)
		expect(a.title).toContain(angel.name)
		expect(j.title).toContain(jesus.name)
		expect(
			(a.lines as PreCertLine[]).map((l) => [l.claroCode, l.certifiedQty]),
		).toEqual([
			[fiber.claroCode, 600],
			[digger.claroCode, 1],
		])
		expect(
			(j.lines as PreCertLine[]).map((l) => [l.claroCode, l.certifiedQty]),
		).toEqual([[fiber.claroCode, 400]])
		expect(Number(a.total)).toBe(1700)
		expect(Number(j.total)).toBe(800)
		// Same Aviso on both, and each has its own rendered file.
		expect(a.avisoNumber).toBe("10359868")
		expect(j.avisoNumber).toBe("10359868")
		expect(a.pdfPath).not.toBe(j.pdfPath)
		for (const s of sheets)
			expect((await readFile(s.pdfPath as string)).length).toBeGreaterThan(0)
	})

	it("the lead's certificate is the job's active sheet, and any other is found by id", async () => {
		const lead = await activeSheet(docId)
		expect(lead?.brigadeId).toBe(angel.id)
		const [, other] = await activeSheets(docId)
		expect((await activeSheetById(docId, other.id))?.brigadeId).toBe(jesus.id)
		expect(await activeSheetById("another-doc", other.id)).toBeNull()
	})

	it("regenerating supersedes every certificate and issues a fresh set", async () => {
		const before = await activeSheets(docId)
		const res = await createPreCertSheet({ docId, actor: actor() })
		expect(res).toEqual({ version: 3, count: 2 })
		const after = await activeSheets(docId)
		expect(after.map((s) => s.version)).toEqual([3, 4])
		const old = await db.preCertSheet.findMany({
			where: { id: { in: before.map((s) => s.id) } },
		})
		expect(old.every((s) => s.supersededAt)).toBe(true)
		expect(
			await db.auditTrail.count({
				where: { docId, action: "PRECERT_GENERATED" },
			}),
		).toBe(4)
	})

	it("a crew with nothing installed gets no certificate", async () => {
		await db.jafInvoice.update({
			where: { id: docId },
			data: {
				crewServiceLines: [{ brigadeId: angel.id, lines: [line(fiber, 600)] }],
			},
		})
		const res = await createPreCertSheet({ docId, actor: actor() })
		expect(res.count).toBe(1)
		expect((await activeSheets(docId)).map((s) => s.brigadeId)).toEqual([
			angel.id,
		])
	})

	it("a one-crew job still gets a single plain certificate with no crew on it", async () => {
		await db.jafInvoice.update({
			where: { id: docId },
			data: { crewAssignmentHistory: [], crewServiceLines: Prisma.DbNull },
		})
		const res = await createPreCertSheet({ docId, actor: actor() })
		expect(res.count).toBe(1)
		const [only] = await activeSheets(docId)
		expect(only.brigadeId).toBeNull()
		expect(only.title).toBe("Mantenimiento")
	})
})
