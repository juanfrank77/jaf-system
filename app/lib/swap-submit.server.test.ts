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

it("does not throw when the outgoing serial has no prior SerialLocation row (pre-existing install)", async () => {
	const untracked = `UNTRACKED-${Date.now()}`
	const freshIn = `FRESH-IN-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: freshIn,
			serviceCodeId: scId,
			status: "VAN",
			currentRef: vanId,
		},
	})
	const res = await submitSwap(
		{
			completionId,
			serialOut: untracked,
			reason: "HARDWARE",
			serialIn: freshIn,
			newClaroOrderNo: undefined,
			installerId,
			vanId,
		},
		{ id: installerId },
	)
	expect(res.paymentRequestId).toBeTruthy()
	const outLoc = await db.serialLocation.findUnique({
		where: { serial: untracked },
	})
	expect(outLoc?.status).toBe("REMOVED_PENDING_RETURN")
	const swap = await db.swapEvent.findUniqueOrThrow({
		where: { id: res.swapId },
	})
	expect(swap.serialOutMatchedRecord).toBe(false)
})

it("does not throw when the incoming serial is not on the van, and flags it", async () => {
	const outS = `OUT2-${Date.now()}`
	const elsewhereIn = `ELSEWHERE-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: outS,
			serviceCodeId: scId,
			status: "INSTALLED",
			currentRef: completionId,
		},
	})
	await db.serialLocation.create({
		data: {
			serial: elsewhereIn,
			serviceCodeId: scId,
			status: "WAREHOUSE",
			currentRef: "wh1",
		},
	})
	const res = await submitSwap(
		{
			completionId,
			serialOut: outS,
			reason: "HARDWARE",
			serialIn: elsewhereIn,
			newClaroOrderNo: undefined,
			installerId,
			vanId,
		},
		{ id: installerId },
	)
	expect(
		(await db.serialLocation.findUnique({ where: { serial: elsewhereIn } }))
			?.status,
	).toBe("INSTALLED")
	const swap = await db.swapEvent.findUniqueOrThrow({
		where: { id: res.swapId },
	})
	expect(swap.serialInNotOnVan).toBe(true)
})

it("does not leave an orphan SwapEvent when the transaction fails", async () => {
	await expect(
		submitSwap(
			{
				completionId,
				serialOut: `NOPE-${Date.now()}`,
				reason: "HARDWARE",
				serialIn: `ALSO-NOPE-${Date.now()}`,
				newClaroOrderNo: undefined,
				installerId: "does-not-exist",
				vanId,
			},
			{ id: "does-not-exist" },
		),
	).rejects.toThrow()
	const count = await db.swapEvent.count({
		where: { byInstallerId: "does-not-exist" },
	})
	expect(count).toBe(0)
})

it("rejects swapping against a DRAFT completion", async () => {
	const draft = await db.installCompletion.create({
		data: {
			idempotencyKey: `draft-${Date.now()}`,
			claroOrderNo: "999",
			installerId,
			vanId,
			status: "DRAFT",
			address: "a",
		},
	})
	const s1 = `DOUT-${Date.now()}`
	const s2 = `DIN-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s1,
			serviceCodeId: scId,
			status: "INSTALLED",
			currentRef: draft.id,
		},
	})
	await db.serialLocation.create({
		data: { serial: s2, serviceCodeId: scId, status: "VAN", currentRef: vanId },
	})
	await expect(
		submitSwap(
			{
				completionId: draft.id,
				serialOut: s1,
				reason: "HARDWARE",
				serialIn: s2,
				newClaroOrderNo: undefined,
				installerId,
				vanId,
			},
			{ id: installerId },
		),
	).rejects.toThrow()
})
