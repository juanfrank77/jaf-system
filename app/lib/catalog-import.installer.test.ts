import { describe, expect, it } from "vitest"
import { parseInstallerRosterCsv } from "./catalog-import"

describe("installer roster csv", () => {
	it("parses rows and dedups on toa_number", () => {
		const csv =
			"name,jaf_number,toa_number,region,email\n" +
			"Alfredo Rosario,1820,98549,Norte,a@x.com\n" +
			"Alfredo Rosario,1820,98549,Norte,a@x.com\n" +
			"Efrain Flores,1941,97498,,e@x.com\n"
		const rows = parseInstallerRosterCsv(csv)
		expect(rows).toHaveLength(2)
		expect(rows[0].toaNumber).toBe("98549")
		expect(rows[1].region).toBeNull()
	})
})
