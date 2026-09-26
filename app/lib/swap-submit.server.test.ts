import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { submitSwap } from "./swap-submit.server"

let completionId: string
let vanId: string
let installerId: string
let outSerial: string
let inSerial: string
let scId: string
beforeAll(async () => {
	const u = await db.user.create({
		data: { email: `s${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	installerId = u.id
	vanId = (await db.van.create({ data: { name: "V", installerId: u.id } })).id
	scId = (
		await db.serviceCode.create({
			data: {
				claroCode: `SW${Date.now()}`,
				name: "M",
				unitPrice: "0",
				serialized: true,
			},
		})
	).id
	outSerial = `OUT-${Date.now()}`
	inSerial = `IN-${Date.now()}`
	const c = await db.installCompletion.create({
		data: {
			idempotencyKey: `ik${Date.now()}`,
			claroOrderNo: "429960",
			installerId,
			vanId,
			address: "a",
			installedAt: new Date(Date.now() - 30 * 86_400_000),
			submittedAt: new Date(),
		},
	})
	completionId = c.id
	await db.serialLocation.create({
		data: {
			serial: outSerial,
			serviceCodeId: scId,
			status: "INSTALLED",
			currentRef: c.id,
		},
	})
	await db.serialLocation.create({
		data: {
			serial: inSerial,
			serviceCodeId: scId,
			status: "VAN",
			currentRef: vanId,
		},
	})
})

it("swaps units and leaves the original completion untouched", async () => {
	const before = await db.installCompletion.findUniqueOrThrow({
		where: { id: completionId },
	})
	const res = await submitSwap(
		{
			completionId,
			serialOut: outSerial,
			reason: "HARDWARE",
			serialIn: inSerial,
			newClaroOrderNo: undefined,
			installerId,
			vanId,
		},
		{ id: installerId },
	)
	expect(
		(await db.serialLocation.findUnique({ where: { serial: outSerial } }))
			?.status,
	).toBe("REMOVED_PENDING_RETURN")
	expect(
		(await db.serialLocation.findUnique({ where: { serial: inSerial } }))
			?.status,
	).toBe("INSTALLED")
	const pr = await db.paymentRequest.findUnique({
		where: { id: res.paymentRequestId },
	})
	expect(pr?.kind).toBe("CALLBACK")
	const after = await db.installCompletion.findUniqueOrThrow({
		where: { id: completionId },
	})
	expect(after.claroOrderNo).toBe(before.claroOrderNo)
	expect(after.id).toBe(completionId)
})
