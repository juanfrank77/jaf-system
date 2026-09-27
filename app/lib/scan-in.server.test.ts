import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { scanInReturn } from "./scan-in.server"

let serial: string
let vanId: string
let scId: string
let actorId: string
beforeAll(async () => {
	const u = await db.user.create({
		data: { email: `wh${Date.now()}@x.com`, name: "WH", role: "WAREHOUSE" },
	})
	actorId = u.id
	const inst = await db.user.create({
		data: { email: `in${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	vanId = (await db.van.create({ data: { name: "V", installerId: inst.id } }))
		.id
	scId = (
		await db.serviceCode.create({
			data: {
				claroCode: `R${Date.now()}`,
				name: "M",
				unitPrice: "0",
				serialized: true,
			},
		})
	).id
	serial = `RET-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial,
			serviceCodeId: scId,
			status: "REMOVED_PENDING_RETURN",
			currentRef: vanId,
		},
	})
})

it("returns an owed-back serial and writes a RETURN movement", async () => {
	const res = await scanInReturn(serial, "wh1", { id: actorId })
	expect(res.ok).toBe(true)
	expect(
		(await db.serialLocation.findUnique({ where: { serial } }))?.status,
	).toBe("RETURNED")
	expect(
		await db.vanMovement.count({ where: { serial, type: "RETURN" } }),
	).toBe(1)
})

it("rejects a serial that is not owed-back", async () => {
	const s = `NOP-${Date.now()}`
	await db.serialLocation.create({
		data: { serial: s, serviceCodeId: scId, status: "VAN", currentRef: vanId },
	})
	expect((await scanInReturn(s, "wh1", { id: actorId })).ok).toBe(false)
})
