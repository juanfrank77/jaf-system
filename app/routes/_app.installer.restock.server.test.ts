import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	requireInstaller: vi.fn(),
	createRestock: vi.fn(),
	buildRestockPrefill: vi.fn(),
	getActiveMaterialCodes: vi.fn(),
	db: {
		restockRequest: { updateMany: vi.fn(), findMany: vi.fn() },
	},
}))

vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/installer-context.server", () => ({
	requireInstaller: mocks.requireInstaller,
}))
vi.mock("~/lib/restock.server", () => ({
	createRestock: mocks.createRestock,
	buildRestockPrefill: mocks.buildRestockPrefill,
	MAX_LINE_QTY: 1000,
}))
vi.mock("~/lib/service-codes.server", async () => {
	const actual = await vi.importActual<
		typeof import("~/lib/service-codes.server")
	>("~/lib/service-codes.server")
	return {
		getActiveMaterialCodes: mocks.getActiveMaterialCodes,
		serviceCodesForRole: actual.serviceCodesForRole,
	}
})
vi.mock("~/lib/db.server", () => ({ db: mocks.db }))

import { action, loader } from "./_app.installer.restock"

function formRequest(entries: Record<string, string>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(entries)) form.set(k, v)
	return new Request("http://localhost/installer/restock", {
		method: "POST",
		body: form,
	})
}

describe("GET /installer/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("gives the installer a pickable list of service codes to add lines from", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		mocks.buildRestockPrefill.mockResolvedValue([])
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-1",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "1.5",
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		// No price field of any kind reaches an installer.
		expect(JSON.stringify(res)).not.toMatch(/price|Price|1\.5/)
		expect(res.serviceCodes).toEqual([
			{ id: "sc-1", claroCode: "C1", name: "Wrap", unit: "EA" },
		])
	})
})

describe("GET /installer/restock — prices", () => {
	beforeEach(() => vi.clearAllMocks())

	it("never sends an installer a price, and an admin/supervisor gets no catalog here at all", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		mocks.buildRestockPrefill.mockResolvedValue([])
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-1",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "9.99",
				contractorPrice: "5",
				claroBasePrice: "7",
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		expect(JSON.stringify(res)).not.toMatch(/9\.99|rice/)

		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		const sup = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		expect(sup.serviceCodes).toEqual([])
	})
})

describe("GET /installer/restock — own requests", () => {
	beforeEach(() => vi.clearAllMocks())

	it("lists the installer's own requests with status, totals and whether sign-off applies", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.buildRestockPrefill.mockResolvedValue([])
		mocks.getActiveMaterialCodes.mockResolvedValue([])
		mocks.db.restockRequest.findMany.mockResolvedValue([
			{
				id: "r1",
				status: "NEEDS_SIGNOFF",
				submittedAt: new Date("2026-10-01T12:00:00Z"),
				lines: [
					{ serviceCodeId: "a", qty: 2 },
					{ serviceCodeId: "b", qty: 3 },
				],
				approvedById: null,
			},
			{
				id: "r2",
				status: "PICKED",
				submittedAt: new Date("2026-09-20T12:00:00Z"),
				lines: [{ serviceCodeId: "a", qty: 1 }],
				approvedById: "sup-1",
			},
			{
				id: "r3",
				status: "SUBMITTED",
				submittedAt: new Date("2026-09-10T12:00:00Z"),
				lines: [],
				approvedById: null,
			},
		])
		const res = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		expect(mocks.db.restockRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { vanId: "van-1" } }),
		)
		expect(res.requests).toEqual([
			{
				id: "r1",
				status: "NEEDS_SIGNOFF",
				submittedAt: "2026-10-01T12:00:00.000Z",
				lineCount: 2,
				units: 5,
				signoff: true,
			},
			{
				id: "r2",
				status: "PICKED",
				submittedAt: "2026-09-20T12:00:00.000Z",
				lineCount: 1,
				units: 1,
				signoff: true,
			},
			{
				id: "r3",
				status: "SUBMITTED",
				submittedAt: "2026-09-10T12:00:00.000Z",
				lineCount: 0,
				units: 0,
				signoff: false,
			},
		])
	})

	it("gives a supervisor no personal requests", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		mocks.db.restockRequest.findMany.mockResolvedValue([])
		const res = await loader({
			request: new Request("http://localhost/installer/restock"),
			params: {},
		} as never)
		expect(res.requests).toEqual([])
	})
})

describe("POST /installer/restock", () => {
	beforeEach(() => vi.clearAllMocks())

	it("an installer cannot approve — redirects without updating", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		const req = formRequest({ intent: "approve", id: "r1" })
		await action({ request: req, params: {} } as never).catch(() => {})
		expect(mocks.db.restockRequest.updateMany).not.toHaveBeenCalled()
	})

	it("an installer supervisor can approve a restock awaiting sign-off", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		mocks.db.restockRequest.updateMany.mockResolvedValue({ count: 1 })
		const req = formRequest({ intent: "approve", id: "r1" })
		await action({ request: req, params: {} } as never).catch(() => {})
		expect(mocks.db.restockRequest.updateMany).toHaveBeenCalledWith({
			where: { id: "r1", status: "NEEDS_SIGNOFF" },
			data: { status: "APPROVED", approvedById: "sup-1" },
		})
	})

	it("rejects a double-approve on a restock no longer awaiting sign-off", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "sup-1", role: "INSTALLER_SUPERVISOR" },
		})
		mocks.db.restockRequest.updateMany.mockResolvedValue({ count: 0 })
		const req = formRequest({ intent: "approve", id: "r1" })
		const res = await action({ request: req, params: {} } as never)
		expect((res as Response).status).toBe(302)
		expect(mocks.db.restockRequest.updateMany).toHaveBeenCalledTimes(1)
	})

	it("drops a posted line whose serviceCodeId is not a real, active service code", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-real",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "1",
			},
		])
		const req = formRequest({
			lines: JSON.stringify([
				{ serviceCodeId: "sc-real", qty: 2 },
				{ serviceCodeId: "sc-forged", qty: 5 },
			]),
		})
		await action({ request: req, params: {} } as never)
		expect(mocks.createRestock).toHaveBeenCalledWith(
			"van-1",
			[{ serviceCodeId: "sc-real", qty: 2 }],
			{ id: "inst-1" },
		)
	})

	it("drops a posted line with a non-integer quantity", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-real",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "1",
			},
		])
		const req = formRequest({
			lines: JSON.stringify([{ serviceCodeId: "sc-real", qty: 1.5 }]),
		})
		const res = await action({ request: req, params: {} } as never)
		// Rejecting an all-invalid submission, not silently persisting an
		// empty restock: a lines: [] request would still reach the warehouse
		// release queue as a real, signable, no-op RECEIVED restock. Uses a
		// real i18n key (installer_restock.errors.items_required exists in
		// both locales) instead of a namespace that was never rendered.
		expect(mocks.createRestock).not.toHaveBeenCalled()
		expect(res).toEqual({ errorKey: "installer_restock.errors.items_required" })
	})

	it("rejects, with a graceful error, a combined quantity above the maximum instead of letting createRestock's throw 500", async () => {
		mocks.requireRole.mockResolvedValue({
			user: { id: "inst-1", role: "INSTALLER" },
		})
		mocks.requireInstaller.mockResolvedValue({ van: { id: "van-1" } })
		mocks.getActiveMaterialCodes.mockResolvedValue([
			{
				id: "sc-real",
				claroCode: "C1",
				name: "Wrap",
				unit: "EA",
				unitPrice: "1",
			},
		])
		// Two lines, each individually under MAX_LINE_QTY, that coalesce over it.
		const req = formRequest({
			lines: JSON.stringify([
				{ serviceCodeId: "sc-real", qty: 999 },
				{ serviceCodeId: "sc-real", qty: 999 },
			]),
		})
		const res = await action({ request: req, params: {} } as never)
		expect(mocks.createRestock).not.toHaveBeenCalled()
		expect(res).toEqual({ errorKey: "installer_restock.errors.qty_too_large" })
	})
})
