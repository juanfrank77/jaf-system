import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
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

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { action } from "./_app.docs.$id_.field"

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

	it("rejects materials used greater than taken", async () => {
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
			JSON.stringify([{ serviceCodeId: "sc-1", qty: 10 }]),
		)
		form.set("completionSignature", "data:image/png;base64,abc")

		const result = await action({
			request: formRequest(form),
			params: { id: "doc-1" },
		} as any)

		expect(result).toEqual({
			errorKey: "docs_field.errors.exceeds_taken",
			errorParams: { serviceCodeId: "sc-1" },
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})
