import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { releaseRestockToVan } from "./load-to-van.server"

let vanId: string
let restockId: string
let scId: string
let serial: string
let actorId: string
beforeAll(async () => {
	const u = await db.user.create({
		data: { email: `w${Date.now()}@x.com`, name: "WH", role: "WAREHOUSE" },
	})
	actorId = u.id
	const inst = await db.user.create({
		data: { email: `i${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	vanId = (await db.van.create({ data: { name: "V", installerId: inst.id } }))
		.id
	scId = (
		await db.serviceCode.create({
			data: {
				claroCode: `S${Date.now()}`,
				name: "M",
				unitPrice: "0",
				serialized: true,
			},
		})
	).id
	serial = `WH-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	restockId = (
		await db.restockRequest.create({
			data: {
				vanId,
				lines: [{ serviceCodeId: scId, qty: 1 }],
				status: "APPROVED",
			},
		})
	).id
})

it("moves a warehouse serial onto the van and closes the restock", async () => {
	await releaseRestockToVan(restockId, [{ serial, serviceCodeId: scId }], [], {
		id: actorId,
	})
	expect(
		(await db.serialLocation.findUnique({ where: { serial } }))?.status,
	).toBe("VAN")
	expect(
		(await db.serialLocation.findUnique({ where: { serial } }))?.currentRef,
	).toBe(vanId)
	expect(
		(await db.restockRequest.findUnique({ where: { id: restockId } }))?.status,
	).toBe("RECEIVED")
	expect(
		await db.vanMovement.count({ where: { serial, type: "PICKUP" } }),
	).toBe(1)
})

it("rejects releasing a restock that is still awaiting over-par sign-off", async () => {
	const needsSignoff = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 1 }],
			status: "NEEDS_SIGNOFF",
		},
	})
	await expect(
		releaseRestockToVan(
			needsSignoff.id,
			[],
			[{ serviceCodeId: scId, qty: 3 }],
			{
				id: actorId,
			},
		),
	).rejects.toThrow()
	expect(
		await db.vanMovement.count({ where: { refRestockId: needsSignoff.id } }),
	).toBe(0)
	expect(
		(
			await db.restockRequest.findUniqueOrThrow({
				where: { id: needsSignoff.id },
			})
		).status,
	).toBe("NEEDS_SIGNOFF")
})

it("rejects releasing the same restock twice (no replay, no double-counted accessory stock)", async () => {
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 4 }],
			status: "APPROVED",
		},
	})
	await releaseRestockToVan(req.id, [], [{ serviceCodeId: scId, qty: 4 }], {
		id: actorId,
	})
	await expect(
		releaseRestockToVan(req.id, [], [{ serviceCodeId: scId, qty: 4 }], {
			id: actorId,
		}),
	).rejects.toThrow()
	expect(await db.vanMovement.count({ where: { refRestockId: req.id } })).toBe(
		1,
	)
})
