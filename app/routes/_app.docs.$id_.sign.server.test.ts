import { redirect } from "react-router"
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
			findMany: vi.fn(() => Promise.resolve([])),
		},
		brigade: {
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

// The pickup signer is the assigned brigade's lead, a CREW user. findMany also
// serves the warehouse list and the overage notify list, so branch on the role.
const crewUsers = [
	{ id: "crew-1", name: "Jesus Martinez" },
	{ id: "crew-2", name: "Maria Lopez" },
]
function mockUserLists(notify: unknown[] = []) {
	;(db.user.findMany as any).mockImplementation((args: any) =>
		Promise.resolve(
			args.where?.role === "CREW"
				? crewUsers
				: args.where?.role === "WAREHOUSE"
					? []
					: notify,
		),
	)
}
function mockBrigade(
	brigade: { leadName: string | null; memberIds: string[] } | null = {
		leadName: "Jesus Martinez",
		memberIds: ["crew-2"],
	},
) {
	vi.mocked(db.brigade.findUnique).mockResolvedValue(brigade as any)
}

function formRequest(form: FormData, id = "doc-1") {
	return new Request(`http://localhost/docs/${id}/sign`, {
		method: "POST",
		body: form,
	})
}

describe("POST /docs/:id/sign", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockBrigade()
		mockUserLists()
	})

	function baseDoc() {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "PREPPED",
			supervisorId: "sup-1",
			brigadeId: "b-1",
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
		mockUserLists()

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
		mockUserLists([{ id: "sup-1" }, { id: "admin-1" }] as any)

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

	describe("signed Taken differs from Listed", () => {
		async function signWithTaken(taken: number) {
			vi.mocked(requireRole).mockResolvedValue({
				user: { id: "warehouse-1", role: "WAREHOUSE" },
				session: {},
			} as any)
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
				baseDoc() as any, // Listed: sc-1 x 2
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
			mockUserLists([{ id: "sup-1" }] as any)
			vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
				if (typeof callback === "function") {
					return await callback({
						jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
						auditTrail: { create: vi.mocked(db.auditTrail.create) },
						notification: { create: vi.mocked(db.notification.create) },
						stockMovement: { create: vi.mocked(db.stockMovement.create) },
					})
				}
			})

			const form = validForm()
			form.set(
				"materials",
				JSON.stringify([{ serviceCodeId: "sc-1", qty: taken }]),
			)
			const result = await action({
				request: formRequest(form),
				params: { id: "doc-1" },
			} as any).catch((r: any) => r)
			expect(result.status).toBe(302)
		}

		it("uses the edited (higher) number for saved Taken, stock movement and supervisor overage alert", async () => {
			await signWithTaken(5)

			const updateData = vi.mocked(db.jafInvoice.update).mock.calls[0][0]
				.data as any
			expect(updateData.materialsTaken).toEqual([
				{ serviceCodeId: "sc-1", qty: 5 },
			])

			const moves = vi
				.mocked(db.stockMovement.create)
				.mock.calls.map((c) => (c[0] as any).data)
			expect(moves).toHaveLength(1)
			expect(moves[0]).toMatchObject({
				serviceCodeId: "sc-1",
				type: "RELEASE",
				qty: -5,
			})

			// The supervisor is alerted because the edited 5 exceeds the listed 2,
			// and the overage audit records both numbers.
			const notified = vi
				.mocked(db.notification.create)
				.mock.calls.map((c) => (c[0] as any).data.userId)
			expect(notified).toEqual(["sup-1"])
			const overageAudit = vi
				.mocked(db.auditTrail.create)
				.mock.calls.map((c) => (c[0] as any).data)
				.find((d) => d.action === "MATERIAL_OVERAGE")
			expect(overageAudit.diffJson.overages).toEqual([
				{ serviceCodeId: "sc-1", estimatedQty: 2, takenQty: 5 },
			])
		})

		it("uses the edited (lower) number for Taken and stock movement, and raises no overage alert", async () => {
			await signWithTaken(1)

			const updateData = vi.mocked(db.jafInvoice.update).mock.calls[0][0]
				.data as any
			expect(updateData.materialsTaken).toEqual([
				{ serviceCodeId: "sc-1", qty: 1 },
			])
			const moves = vi
				.mocked(db.stockMovement.create)
				.mock.calls.map((c) => (c[0] as any).data)
			expect(moves.map((m) => m.qty)).toEqual([-1])
			expect(db.notification.create).not.toHaveBeenCalled()
		})
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
		mockUserLists()
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
		mockUserLists()
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

describe("who signs on /docs/:id/sign (crew accounts no longer sign in)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockBrigade()
		mockUserLists()
	})

	/** requireRole as the real one behaves: off-list roles go to /dashboard. */
	function as(role: string, id: string) {
		vi.mocked(requireRole).mockImplementation(async (_req, roles) => {
			if (!(roles as string[]).includes(role)) throw redirect("/dashboard")
			return { user: { id, role }, session: {} } as any
		})
	}

	function signable() {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "PREPPED",
			supervisorId: "sup-1",
			brigadeId: "b-1",
			assignedCrewIds: ["crew-1", "crew-2"],
			estimatedMaterials: [{ serviceCodeId: "sc-1", qty: 2 }],
			materialsTaken: null,
		} as any)
		;(db.user.findFirst as any).mockImplementation((args: any) =>
			Promise.resolve(
				args.where.role === "WAREHOUSE"
					? { id: args.where.id, name: "Iidalia" }
					: { id: args.where.id, name: `Member ${args.where.id}` },
			),
		)
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)
		mockUserLists()
	}

	function signForm() {
		const form = new FormData()
		form.set("warehouseId", "wh-1")
		form.set("releasedById", "warehouse-1")
		form.set("signedById", "crew-1")
		form.set("releaseSignature", "data:image/png;base64,release")
		form.set("crewSignature", "data:image/png;base64,crew")
		form.set("materials", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))
		return form
	}

	it("refuses a CREW session on the loader and the action, writing nothing", async () => {
		as("CREW", "crew-1")
		signable()
		const l = await loader({
			request: new Request("http://localhost/docs/doc-1/sign"),
			params: { id: "doc-1" },
		} as any).catch((e: unknown) => e)
		const a = await action({
			request: formRequest(signForm()),
			params: { id: "doc-1" },
		} as any).catch((e: unknown) => e)
		for (const res of [l, a]) {
			expect((res as Response).status).toBe(302)
			expect((res as Response).headers.get("Location")).toBe("/dashboard")
		}
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), [
			"WAREHOUSE",
			"ADMIN",
		])
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it.each([
		["WAREHOUSE", "warehouse-1"],
		["ADMIN", "admin-1"],
	])("lets %s complete the dual signature", async (role, id) => {
		as(role, id)
		signable()
		const res = await action({
			request: formRequest(signForm()),
			params: { id: "doc-1" },
		} as any).catch((r: unknown) => r)
		expect((res as Response).status).toBe(302)
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data as any
		expect(data.status).toBe("SIGNED")
		expect(data.releasedById).toBe("warehouse-1")
		expect(data.releaseSignature).toBe("data:image/png;base64,release")
		expect(data.signedById).toBe("crew-1")
		expect(data.crewSignature).toBe("data:image/png;base64,crew")
	})

	it("records one brigade member on the crew side, even when several are sent (multi-member signing is a follow-up)", async () => {
		as("WAREHOUSE", "warehouse-1")
		signable()
		const form = signForm()
		form.append("signedById", "crew-2")
		await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch((r: unknown) => r)
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data as any
		expect(data.signedById).toBe("crew-1")
		expect(generateWarehouseReceiptPdf).toHaveBeenCalledWith(
			expect.objectContaining({ crewSignerName: "Jesus Martinez" }),
			expect.anything(),
			"Main",
		)
	})
})

describe("pickup signer is the assigned brigade", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "warehouse-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "PREPPED",
			supervisorId: "sup-1",
			brigadeId: "b-1",
			estimatedMaterials: [{ serviceCodeId: "sc-1", qty: 2 }],
			materialsTaken: null,
		} as any)
		;(db.user.findFirst as any).mockResolvedValue({
			id: "warehouse-1",
			name: "Iidalia",
		})
		vi.mocked(db.warehouse.findUnique).mockResolvedValue({
			id: "wh-1",
			name: "Main",
		} as any)
		mockUserLists()
	})

	function loaderReq() {
		return loader({
			request: new Request("http://localhost/docs/doc-1/sign"),
			params: { id: "doc-1" },
		} as any) as Promise<any>
	}

	function form(signedById: string) {
		const f = new FormData()
		f.set("warehouseId", "wh-1")
		f.set("releasedById", "warehouse-1")
		f.set("signedById", signedById)
		f.set("releaseSignature", "data:image/png;base64,release")
		f.set("crewSignature", "data:image/png;base64,crew")
		f.set("materials", JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]))
		return f
	}

	it("the loader returns the brigade lead as the pickup signer", async () => {
		mockBrigade({ leadName: "Jesus Martinez", memberIds: ["crew-2"] })
		const data = await loaderReq()
		expect(data.pickupSigner).toEqual({ id: "crew-1", name: "Jesus Martinez" })
		expect(data.pickupErrorKey).toBeNull()
	})

	it("the loader reports no_pickup_signer, without throwing, when the brigade has no CREW user", async () => {
		mockBrigade({ leadName: "Nobody Known", memberIds: ["not-crew"] })
		const data = await loaderReq()
		expect(data.pickupSigner).toBeNull()
		expect(data.pickupErrorKey).toBe("docs_sign.errors.no_pickup_signer")
	})

	it("the loader reports no_pickup_signer when the job has no brigade", async () => {
		mockBrigade(null)
		const data = await loaderReq()
		expect(data.pickupSigner).toBeNull()
		expect(data.pickupErrorKey).toBe("docs_sign.errors.no_pickup_signer")
	})

	it("the action rejects a signedById that is not the brigade's pickup signer", async () => {
		mockBrigade({ leadName: "Jesus Martinez", memberIds: [] })
		const result = await action({
			request: formRequest(form("crew-2")),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_sign.errors.crew_signer_invalid" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("the action returns no_pickup_signer when the brigade has no CREW user", async () => {
		mockBrigade({ leadName: null, memberIds: [] })
		const result = await action({
			request: formRequest(form("crew-1")),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_sign.errors.no_pickup_signer" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("stores signedById and crewSignerName from the brigade lead", async () => {
		mockBrigade({ leadName: "Jesus Martinez", memberIds: ["crew-2"] })
		vi.mocked(db.$transaction).mockImplementation(async (cb: any) =>
			cb({
				jafInvoice: { update: vi.mocked(db.jafInvoice.update) },
				auditTrail: { create: vi.mocked(db.auditTrail.create) },
				notification: { create: vi.mocked(db.notification.create) },
				stockMovement: { create: vi.mocked(db.stockMovement.create) },
			}),
		)
		const res = await action({
			request: formRequest(form("crew-1")),
			params: { id: "doc-1" },
		} as any).catch((r: unknown) => r)
		expect((res as Response).status).toBe(302)
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data as any
		expect(data.signedById).toBe("crew-1")
		expect(generateWarehouseReceiptPdf).toHaveBeenCalledWith(
			expect.objectContaining({ crewSignerName: "Jesus Martinez" }),
			expect.anything(),
			"Main",
		)
	})
})
