import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { buildRestockPrefill, createRestock } from "./restock.server"

let vanId: string
let scId: string
let actorId: string
beforeAll(async () => {
	const inst = await db.user.create({
		data: { email: `rs${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	actorId = inst.id
	vanId = (await db.van.create({ data: { name: "V", installerId: inst.id } }))
		.id
	scId = (
		await db.serviceCode.create({
			data: { claroCode: `RS${Date.now()}`, name: "Wrap", unitPrice: "0" },
		})
	).id
})

it("empty prefill when no par exists", async () => {
	expect(await buildRestockPrefill(vanId)).toEqual([])
})

it("prefills a par'd code that has zero units on the van (the actual restock case)", async () => {
	const noStockCode = await db.serviceCode.create({
		data: { claroCode: `NS${Date.now()}`, name: "NoStock", unitPrice: "0" },
	})
	await db.vanPar.create({
		data: { vanId, serviceCodeId: noStockCode.id, parQty: 3 },
	})
	const prefill = await buildRestockPrefill(vanId)
	expect(prefill).toContainEqual({ serviceCodeId: noStockCode.id, qty: 3 })
})

it("over-par line goes to NEEDS_SIGNOFF", async () => {
	await db.vanPar.create({ data: { vanId, serviceCodeId: scId, parQty: 5 } })
	const res = await createRestock(vanId, [{ serviceCodeId: scId, qty: 99 }], {
		id: actorId,
	})
	expect(res.status).toBe("NEEDS_SIGNOFF")
})
