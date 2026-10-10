import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { PENDING_CODE_PREFIX } from "./catalog-import"
import {
	getActiveMaterialCodes,
	getActiveServiceCodes,
	getSerializedCodes,
	searchServiceCodes,
} from "./service-codes.server"

const token = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const pendingCode = `${PENDING_CODE_PREFIX}PICKER_${token}`
const realCode = `PICKER-REAL-${token}`

describe("pickers exclude pending-code placeholders", () => {
	afterAll(async () => {
		await db.serviceCode.deleteMany({
			where: { claroCode: { in: [pendingCode, realCode] } },
		})
	})

	it("hides an ACTIVE placeholder from every picker query but keeps real codes", async () => {
		const base = { unitPrice: 0, active: true, serialized: true }
		await db.serviceCode.create({
			data: {
				...base,
				claroCode: pendingCode,
				name: `PENDING ${token}`,
				kind: "MATERIAL",
			},
		})
		await db.serviceCode.create({
			data: {
				...base,
				claroCode: realCode,
				name: `REAL ${token}`,
				kind: "MATERIAL",
			},
		})
		const codesOf = (rows: { claroCode: string }[]) =>
			rows.map((r) => r.claroCode)

		for (const rows of [
			await getActiveServiceCodes(),
			await getActiveMaterialCodes(),
			await getSerializedCodes(),
		]) {
			expect(codesOf(rows)).toContain(realCode)
			expect(codesOf(rows)).not.toContain(pendingCode)
		}

		// searchServiceCodes is SERVICE-kind only; prove the exclusion on a
		// SERVICE-kind placeholder too.
		await db.serviceCode.update({
			where: { claroCode: pendingCode },
			data: { kind: "SERVICE" },
		})
		expect(codesOf(await searchServiceCodes(token))).not.toContain(pendingCode)
	})
})
