import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(() => Promise.resolve([])),
		},
		user: {
			findMany: vi.fn(),
			findFirst: vi.fn(),
		},
		warehouse: {
			findUnique: vi.fn(),
		},
		auditTrail: {
			create: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (ops: any[]) => {
			for (const op of ops) {
				if (typeof op === "function") {
					await op({
						jafInvoice: { update: vi.fn() },
						auditTrail: { create: vi.fn() },
						notification: { create: vi.fn() },
					})
				}
			}
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/pdf/warehouse-receipt.server", () => ({
	generateWarehouseReceiptPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}))

import { db } from "~/lib/db.server"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.docs.$id_.sign"

function formRequest(form: FormData, id = "doc-1") {
	return new Request(`http://localhost/docs/${id}/sign`, {
		method: "POST",
		body: form,
	})
}

describe("POST /docs/:id/sign", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseDoc() {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "PREPPED",
			supervisorId: "sup-1",
			estimatedMaterials: [{ serviceCodeId: "sc-1", qty: 2 }],
			materialsTaken: null,
		}
	}

	function validForm() {
		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("releasedById", "warehouse-1")
		form.set("signedById", "crew-1")
		form.set("releaseSignature", "data:image/png;base64,release")
		form.set("crewSignature", "data:image/png;base64,crew")
		form.set("materials", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))
		return form
	}

	it("requires both signatures", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "warehouse-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)

		const form = validForm()
		form.set("releaseSignature", "")
		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({
			errorKey: "docs_sign.errors.release_signature_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("transitions to SIGNED and records both signers", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "warehouse-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		;(db.user.findFirst as any).mockImplementation((args: any) => {
			if (args.where.role === "WAREHOUSE")
				return Promise.resolve({ id: "warehouse-1", name: "Iidalia" })
			return Promise.resolve({ id: "crew-1", name: "Crew A" })
		})
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const result = await action({
			request: formRequest(validForm()),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(db.jafInvoice.update).toHaveBeenCalled()
		const updateCall = vi.mocked(db.jafInvoice.update).mock.calls[0][0]
		expect(updateCall.data.status).toBe("SIGNED")
		expect(updateCall.data.releasedById).toBe("warehouse-1")
		expect(updateCall.data.signedById).toBe("crew-1")
		expect(updateCall.data.materialsTaken).toEqual([
			{ serviceCodeId: "sc-1", qty: 2 },
		])
		expect(generateWarehouseReceiptPdf).toHaveBeenCalled()
	})

	it("creates overage notification and audit when taken exceeds estimated", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "warehouse-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		;(db.user.findFirst as any).mockImplementation((args: any) => {
			if (args.where.role === "WAREHOUSE")
				return Promise.resolve({ id: "warehouse-1", name: "Iidalia" })
			return Promise.resolve({ id: "crew-1", name: "Crew A" })
		})
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([
			{ id: "sup-1" },
			{ id: "admin-1" },
		] as any)
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = validForm()
		form.set("materials", JSON.stringify([{ serviceCodeId: "sc-1", qty: 5 }]))

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(db.auditTrail.create).toHaveBeenCalled()
		expect(db.notification.create).toHaveBeenCalledTimes(2)
		const notificationMessages = vi
			.mocked(db.notification.create)
			.mock.calls.map((c) => (c[0] as any).data.message)
		expect(notificationMessages[0]).toContain("overage")
	})

	it("rejects when materials are already signed", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "warehouse-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...baseDoc(),
			materialsTaken: [{ serviceCodeId: "sc-1", qty: 2 }],
		} as any)

		const result = await action({
			request: formRequest(validForm()),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({ errorKey: "docs_sign.errors.already_signed" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})
