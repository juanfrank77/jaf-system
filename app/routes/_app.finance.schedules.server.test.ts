import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader as invoiceLoader } from "./_app.finance.pbcc.$id.invoice"
import { action, loader } from "./_app.finance.schedules.$id"
import { loader as xlsxLoader } from "./_app.finance.schedules.$id.xlsx"

const t = makeTracker()
afterAll(() => t.cleanup())

async function schedule(
	generatedById: string,
	extra: { xlsxPath?: string | null; sentAt?: Date | null } = {},
) {
	const s = await db.bankSchedule.create({
		data: {
			generatedById,
			advanceRate: 0.8,
			total: 100,
			advanceAmount: 80,
			...extra,
		},
	})
	return t.track("bankSchedule", s)
}

async function financeUser() {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: finance })
	return finance
}

const post = (id: string, intent: string) =>
	action({
		request: new Request(`http://x/finance/schedules/${id}`, {
			method: "POST",
			body: new URLSearchParams({ intent }),
		}),
		params: { id },
		context: {},
	} as never)

describe("schedule routes", () => {
	it("loader returns the schedule with its packets", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		const res = await loader({
			request: new Request(`http://x/finance/schedules/${s.id}`),
			params: { id: s.id },
			context: {},
		} as never)
		expect(res.schedule.id).toBe(s.id)
		expect(res.schedule.invoices).toEqual([])
		expect(res.schedule.hasXlsx).toBe(false)
	})

	it("loader requires FINANCE or ADMIN", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		mocks.requireRole.mockClear()
		await loader({
			request: new Request("http://x"),
			params: { id: s.id },
			context: {},
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})

	it("download routes allow FINANCE, COMPTROLLER and ADMIN", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		mocks.requireRole.mockClear()
		await xlsxLoader({
			request: new Request("http://x"),
			params: { id: s.id },
			context: {},
		} as never).catch(() => null)
		await invoiceLoader({
			request: new Request("http://x"),
			params: { id: "nope" },
			context: {},
		} as never).catch(() => null)
		expect(mocks.requireRole).toHaveBeenNthCalledWith(1, expect.anything(), [
			"FINANCE",
			"COMPTROLLER",
			"ADMIN",
		])
		expect(mocks.requireRole).toHaveBeenNthCalledWith(2, expect.anything(), [
			"FINANCE",
			"COMPTROLLER",
			"ADMIN",
		])
	})

	it("loader 404s for an unknown schedule", async () => {
		await financeUser()
		await expect(
			loader({
				request: new Request("http://x"),
				params: { id: "nope" },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("xlsx route 404s when the schedule has no file", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		await expect(
			xlsxLoader({
				request: new Request("http://x"),
				params: { id: s.id },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("invoice route 404s when the packet has no bank invoice", async () => {
		await financeUser()
		await expect(
			invoiceLoader({
				request: new Request("http://x"),
				params: { id: "nope" },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("mark_sent action is idempotent and redirect-free (returns ok)", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id, { xlsxPath: "unused/schedule.xlsx" })
		const a = await post(s.id, "mark_sent")
		const b = await post(s.id, "mark_sent")
		expect(a).toEqual({ ok: true })
		expect(b).toEqual({ ok: true })
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).not.toBeNull()
	})

	it("mark_sent on an incomplete schedule returns the incomplete error and does not stamp", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		const res = await post(s.id, "mark_sent")
		expect(res).toMatchObject({
			ok: false,
			errorKey: "finance_schedule.errors.incomplete",
		})
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).toBeNull()
	})

	it("mark_sent for an unknown schedule 404s", async () => {
		await financeUser()
		await expect(post("nope", "mark_sent")).rejects.toMatchObject({
			status: 404,
		})
	})

	it("mark_sent with an ineligible packet returns not_eligible with the control number", async () => {
		const finance = await financeUser()
		const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const s = await schedule(finance.id, { xlsxPath: "unused/schedule.xlsx" })
		const inv = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				supervisorId: sup.id,
				pbccRequestSentAt: null,
			}),
		)
		// financeVerifiedAt stays null: the packet fell out of LC_REQUEST.
		await db.jafInvoice.update({
			where: { id: inv.id },
			data: { bankScheduleId: s.id, financeVerifiedAt: null },
		})
		const res = await post(s.id, "mark_sent")
		expect(res).toMatchObject({
			ok: false,
			errorKey: "finance_schedule.errors.not_eligible",
			list: inv.controlNumber,
		})
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).toBeNull()
	})

	it("discard on an unsent schedule redirects to the LC request list and deletes it", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		const res = (await post(s.id, "discard")) as Response
		expect(res).toBeInstanceOf(Response)
		expect(res.headers.get("Location")).toBe("/finance/lc-requests")
		expect(await db.bankSchedule.findUnique({ where: { id: s.id } })).toBeNull()
	})

	it("discard on a sent schedule returns already_sent and keeps the row", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id, {
			xlsxPath: "unused/schedule.xlsx",
			sentAt: new Date(),
		})
		const res = await post(s.id, "discard")
		expect(res).toMatchObject({
			ok: false,
			errorKey: "finance_schedule.errors.already_sent",
		})
		expect(
			await db.bankSchedule.findUnique({ where: { id: s.id } }),
		).not.toBeNull()
	})

	it("discard for an unknown schedule 404s", async () => {
		await financeUser()
		await expect(post("nope", "discard")).rejects.toMatchObject({
			status: 404,
		})
	})
})
