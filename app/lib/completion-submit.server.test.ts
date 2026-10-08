import { beforeAll, expect, it } from "vitest"
import { submitCompletion } from "./completion-submit.server"
import { db } from "./db.server"

let installerId: string
let vanId: string
let modemCodeId: string
let serial: string
beforeAll(async () => {
	const u = await db.user.create({
		data: { email: `c${Date.now()}@x.com`, name: "I", role: "INSTALLER" },
	})
	installerId = u.id
	const v = await db.van.create({ data: { name: "Van C", installerId: u.id } })
	vanId = v.id
	const sc = await db.serviceCode.create({
		data: {
			claroCode: `M${Date.now()}`,
			name: "Modem",
			unitPrice: "0",
			serialized: true,
			serialPrefix: "ALCLED",
		},
	})
	modemCodeId = sc.id
	serial = `ALCLED${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial,
			serviceCodeId: modemCodeId,
			status: "VAN",
			currentRef: vanId,
		},
	})
})

it("installs a serial, writes movement, creates a READY payment request", async () => {
	const res = await submitCompletion(
		{
			idempotencyKey: `k-${Date.now()}`,
			claroOrderNo: "430920",
			installerId,
			vanId,
			address: "Calle 1",
			accessories: [],
			groundRod: true,
			serialInstalled: serial,
			serialUnreadable: false,
			formPhotoPath: "/tmp/f.jpg",
			sigInstaller: "data:image/png;base64,AAA",
			installedAt: new Date(),
		},
		{ id: installerId },
	)
	expect(res.status).toBe("READY")
	const loc = await db.serialLocation.findUnique({ where: { serial } })
	expect(loc?.status).toBe("INSTALLED")
	const mv = await db.stockMovement.findFirst({
		where: { serial, type: "INSTALL" },
	})
	expect(mv).not.toBeNull()
})

it("is idempotent: same key returns the same completion, no duplicate", async () => {
	const key = `k-idem-${Date.now()}`
	const s2 = `ALCLED2-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s2,
			serviceCodeId: modemCodeId,
			status: "VAN",
			currentRef: vanId,
		},
	})
	const input = {
		idempotencyKey: key,
		claroOrderNo: "1",
		installerId,
		vanId,
		address: "a",
		accessories: [],
		groundRod: true,
		serialInstalled: s2,
		serialUnreadable: false,
		formPhotoPath: "/tmp/f.jpg",
		sigInstaller: "data:image/png;base64,AAA",
		installedAt: new Date(),
	}
	const a = await submitCompletion(input, { id: installerId })
	const b = await submitCompletion(input, { id: installerId })
	expect(b.completionId).toBe(a.completionId)
	expect(
		await db.stockMovement.count({ where: { serial: s2, type: "INSTALL" } }),
	).toBe(1)
})

it("flags an unreadable serial as INCOMPLETE with missing serial", async () => {
	const res = await submitCompletion(
		{
			idempotencyKey: `k-u-${Date.now()}`,
			claroOrderNo: "2",
			installerId,
			vanId,
			address: "a",
			accessories: [],
			groundRod: true,
			serialUnreadable: true,
			formPhotoPath: "/tmp/f.jpg",
			sigInstaller: "data:image/png;base64,AAA",
			installedAt: new Date(),
		},
		{ id: installerId },
	)
	expect(res.status).toBe("INCOMPLETE")
	const pr = await db.paymentRequest.findUnique({
		where: { id: res.paymentRequestId },
	})
	expect(pr?.missing).toContain("serial")
})

it("leaves no orphan InstallCompletion when the transaction fails", async () => {
	const key = `k-orphan-${Date.now()}`
	const s3 = `ALCLED3-${Date.now()}`
	await db.serialLocation.create({
		data: {
			serial: s3,
			serviceCodeId: modemCodeId,
			status: "VAN",
			currentRef: vanId,
		},
	})
	await expect(
		submitCompletion(
			{
				idempotencyKey: key,
				claroOrderNo: "3",
				installerId,
				vanId,
				address: "a",
				accessories: [],
				groundRod: true,
				serialInstalled: s3,
				serialUnreadable: false,
				formPhotoPath: "/tmp/f.jpg",
				sigInstaller: "data:image/png;base64,AAA",
				installedAt: new Date(),
			},
			// A byUserId that doesn't exist violates StockMovement's FK — this must
			// roll back the InstallCompletion too, not just the movement.
			{ id: "does-not-exist" },
		),
	).rejects.toThrow()
	const completion = await db.installCompletion.findUnique({
		where: { idempotencyKey: key },
	})
	expect(completion).toBeNull()
	expect(
		(await db.serialLocation.findUnique({ where: { serial: s3 } }))?.status,
	).toBe("VAN")
})

it("recovers the winner's row instead of throwing when a concurrent submit already committed the idempotencyKey", async () => {
	const key = `k-race-${Date.now()}`
	const winner = await db.installCompletion.create({
		data: {
			idempotencyKey: key,
			claroOrderNo: "4",
			installerId,
			vanId,
			status: "SUBMITTED",
			address: "a",
			groundRod: true,
			serialUnreadable: true,
			formPhotoPath: "/tmp/f.jpg",
			submittedAt: new Date(),
		},
	})
	const winnerPr = await db.paymentRequest.create({
		data: {
			kind: "INSTALL",
			completionId: winner.id,
			installerId,
			status: "INCOMPLETE",
			missing: ["serial"],
		},
	})

	// submitCompletion doesn't see `winner` via its own findUnique read (it
	// hasn't been given the chance to), so it attempts to create a duplicate —
	// exercising the same P2002 path a true race would hit — and must recover
	// the winner's row rather than throw or fabricate a fake one.
	const dbAny = db as unknown as {
		installCompletion: { findUnique: typeof db.installCompletion.findUnique }
	}
	const original = dbAny.installCompletion.findUnique
	dbAny.installCompletion.findUnique = (async () => null) as never
	try {
		const res = await submitCompletion(
			{
				idempotencyKey: key,
				claroOrderNo: "4",
				installerId,
				vanId,
				address: "a",
				accessories: [],
				groundRod: true,
				serialUnreadable: true,
				formPhotoPath: "/tmp/f.jpg",
				sigInstaller: "data:image/png;base64,AAA",
				installedAt: new Date(),
			},
			{ id: installerId },
		)
		expect(res.completionId).toBe(winner.id)
		expect(res.paymentRequestId).toBe(winnerPr.id)
	} finally {
		dbAny.installCompletion.findUnique = original
	}
	expect(
		await db.installCompletion.count({ where: { idempotencyKey: key } }),
	).toBe(1)
})

it("writes a zero-qty ADJUST log row only for accessory lines edited from the prefill", async () => {
	const mk = (n: string) =>
		db.serviceCode.create({
			data: {
				claroCode: `A${n}${Date.now()}`,
				name: `Acc ${n}`,
				unitPrice: "0",
			},
		})
	const [kept, edited] = await Promise.all([mk("1"), mk("2")])
	const res = await submitCompletion(
		{
			idempotencyKey: `k-acc-${Date.now()}`,
			claroOrderNo: "2",
			installerId,
			vanId,
			address: "a",
			accessories: [
				{ serviceCodeId: kept.id, prefilledQty: 3, qty: 3 },
				{ serviceCodeId: edited.id, prefilledQty: 4, qty: 6 },
			],
			groundRod: true,
			serialUnreadable: true,
			installedAt: new Date(),
		},
		{ id: installerId },
	)
	const rows = await db.stockMovement.findMany({
		where: { refCompletionId: res.completionId },
	})
	const adjusts = rows.filter((r) => r.type === "ADJUST")
	expect(adjusts).toHaveLength(1)
	expect(adjusts[0]).toMatchObject({
		serviceCodeId: edited.id,
		qty: 0,
		kind: "BULK",
		vanId,
	})
	expect(adjusts[0].note).toContain("prefilled 4")
	expect(adjusts[0].note).toContain("final 6")
	// Stock still moves by the final quantity, one INSTALL row per line.
	const installs = rows.filter((r) => r.type === "INSTALL")
	expect(installs.map((r) => r.qty).sort((a, b) => a - b)).toEqual([-6, -3])
})

it("logs a line edited down to zero without an INSTALL row", async () => {
	const code = await db.serviceCode.create({
		data: { claroCode: `Z${Date.now()}`, name: "Acc Z", unitPrice: "0" },
	})
	const res = await submitCompletion(
		{
			idempotencyKey: `k-zero-${Date.now()}`,
			claroOrderNo: "3",
			installerId,
			vanId,
			address: "a",
			accessories: [{ serviceCodeId: code.id, prefilledQty: 2, qty: 0 }],
			groundRod: true,
			serialUnreadable: true,
			installedAt: new Date(),
		},
		{ id: installerId },
	)
	const rows = await db.stockMovement.findMany({
		where: { refCompletionId: res.completionId },
	})
	expect(rows.map((r) => r.type)).toEqual(["ADJUST"])
})
