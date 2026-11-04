import { afterAll, describe, expect, it } from "vitest"
import { makeTracker, runToken } from "~/test/helpers"
import { importCatalogRows, parseCatalogCsv } from "./catalog-import"
import { db } from "./db.server"
import { searchServiceCodes } from "./service-codes.server"

const track = makeTracker()
const token = runToken("SRCH").replace(/\D/g, "").slice(-8)

const csvRow = (code: string, name: string) =>
	`${code},${name},610,EA,10.0000,1.15,11.5000,7.4750,0.65,REV 2023-04-21,2023-04-21`
const HEADER =
	"service_code,description,account_code,unit,claro_base_price,uplift_factor,jaf_price,contractor_price,contractor_factor,price_list_revision,effective_from"

afterAll(async () => {
	await db.serviceCode.deleteMany({
		where: { claroCode: { contains: token } },
	})
	await track.cleanup()
})

describe("searchServiceCodes", () => {
	it("finds codes the old demo seed had deactivated once the catalog is imported", async () => {
		const legacy = [`L1${token}`, `L2${token}`]
		// What the old seed left behind: fabricated, inactive rows with the same codes.
		await db.serviceCode.createMany({
			data: legacy.map((claroCode) => ({
				claroCode,
				name: "FAKE DEMO",
				kind: "SERVICE" as const,
				unitPrice: 1,
				active: false,
			})),
		})
		const rows = parseCatalogCsv(
			[
				HEADER,
				csvRow(legacy[0], "REMOCION MENSAJERO (TODO TAMAÑO)MO"),
				csvRow(legacy[1], "REMOVER IPs (TODOS LOS TAMA?OS)MO"),
			].join("\n"),
		)
		await importCatalogRows(db, rows, legacy)
		for (const code of legacy) {
			const hits = await searchServiceCodes(code)
			expect(hits.map((h) => h.claroCode)).toEqual([code])
			expect(hits[0].active).toBe(true)
		}
	})

	it("sorts an exact code first, then prefix, then description; max 8 by default", async () => {
		const exact = `E${token}`
		const codes = [
			exact,
			`E${token}9`,
			...Array.from({ length: 10 }, (_, i) => `E${token}0${i}`),
		]
		await db.serviceCode.createMany({
			data: codes.map((claroCode) => ({
				claroCode,
				name: `SEARCHABLE ${claroCode}`,
				kind: "SERVICE" as const,
				unitPrice: 1,
			})),
		})
		const hits = await searchServiceCodes(exact)
		expect(hits).toHaveLength(8)
		expect(hits[0].claroCode).toBe(exact)
		const byName = await searchServiceCodes(`SEARCHABLE E${token}`)
		expect(byName).toHaveLength(8)
	})
})
