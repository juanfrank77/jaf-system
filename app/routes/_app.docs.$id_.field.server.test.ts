import { redirect } from "react-router"
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
			findMany: vi.fn(),
		},
		auditTrail: {
			create: vi.fn(),
		},
		serviceCode: {
			findMany: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
		$transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
	},
}))

vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	getActiveMaterialCodes: vi.fn(),
}))

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/uploads.server", () => ({
	saveUpload: vi.fn(
		async (kind: string, filename: string) => `/uploads/${kind}/${filename}`,
	),
	photosThatLoad: vi.fn(async (_docId: string, photos: unknown[]) => photos),
}))

import { db } from "~/lib/db.server"
import { usedForFinance } from "~/lib/field-materials"
import { composeJobAddress } from "~/lib/intake-address"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { saveUpload } from "~/lib/uploads.server"
import { action, loader } from "./_app.docs.$id_.field"

type Role = "SUPERVISOR" | "ADMIN" | "CREW"

function as(role: Role, id = "sup-1") {
	vi.mocked(requireRole).mockImplementation(async (_req, roles) => {
		if (!(roles as string[]).includes(role)) throw redirect("/dashboard")
		return { user: { id, role }, session: {} } as any
	})
}

function baseDoc(overrides: Record<string, unknown> = {}) {
	return {
		id: "doc-1",
		controlNumber: "JAF-1001",
		status: "SIGNED",
		supervisorId: "sup-1",
		brigade: { area: "CENTRAL", name: "JESUS MARTINEZ" },
		assignedCrewIds: ["crew-1"],
		sector: "Cupey",
		direccion1: "Calle Luna 1",
		direccion2: null,
		latitud: null,
		longitud: null,
		ciudad: "San Juan",
		jobAddressEstimated: "Calle Luna 1, Cupey",
		jobAddressActual: null,
		addressCorrections: null,
		materialsTaken: [{ serviceCodeId: "sc-1", qty: 5 }],
		estimatedMaterials: [{ serviceCodeId: "sc-1", qty: 4 }],
		materialsUsed: null,
		materialsReturned: null,
		fieldMaterials: null,
		serviceLines: [
			{
				serviceCodeId: "svc-1",
				claroCode: "34006301",
				accountCode: "610",
				name: "TRANSFER",
				qty: 2,
			},
		],
		installedServiceLines: null,
		fieldNotes: null,
		fieldStartedAt: null,
		fieldSubmittedAt: null,
		supervisorApprovedAt: null,
		blueprintPaths: ["/uploads/blueprints/doc-1/intake.pdf"],
		claroSupervisor: {
			name: "Claro Ana",
			requiresBlueprint: false,
			requiresPrefield: false,
		},
		// Price columns a supervisor must never receive.
		jafInvoiceLines: [{ unitPrice: 99, lineAmount: 198 }],
		jafInvoiceLineTotal: 198,
		avisoLines: [{ unitPrice: 99 }],
		avisoLineTotal: 198,
		grossPayable: 150,
		netPayable: 135,
		retentionAmount: 15,
		contractorShareLines: [{ amount: 1 }],
		advanceAmount: 10,
		finalPaymentAmount: 20,
		...overrides,
	}
}

/** Honour the route's `select` so the test sees exactly what is fetched. */
function pick(record: Record<string, unknown>, select: unknown) {
	if (!select || typeof select !== "object") return record
	return Object.fromEntries(
		Object.keys(select as object)
			.filter((k) => k in record)
			.map((k) => [k, record[k]]),
	)
}

function withDoc(overrides: Record<string, unknown> = {}) {
	const record = baseDoc(overrides)
	vi.mocked(db.jafInvoice.findUniqueOrThrow).mockImplementation(((args: {
		select?: unknown
	}) => Promise.resolve(pick(record, args?.select))) as any)
	return record
}

function post(form: FormData, id = "doc-1") {
	return new Request(`http://localhost/docs/${id}/field`, {
		method: "POST",
		body: form,
	})
}

function run(form: FormData) {
	return action({ request: post(form), params: { id: "doc-1" } } as any).catch(
		(r: unknown) => r,
	) as Promise<any>
}

function load() {
	return loader({
		request: new Request("http://localhost/docs/doc-1/field"),
		params: { id: "doc-1" },
	} as any).catch((r: unknown) => r) as Promise<any>
}

const photo = (name: string) => new File(["img"], name, { type: "image/jpeg" })

function lastUpdate() {
	return vi.mocked(db.jafInvoice.update).mock.calls.at(-1)?.[0] as any
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(db.user.findUnique).mockResolvedValue({
		supervisorAreas: ["CENTRAL"],
	} as any)
	vi.mocked(db.user.findMany).mockResolvedValue([])
	vi.mocked(db.photo.findMany).mockResolvedValue([])
	vi.mocked(getActiveMaterialCodes).mockResolvedValue([])
	vi.mocked(db.serviceCode.findMany).mockResolvedValue([
		{ id: "svc-1", unit: "EA" },
	] as any)
})

describe("POST /docs/:id/field — save", () => {
	const rows = [
		{ serviceCodeId: "sc-1", used: 3, returned: 2, source: "WAREHOUSE" },
		{ serviceCodeId: "sc-2", used: 1, returned: 0, source: "BRIGADE_STOCK" },
		{ serviceCodeId: "sc-3", used: 0, returned: 0, source: "WAREHOUSE" },
	] as const

	function fullSave() {
		const form = new FormData()
		form.set("intent", "save")
		form.append("photosBefore", photo("before.jpg"))
		form.append("photosDuring", photo("during.jpg"))
		form.append("photosAfter", photo("after.jpg"))
		form.append(
			"blueprint",
			new File(["%PDF"], "plan.pdf", { type: "application/pdf" }),
		)
		form.set("fieldMaterials", JSON.stringify(rows))
		form.set("direccion1", "Calle Sol 22")
		form.set("sector", "Cupey")
		form.set("ciudad", "San Juan")
		return form
	}

	it("saves photos by tag, blueprints, the materials table and the address; status unchanged", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(fullSave())

		expect(res).toEqual({ ok: true })
		const tags = vi
			.mocked(db.photo.create)
			.mock.calls.map((c) => (c[0] as any).data.tag)
		expect(tags).toEqual(["BEFORE", "DURING", "AFTER"])
		expect(saveUpload).toHaveBeenCalledWith(
			"photos/doc-1",
			expect.stringMatching(/during\.jpg$/),
			expect.any(File),
		)
		expect(saveUpload).toHaveBeenCalledWith(
			"blueprints/doc-1",
			expect.stringMatching(/plan\.pdf$/),
			expect.any(File),
		)

		const { data } = lastUpdate()
		expect(data).not.toHaveProperty("status")
		expect(data.fieldStartedAt).toBeInstanceOf(Date)
		expect(data.fieldMaterials).toEqual(rows)
		expect(data.materialsUsed).toEqual(usedForFinance([...rows]))
		expect(data.blueprintPaths).toEqual([
			"/uploads/blueprints/doc-1/intake.pdf",
			expect.stringMatching(/^\/uploads\/blueprints\/doc-1\/.*plan\.pdf$/),
		])
		expect(db.notification.create).not.toHaveBeenCalled()
	})

	it("a changed Dirección 1 updates the Aviso address columns, recomputes the job address and logs the correction", async () => {
		as("SUPERVISOR")
		withDoc()
		await run(fullSave())
		const { data } = lastUpdate()
		const composed = composeJobAddress({
			direccion1: "Calle Sol 22",
			sector: "Cupey",
		})
		expect(data.direccion1).toBe("Calle Sol 22")
		expect(data.jobAddressEstimated).toBe(composed)
		expect(data.jobAddressActual).toBe(composed)
		expect(data.addressCorrections).toEqual([
			expect.objectContaining({
				original: "Calle Luna 1, Cupey",
				corrected: composed,
				correctedById: "sup-1",
			}),
		])
	})

	it("a changed jobAddressActual is taken as Dirección 1", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("jobAddressActual", "Calle Sol 22")
		await run(form)
		const { data } = lastUpdate()
		expect(data.direccion1).toBe("Calle Sol 22")
		expect(data.jobAddressEstimated).toBe("Calle Sol 22, Cupey")
		expect(data.addressCorrections).toHaveLength(1)
	})

	it("appends to an existing correction history", async () => {
		as("SUPERVISOR")
		const earlier = {
			original: "x",
			corrected: "Calle Luna 1, Cupey",
			correctedById: "sup-1",
			correctedAt: "2026-10-01T10:00:00.000Z",
		}
		withDoc({ addressCorrections: [earlier] })
		await run(fullSave())
		expect(lastUpdate().data.addressCorrections).toEqual([
			earlier,
			expect.objectContaining({ corrected: "Calle Sol 22, Cupey" }),
		])
	})

	it("an unchanged address writes no address columns and no correction", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("direccion1", "Calle Luna 1")
		form.set("sector", "Cupey")
		form.set("ciudad", "San Juan")
		form.set("fieldNotes", "Poste caído")
		await run(form)
		const { data } = lastUpdate()
		expect(data.fieldNotes).toBe("Poste caído")
		expect(data).not.toHaveProperty("addressCorrections")
		expect(data).not.toHaveProperty("jobAddressEstimated")
		expect(data).not.toHaveProperty("direccion1")
	})

	it("refuses an empty Dirección 1", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("direccion1", "  ")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.address_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("sets fieldStartedAt only on the first save", async () => {
		as("SUPERVISOR")
		withDoc({ fieldStartedAt: new Date("2026-10-17T09:00:00Z") })
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "again")
		expect(await run(form)).toEqual({ ok: true })
		expect(lastUpdate().data).not.toHaveProperty("fieldStartedAt")
	})

	it("a partial save touches only what was sent", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.append("photosDuring", photo("d.jpg"))
		await run(form)
		expect(Object.keys(lastUpdate().data).sort()).toEqual(["fieldStartedAt"])
		expect(db.photo.create).toHaveBeenCalledTimes(1)
	})

	it("does not check quantities on save (Continue does)", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set(
			"fieldMaterials",
			JSON.stringify([
				{ serviceCodeId: "sc-1", used: 9, returned: 0, source: "WAREHOUSE" },
			]),
		)
		expect(await run(form)).toEqual({ ok: true })
	})

	it("refuses a photo that fails file validation and writes nothing", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.append(
			"photosBefore",
			new File(["x"], "a.txt", { type: "text/plain" }),
		)
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.photo_invalid",
		})
		expect(saveUpload).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses a blueprint that is neither a PDF nor a photo and writes nothing", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.append("blueprint", new File(["x"], "plan.exe", { type: "" }))
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.blueprint_invalid",
		})
		expect(saveUpload).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses malformed materials JSON", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldMaterials", "{bad")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.invalid_materials",
		})
	})

	it("stores installed quantities per service line", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		const installed = [
			{
				serviceCodeId: "svc-1",
				claroCode: "34006301",
				accountCode: "610",
				name: "TRANSFER",
				qty: 0,
			},
		]
		form.set("installedServiceLines", JSON.stringify(installed))
		await run(form)
		expect(lastUpdate().data.installedServiceLines).toEqual(installed)
	})

	it("refuses malformed installed service lines", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("installedServiceLines", "{bad")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.invalid_service_lines",
		})
	})

	it("is allowed after Continue, before sign-off", async () => {
		as("SUPERVISOR")
		withDoc({ status: "FIELD_UPDATED" })
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "late info")
		expect(await run(form)).toEqual({ ok: true })
	})
})

describe("POST /docs/:id/field — continue", () => {
	function cont(
		rows: unknown[],
		extra: (f: FormData) => void = () => {},
	): FormData {
		const form = new FormData()
		form.set("intent", "continue")
		form.set("fieldMaterials", JSON.stringify(rows))
		extra(form)
		return form
	}

	it("refuses WAREHOUSE use above what was signed out", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont([
				{ serviceCodeId: "sc-1", used: 6, returned: 0, source: "WAREHOUSE" },
			]),
		)
		expect(res).toEqual({ errorKey: "docs_field.errors.used_exceeds_took" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.$transaction).not.toHaveBeenCalled()
	})

	it("lets Brigade's-stock use exceed what was signed out", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont([
				{ serviceCodeId: "sc-1", used: 5, returned: 0, source: "WAREHOUSE" },
				{
					serviceCodeId: "sc-9",
					used: 7,
					returned: 0,
					source: "BRIGADE_STOCK",
				},
			]),
		)
		expect(res.status).toBe(302)
	})

	it("requires a discrepancy note when quantities differ", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont([
				{ serviceCodeId: "sc-1", used: 3, returned: 2, source: "WAREHOUSE" },
			]),
		)
		expect(res).toEqual({
			errorKey: "docs_field.errors.discrepancy_note_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("validates the stored table when the post carries none", async () => {
		as("SUPERVISOR")
		withDoc({
			fieldMaterials: [
				{ serviceCodeId: "sc-1", used: 8, returned: 0, source: "WAREHOUSE" },
			],
		})
		const form = new FormData()
		form.set("intent", "continue")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.used_exceeds_took",
		})
	})

	it("with a note, logs the discrepancy and advances", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont(
				[{ serviceCodeId: "sc-1", used: 3, returned: 2, source: "WAREHOUSE" }],
				(f) => f.set("discrepancyNote", "Two came back unused"),
			),
		)
		expect(res.status).toBe(302)
		const audit = vi
			.mocked(db.auditTrail.create)
			.mock.calls.find(
				(c) => (c[0] as any).data.action === "QUANTITY_DISCREPANCY",
			)
		expect((audit as any)[0].data.diffJson).toMatchObject({
			note: "Two came back unused",
			blocksFinance: false,
		})
	})

	it("a second Continue, once already at Sign off, logs no second discrepancy", async () => {
		as("SUPERVISOR")
		withDoc({ status: "FIELD_UPDATED" })
		const res = await run(
			cont(
				[{ serviceCodeId: "sc-1", used: 3, returned: 2, source: "WAREHOUSE" }],
				(f) => f.set("discrepancyNote", "Two came back unused"),
			),
		)
		expect(res.status).toBe(302)
		const actions = vi
			.mocked(db.auditTrail.create)
			.mock.calls.map((c) => (c[0] as any).data.action)
		expect(actions).not.toContain("QUANTITY_DISCREPANCY")
		expect(actions).not.toContain("STATUS_CHANGED")
	})

	it("advances SIGNED → FIELD_UPDATED without a signature, a crew notification or the blueprint", async () => {
		as("SUPERVISOR")
		withDoc({
			blueprintPaths: [],
			claroSupervisor: {
				name: "Claro Ana",
				requiresBlueprint: true,
				requiresPrefield: true,
			},
		})
		const res = await run(
			cont([
				{ serviceCodeId: "sc-1", used: 5, returned: 0, source: "WAREHOUSE" },
			]),
		)
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/docs/doc-1/review")
		const { data } = lastUpdate()
		expect(data.status).toBe("FIELD_UPDATED")
		expect(data.fieldSubmittedAt).toBeInstanceOf(Date)
		expect(data.fieldStartedAt).toBeInstanceOf(Date)
		expect(data.materialsUsed).toEqual([{ serviceCodeId: "sc-1", qty: 5 }])
		expect(data).not.toHaveProperty("completionSignature")
		expect(data).not.toHaveProperty("completedById")
		expect(db.notification.create).not.toHaveBeenCalled()
		const statusAudit = vi
			.mocked(db.auditTrail.create)
			.mock.calls.find((c) => (c[0] as any).data.action === "STATUS_CHANGED")
		expect((statusAudit as any)[0].data.diffJson.status).toEqual({
			before: "SIGNED",
			after: "FIELD_UPDATED",
		})
	})

	it("a second Continue (already FIELD_UPDATED) re-saves without a status change", async () => {
		as("SUPERVISOR")
		withDoc({ status: "FIELD_UPDATED" })
		const res = await run(
			cont([
				{ serviceCodeId: "sc-1", used: 5, returned: 0, source: "WAREHOUSE" },
			]),
		)
		expect(res.status).toBe(302)
		expect(lastUpdate().data).not.toHaveProperty("status")
		expect(lastUpdate().data.fieldSubmittedAt).toBeInstanceOf(Date)
	})
})

describe("/docs/:id/field — access", () => {
	it("CREW is rejected by requireRole (loader and action)", async () => {
		as("CREW", "crew-1")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		const a = await run(form)
		const l = await load()
		expect(a.status).toBe(302)
		expect(l.status).toBe(302)
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), [
			"SUPERVISOR",
			"ADMIN",
		])
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("an out-of-scope supervisor is refused", async () => {
		as("SUPERVISOR", "sup-2")
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "x")
		const a = await run(form)
		const l = await load()
		expect(a.status).toBe(302)
		expect(a.headers.get("Location")).toBe("/dashboard")
		expect(l.headers.get("Location")).toBe("/dashboard")
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("a supervisor of the brigade's area may fill it", async () => {
		as("SUPERVISOR", "sup-2")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "x")
		expect(await run(form)).toEqual({ ok: true })
	})

	it("ADMIN may fill any job", async () => {
		as("ADMIN", "admin-1")
		withDoc({ supervisorId: "sup-9", brigade: null })
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "x")
		expect(await run(form)).toEqual({ ok: true })
	})

	it("redirects to the job when the Field step is not open", async () => {
		as("SUPERVISOR")
		withDoc({ status: "SUPERVISOR_APPROVED" })
		const form = new FormData()
		form.set("intent", "save")
		const a = await run(form)
		expect(a.headers.get("Location")).toBe("/docs/doc-1")
		expect((await load()).headers.get("Location")).toBe("/docs/doc-1")
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("after sign-off, save is refused for SUPERVISOR (locked) but allowed for ADMIN", async () => {
		const signedOff = {
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
		}
		const form = () => {
			const f = new FormData()
			f.set("intent", "save")
			f.set("fieldNotes", "late info")
			return f
		}

		as("SUPERVISOR")
		withDoc(signedOff)
		const refused = await run(form())
		expect(refused.status).toBe(302)
		expect(refused.headers.get("Location")).toBe("/docs/doc-1")
		expect((await load()).headers.get("Location")).toBe("/docs/doc-1")
		expect(db.jafInvoice.update).not.toHaveBeenCalled()

		as("ADMIN", "admin-1")
		withDoc(signedOff)
		expect(await run(form())).toEqual({ ok: true })
		expect(lastUpdate().data).toMatchObject({ fieldNotes: "late info" })
		expect(lastUpdate().data).not.toHaveProperty("status")
		expect((await load()).doc.status).toBe("SUPERVISOR_APPROVED")
	})

	it("ADMIN continue after sign-off saves and does not change the status", async () => {
		as("ADMIN", "admin-1")
		withDoc({ status: "SUPERVISOR_APPROVED", supervisorApprovedAt: new Date() })
		const form = new FormData()
		form.set("intent", "continue")
		form.set(
			"fieldMaterials",
			JSON.stringify([
				{ serviceCodeId: "sc-1", used: 5, returned: 0, source: "WAREHOUSE" },
			]),
		)
		const res = await run(form)
		expect(res.status).toBe(302)
		expect(lastUpdate().data).not.toHaveProperty("status")
	})

	it("a supervisor is locked out once supervisorApprovedAt is set, whatever the status", async () => {
		as("SUPERVISOR")
		withDoc({ status: "FIELD_UPDATED", supervisorApprovedAt: new Date() })
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldNotes", "x")
		expect((await run(form)).headers.get("Location")).toBe("/docs/doc-1")
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("nobody edits Field once the packet has gone to Claro", async () => {
		as("ADMIN", "admin-1")
		withDoc({ status: "CLARO_UPLOADED", supervisorApprovedAt: new Date() })
		const form = new FormData()
		form.set("intent", "save")
		expect((await run(form)).headers.get("Location")).toBe("/docs/doc-1")
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses an unknown intent", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "approve")
		const res = await run(form)
		expect(res.init?.status ?? res.status).toBe(400)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("GET /docs/:id/field", () => {
	it("returns photos by tag, default materials rows and the services table, with no prices", async () => {
		as("SUPERVISOR")
		withDoc()
		vi.mocked(getActiveMaterialCodes).mockResolvedValue([
			{
				id: "sc-1",
				claroCode: "M-1",
				name: "Cable",
				unit: "ft",
				unitPrice: 12.5,
				claroBasePrice: 10,
				contractorPrice: 8,
			},
		] as any)
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{ id: "p1", tag: "BEFORE", localPath: "/u/photos/doc-1/a.jpg" },
			{ id: "p2", tag: "DURING", localPath: "/u/photos/doc-1/b.jpg" },
			{ id: "p3", tag: "AFTER", localPath: "/u/photos/doc-1/c.jpg" },
		] as any)

		const res = await load()

		expect(res.photos).toEqual({
			BEFORE: [{ id: "p1", src: "/files/photos/doc-1/a.jpg" }],
			DURING: [{ id: "p2", src: "/files/photos/doc-1/b.jpg" }],
			AFTER: [{ id: "p3", src: "/files/photos/doc-1/c.jpg" }],
		})
		expect(res.fieldMaterials).toEqual([
			{ serviceCodeId: "sc-1", used: 5, returned: 0, source: "WAREHOUSE" },
		])
		expect(res.services).toEqual({
			rows: [
				{
					serviceCodeId: "svc-1",
					claroCode: "34006301",
					name: "TRANSFER",
					estimated: 2,
					actual: null,
					unit: "EA",
				},
			],
			brigadeNames: [],
		})
		const payload = JSON.stringify(res)
		for (const priceKey of [
			"unitPrice",
			"claroBasePrice",
			"contractorPrice",
			"lineAmount",
			"jafInvoiceLines",
			"jafInvoiceLineTotal",
			"avisoLines",
			"avisoLineTotal",
			"grossPayable",
			"netPayable",
			"retentionAmount",
			"contractorShareLines",
			"advanceAmount",
			"finalPaymentAmount",
		]) {
			expect(payload).not.toContain(priceKey)
		}
	})

	it("names the brigades only on a shared job", async () => {
		as("SUPERVISOR")
		withDoc({ assignedCrewIds: ["crew-1", "crew-2"] })
		vi.mocked(db.user.findMany).mockImplementation((async (args: any) =>
			[
				{ id: "crew-1", name: "Brigada Uno" },
				{ id: "crew-2", name: "Brigada Dos" },
			].filter((u) => args.where.id.in.includes(u.id))) as any)
		const res = await load()
		expect(res.services.brigadeNames).toEqual(["Brigada Uno", "Brigada Dos"])
	})

	it("returns stored materials rows and the names of whoever edited the address", async () => {
		as("SUPERVISOR")
		const stored = [
			{ serviceCodeId: "sc-1", used: 2, returned: 3, source: "WAREHOUSE" },
		]
		withDoc({
			fieldMaterials: stored,
			addressCorrections: [
				{
					original: "a",
					corrected: "b",
					correctedById: "sup-3",
					correctedAt: "2026-10-01T10:00:00.000Z",
				},
			],
		})
		vi.mocked(db.user.findMany).mockResolvedValue([
			{ id: "sup-3", name: "Sup Tres" },
		] as any)
		const res = await load()
		expect(res.fieldMaterials).toEqual(stored)
		expect(res.correctorNames).toEqual({ "sup-3": "Sup Tres" })
	})
})
