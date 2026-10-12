import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedBrigade,
	seedContractorAccount,
	seedFinanceableInvoice,
	seedServiceCode,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.lc-requests"

const t = makeTracker()
afterAll(() => t.cleanup())

const OLD = new Date("2000-01-01")

describe("step 2 LC request", () => {
	it("lists an accepted unsent job and not an unaccepted one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const accepted = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		await db.jafInvoice.update({
			where: { id: accepted.id },
			data: { financeVerifiedAt: new Date() },
		})
		const unaccepted = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		const result = await loader({
			request: new Request("http://localhost/finance/lc-requests"),
			params: {},
			context: {},
		} as never)
		const ids = result.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(accepted.id)
		expect(ids).not.toContain(unaccepted.id)
	})

	it("restricts loader and action to FINANCE and ADMIN", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockClear()
		mocks.requireRole.mockResolvedValue({ user: finance })
		await loader(loaderArgs() as never)
		await post(new URLSearchParams({ intent: "build_schedule" }))
		expect(mocks.requireRole).toHaveBeenCalledTimes(2)
		for (const call of mocks.requireRole.mock.calls)
			expect(call[1]).toEqual(["FINANCE", "ADMIN"])
	})

	it("build_schedule returns a typed error for an empty selection", async () => {
		await financeUser()
		const res = await post(new URLSearchParams({ intent: "build_schedule" }))
		expect(res).toMatchObject({ errorKey: "finance_schedule.errors.empty" })
	})

	it("build_schedule redirects to the new schedule holding both packets", async () => {
		await financeUser()
		const a = await lcRequestPacket()
		const b = await lcRequestPacket()
		const thrown = await post(
			new URLSearchParams([
				["intent", "build_schedule"],
				["packetId", a.id],
				["packetId", b.id],
			]),
		).catch((e) => e)
		// Track whatever was claimed before asserting, so a failure can't leak.
		const claimed = await db.jafInvoice.findUniqueOrThrow({
			where: { id: a.id },
			select: { bankScheduleId: true },
		})
		if (claimed.bankScheduleId)
			t.track("bankSchedule", { id: claimed.bankScheduleId })
		expect(thrown).toBeInstanceOf(Response)
		expect(thrown.status).toBe(302)
		expect(thrown.headers.get("Location")).toBe(
			`/finance/schedules/${claimed.bankScheduleId}`,
		)
		const s = await db.bankSchedule.findUniqueOrThrow({
			where: { id: claimed.bankScheduleId as string },
			include: { invoices: { select: { id: true } } },
		})
		expect(s.invoices.map((i) => i.id).sort()).toEqual([a.id, b.id].sort())
	})

	it("build_schedule names a packet whose brigade has no area; nothing is created", async () => {
		await financeUser()
		const noArea = await lcRequestPacket({ area: null })
		const before = await db.bankSchedule.count()
		const res = await post(
			new URLSearchParams([
				["intent", "build_schedule"],
				["packetId", noArea.id],
			]),
		).catch((e) => e)
		if (res instanceof Response) {
			const loc = res.headers.get("Location")?.split("/").pop()
			if (loc) t.track("bankSchedule", { id: loc })
		}
		expect(res).toMatchObject({
			errorKey: "finance_schedule.errors.no_area",
		})
		expect(res.list).toContain(noArea.controlNumber)
		expect(await db.bankSchedule.count()).toBe(before)
	})

	it("loader returns recent schedules", async () => {
		const finance = await financeUser()
		const s = t.track(
			"bankSchedule",
			await db.bankSchedule.create({
				data: {
					generatedById: finance.id,
					advanceRate: 0.8,
					total: 10,
					advanceAmount: 8,
				},
			}),
		)
		const res = await loader(loaderArgs() as never)
		expect(res.schedules.map((x: { id: string }) => x.id)).toContain(s.id)
	})

	it("loader marks a scheduled-but-unsent packet with its schedule", async () => {
		const finance = await financeUser()
		const scheduled = await lcRequestPacket()
		const plain = await lcRequestPacket()
		const s = t.track(
			"bankSchedule",
			await db.bankSchedule.create({
				data: {
					generatedById: finance.id,
					advanceRate: 0.8,
					total: 10,
					advanceAmount: 8,
				},
			}),
		)
		await db.jafInvoice.update({
			where: { id: scheduled.id },
			data: { bankScheduleId: s.id },
		})
		const res = await loader(loaderArgs() as never)
		const ids = res.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(scheduled.id)
		expect(ids).toContain(plain.id)
		expect(res.scheduleByPacket[scheduled.id]).toEqual({
			id: s.id,
			number: s.number,
		})
		expect(res.scheduleByPacket[plain.id]).toBeUndefined()
	})
})

const loaderArgs = () => ({
	request: new Request("http://x/finance/lc-requests"),
	params: {},
	context: {},
})

const post = (body: URLSearchParams) =>
	action({
		request: new Request("http://x/finance/lc-requests", {
			method: "POST",
			body,
		}),
		params: {},
		context: {},
	} as never)

async function financeUser() {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: finance })
	return finance
}

/** An accepted, unsent Arm A packet in the LC request stage (same recipe as
 * bank-schedule.server.test.ts). */
async function lcRequestPacket(opts: { area?: string | null } = {}) {
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const brigade = t.track(
		"brigade",
		await seedBrigade({ area: opts.area ?? "NORTE" }),
	)
	if (opts.area === null)
		await db.brigade.update({ where: { id: brigade.id }, data: { area: null } })
	const sc = t.track(
		"serviceCode",
		await seedServiceCode(`LR-${Math.random().toString(36).slice(2, 10)}`, {
			unitPrice: 100,
		}),
	)
	const account = t.track(
		"contractorAccount",
		await seedContractorAccount({ brigadeId: brigade.id }),
	)
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
					unitPrice: 100,
					lineAmount: 100,
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
			jafInvoiceLineTotal: 100,
			jobAddressActual: "Calle Luna 55, Mayagüez PR 00680",
			releasedToFinanceAt: new Date("2000-01-01"),
		},
	})
	return inv
}
