import { redirect } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn() },
		user: { findMany: vi.fn() },
		serviceCode: { findMany: vi.fn() },
		preCertSheet: { findFirst: vi.fn() },
	},
	requireRole: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.admin.docs.$id"

const doc = (overrides: Record<string, unknown> = {}) => ({
	id: "job-1",
	controlNumber: "JAF-1",
	status: "CLARO_UPLOADED",
	jobType: "INSTALL",
	supervisorId: "sup-1",
	assignedCrewIds: [],
	sendBackHistory: [],
	auditTrail: [],
	paymentRecords: [],
	fieldMaterials: null,
	jafInvoiceGeneratedAt: null,
	jafInvoicePdfPath: null,
	...overrides,
})

const load = () =>
	loader({
		request: new Request("http://localhost/admin/docs/job-1"),
		params: { id: "job-1" },
	} as any)

describe("Admin doc page loader: brigade's stock and the two PDFs", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({ user: { id: "a", role: "ADMIN" } })
		mocks.db.user.findMany.mockResolvedValue([])
		mocks.db.preCertSheet.findFirst.mockResolvedValue(null)
		mocks.db.serviceCode.findMany.mockResolvedValue([
			{
				id: "m1",
				claroCode: "1005803",
				name: "Drop cable",
				unit: "FT",
				unitPrice: 2,
			},
		])
	})

	it("is Admin only", async () => {
		mocks.requireRole.mockImplementation(async (_r, roles: string[]) => {
			if (!roles.includes("FINANCE")) throw redirect("/dashboard")
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(doc())
		await expect(load()).rejects.toHaveProperty("status", 302)
	})

	it("lists BRIGADE_STOCK use as tracked and links both PDFs once sent", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(
			doc({
				jafInvoiceGeneratedAt: new Date("2026-10-01T12:00:00Z"),
				jafInvoicePdfPath: "/uploads/packets/job-1-packet-1.pdf",
				fieldMaterials: [
					{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
					{
						serviceCodeId: "m1",
						used: 4,
						returned: 0,
						source: "BRIGADE_STOCK",
					},
				],
			}),
		)
		const data = await load()
		expect(data.brigadeStock).toEqual([
			{ claroCode: "1005803", name: "Drop cable", qty: 4, unit: "FT" },
		])
		expect(data.pricedInvoiceHref).toBe("/finance/verify/job-1/invoice.pdf")
		expect(data.packetHref).toMatch(/job-1-packet-1\.pdf$/)
	})

	it("has no tracked list without BRIGADE_STOCK rows, no priced link before the send", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(
			doc({
				fieldMaterials: [
					{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
				],
			}),
		)
		const data = await load()
		expect(data.brigadeStock).toEqual([])
		expect(data.pricedInvoiceHref).toBeNull()
		expect(data.packetHref).toBeNull()
	})
})
