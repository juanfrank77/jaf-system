import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		auditTrail: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (ops: any[]) => {
			for (const op of ops) await op
		}),
	},
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.returns"

function formRequest(form: FormData, id = "doc-1") {
	return new Request(`http://localhost/docs/${id}/returns`, {
		method: "POST",
		body: form,
	})
}

function baseDoc(overrides: Record<string, unknown> = {}) {
	return {
		id: "doc-1",
		status: "SIGNED",
		controlNumber: "JAF-2026-1004",
		materialsTaken: [{ serviceCodeId: "sc-1", qty: 10 }],
		materialsUsed: null,
		materialsReturned: null,
		...overrides,
	}
}

describe("GET /docs/:id/returns", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns existing returns and materialsUsed to the client", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "wh-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({
				materialsReturned: [
					{
						serviceCodeId: "sc-1",
						takenQty: 10,
						returnedQty: 3,
						notes: "leftover",
					},
				],
				materialsUsed: [{ serviceCodeId: "sc-1", qty: 7 }],
			}) as any,
		)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([] as any)

		const result = await loader({
			request: new Request("http://localhost/docs/doc-1/returns"),
			params: { id: "doc-1" },
		} as any)

		expect(result.existingReturns).toEqual([
			{
				serviceCodeId: "sc-1",
				takenQty: 10,
				returnedQty: 3,
				notes: "leftover",
			},
		])
		expect(result.materialsUsed).toEqual([{ serviceCodeId: "sc-1", qty: 7 }])
	})
})

describe("POST /docs/:id/returns", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("logs returns and updates the document", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "wh-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)

		const form = new FormData()
		form.set(
			"materialsReturned",
			JSON.stringify([
				{
					serviceCodeId: "sc-1",
					takenQty: 999,
					returnedQty: 3,
					notes: "some leftover",
				},
			]),
		)

		await expect(
			action({
				request: formRequest(form),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		const updateCall = (db.jafInvoice.update as any).mock.calls[0][0]
		expect(updateCall.data.materialsReturned).toEqual([
			{
				serviceCodeId: "sc-1",
				takenQty: 10,
				returnedQty: 3,
				notes: "some leftover",
			},
		])
	})

	it("rejects returnedQty greater than takenQty", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "wh-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)

		const form = new FormData()
		form.set(
			"materialsReturned",
			JSON.stringify([
				{
					serviceCodeId: "sc-1",
					takenQty: 10,
					returnedQty: 11,
					notes: "",
				},
			]),
		)

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toMatchObject({
			errorKey: "docs_returns.errors.return_exceeds_taken",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("ignores attempts to overwrite signed taken quantities", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "wh-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "sc-1" },
		] as any)

		const form = new FormData()
		form.set(
			"materialsTaken",
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 99 }]),
		)
		form.set(
			"materialsReturned",
			JSON.stringify([
				{
					serviceCodeId: "sc-1",
					takenQty: 99,
					returnedQty: 2,
					notes: "",
				},
			]),
		)

		await expect(
			action({
				request: formRequest(form),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })

		const updateCall = (db.jafInvoice.update as any).mock.calls[0][0]
		expect(updateCall.data.materialsReturned[0].takenQty).toBe(10)
	})

	it("rejects non-authorized status", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "wh-1", role: "WAREHOUSE" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc({ status: "CREATED" }) as any,
		)

		const form = new FormData()
		form.set("materialsReturned", JSON.stringify([]))

		await expect(
			action({
				request: formRequest(form),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})
