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
	const mv = await db.vanMovement.findFirst({
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
		await db.vanMovement.count({ where: { serial: s2, type: "INSTALL" } }),
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
