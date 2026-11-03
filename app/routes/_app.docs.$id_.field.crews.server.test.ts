import { redirect } from "react-router"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => {
	const db: Record<string, any> = {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		user: { findUnique: vi.fn(), findMany: vi.fn() },
		brigade: { findMany: vi.fn() },
		photo: { create: vi.fn(), findMany: vi.fn() },
		auditTrail: { create: vi.fn() },
		serviceCode: { findMany: vi.fn(), findFirst: vi.fn() },
		notification: { create: vi.fn() },
	}
	db.$transaction = vi.fn(async (ops: unknown) =>
		typeof ops === "function" ? ops(db) : Promise.all(ops as unknown[]),
	)
	return { db }
})
vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	getActiveMaterialCodes: vi.fn(),
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/uploads.server", () => ({
	saveUpload: vi.fn(async (k: string, f: string) => `/uploads/${k}/${f}`),
	photosThatLoad: vi.fn(async (_d: string, photos: unknown[]) => photos),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { action, loader } from "./_app.docs.$id_.field"

const line = (id: string, qty: number, extra = {}) => ({
	serviceCodeId: id,
	claroCode: id.toUpperCase(),
	accountCode: "610",
	name: id,
	qty,
	...extra,
})
const FIBER = line("fiber", 1000)
const DIGGER = line("digger", 1)

function baseDoc(overrides: Record<string, unknown> = {}) {
	return {
		id: "doc-1",
		controlNumber: "JAF-1001",
		status: "SIGNED",
		supervisorId: "sup-1",
		brigade: { area: "CENTRAL", name: "ANGEL" },
		brigadeId: "b-angel",
		crewAssignmentHistory: [
			{ brigadeId: "b-angel", brigadeIds: ["b-angel", "b-jesus"] },
		],
		assignedCrewIds: ["u1", "u2"],
		materialsTaken: [{ serviceCodeId: "m-1", qty: 20 }],
		estimatedMaterials: [],
		fieldMaterials: null,
		serviceLines: [FIBER],
		installedServiceLines: null,
		crewServiceLines: null,
		fieldNotes: null,
		fieldStartedAt: null,
		fieldSubmittedAt: null,
		supervisorApprovedAt: null,
		jafInvoiceGeneratedAt: null,
		blueprintPaths: [],
		addressCorrections: null,
		claroSupervisor: { name: "Claro", requiresBlueprint: false },
		...overrides,
	}
}

function withDoc(overrides: Record<string, unknown> = {}) {
	const record = baseDoc(overrides)
	vi.mocked(db.jafInvoice.findUniqueOrThrow).mockImplementation(((a: {
		select?: object
	}) =>
		Promise.resolve(
			a?.select
				? Object.fromEntries(
						Object.keys(a.select)
							.filter((k) => k in record)
							.map((k) => [k, (record as any)[k]]),
					)
				: record,
		)) as any)
}

const as = (role = "SUPERVISOR") =>
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: "sup-1", role },
		session: {},
	} as any)
const post = (form: FormData) =>
	new Request("http://localhost/docs/doc-1/field", {
		method: "POST",
		body: form,
	})
const run = (form: FormData) =>
	action({ request: post(form), params: { id: "doc-1" } } as any).catch(
		(r: unknown) => r,
	) as Promise<any>
const lastUpdate = () =>
	vi.mocked(db.jafInvoice.update).mock.calls.at(-1)?.[0] as any
const photo = (n: string) => new File(["i"], n, { type: "image/jpeg" })

beforeEach(() => {
	vi.clearAllMocks()
	as()
	vi.mocked(db.user.findUnique).mockResolvedValue({
		supervisorAreas: ["CENTRAL"],
	} as any)
	vi.mocked(db.user.findMany).mockResolvedValue([])
	vi.mocked(db.photo.findMany).mockResolvedValue([])
	vi.mocked(getActiveMaterialCodes).mockResolvedValue([])
	vi.mocked(db.serviceCode.findMany).mockResolvedValue([])
	vi.mocked(db.brigade.findMany).mockResolvedValue([
		{ id: "b-angel", name: "ANGEL D JIMENEZ", code: "124" },
		{ id: "b-jesus", name: "JESUS MARTINEZ", code: "009" },
	] as any)
})

describe("field step — one window per crew", () => {
	describe("loader", () => {
		it("returns a window per brigade, lead first, each with its own quantities", async () => {
			withDoc({
				crewServiceLines: [
					{ brigadeId: "b-jesus", lines: [line("fiber", 400)] },
					{
						brigadeId: "b-angel",
						lines: [
							line("fiber", 600),
							line("digger", 1, { addedInField: true }),
						],
					},
				],
			})
			const data = await loader({
				request: new Request("http://localhost/docs/doc-1/field"),
				params: { id: "doc-1" },
			} as any)
			expect(
				data.crews.map((c: any) => [c.id, c.name, c.code, c.lead]),
			).toEqual([
				["b-angel", "ANGEL D JIMENEZ", "124", true],
				["b-jesus", "JESUS MARTINEZ", "009", false],
			])
			const [angel, jesus] = data.crews
			expect(
				angel.rows.map((r: any) => [r.serviceCodeId, r.estimated, r.actual]),
			).toEqual([
				["fiber", 1000, 600],
				["digger", 0, 1],
			])
			expect(
				jesus.rows.map((r: any) => [r.serviceCodeId, r.estimated, r.actual]),
			).toEqual([["fiber", 1000, 400]])
		})

		it("has no windows on a one-crew job", async () => {
			withDoc({ crewAssignmentHistory: null })
			const data = await loader({
				request: new Request("http://localhost/docs/doc-1/field"),
				params: { id: "doc-1" },
			} as any)
			expect(data.crews).toEqual([])
		})
	})

	describe("save", () => {
		const crewForm = (crews: unknown, intent = "save") => {
			const f = new FormData()
			f.set("intent", intent)
			f.set("crewServiceLines", JSON.stringify(crews))
			return f
		}

		it("stores each crew's lines and the job total as their sum", async () => {
			withDoc()
			await run(
				crewForm([
					{ brigadeId: "b-jesus", lines: [line("fiber", 400)] },
					{
						brigadeId: "b-angel",
						lines: [line("fiber", 600)],
					},
				]),
			)
			const { data } = lastUpdate()
			expect(data.crewServiceLines.map((c: any) => c.brigadeId)).toEqual([
				"b-angel",
				"b-jesus",
			])
			expect(
				data.installedServiceLines.map((l: any) => [l.serviceCodeId, l.qty]),
			).toEqual([["fiber", 1000]])
		})

		it("keeps a crew's field-added service when its post leaves it out of the order", async () => {
			const added = line("digger", 1, { addedInField: true })
			withDoc({
				crewServiceLines: [
					{ brigadeId: "b-angel", lines: [line("fiber", 600), added] },
				],
			})
			await run(
				crewForm([{ brigadeId: "b-angel", lines: [line("fiber", 650)] }]),
			)
			const angel = lastUpdate().data.crewServiceLines.find(
				(c: any) => c.brigadeId === "b-angel",
			)
			expect(angel.lines.map((l: any) => [l.serviceCodeId, l.qty])).toEqual([
				["fiber", 650],
				["digger", 1],
			])
		})

		it("refuses lines for a brigade that is not on the job", async () => {
			withDoc()
			const res = await run(
				crewForm([{ brigadeId: "b-stranger", lines: [line("fiber", 5)] }]),
			)
			expect(res).toEqual({
				errorKey: "docs_field.errors.invalid_service_lines",
			})
			expect(db.jafInvoice.update).not.toHaveBeenCalled()
		})

		it("refuses a materials row for a brigade that is not on the job", async () => {
			withDoc()
			const f = new FormData()
			f.set("intent", "save")
			f.set(
				"fieldMaterials",
				JSON.stringify([
					{
						serviceCodeId: "m-1",
						used: 1,
						returned: 0,
						source: "WAREHOUSE_ISSUE",
						brigadeId: "b-stranger",
					},
				]),
			)
			expect(await run(f)).toEqual({
				errorKey: "docs_field.errors.invalid_materials",
			})
		})

		it("keeps each material row's crew and bills the sum of the crews", async () => {
			withDoc()
			const f = new FormData()
			f.set("intent", "save")
			f.set(
				"fieldMaterials",
				JSON.stringify([
					{
						serviceCodeId: "m-1",
						used: 7,
						returned: 0,
						source: "WAREHOUSE_ISSUE",
						brigadeId: "b-angel",
					},
					{
						serviceCodeId: "m-1",
						used: 10,
						returned: 0,
						source: "WAREHOUSE_ISSUE",
						brigadeId: "b-jesus",
					},
				]),
			)
			await run(f)
			const { data } = lastUpdate()
			expect(data.fieldMaterials.map((r: any) => r.brigadeId)).toEqual([
				"b-angel",
				"b-jesus",
			])
			expect(data.materialsUsed).toEqual([{ serviceCodeId: "m-1", qty: 17 }])
		})
	})

	describe("continue", () => {
		const cont = (crews: unknown) => {
			const f = new FormData()
			f.set("intent", "continue")
			f.set("crewServiceLines", JSON.stringify(crews))
			f.set("fieldMaterials", "[]")
			f.set("fieldNotes", "Done")
			f.append("photosBefore", photo("b.jpg"))
			f.append("photosAfter", photo("a.jpg"))
			return f
		}

		it("stays put until every crew has quantities", async () => {
			withDoc()
			const res = await run(
				cont([{ brigadeId: "b-angel", lines: [line("fiber", 600)] }]),
			)
			expect(res).toEqual({ errorKey: "docs_field.errors.crew_lines_required" })
			expect(db.jafInvoice.update).not.toHaveBeenCalled()
		})

		it("moves on when every crew has its quantities", async () => {
			withDoc()
			const res = await run(
				cont([
					{ brigadeId: "b-angel", lines: [line("fiber", 600)] },
					{ brigadeId: "b-jesus", lines: [line("fiber", 400)] },
				]),
			)
			expect(res).toBeInstanceOf(Response)
			expect((res as Response).status).toBe(302)
			expect(lastUpdate().data.fieldSubmittedAt).toBeInstanceOf(Date)
		})
	})

	describe("add a service in one crew's window", () => {
		beforeEach(() => {
			vi.mocked(db.serviceCode.findFirst).mockResolvedValue({
				id: "digger",
				claroCode: "DIGGER",
				accountCode: "610",
				name: "digger",
			} as any)
			vi.mocked(db.jafInvoice.updateMany).mockResolvedValue({ count: 1 } as any)
		})
		const addForm = (brigadeId: string) => {
			const f = new FormData()
			f.set("intent", "add_service")
			f.set("serviceCodeId", "digger")
			f.set("qty", "1")
			f.set("brigadeId", brigadeId)
			return f
		}

		it("lands on that crew only, and the job total follows", async () => {
			withDoc({
				crewServiceLines: [
					{ brigadeId: "b-angel", lines: [line("fiber", 600)] },
					{ brigadeId: "b-jesus", lines: [line("fiber", 400)] },
				],
			})
			expect(await run(addForm("b-jesus"))).toEqual({ ok: true })
			const { data } = vi.mocked(db.jafInvoice.updateMany).mock
				.calls[0][0] as any
			expect(
				data.crewServiceLines.find((c: any) => c.brigadeId === "b-jesus").lines,
			).toHaveLength(2)
			expect(
				data.crewServiceLines.find((c: any) => c.brigadeId === "b-angel").lines,
			).toHaveLength(1)
			expect(
				data.installedServiceLines.map((l: any) => [l.serviceCodeId, l.qty]),
			).toEqual([
				["fiber", 1000],
				["digger", 1],
			])
		})

		it("lets the second crew add the same service the first one added", async () => {
			withDoc({
				crewServiceLines: [
					{
						brigadeId: "b-angel",
						lines: [line("digger", 1, { addedInField: true })],
					},
				],
			})
			expect(await run(addForm("b-jesus"))).toEqual({ ok: true })
			const { data } = vi.mocked(db.jafInvoice.updateMany).mock
				.calls[0][0] as any
			expect(data.installedServiceLines).toEqual([
				expect.objectContaining({ serviceCodeId: "digger", qty: 2 }),
			])
		})

		it("refuses a brigade that is not on the job", async () => {
			withDoc()
			expect(await run(addForm("b-stranger"))).toEqual({
				errorKey: "docs_field.errors.invalid_service_lines",
			})
			expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
		})
	})
})
