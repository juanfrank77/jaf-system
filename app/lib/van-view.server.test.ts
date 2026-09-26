import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { getVanView } from "./van-view.server"

let vanId: string
let scId: string
beforeAll(async () => {
	const inst = await db.user.create({
		data: { email: `vv${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	vanId = (await db.van.create({ data: { name: "V", installerId: inst.id } }))
		.id
	scId = (
		await db.serviceCode.create({
			data: {
				claroCode: `V${Date.now()}`,
				name: "M",
				unitPrice: "0",
				serialized: true,
			},
		})
	).id
	await db.serialLocation.create({
		data: {
			serial: `vv-${Date.now()}`,
			serviceCodeId: scId,
			status: "VAN",
			currentRef: vanId,
		},
	})
})

it("derives a van view with null par when no VanPar rows exist", async () => {
	const view = await getVanView(vanId)
	const modem = view.serialized.find((s) => s.serviceCodeId === scId)
	expect(modem?.onVan).toBe(1)
	expect(modem?.par).toBeNull()
})
