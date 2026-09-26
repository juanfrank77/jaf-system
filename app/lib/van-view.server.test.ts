import { beforeAll, expect, it } from "vitest"
import { db } from "./db.server"
import { getInstallerRollup, getVanView } from "./van-view.server"

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

it("includes a par'd accessory with zero stock instead of dropping it", async () => {
	const wrapCode = await db.serviceCode.create({
		data: { claroCode: `WR${Date.now()}`, name: "Wrap", unitPrice: "0" },
	})
	await db.vanPar.create({
		data: { vanId, serviceCodeId: wrapCode.id, parQty: 5 },
	})
	const view = await getVanView(vanId)
	const wrap = view.accessories.find((a) => a.serviceCodeId === wrapCode.id)
	expect(wrap).toEqual({ serviceCodeId: wrapCode.id, onVan: 0, par: 5 })
})

it("includes a par'd serialized SKU with zero stock instead of dropping it", async () => {
	const modemCode = await db.serviceCode.create({
		data: {
			claroCode: `MD${Date.now()}`,
			name: "Modem2",
			unitPrice: "0",
			serialized: true,
		},
	})
	await db.vanPar.create({
		data: { vanId, serviceCodeId: modemCode.id, parQty: 2 },
	})
	const view = await getVanView(vanId)
	const modem = view.serialized.find((s) => s.serviceCodeId === modemCode.id)
	expect(modem).toEqual({ serviceCodeId: modemCode.id, onVan: 0, par: 2 })
})

it("includes the since timestamp on an owed-back serial, so callers can key on the return episode instead of the serial alone", async () => {
	const owedSerial = `vv-owed-${Date.now()}`
	const since = new Date(Date.now() - 10 * 86_400_000)
	await db.serialLocation.create({
		data: {
			serial: owedSerial,
			serviceCodeId: scId,
			status: "REMOVED_PENDING_RETURN",
			currentRef: vanId,
			since,
		},
	})
	const view = await getVanView(vanId)
	const owed = view.owedBack.find((o) => o.serial === owedSerial)
	expect(owed?.since).toEqual(since)
	expect(owed?.sinceDays).toBe(10)
})

it("nets accessory stock from many movement rows via DB aggregation, not an unbounded in-memory scan", async () => {
	const wrapCode = await db.serviceCode.create({
		data: { claroCode: `WRN${Date.now()}`, name: "WrapNet", unitPrice: "0" },
	})
	const byUser = await db.user.create({
		data: { email: `vvu${Date.now()}@x.com`, name: "U", role: "WAREHOUSE" },
	})
	await db.vanMovement.createMany({
		data: [
			{
				vanId,
				serviceCodeId: wrapCode.id,
				qty: 10,
				type: "PICKUP",
				byUserId: byUser.id,
			},
			{
				vanId,
				serviceCodeId: wrapCode.id,
				qty: -3,
				type: "ADJUST",
				byUserId: byUser.id,
			},
			{
				vanId,
				serviceCodeId: wrapCode.id,
				qty: -1,
				type: "ADJUST",
				byUserId: byUser.id,
			},
		],
	})
	const view = await getVanView(vanId)
	const wrap = view.accessories.find((a) => a.serviceCodeId === wrapCode.id)
	expect(wrap?.onVan).toBe(6)
})

// Dev DB has accumulated hundreds of throwaway vans from ad-hoc test fixtures
// across this session; getInstallerRollup legitimately walks every active
// van, so this needs more than the default timeout here. Unrelated to prod,
// where the real fleet size is ~54.
it("getInstallerRollup includes the vanId and owed-back details so callers don't re-derive the same van's view", async () => {
	const rollup = await getInstallerRollup()
	const row = rollup.find((r) => r.vanId === vanId)
	expect(row?.vanId).toBe(vanId)
	expect(Array.isArray(row?.owedBackDetails)).toBe(true)
}, 30_000)
