import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
		},
		user: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
		},
		photo: {
			create: vi.fn(),
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
						photo: { create: vi.fn() },
						jafInvoice: { update: vi.fn() },
						auditTrail: { create: vi.fn() },
						notification: { create: vi.fn() },
					})
				}
			}
		}),
	},
}))

vi.mock("~/lib/service-codes.server", () => ({
	getActiveMaterialCodes: vi.fn(async () => []),
	serviceCodesForRole: (_role: string, codes: unknown[]) => codes,
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.field"

function formRequest(form: FormData, id = "doc-1") {
	return new Request(`http://localhost/docs/${id}/field`, {
		method: "POST",
		body: form,
	})
}

describe("POST /docs/:id/field", () => {
	beforeEach(() => vi.clearAllMocks())

	function baseDoc() {
		return {
			id: "doc-1",
			controlNumber: "JAF-1001",
			status: "SIGNED",
			supervisorId: "sup-1",
			jobAddressEstimated: "Cupey, San Juan",
			jobAddressActual: null,
			addressCorrections: null,
			gpsCoordinates: null,
			materialsTaken: [{ serviceCodeId: "sc-1", qty: 5 }],
			materialsUsed: null,
			fieldNotes: null,
			startedAt: null,
			endedAt: null,
			completionSignature: null,
			completedById: null,
			completionSignedAt: null,
			completedAt: null,
			fieldSubmittedAt: null,
			assignedCrewIds: ["crew-1"],
		}
	}

	it("requires a completion signature", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)

		const form = new FormData()
		form.set("jobAddressActual", "123 Calle Sol")
		form.set(
			"materialsUsed",
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]),
		)
		form.set("completionSignature", "")

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({
			errorKey: "docs_field.errors.completion_signature_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("saves field update with address correction, time on site, GPS, and completion signature", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = new FormData()
		form.set("jobAddressActual", "123 Calle Sol, Cupey")
		form.set(
			"materialsUsed",
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]),
		)
		form.set("discrepancyNote", "Used fewer than taken due to site conditions")
		form.set("completionSignature", "data:image/png;base64,abc")
		form.set("startedAt", "2026-08-13T12:00:00.000Z")
		form.set("endedAt", "2026-08-13T13:30:00.000Z")
		form.set(
			"gpsCoordinates",
			JSON.stringify({
				lat: 18.22,
				lng: -66.05,
				capturedAt: "2026-08-13T12:00:00Z",
			}),
		)
		form.set("fieldNotes", "Done")

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(db.jafInvoice.update).toHaveBeenCalled()
		const updateCall = vi.mocked(db.jafInvoice.update).mock.calls[0][0]
		expect(updateCall.data.status).toBe("FIELD_UPDATED")
		expect(updateCall.data.jobAddressActual).toBe("123 Calle Sol, Cupey")
		expect(updateCall.data.completionSignature).toBe(
			"data:image/png;base64,abc",
		)
		expect(updateCall.data.completedById).toBe("crew-1")
		const corrections = updateCall.data.addressCorrections as unknown[]
		expect(corrections).toHaveLength(1)
		expect((corrections[0] as { original: string }).original).toBe(
			"Cupey, San Juan",
		)
		expect((corrections[0] as { corrected: string }).corrected).toBe(
			"123 Calle Sol, Cupey",
		)
		expect(updateCall.data.gpsCoordinates).toMatchObject({
			lat: 18.22,
			lng: -66.05,
		})
		expect(updateCall.data.startedAt).toBeInstanceOf(Date)
		expect(updateCall.data.endedAt).toBeInstanceOf(Date)
	})

	it("requires a discrepancy note when installed quantity differs from taken", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)

		const form = new FormData()
		form.set("jobAddressActual", "123 Calle Sol")
		form.set(
			"materialsUsed",
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 3 }]),
		)
		form.set("completionSignature", "data:image/png;base64,abc")

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({
			errorKey: "docs_field.errors.discrepancy_note_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	function buildValidForm() {
		const form = new FormData()
		form.set("jobAddressActual", "123 Calle Sol")
		form.set(
			"materialsUsed",
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 5 }]),
		)
		form.set("completionSignature", "data:image/png;base64,abc")
		return form
	}

	it("stores installed quantities per service line", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)

		const form = buildValidForm()
		form.set(
			"installedServiceLines",
			JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					accountCode: "610",
					name: "TRANSFER",
					qty: 4,
				},
			]),
		)
		await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		const update = vi.mocked(db.jafInvoice.update).mock.calls.at(-1)?.[0]
		expect(update?.data.installedServiceLines).toEqual([
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				name: "TRANSFER",
				qty: 4,
			},
		])
	})

	it("rejects malformed installed service lines", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)

		const form = buildValidForm()
		form.set("installedServiceLines", "{bad")
		const res = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({
			errorKey: "docs_field.errors.invalid_service_lines",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	function usedForm(lines: { serviceCodeId: string; qty: number }[]) {
		const form = new FormData()
		form.set("jobAddressActual", "123 Calle Sol")
		form.set("materialsUsed", JSON.stringify(lines))
		form.set("discrepancyNote", "Different from pickup")
		form.set("completionSignature", "data:image/png;base64,abc")
		return form
	}

	function asCrewWithDoc() {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			baseDoc() as any,
		)
		vi.mocked(db.$transaction).mockResolvedValue(undefined as any)
	}

	it("rejects a used quantity greater than taken, even with a discrepancy note", async () => {
		asCrewWithDoc()
		const result = await action({
			request: formRequest(usedForm([{ serviceCodeId: "sc-1", qty: 10 }])),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_field.errors.used_exceeds_took" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.$transaction).not.toHaveBeenCalled()
	})

	it("rejects a code that was not signed out at all", async () => {
		asCrewWithDoc()
		const result = await action({
			request: formRequest(usedForm([{ serviceCodeId: "sc-9", qty: 1 }])),
			params: { id: "doc-1" },
		} as any)
		expect(result).toEqual({ errorKey: "docs_field.errors.used_exceeds_took" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("accepts a used quantity equal to taken", async () => {
		asCrewWithDoc()
		const result = await action({
			request: formRequest(usedForm([{ serviceCodeId: "sc-1", qty: 5 }])),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
		expect(db.jafInvoice.update).toHaveBeenCalled()
	})

	it("accepts a used quantity below taken with a discrepancy note and logs it", async () => {
		asCrewWithDoc()
		const result = await action({
			request: formRequest(usedForm([{ serviceCodeId: "sc-1", qty: 3 }])),
			params: { id: "doc-1" },
		} as any).catch((r: any) => r)

		expect(result.status).toBe(302)
		expect(db.jafInvoice.update).toHaveBeenCalled()
		const auditCalls = vi.mocked(db.auditTrail.create).mock.calls
		const discrepancyAudit = auditCalls.find(
			(call) => call[0].data.action === "QUANTITY_DISCREPANCY",
		)
		expect(discrepancyAudit?.[0].data.diffJson).toMatchObject({
			blocksFinance: false,
		})
	})

	it("answers an offline-sync replay of used above taken with a distinct 422", async () => {
		asCrewWithDoc()
		const req = new Request("http://localhost/docs/doc-1/field", {
			method: "POST",
			body: usedForm([{ serviceCodeId: "sc-1", qty: 10 }]),
			headers: { "X-Offline-Sync": "true" },
		})
		const res = (await action({
			request: req,
			params: { id: "doc-1" },
		} as any)) as any
		expect(res.init?.status).toBe(422)
		expect(res.data).toEqual({
			validationError: "docs_field.errors.used_exceeds_took",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("loader exposes the names of whoever edited the address", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "crew-1", role: "CREW" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...baseDoc(),
			addressCorrections: [
				{
					original: "a",
					corrected: "b",
					correctedById: "crew-2",
					correctedAt: "2026-10-01T10:00:00.000Z",
				},
			],
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([
			{ id: "crew-2", name: "Ana Crew" },
		] as any)
		const res = await loader({
			request: new Request("http://localhost/docs/doc-1/field"),
			params: { id: "doc-1" },
		} as any)
		expect(res.correctorNames).toEqual({ "crew-2": "Ana Crew" })
	})
})
