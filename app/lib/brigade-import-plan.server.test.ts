import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseBrigadeImportFile } from "./brigade-import"
import { planBrigadeImport } from "./brigade-import-plan"
import { BRIGADE_SEED } from "./catalog-import"

describe("planBrigadeImport on the real file", () => {
	it("plans the real CSV against the seeded brigades", async () => {
		const data = readFileSync("docs/JAF_Brigades_Import_179.csv")
		const rows = await parseBrigadeImportFile(
			"JAF_Brigades_Import_179.csv",
			new Uint8Array(data),
		)
		// The seed leaves most codes null; IR is the one Carmen's list numbers 256.
		const existing = BRIGADE_SEED.map((b, i) => ({
			id: `s${i}`,
			name: b.name,
			code: b.name.startsWith("IR COMM") ? "256" : b.code,
		}))
		const plan = planBrigadeImport(rows, existing)
		const irId = `s${BRIGADE_SEED.findIndex((b) => b.name.startsWith("IR COMM"))}`
		expect(plan.recodes).toContainEqual({
			brigadeId: irId,
			from: "256",
			to: "151",
			confidence: "name",
		})
		// Recodes never use a close match, and no CSV code is both recoded and created.
		expect(plan.recodes.every((r) => r.confidence !== "close")).toBe(true)
		const created = new Set(plan.creates.map((r) => r.code))
		for (const r of plan.recodes) expect(created.has(r.to)).toBe(false)
		expect(plan.creates.filter((r) => r.isEquipmentAccount)).toHaveLength(24)
	})
})
