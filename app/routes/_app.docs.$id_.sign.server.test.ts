import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => {
	const mockJafInvoiceUpdate = vi.fn((args: any) =>
		Promise.resolve({ ...args.data }),
	)
	const mockAuditTrailCreate = vi.fn((args: any) =>
		Promise.resolve({ ...args.data, id: "audit-1" }),
	)
	const mockNotificationCreate = vi.fn((args: any) =>
		Promise.resolve({ ...args.data, id: "notif-1" }),
	)
	const mockStockMovementCreate = vi.fn((args: any) =>
		Promise.resolve({ ...args.data, id: "move-1" }),
	)

	const mockDb = {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: mockJafInvoiceUpdate,
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
			create: mockAuditTrailCreate,
		},
		notification: {
			create: mockNotificationCreate,
		},
		stockMovement: {
			create: mockStockMovementCreate,
			findMany: vi.fn(),
		},
		$transaction: vi.fn(async (callback: any) => {
			if (typeof callback === "function") {
				// Create a transaction object that uses the mocked methods
				const txObject = {
					jafInvoice: { update: mockJafInvoiceUpdate },
					auditTrail: { create: mockAuditTrailCreate },
					notification: { create: mockNotificationCreate },
					stockMovement: { create: mockStockMovementCreate },
				}
				await callback(txObject)
			} else if (Array.isArray(callback)) {
				for (const op of callback) {
					if (typeof op === "function") {
						const txObject = {
							jafInvoice: { update: mockJafInvoiceUpdate },
							auditTrail: { create: mockAuditTrailCreate },
							notification: { create: mockNotificationCreate },
							stockMovement: { create: mockStockMovementCreate },
						}
						await op(txObject)
					}
				}
			}
		}),
	}
	return { db: mockDb }
})

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/pdf/warehouse-receipt.server", () => ({
	generateWarehouseReceiptPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}))

import { db } from "~/lib/db.server"
import { generateWarehouseReceiptPdf } from "~/lib/pdf/warehouse-receipt.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.sign"

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
		vi.mocked(db.user.findMany).mockResolvedValue([])

		// Override the transaction mock to properly execute the callback
		vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
			if (typeof callback === "function") {
				const txObject = {
					jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
					auditTrail: { create: vi.mocked(db.auditTrail.create) },
					notification: { create: vi.mocked(db.notification.create) },
					stockMovement: { create: vi.mocked(db.stockMovement.create) },
				}
				return await callback(txObject)
			}
		})

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

		// Override the transaction mock to properly execute the callback
		vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
			if (typeof callback === "function") {
				const txObject = {
					jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
					auditTrail: { create: vi.mocked(db.auditTrail.create) },
					notification: { create: vi.mocked(db.notification.create) },
					stockMovement: { create: vi.mocked(db.stockMovement.create) },
				}
				return await callback(txObject)
			}
		})

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

	it("appends RELEASE(-taken) bulk movements in the sign transaction", async () => {
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
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)

		// Track calls manually since the transaction mock doesn't work perfectly
		const createCalls: any[] = []
		vi.mocked(db.stockMovement.create).mockImplementation(((args: any) => {
			createCalls.push(args.data)
			return Promise.resolve({
				...args.data,
				id: `move-${createCalls.length}`,
			}) as any
		}) as any)

		// Override the transaction mock to properly execute the callback
		vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
			if (typeof callback === "function") {
				const txObject = {
					jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
					auditTrail: { create: vi.mocked(db.auditTrail.create) },
					notification: { create: vi.mocked(db.notification.create) },
					stockMovement: { create: vi.mocked(db.stockMovement.create) },
				}
				return await callback(txObject)
			}
		})

		const form = validForm()
		form.set(
			"materials",
			JSON.stringify([
				{ serviceCodeId: "1005803", qty: 300 },
				{ serviceCodeId: "1003748", qty: 2 },
			]),
		)

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(createCalls.length).toBe(2)
		const qtys = createCalls.map((c) => c.qty).sort()
		expect(qtys).toEqual([-300, -2].sort())
		const allBulkRelease = createCalls.every((data) => {
			return (
				data.kind === "BULK" &&
				data.type === "RELEASE" &&
				data.warehouseId === "wh-1"
			)
		})
		expect(allBulkRelease).toBe(true)
	})

	it("allows over-draw (on-hand may go negative) without error", async () => {
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
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)

		// Track calls manually
		const createCalls: any[] = []
		vi.mocked(db.stockMovement.create).mockImplementation(((args: any) => {
			createCalls.push(args.data)
			return Promise.resolve({ ...args.data, id: "move-1" }) as any
		}) as any)

		// Override the transaction mock to properly execute the callback
		vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
			if (typeof callback === "function") {
				const txObject = {
					jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
					auditTrail: { create: vi.mocked(db.auditTrail.create) },
					notification: { create: vi.mocked(db.notification.create) },
					stockMovement: { create: vi.mocked(db.stockMovement.create) },
				}
				return await callback(txObject)
			}
		})

		const form = validForm()
		form.set(
			"materials",
			JSON.stringify([{ serviceCodeId: "1005803", qty: 300 }]),
		)

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(
			createCalls.some((data) => {
				return data.type === "RELEASE" && data.qty === -300
			}),
		).toBe(true)
	})
})

describe("crew assignment scope on /docs/:id/sign", () => {
	beforeEach(() => vi.clearAllMocks())

	function unassignedCrewSetup() {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-9", role: "CREW" },
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			id: "doc-1",
			status: "PREPPED",
			assignedCrewIds: ["crew-1"],
		} as any)
	}

	it("404s the loader for a crew member not assigned to the job", async () => {
		unassignedCrewSetup()
		const thrown = await loader({
			request: new Request("http://localhost/docs/doc-1/sign"),
			params: { id: "doc-1" },
		} as any).catch((e: unknown) => e)
		expect((thrown as Response).status).toBe(404)
		expect(await (thrown as Response).text()).toBe("NOT_ASSIGNED")
	})

	it("404s the action and writes nothing for an unassigned crew member", async () => {
		unassignedCrewSetup()
		await expect(
			action({
				request: formRequest(new FormData()),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 404 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})
