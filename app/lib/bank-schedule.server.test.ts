import fs from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import { afterAll, afterEach, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { stageWhere } from "~/lib/finance-stages.server"
import type { BankInvoiceInput } from "~/lib/pdf/bank-invoice.server"
import {
	makeTracker,
	seedBrigade,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedServiceCode,
	seedUser,
} from "~/test/helpers"
import {
	bankDateLabel,
	buildBankSchedule,
	discardBankSchedule,
	markScheduleSent,
	ScheduleValidationError,
} from "./bank-schedule.server"

/** Failure injection for the invoice PDF generator: `failOnCall = n` makes the
 * n-th call (1-based, counted from the last reset) throw. Other tests run the
 * real generator. */
const pdfMock = vi.hoisted(() => ({
	failOnCall: null as number | null,
	calls: [] as unknown[],
}))
vi.mock("~/lib/pdf/bank-invoice.server", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/pdf/bank-invoice.server")>()
	return {
		...actual,
		generateBankInvoicePdf: async (input: BankInvoiceInput) => {
			pdfMock.calls.push(input)
			if (pdfMock.failOnCall === pdfMock.calls.length)
				throw new Error("injected pdf failure")
			return actual.generateBankInvoicePdf(input)
		},
	}
})

/** `beforeClaim` runs inside getBankInvoicePrefix, i.e. after buildBankSchedule's
 * eligibility pre-check and before its claim transaction. */
const settingsHook = vi.hoisted(() => ({
	beforeClaim: null as null | (() => Promise<void>),
}))
vi.mock("~/lib/system-settings.server", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("~/lib/system-settings.server")>()
	return {
		...actual,
		getBankInvoicePrefix: async () => {
			await settingsHook.beforeClaim?.()
			return actual.getBankInvoicePrefix()
		},
	}
})

const t = makeTracker()
afterEach(() => {
	pdfMock.failOnCall = null
	pdfMock.calls = []
	settingsHook.beforeClaim = null
	vi.restoreAllMocks()
})
afterAll(() => t.cleanup())

const uploadPath = (kind: string, file: string) =>
	path.join(process.env.UPLOAD_DIR || "/tmp/jaf/uploads", kind, file)
const exists = (p: string) =>
	fs.access(p).then(
		() => true,
		() => false,
	)
const inLcRequest = async (id: string) =>
	(await db.jafInvoice.count({
		where: { AND: [{ id }, stageWhere("LC_REQUEST")] },
	})) === 1

/** An accepted, unsent Arm A packet in the LC request stage. */
async function lcRequestPacket(
	opts: {
		area?: string | null
		total?: number
		startedAt?: Date
		endedAt?: Date
	} = {},
) {
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const brigade = t.track(
		"brigade",
		await seedBrigade({ area: opts.area ?? "NORTE" }),
	)
	if (opts.area === null)
		await db.brigade.update({ where: { id: brigade.id }, data: { area: null } })
	const sc = t.track(
		"serviceCode",
		await seedServiceCode(`BS-${Math.random().toString(36).slice(2, 10)}`, {
			unitPrice: 100,
		}),
	)
	const account = t.track(
		"contractorAccount",
		await seedContractorAccount({ brigadeId: brigade.id }),
	)
	const total = opts.total ?? 100
	const inv = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			supervisorId: sup.id,
			contractorAccountCode: account.code,
			pbccRequestSentAt: null,
			jafInvoiceLines: [
				{
					serviceCodeId: sc.id,
					claroCode: sc.claroCode,
					name: "Line",
					unit: "EA",
					qty: 1,
					unitPrice: total,
					lineAmount: total,
				},
			],
		}),
	)
	await db.jafInvoice.update({
		where: { id: inv.id },
		data: {
			brigadeId: brigade.id,
			financeVerifiedAt: new Date(),
			avisoNumber: `9${Math.floor(Math.random() * 1e9)}`,
			jafInvoiceLineTotal: total,
			jobAddressActual: "Calle Luna 55, Mayagüez PR 00680",
			startedAt: opts.startedAt ?? null,
			endedAt: opts.endedAt ?? null,
		},
	})
	expect(await inLcRequest(inv.id)).toBe(true)
	return inv
}

describe("bankDateLabel", () => {
	it("prints the Puerto Rico calendar day, not the UTC one", () => {
		expect(bankDateLabel(new Date("2026-08-06T02:00:00Z"))).toBe("08/05/26")
		expect(bankDateLabel(new Date("2026-08-06T04:00:00Z"))).toBe("08/06/26")
	})
})

describe("buildBankSchedule", () => {
	it("creates a schedule with totals, files and claimed packets", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await lcRequestPacket({
			total: 100,
			startedAt: new Date("2026-08-04T14:00:00Z"),
			endedAt: new Date("2026-08-06T02:00:00Z"),
		})
		const b = await lcRequestPacket({ total: 50.5 })
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
			include: { invoices: true },
		})
		expect(Number(s.total)).toBe(150.5)
		expect(Number(s.advanceAmount)).toBeCloseTo(
			Math.round(150.5 * Number(s.advanceRate) * 100) / 100,
			2,
		)
		expect(s.invoices).toHaveLength(2)
		expect(s.sentAt).toBeNull()
		expect(s.generatedById).toBe(finance.id)
		expect(s.xlsxPath).toBeTruthy()
		await fs.access(s.xlsxPath as string)
		for (const inv of s.invoices) {
			expect(inv.bankInvoicePdfPath).toBeTruthy()
			await fs.access(inv.bankInvoicePdfPath as string)
			expect(inv.pbccRequestSentAt).toBeNull()
		}
		// Work dates on packet a's invoice are Puerto Rico calendar days.
		const aAviso = s.invoices.find((i) => i.id === a.id)?.avisoNumber
		expect(aAviso).toBeTruthy()
		const aInput = (pdfMock.calls as BankInvoiceInput[]).find(
			(c) => c.avisoNumber === aAviso,
		)
		// Excel "Inv. Date" is the request-creation date (the schedule's creation
		// day in Puerto Rico), NOT the packet's work date (Aug 4-5 above).
		const wb = new ExcelJS.Workbook()
		await wb.xlsx.readFile(s.xlsxPath as string)
		const ws = wb.getWorksheet("FECHA") as ExcelJS.Worksheet
		let headerRow = 0
		ws.eachRow((row, n) => {
			if (String(row.getCell(1).value ?? "").startsWith("Inv. Date"))
				headerRow = n
		})
		expect(headerRow).toBeGreaterThan(0)
		const expectedDay = s.generatedAt.toLocaleDateString("en-CA", {
			timeZone: "America/Puerto_Rico",
		})
		for (const n of [headerRow + 1, headerRow + 2]) {
			const cell = ws.getRow(n).getCell(1).value as Date
			expect(cell.toISOString().slice(0, 10)).toBe(expectedDay)
			expect(cell.toISOString().slice(0, 10)).not.toBe("2026-08-04")
		}
		expect(aInput?.workFrom).toBe("08/04/26")
		expect(aInput?.workTo).toBe("08/05/26")
		expect(aInput?.locality).toBe("Mayagüez")
		expect(aInput?.barrio).toBe("Calle Luna 55")
		expect(aInput?.org).toBe("PWOR")
		// The PDF's FECHA is the request-creation date too, in the PR calendar.
		expect(aInput?.invoiceDate).toBe(bankDateLabel(s.generatedAt))
		expect(aInput?.total).toBe(100)
	})

	it("refuses a packet whose brigade has no area; nothing is created", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const ok = await lcRequestPacket()
		const noArea = await lcRequestPacket({ area: null })
		const before = await db.bankSchedule.count({
			where: { generatedById: finance.id },
		})
		const err = await buildBankSchedule({
			packetIds: [ok.id, noArea.id],
			generatedById: finance.id,
		}).catch((e) => e)
		// If the build wrongly succeeds, still clean up what it created.
		if (err?.scheduleId) t.track("bankSchedule", { id: err.scheduleId })
		expect(err).toBeInstanceOf(ScheduleValidationError)
		expect(err).toMatchObject({
			code: "no_area",
			controlNumbers: [noArea.controlNumber],
		})
		expect(
			await db.bankSchedule.count({ where: { generatedById: finance.id } }),
		).toBe(before)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: ok.id },
		})
		expect(reloaded.bankScheduleId).toBeNull()
	})

	it("refuses an empty selection and an unknown id", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		await expect(
			buildBankSchedule({ packetIds: [], generatedById: finance.id }),
		).rejects.toMatchObject({ code: "empty" })
		await expect(
			buildBankSchedule({ packetIds: ["nope"], generatedById: finance.id }),
		).rejects.toMatchObject({ code: "not_found" })
	})

	it("refuses a packet that is not in the LC request stage (already sent)", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		await db.jafInvoice.update({
			where: { id: p.id },
			data: { pbccRequestSentAt: new Date() },
		})
		await expect(
			buildBankSchedule({ packetIds: [p.id], generatedById: finance.id }),
		).rejects.toMatchObject({
			code: "not_eligible",
			controlNumbers: [p.controlNumber],
		})
	})

	it("an empty-string aviso falls back to the control number for the invoice number", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		await db.jafInvoice.update({
			where: { id: p.id },
			data: { avisoNumber: "" },
		})
		const { scheduleId } = await buildBankSchedule({
			packetIds: [p.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		const input = pdfMock.calls[0] as BankInvoiceInput
		expect(input.avisoNumber).toBe(p.controlNumber)
	})

	it("refuses a packet already on a schedule", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [p.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		await expect(
			buildBankSchedule({ packetIds: [p.id], generatedById: finance.id }),
		).rejects.toMatchObject({
			code: "already_scheduled",
			controlNumbers: [p.controlNumber],
		})
	})

	it("two concurrent builds for the same packet: exactly one wins", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const results = await Promise.allSettled([
			buildBankSchedule({ packetIds: [p.id], generatedById: finance.id }),
			buildBankSchedule({ packetIds: [p.id], generatedById: finance.id }),
		])
		const ok = results.filter((r) => r.status === "fulfilled")
		const bad = results.filter((r) => r.status === "rejected")
		for (const r of ok)
			t.track("bankSchedule", {
				id: (r as PromiseFulfilledResult<{ scheduleId: string }>).value
					.scheduleId,
			})
		expect(ok).toHaveLength(1)
		expect(bad).toHaveLength(1)
		const reason = (bad[0] as PromiseRejectedResult).reason
		expect(reason).toBeInstanceOf(ScheduleValidationError)
		expect(["already_scheduled", "not_eligible"]).toContain(reason.code)
		const winner = (ok[0] as PromiseFulfilledResult<{ scheduleId: string }>)
			.value.scheduleId
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: p.id },
		})
		expect(reloaded.bankScheduleId).toBe(winner)
	})

	it("a packet sent back between the pre-check and the claim is not claimed", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const before = await db.bankSchedule.count({
			where: { generatedById: finance.id },
		})
		settingsHook.beforeClaim = async () => {
			await db.jafInvoice.update({
				where: { id: b.id },
				data: { financeVerifiedAt: null },
			})
		}
		const err = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		}).catch((e) => e)
		if (err?.scheduleId) t.track("bankSchedule", { id: err.scheduleId })
		expect(err).toBeInstanceOf(ScheduleValidationError)
		expect(err).toMatchObject({
			code: "not_eligible",
			controlNumbers: [b.controlNumber],
		})
		expect(
			await db.bankSchedule.count({ where: { generatedById: finance.id } }),
		).toBe(before)
		for (const id of [a.id, b.id]) {
			const reloaded = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(reloaded.bankScheduleId).toBeNull()
		}
		expect(await inLcRequest(a.id)).toBe(true)
	})

	it("a cleanup failure still surfaces the original error; discard recovers", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const before = await db.bankSchedule.count({
			where: { generatedById: finance.id },
		})
		const realTx = db.$transaction.bind(db)
		vi.spyOn(db, "$transaction").mockImplementation(((
			arg: unknown,
			...rest: unknown[]
		) =>
			Array.isArray(arg)
				? Promise.reject(new Error("cleanup boom"))
				: (realTx as (...a: unknown[]) => unknown)(
						arg,
						...rest,
					)) as typeof db.$transaction)
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		pdfMock.failOnCall = 1
		const err = await buildBankSchedule({
			packetIds: [p.id],
			generatedById: finance.id,
		}).catch((e) => e)
		vi.restoreAllMocks()
		// Track whatever schedule exists before asserting, so a failure here
		// cannot leak rows into the shared DB.
		const stuck = await db.jafInvoice.findUniqueOrThrow({ where: { id: p.id } })
		if (stuck.bankScheduleId)
			t.track("bankSchedule", { id: stuck.bankScheduleId })
		if (err?.scheduleId) t.track("bankSchedule", { id: err.scheduleId })
		expect(err).toBeInstanceOf(Error)
		expect(err.message).toBe("injected pdf failure")
		expect(logged).toHaveBeenCalled()

		// The claim could not be released: the packet is stuck on a half-built
		// schedule, which mark-sent refuses and discard removes.
		expect(stuck.bankScheduleId).toBeTruthy()
		const scheduleId = stuck.bankScheduleId as string
		await expect(
			markScheduleSent({ scheduleId, sentById: finance.id }),
		).rejects.toMatchObject({ code: "incomplete" })
		expect(await discardBankSchedule({ scheduleId })).toEqual({
			discarded: true,
		})
		expect(
			await db.bankSchedule.count({ where: { generatedById: finance.id } }),
		).toBe(before)
		const released = await db.jafInvoice.findUniqueOrThrow({
			where: { id: p.id },
		})
		expect(released.bankScheduleId).toBeNull()
		expect(await inLcRequest(p.id)).toBe(true)
	})

	it("a PDF failure on the first packet rolls everything back", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const before = await db.bankSchedule.count({
			where: { generatedById: finance.id },
		})
		pdfMock.failOnCall = 1
		await expect(
			buildBankSchedule({ packetIds: [p.id], generatedById: finance.id }),
		).rejects.toThrow("injected pdf failure")
		expect(
			await db.bankSchedule.count({ where: { generatedById: finance.id } }),
		).toBe(before)
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: p.id },
		})
		expect(reloaded.bankScheduleId).toBeNull()
		expect(reloaded.bankInvoicePdfPath).toBeNull()
		expect(await inLcRequest(p.id)).toBe(true)
	})

	it("a PDF failure on the second packet releases the first packet's file and column", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const before = await db.bankSchedule.count({
			where: { generatedById: finance.id },
		})
		pdfMock.failOnCall = 2
		await expect(
			buildBankSchedule({ packetIds: [a.id, b.id], generatedById: finance.id }),
		).rejects.toThrow("injected pdf failure")
		expect(pdfMock.calls).toHaveLength(2)
		expect(
			await db.bankSchedule.count({ where: { generatedById: finance.id } }),
		).toBe(before)
		for (const id of [a.id, b.id]) {
			const reloaded = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(reloaded.bankScheduleId).toBeNull()
			expect(reloaded.bankInvoicePdfPath).toBeNull()
			expect(await inLcRequest(id)).toBe(true)
			expect(
				await exists(uploadPath("bank-invoices", `${id}-bank-invoice.pdf`)),
			).toBe(false)
		}
		// The packets can be scheduled again afterwards.
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
	})
})

describe("markScheduleSent", () => {
	it("stamps every packet once, audits, notifies, and is idempotent", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		// Packet b was sent by hand meanwhile: its stamp must not be overwritten.
		const byHand = new Date("2026-09-01T12:00:00Z")
		await db.jafInvoice.update({
			where: { id: b.id },
			data: { pbccRequestSentAt: byHand, karmenCopySentAt: byHand },
		})

		const first = await markScheduleSent({ scheduleId, sentById: finance.id })
		expect(first.alreadySent).toBe(false)
		const afterFirst = await db.jafInvoice.findUniqueOrThrow({
			where: { id: a.id },
		})
		const second = await markScheduleSent({
			scheduleId,
			sentById: finance.id,
		})
		expect(second.alreadySent).toBe(true)

		const rows = await db.jafInvoice.findMany({
			where: { bankScheduleId: scheduleId },
		})
		expect(rows).toHaveLength(2)
		for (const r of rows) {
			expect(r.pbccRequestSentAt).not.toBeNull()
			expect(r.karmenCopySentAt).not.toBeNull()
		}
		const ra = rows.find((r) => r.id === a.id)
		const rb = rows.find((r) => r.id === b.id)
		expect(ra?.pbccRequestSentAt).toEqual(afterFirst.pbccRequestSentAt)
		expect(rb?.pbccRequestSentAt).toEqual(byHand)
		expect(rb?.karmenCopySentAt).toEqual(byHand)
		expect(await inLcRequest(a.id)).toBe(false)

		const audits = await db.auditTrail.count({
			where: { docId: { in: [a.id, b.id] }, action: "PBCC_REQUEST_GENERATED" },
		})
		expect(audits).toBe(2)
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
		})
		// Scope to THIS schedule: other files' mark-sent notifies every comptroller.
		const notes = await db.notification.count({
			where: {
				userId: carmen.id,
				message: { contains: `Bank schedule #${s.number} ` },
			},
		})
		expect(notes).toBe(1)
		expect(s.sentAt).not.toBeNull()
		expect(s.sentById).toBe(finance.id)
	})
})

describe("markScheduleSent refusals", () => {
	it("refuses an unknown schedule", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		await expect(
			markScheduleSent({ scheduleId: "nope", sentById: finance.id }),
		).rejects.toMatchObject({ code: "not_found", controlNumbers: [] })
	})

	it("refuses a schedule with no xlsx and stamps nothing", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [p.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		await db.bankSchedule.update({
			where: { id: scheduleId },
			data: { xlsxPath: null },
		})
		await expect(
			markScheduleSent({ scheduleId, sentById: finance.id }),
		).rejects.toMatchObject({ code: "incomplete" })
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
		})
		expect(s.sentAt).toBeNull()
		const reloaded = await db.jafInvoice.findUniqueOrThrow({
			where: { id: p.id },
		})
		expect(reloaded.pbccRequestSentAt).toBeNull()
		expect(reloaded.karmenCopySentAt).toBeNull()
	})

	it("refuses when a packet was sent back after scheduling and stamps nobody", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		await db.jafInvoice.update({
			where: { id: b.id },
			data: { financeVerifiedAt: null },
		})
		await expect(
			markScheduleSent({ scheduleId, sentById: finance.id }),
		).rejects.toMatchObject({
			code: "not_eligible",
			controlNumbers: [b.controlNumber],
		})
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
		})
		expect(s.sentAt).toBeNull()
		for (const id of [a.id, b.id]) {
			const r = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(r.pbccRequestSentAt).toBeNull()
			expect(r.karmenCopySentAt).toBeNull()
		}
		expect(
			await db.auditTrail.count({
				where: {
					docId: { in: [a.id, b.id] },
					action: "PBCC_REQUEST_GENERATED",
				},
			}),
		).toBe(0)
	})
})

describe("markScheduleSent stamp race", () => {
	it("a packet sent back after the pre-check is not stamped; nothing is left behind", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })

		// Run the send-back inside markScheduleSent's transaction, just before
		// its sentAt claim: after the eligibility pre-check, before the stamp.
		const realTx = db.$transaction.bind(db) as (...a: unknown[]) => unknown
		let injected = false
		vi.spyOn(db, "$transaction").mockImplementation(((
			arg: unknown,
			...rest: unknown[]
		) => {
			if (typeof arg !== "function") return realTx(arg, ...rest)
			return realTx(
				(tx: typeof db) =>
					arg(
						new Proxy(tx, {
							get(target, prop, receiver) {
								const v = Reflect.get(target, prop, receiver)
								if (prop !== "bankSchedule") return v
								return new Proxy(v, {
									get(m, p, r) {
										const f = Reflect.get(m, p, r)
										if (p !== "updateMany") return f
										return async (...args: unknown[]) => {
											injected = true
											await db.jafInvoice.update({
												where: { id: b.id },
												data: { financeVerifiedAt: null },
											})
											return f.apply(m, args)
										}
									},
								})
							},
						}),
					),
				...rest,
			)
		}) as typeof db.$transaction)

		const err = await markScheduleSent({
			scheduleId,
			sentById: finance.id,
		}).catch((e) => e)
		vi.restoreAllMocks()
		expect(injected).toBe(true)
		expect(err).toBeInstanceOf(ScheduleValidationError)
		expect(err).toMatchObject({
			code: "not_eligible",
			controlNumbers: [b.controlNumber],
		})
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
		})
		expect(s.sentAt).toBeNull()
		expect(s.sentById).toBeNull()
		for (const id of [a.id, b.id]) {
			const r = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(r.pbccRequestSentAt).toBeNull()
			expect(r.karmenCopySentAt).toBeNull()
		}
		expect(
			await db.auditTrail.count({
				where: {
					docId: { in: [a.id, b.id] },
					action: "PBCC_REQUEST_GENERATED",
				},
			}),
		).toBe(0)
		expect(
			await db.notification.count({
				where: {
					userId: carmen.id,
					message: { contains: `Bank schedule #${s.number} ` },
				},
			}),
		).toBe(0)
	})
})

describe("discardBankSchedule", () => {
	it("releases the packets and deletes the schedule and its files", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
			include: { invoices: true },
		})
		const files = [
			s.xlsxPath as string,
			...s.invoices.map((i) => i.bankInvoicePdfPath as string),
		]
		expect(files).toHaveLength(3)
		for (const f of files) expect(await exists(f)).toBe(true)

		expect(await discardBankSchedule({ scheduleId })).toEqual({
			discarded: true,
		})
		expect(
			await db.bankSchedule.findUnique({ where: { id: scheduleId } }),
		).toBeNull()
		for (const f of files) expect(await exists(f)).toBe(false)
		for (const id of [a.id, b.id]) {
			const r = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(r.bankScheduleId).toBeNull()
			expect(r.bankInvoicePdfPath).toBeNull()
			expect(await inLcRequest(id)).toBe(true)
		}
		// Claimable again.
		const again = await buildBankSchedule({
			packetIds: [a.id, b.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: again.scheduleId })
	})

	it("leaves a sent schedule untouched", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		const p = await lcRequestPacket()
		const { scheduleId } = await buildBankSchedule({
			packetIds: [p.id],
			generatedById: finance.id,
		})
		t.track("bankSchedule", { id: scheduleId })
		await markScheduleSent({ scheduleId, sentById: finance.id })
		expect(await discardBankSchedule({ scheduleId })).toEqual({
			discarded: false,
		})
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: scheduleId },
		})
		expect(s.sentAt).not.toBeNull()
		expect(await exists(s.xlsxPath as string)).toBe(true)
		const r = await db.jafInvoice.findUniqueOrThrow({ where: { id: p.id } })
		expect(r.bankScheduleId).toBe(scheduleId)
		expect(r.bankInvoicePdfPath).toBeTruthy()
	})

	it("refuses an unknown schedule", async () => {
		await expect(
			discardBankSchedule({ scheduleId: "nope" }),
		).rejects.toMatchObject({ code: "not_found", controlNumbers: [] })
	})
})
