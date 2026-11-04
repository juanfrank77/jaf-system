import { redirect } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => {
	const db: Record<string, any> = {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
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
			findFirst: vi.fn(),
		},
		notification: {
			create: vi.fn(),
		},
	}
	db.$transaction = vi.fn(async (ops: unknown) =>
		typeof ops === "function" ? ops(db) : Promise.all(ops as unknown[]),
	)
	return { db }
})

vi.mock("~/lib/brigade-inventory.server", () => ({
	syncUsedFromJob: vi.fn(async () => {}),
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

import { syncUsedFromJob } from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
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
		{ serviceCodeId: "sc-1", used: 3, returned: 2, source: "WAREHOUSE_ISSUE" },
		{ serviceCodeId: "sc-2", used: 1, returned: 0, source: "TRUCK_STOCK" },
		{ serviceCodeId: "sc-3", used: 0, returned: 0, source: "WAREHOUSE_ISSUE" },
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
		// Brigade's stock (sc-2) is tracked in fieldMaterials, never billed.
		expect(data.materialsUsed).toEqual([{ serviceCodeId: "sc-1", qty: 3 }])
		expect(data.blueprintPaths).toEqual([
			"/uploads/blueprints/doc-1/intake.pdf",
			expect.stringMatching(/^\/uploads\/blueprints\/doc-1\/.*plan\.pdf$/),
		])
		expect(db.notification.create).not.toHaveBeenCalled()
	})

	it("6 from the warehouse + 4 from brigade's stock bills 6 and tracks both", async () => {
		as("SUPERVISOR")
		withDoc({ materialsTaken: [{ serviceCodeId: "sc-1", qty: 10 }] })
		const split = [
			{
				serviceCodeId: "sc-1",
				used: 6,
				returned: 4,
				source: "WAREHOUSE_ISSUE",
			},
			{ serviceCodeId: "sc-1", used: 4, returned: 0, source: "TRUCK_STOCK" },
		]
		const form = new FormData()
		form.set("intent", "save")
		form.set("fieldMaterials", JSON.stringify(split))
		expect(await run(form)).toEqual({ ok: true })
		const { data } = lastUpdate()
		expect(data.materialsUsed).toEqual([{ serviceCodeId: "sc-1", qty: 6 }])
		expect(data.fieldMaterials).toEqual(split)
		// The truck-stock use is charged to the brigade's balance.
		expect(syncUsedFromJob).toHaveBeenCalledWith(
			expect.objectContaining({ fieldMaterials: split }),
			expect.any(String),
		)
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
				{
					serviceCodeId: "sc-1",
					used: 9,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
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

	it("accepts a PDF among the photos and saves the original file unchanged", async () => {
		as("SUPERVISOR")
		withDoc()
		const bytes = new Uint8Array([37, 80, 68, 70, 45, 1, 2, 3])
		const pdf = new File([bytes], "scan.pdf", { type: "application/pdf" })
		const form = new FormData()
		form.set("intent", "save")
		form.append("photosBefore", pdf)
		expect(await run(form)).toEqual({ ok: true })
		expect(saveUpload).toHaveBeenCalledTimes(1)
		const saved = vi.mocked(saveUpload).mock.calls[0][2]
		expect(new Uint8Array(await saved.arrayBuffer())).toEqual(bytes)
		expect(saved.type).toBe("application/pdf")
	})

	it("refuses a WebP photo", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "save")
		form.append(
			"photosBefore",
			new File(["x"], "a.webp", { type: "image/webp" }),
		)
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.photo_invalid",
		})
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

describe("POST /docs/:id/field — back", () => {
	it("saves the draft like Save, never advances, and goes to the job page", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "back")
		form.set("fieldNotes", "half written")
		const res = await run(form)
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/docs/doc-1")
		const { data } = lastUpdate()
		expect(data.fieldNotes).toBe("half written")
		expect(data).not.toHaveProperty("status")
		expect(data).not.toHaveProperty("fieldSubmittedAt")
	})

	it("does not leave the page when the draft cannot be saved", async () => {
		as("SUPERVISOR")
		withDoc()
		const form = new FormData()
		form.set("intent", "back")
		form.set("fieldMaterials", "not json")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.invalid_materials",
		})
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
		form.set("fieldNotes", "Brigade finished, customer confirmed.")
		form.append("photosBefore", photo("before.jpg"))
		form.append("photosAfter", photo("after.jpg"))
		extra(form)
		return form
	}

	it("refuses a blank Field report, and accepts N/A", async () => {
		as("SUPERVISOR")
		withDoc()
		const blank = await run(cont([], (f) => f.set("fieldNotes", "   ")))
		expect(blank).toMatchObject({
			errorKey: "docs_field.errors.field_report_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		await run(cont([], (f) => f.set("fieldNotes", "N/A")))
		expect(lastUpdate().data).toMatchObject({
			status: "FIELD_UPDATED",
			fieldNotes: "N/A",
		})
	})

	it("uses the stored Field report when the post carries none", async () => {
		as("SUPERVISOR")
		withDoc({ fieldNotes: "N/A" })
		await run(cont([], (f) => f.delete("fieldNotes")))
		expect(lastUpdate().data.status).toBe("FIELD_UPDATED")
	})

	it("refuses to continue without a Before and an After photo", async () => {
		as("SUPERVISOR")
		withDoc()
		const none = await run(
			cont([], (f) => {
				f.delete("photosBefore")
				f.delete("photosAfter")
			}),
		)
		expect(none).toMatchObject({
			errorKey: "docs_field.errors.photos_required",
		})
		const noAfter = await run(cont([], (f) => f.delete("photosAfter")))
		expect(noAfter).toMatchObject({
			errorKey: "docs_field.errors.photos_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("counts photos already saved, so During-only posts still continue", async () => {
		as("SUPERVISOR")
		withDoc()
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{ tag: "BEFORE" },
			{ tag: "AFTER" },
		] as any)
		await run(
			cont([], (f) => {
				f.delete("photosBefore")
				f.delete("photosAfter")
			}),
		)
		expect(lastUpdate().data.status).toBe("FIELD_UPDATED")
	})

	it("refuses WAREHOUSE use above what was signed out", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont([
				{
					serviceCodeId: "sc-1",
					used: 6,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
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
				{
					serviceCodeId: "sc-1",
					used: 5,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
				{
					serviceCodeId: "sc-9",
					used: 7,
					returned: 0,
					source: "TRUCK_STOCK",
				},
			]),
		)
		expect(res.status).toBe(302)
	})

	it("validates the stored table when the post carries none", async () => {
		as("SUPERVISOR")
		withDoc({
			fieldNotes: "N/A",
			fieldMaterials: [
				{
					serviceCodeId: "sc-1",
					used: 8,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
			],
		})
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{ tag: "BEFORE" },
			{ tag: "AFTER" },
		] as any)
		const form = new FormData()
		form.set("intent", "continue")
		expect(await run(form)).toEqual({
			errorKey: "docs_field.errors.used_exceeds_took",
		})
	})

	it("continues without a note when used differs from issued, and logs no discrepancy", async () => {
		as("SUPERVISOR")
		withDoc()
		const res = await run(
			cont([
				{
					serviceCodeId: "sc-1",
					used: 3,
					returned: 2,
					source: "WAREHOUSE_ISSUE",
				},
			]),
		)
		expect(res.status).toBe(302)
		const actions = vi
			.mocked(db.auditTrail.create)
			.mock.calls.map((c) => (c[0] as any).data.action)
		expect(actions).toContain("STATUS_CHANGED")
		expect(actions).not.toContain("QUANTITY_DISCREPANCY")
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
				{
					serviceCodeId: "sc-1",
					used: 5,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
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
				{
					serviceCodeId: "sc-1",
					used: 5,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
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
		withDoc({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
			fieldNotes: "N/A",
		})
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{ tag: "BEFORE" },
			{ tag: "AFTER" },
		] as any)
		const form = new FormData()
		form.set("intent", "continue")
		form.set(
			"fieldMaterials",
			JSON.stringify([
				{
					serviceCodeId: "sc-1",
					used: 5,
					returned: 0,
					source: "WAREHOUSE_ISSUE",
				},
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
			{
				serviceCodeId: "sc-1",
				used: 5,
				returned: 0,
				source: "WAREHOUSE_ISSUE",
			},
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
			{
				serviceCodeId: "sc-1",
				used: 2,
				returned: 3,
				source: "WAREHOUSE_ISSUE",
			},
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

describe("POST /docs/:id/field — add a service in the field", () => {
	const ordered = {
		serviceCodeId: "svc-1",
		claroCode: "34006301",
		accountCode: "610",
		name: "TRANSFER",
		qty: 2,
	}
	const retensar = {
		id: "svc-ret",
		claroCode: "34006300",
		accountCode: "610",
		name: "RETENSAR MENSAJERO MO",
	}
	const added = {
		serviceCodeId: "svc-ret",
		claroCode: "34006300",
		accountCode: "610",
		name: "RETENSAR MENSAJERO MO",
		qty: 1,
		addedInField: true,
	}

	function addForm(serviceCodeId = "svc-ret", qty: string | null = "1") {
		const form = new FormData()
		form.set("intent", "add_service")
		form.set("serviceCodeId", serviceCodeId)
		if (qty !== null) form.set("qty", qty)
		return form
	}
	function removeForm(serviceCodeId = "svc-ret") {
		const form = new FormData()
		form.set("intent", "remove_added_service")
		form.set("serviceCodeId", serviceCodeId)
		return form
	}
	const lastUpdateMany = () =>
		vi.mocked(db.jafInvoice.updateMany).mock.calls.at(-1)?.[0] as any
	const audits = () =>
		vi.mocked(db.auditTrail.create).mock.calls.map((c) => (c[0] as any).data)

	beforeEach(() => {
		vi.mocked(db.serviceCode.findFirst).mockImplementation((async (
			args: any,
		) => (args.where.id === retensar.id ? retensar : null)) as any)
		vi.mocked(db.jafInvoice.updateMany).mockResolvedValue({ count: 1 } as any)
	})

	it("adds 34006300 qty 1 to a job whose order lacks it, flagged and audited", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }] })
		expect(await run(addForm())).toEqual({ ok: true })

		const write = lastUpdateMany()
		// Never once the job is signed off or the packet is out, even if that
		// happened between read and write.
		expect(write.where).toEqual({
			id: "doc-1",
			jafInvoiceGeneratedAt: null,
			supervisorApprovedAt: null,
		})
		expect(write.data.installedServiceLines).toEqual([
			{ ...ordered, qty: 2 },
			added,
		])
		expect(audits()).toEqual([
			{
				docId: "doc-1",
				userId: "sup-1",
				action: "SERVICE_ADDED_IN_FIELD",
				diffJson: { code: "34006300", qty: 1 },
			},
		])
		// The picker's catalog rules: an active SERVICE code, never a placeholder.
		const where = vi.mocked(db.serviceCode.findFirst).mock.calls[0][0]!
			.where as any
		expect(where).toMatchObject({
			id: "svc-ret",
			active: true,
			kind: "SERVICE",
		})
		expect(JSON.stringify(where)).toContain("NEEDS_CODE")
		// The line is copied without any price column.
		expect(JSON.stringify(write.data)).not.toMatch(/price|amount/i)
	})

	it("adds to a job with no installed quantities yet", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: null })
		expect(await run(addForm("svc-ret", "2.5"))).toEqual({ ok: true })
		expect(lastUpdateMany().data.installedServiceLines).toEqual([
			{ ...added, qty: 2.5 },
		])
	})

	it("refuses a code already on the order: its installed qty is edited instead", async () => {
		as("SUPERVISOR")
		vi.mocked(db.serviceCode.findFirst).mockResolvedValue({
			id: "svc-1",
			claroCode: "34006301",
			accountCode: "610",
			name: "TRANSFER",
		} as any)
		withDoc()
		expect(await run(addForm("svc-1"))).toEqual({
			errorKey: "docs_field.errors.service_on_order",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("refuses a code already added in the field", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [added] })
		expect(await run(addForm())).toEqual({
			errorKey: "docs_field.errors.service_already_added",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("refuses a code that is not an active SERVICE catalog code", async () => {
		as("SUPERVISOR")
		withDoc()
		expect(await run(addForm("sc-1"))).toEqual({
			errorKey: "docs_field.errors.service_not_found",
		})
		expect(await run(addForm(""))).toEqual({
			errorKey: "docs_field.errors.service_not_found",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("refuses a quantity that is not a positive number", async () => {
		as("SUPERVISOR")
		withDoc()
		for (const qty of ["0", "-1", "abc", "", null, "Infinity"]) {
			expect(await run(addForm("svc-ret", qty))).toEqual({
				errorKey: "docs_field.errors.service_qty_invalid",
			})
		}
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("refuses once the packet has gone to Claro (ADMIN override included)", async () => {
		as("ADMIN", "admin-1")
		withDoc({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
			jafInvoiceGeneratedAt: new Date(),
			installedServiceLines: [added],
		})
		expect(await run(addForm("svc-ret"))).toEqual({
			errorKey: "docs_field.errors.service_packet_sent",
		})
		expect(await run(removeForm())).toEqual({
			errorKey: "docs_field.errors.service_packet_sent",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("refuses when the job is signed off (or the packet goes out) between the read and the write", async () => {
		as("SUPERVISOR")
		withDoc()
		vi.mocked(db.jafInvoice.updateMany).mockResolvedValue({ count: 0 } as any)
		expect(await run(addForm())).toEqual({
			errorKey: "docs_field.errors.service_signed_off",
		})
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("an out-of-scope supervisor can neither add nor remove", async () => {
		as("SUPERVISOR", "sup-2")
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["SUR"],
		} as any)
		withDoc({ installedServiceLines: [added] })
		expect((await run(addForm())).headers.get("Location")).toBe("/dashboard")
		expect((await run(removeForm())).headers.get("Location")).toBe("/dashboard")
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("a supervisor cannot add after sign-off (the step is locked)", async () => {
		as("SUPERVISOR")
		withDoc({ status: "SUPERVISOR_APPROVED", supervisorApprovedAt: new Date() })
		expect((await run(addForm())).headers.get("Location")).toBe("/docs/doc-1")
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("Admin cannot add or remove once the job is signed off, even before the packet goes out", async () => {
		as("ADMIN", "admin-1")
		withDoc({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
			installedServiceLines: [added],
		})
		expect(await run(addForm("svc-ret", "1"))).toEqual({
			errorKey: "docs_field.errors.service_signed_off",
		})
		expect(await run(removeForm())).toEqual({
			errorKey: "docs_field.errors.service_signed_off",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("Admin can still add before sign-off", async () => {
		as("ADMIN", "admin-1")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }] })
		expect(await run(addForm())).toEqual({ ok: true })
		expect(lastUpdateMany().where).toEqual({
			id: "doc-1",
			jafInvoiceGeneratedAt: null,
			supervisorApprovedAt: null,
		})
	})

	it("removes a line added in the field and audits it", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }, added] })
		expect(await run(removeForm())).toEqual({ ok: true })
		const write = lastUpdateMany()
		expect(write.where).toEqual({
			id: "doc-1",
			jafInvoiceGeneratedAt: null,
			supervisorApprovedAt: null,
		})
		expect(write.data.installedServiceLines).toEqual([{ ...ordered, qty: 2 }])
		expect(audits()).toEqual([
			{
				docId: "doc-1",
				userId: "sup-1",
				action: "SERVICE_REMOVED_IN_FIELD",
				diffJson: { code: "34006300", qty: 1 },
			},
		])
	})

	it("removes only lines added in the field, never an ordered one", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }, added] })
		expect(await run(removeForm("svc-1"))).toEqual({
			errorKey: "docs_field.errors.service_not_added",
		})
		expect(await run(removeForm("svc-unknown"))).toEqual({
			errorKey: "docs_field.errors.service_not_added",
		})
		// Added in the field, then put on the order by an order edit.
		withDoc({
			serviceLines: [ordered, { ...added, qty: 1 }],
			installedServiceLines: [{ ...ordered, qty: 2 }, added],
		})
		expect(await run(removeForm())).toEqual({
			errorKey: "docs_field.errors.service_not_added",
		})
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it("a draft save keeps the added lines, takes their new quantity and never adds a code itself", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }, added] })
		const form = new FormData()
		form.set("intent", "save")
		// An older draft: only the ordered line.
		form.set("installedServiceLines", JSON.stringify([{ ...ordered, qty: 3 }]))
		await run(form)
		expect(lastUpdate().data.installedServiceLines).toEqual([
			{ ...ordered, qty: 3 },
			added,
		])

		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }, added] })
		const form2 = new FormData()
		form2.set("intent", "save")
		form2.set(
			"installedServiceLines",
			JSON.stringify([
				{ ...ordered, qty: 3, addedInField: true },
				{ ...added, qty: 4, name: "renamed" },
				// Not on the order and never added through "Add service".
				{ ...added, serviceCodeId: "svc-x", claroCode: "999", qty: 9 },
			]),
		)
		await run(form2)
		expect(lastUpdate().data.installedServiceLines).toEqual([
			{ ...ordered, qty: 3 },
			{ ...added, qty: 4 },
		])
	})

	it("a draft save after a remove does not bring the removed line back", async () => {
		as("SUPERVISOR")
		withDoc({ installedServiceLines: [{ ...ordered, qty: 2 }] })
		const form = new FormData()
		form.set("intent", "save")
		form.set(
			"installedServiceLines",
			JSON.stringify([{ ...ordered, qty: 2 }, added]),
		)
		await run(form)
		expect(lastUpdate().data.installedServiceLines).toEqual([
			{ ...ordered, qty: 2 },
		])
	})
})

describe("GET /docs/:id/field — services added in the field", () => {
	it("lists the added line after the ordered ones with Ordered 0, its unit and no price", async () => {
		as("SUPERVISOR")
		withDoc({
			installedServiceLines: [
				{
					serviceCodeId: "svc-1",
					claroCode: "34006301",
					accountCode: "610",
					name: "TRANSFER",
					qty: 2,
				},
				{
					serviceCodeId: "svc-ret",
					claroCode: "34006300",
					accountCode: "610",
					name: "RETENSAR MENSAJERO MO",
					qty: 1,
					addedInField: true,
				},
			],
		})
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "svc-1", unit: "EA" },
			{ id: "svc-ret", unit: "EA" },
		] as any)
		const res = await load()
		expect(res.services.rows).toEqual([
			{
				serviceCodeId: "svc-1",
				claroCode: "34006301",
				name: "TRANSFER",
				estimated: 2,
				actual: 2,
				unit: "EA",
			},
			{
				serviceCodeId: "svc-ret",
				claroCode: "34006300",
				name: "RETENSAR MENSAJERO MO",
				estimated: 0,
				actual: 1,
				unit: "EA",
				addedInField: true,
			},
		])
		expect(res.addServiceOpen).toBe(true)
		const unitLookup = vi.mocked(db.serviceCode.findMany).mock
			.calls[0][0] as any
		expect(unitLookup.where.id.in).toEqual(["svc-1", "svc-ret"])
		// Only the unit is read for these lines, never a price column.
		expect(unitLookup.select).toEqual({ id: true, unit: true })
		expect(JSON.stringify(res)).not.toMatch(/unitPrice|lineAmount/)
	})

	it("closes Add service once the job is signed off (Admin, packet not sent yet)", async () => {
		as("ADMIN", "admin-1")
		withDoc({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
		})
		expect((await load()).addServiceOpen).toBe(false)
	})

	it("closes Add service once the packet has gone to Claro", async () => {
		as("ADMIN", "admin-1")
		withDoc({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
			jafInvoiceGeneratedAt: new Date(),
		})
		expect((await load()).addServiceOpen).toBe(false)
	})
})
