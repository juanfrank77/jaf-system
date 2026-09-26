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

it("rejects a release that scans fewer serials than the restock requested (partial fulfillment)", async () => {
	const s1 = `PART1-${Date.now()}`
	const s2 = `PART2-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s1,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	await db.serialLocation.create({
		data: {
			serial: s2,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 2 }],
			status: "APPROVED",
		},
	})
	// Only 1 of the 2 requested serials was actually scanned.
	await expect(
		releaseRestockToVan(req.id, [{ serial: s1, serviceCodeId: scId }], [], {
			id: actorId,
		}),
	).rejects.toThrow()
	expect(
		(await db.restockRequest.findUniqueOrThrow({ where: { id: req.id } }))
			.status,
	).toBe("APPROVED")
	expect(await db.vanMovement.count({ where: { refRestockId: req.id } })).toBe(
		0,
	)
})

it("releases a mix of serials with and without a prior SerialLocation row in one call", async () => {
	const known = `MIX-KNOWN-${Date.now()}`
	const brandNew = `MIX-NEW-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: known,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 2 }],
			status: "APPROVED",
		},
	})
	await releaseRestockToVan(
		req.id,
		[
			{ serial: known, serviceCodeId: scId },
			{ serial: brandNew, serviceCodeId: scId },
		],
		[],
		{ id: actorId },
	)
	expect(
		(await db.serialLocation.findUnique({ where: { serial: known } }))?.status,
	).toBe("VAN")
	expect(
		(await db.serialLocation.findUnique({ where: { serial: brandNew } }))
			?.status,
	).toBe("VAN")
	expect(
		(await db.serialLocation.findUnique({ where: { serial: brandNew } }))
			?.currentRef,
	).toBe(vanId)
	expect(await db.vanMovement.count({ where: { refRestockId: req.id } })).toBe(
		2,
	)
})

it("rejects a release that scans more units than the restock requested (excess)", async () => {
	const s1 = `EXC1-${Date.now()}`
	const s2 = `EXC2-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s1,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	await db.serialLocation.create({
		data: {
			serial: s2,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 1 }],
			status: "APPROVED",
		},
	})
	await expect(
		releaseRestockToVan(
			req.id,
			[
				{ serial: s1, serviceCodeId: scId },
				{ serial: s2, serviceCodeId: scId },
			],
			[],
			{ id: actorId },
		),
	).rejects.toThrow()
})

it("rejects a release with the same serial scanned twice, instead of crashing on the unique constraint", async () => {
	// Brand new serial (no prior SerialLocation row) is what reproduces the
	// crash: a pre-existing serial's duplicate is silently absorbed into the
	// updateMany path, but a new one has both copies fall into `newSerials`
	// and collide on serialLocation's unique `serial` key in createMany.
	const dupe = `DUPE-${Date.now()}`
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: scId, qty: 2 }],
			status: "APPROVED",
		},
	})
	await expect(
		releaseRestockToVan(
			req.id,
			[
				{ serial: dupe, serviceCodeId: scId },
				{ serial: dupe, serviceCodeId: scId },
			],
			[],
			{ id: actorId },
		),
	).rejects.toThrow(/duplicate/i)
	expect(
		(await db.restockRequest.findUniqueOrThrow({ where: { id: req.id } }))
			.status,
	).toBe("APPROVED")
	expect(await db.vanMovement.count({ where: { refRestockId: req.id } })).toBe(
		0,
	)
})

it("rejects a release that provides a serial for a service code never requested, even though the requested lines are individually satisfied", async () => {
	const requestedCode = scId
	const unrequestedCode = (
		await db.serviceCode.create({
			data: {
				claroCode: `UNREQ${Date.now()}`,
				name: "Unrequested",
				unitPrice: "0",
				serialized: true,
			},
		})
	).id
	const s1 = `PHANTOM-REQ-${Date.now()}`
	const s2 = `PHANTOM-UNREQ-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s1,
			serviceCodeId: requestedCode,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	await db.serialLocation.create({
		data: {
			serial: s2,
			serviceCodeId: unrequestedCode,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	const req = await db.restockRequest.create({
		data: {
			vanId,
			lines: [{ serviceCodeId: requestedCode, qty: 1 }],
			status: "APPROVED",
		},
	})
	await expect(
		releaseRestockToVan(
			req.id,
			[
				{ serial: s1, serviceCodeId: requestedCode },
				{ serial: s2, serviceCodeId: unrequestedCode },
			],
			[],
			{ id: actorId },
		),
	).rejects.toThrow()
	expect(
		(await db.restockRequest.findUniqueOrThrow({ where: { id: req.id } }))
			.status,
	).toBe("APPROVED")
	expect(await db.vanMovement.count({ where: { refRestockId: req.id } })).toBe(
		0,
	)
})

it("rejects releasing a restock that has no lines at all", async () => {
	const req = await db.restockRequest.create({
		data: { vanId, lines: [], status: "APPROVED" },
	})
	await expect(
		releaseRestockToVan(req.id, [], [], { id: actorId }),
	).rejects.toThrow()
	expect(
		(await db.restockRequest.findUniqueOrThrow({ where: { id: req.id } }))
			.status,
	).toBe("APPROVED")
})
