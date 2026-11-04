import { afterAll, describe, expect, it } from "vitest"
import {
	canonicalizeAddress,
	loadAddressSuggestions,
} from "./address-suggestions.server"
import { db } from "./db.server"

const TAG = `adr${Date.now()}`
const docIds: string[] = []
let userId = ""

async function seed(tipo: string) {
	const d = await db.jafInvoice.create({
		data: {
			controlNumber: `${TAG}-${Math.random()}`,
			jobType: "T",
			jobAddressEstimated: "A",
			estimatedMaterials: [],
			supervisorId: userId,
			tipo,
		},
	})
	docIds.push(d.id)
}

afterAll(async () => {
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	if (userId) await db.user.deleteMany({ where: { id: userId } })
})

describe("address suggestions", () => {
	it("dedupes spelling variants and canonicalizes against past jobs", async () => {
		const u = await db.user.create({
			data: { email: `${TAG}@x.test`, name: "A", role: "SUPERVISOR" },
		})
		userId = u.id
		await seed(`Aéreo${TAG}`)
		await seed(`aereo${TAG}`)
		await seed(`AEREO${TAG} `)
		const s = await loadAddressSuggestions()
		const mine = s.tipo.filter((t) => t.toLowerCase().includes(TAG))
		expect(mine).toHaveLength(1)

		const out = await canonicalizeAddress({
			sector: null,
			direccion1: "1",
			direccion2: null,
			latitud: null,
			longitud: null,
			tipo: `  aereo${TAG}`,
			ciudad: null,
			tipoPlanta: "Zzz  Planta",
			grupoPlan: "G",
		})
		expect(out.tipo).toBe(mine[0])
		expect(out.tipoPlanta).toBe("Zzz Planta")
	})
})
