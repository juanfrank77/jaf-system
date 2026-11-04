import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// Real database: the brigade guard and the activation run inside the job
// transaction, so only a real rollback shows that nothing is left behind.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/control-number.server", () => ({
	generateControlNumber: vi.fn(),
}))
vi.mock("~/lib/address-suggestions.server", () => ({
	canonicalizeAddress: vi.fn(async (a: any) => a),
	loadAddressSuggestions: vi.fn(),
}))
// Real by default; one test makes it throw after the activation has run.
vi.mock("~/lib/brigade-picker.server", async (importOriginal) => {
	const mod =
		await importOriginal<typeof import("~/lib/brigade-picker.server")>()
	return { ...mod, assignBrigadesOrThrow: vi.fn(mod.assignBrigadesOrThrow) }
})

import { assignBrigadesOrThrow } from "~/lib/brigade-picker.server"
import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { makeTracker, runToken, seedBrigade, seedUser } from "~/test/helpers"
import { action } from "./_app.docs.new"

const t = makeTracker()
const claroIds: string[] = []
const supIds: string[] = []
afterAll(async () => {
	// Track every job the action wrote, even one a failed assertion never saw,
	// or its supervisor FK blocks the user cleanup.
	const jobs = await db.jafInvoice.findMany({
		where: { supervisorId: { in: supIds } },
	})
	for (const j of jobs) t.track("jafInvoice", j)
	await t.cleanup()
	await db.claroSupervisor.deleteMany({ where: { id: { in: claroIds } } })
})

let supId = ""
let claroId = ""

beforeEach(async () => {
	vi.clearAllMocks()
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	await db.user.update({
		where: { id: sup.id },
		data: { supervisorAreas: ["SUR"] },
	})
	supId = sup.id
	supIds.push(sup.id)
	vi.mocked(requireRole).mockResolvedValue({
		user: { id: sup.id, role: "SUPERVISOR" },
		session: {},
	} as any)
	vi.mocked(generateControlNumber).mockResolvedValue(runToken("MAINT"))
	// The job's Claro supervisor must be one linked to the supervisor.
	if (claroId)
		await db.claroSupervisor.update({
			where: { id: claroId },
			data: { jafSupervisors: { connect: { id: sup.id } } },
		})
	if (!claroId) {
		const claro = await db.claroSupervisor.create({
			data: {
				name: "Test Claro",
				email: `${runToken("c")}@x.test`,
				jafSupervisors: { connect: { id: sup.id } },
			},
		})
		claroIds.push(claro.id)
		claroId = claro.id
	}
})

function post(brigadeId: string) {
	const form = new FormData()
	form.set("jobType", "Mantenimiento")
	form.set("claroSupervisorId", claroId)
	form.set("direccion1", "119")
	form.set("sector", "Sector Palomar")
	form.set("tipo", "CALLE")
	form.set("tipoPlanta", "Aerea")
	form.set("grupoPlan", "G1")
	// No warehouse: no notifications fanned out to every warehouse user.
	form.set("materialsFromWarehouse", "no")
	form.set("materialsReason", "own truck")
	form.set("prefieldNeeded", "not_needed")
	form.set("brigadeId", brigadeId)
	form.set("materials", "[]")
	form.set("serviceLines", "[]")
	return action({
		request: new Request("http://localhost/docs/new", {
			method: "POST",
			body: form,
		}),
		params: {},
	} as any).catch((r) => r)
}

async function jobsBySupervisor() {
	const jobs = await db.jafInvoice.findMany({ where: { supervisorId: supId } })
	for (const j of jobs) t.track("jafInvoice", j)
	return jobs
}

describe("POST /docs/new — brigade guard (real DB)", () => {
	it("refuses an equipment (D) account posted by hand and creates no job", async () => {
		const d = t.track(
			"brigade",
			await seedBrigade({
				area: "SUR",
				supervisorId: supId,
				isEquipmentAccount: true,
			}),
		)
		const res = await post(d.id)
		expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
		expect(await jobsBySupervisor()).toHaveLength(0)
	})

	it("refuses a terminated brigade posted by hand and creates no job", async () => {
		const gone = t.track(
			"brigade",
			await seedBrigade({ active: false, terminatedAt: new Date() }),
		)
		const res = await post(gone.id)
		expect(res).toEqual({ errorKey: "docs_new.errors.brigade_invalid" })
		expect(await jobsBySupervisor()).toHaveLength(0)
		const after = await db.brigade.findUniqueOrThrow({
			where: { id: gone.id },
		})
		expect(after.active).toBe(false)
	})

	it("Activate & assign: an inactive brigade joins the supervisor with the job", async () => {
		const b = t.track(
			"brigade",
			await seedBrigade({ active: false, area: null, supervisorId: null }),
		)
		const res = await post(b.id)
		expect(res.status).toBe(302)
		const jobs = await jobsBySupervisor()
		expect(jobs).toHaveLength(1)
		expect(jobs[0].brigadeId).toBe(b.id)
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after).toMatchObject({ active: true, supervisorId: supId })
		const events = await db.brigadeEvent.findMany({
			where: { brigadeId: b.id },
		})
		expect(events).toEqual([
			expect.objectContaining({
				userId: supId,
				docId: jobs[0].id,
				action: "BRIGADE_ACTIVATED",
			}),
		])
	})

	it("Activate and add: another supervisor's inactive brigade joins the job, goes active and stays with its supervisor", async () => {
		const other = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const b = t.track(
			"brigade",
			await seedBrigade({ active: false, area: "SUR", supervisorId: other.id }),
		)
		const res = await post(b.id)
		expect(res.status).toBe(302)
		const jobs = await jobsBySupervisor()
		expect(jobs).toHaveLength(1)
		expect(jobs[0].brigadeId).toBe(b.id)
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after).toMatchObject({ active: true, supervisorId: other.id })
		expect(await db.brigadeEvent.count({ where: { brigadeId: b.id } })).toBe(1)
	})

	it("the activation rolls back with the job when the job save fails", async () => {
		const b = t.track(
			"brigade",
			await seedBrigade({ active: false, area: null, supervisorId: null }),
		)
		const real = vi.mocked(assignBrigadesOrThrow).getMockImplementation()
		vi.mocked(assignBrigadesOrThrow).mockImplementationOnce(async (tx, a) => {
			await real?.(tx, a)
			throw new Error("disk full")
		})
		const res = await post(b.id)
		expect(res).toBeInstanceOf(Error)
		expect(await jobsBySupervisor()).toHaveLength(0)
		const after = await db.brigade.findUniqueOrThrow({ where: { id: b.id } })
		expect(after).toMatchObject({ active: false, supervisorId: null })
		expect(await db.brigadeEvent.count({ where: { brigadeId: b.id } })).toBe(0)
	})
})
