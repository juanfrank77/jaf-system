import { describe, expect, it } from "vitest"
import { packetBlockers } from "./packet-blockers"

const doc = (over: Partial<Parameters<typeof packetBlockers>[0]> = {}) => ({
	prefieldNeeded: false,
	prefieldPdfPath: null,
	packetStale: false,
	blueprintPaths: [] as string[],
	...over,
})
const relaxed = { requiresBlueprint: false }

describe("packetBlockers", () => {
	it("Prefield needed and no Prefield PDF yet blocks on the PDF", () => {
		expect(packetBlockers(doc({ prefieldNeeded: true }), relaxed)).toEqual([
			"prefield_pdf",
		])
	})

	it("Prefield not needed is never gated, PDF or not", () => {
		expect(packetBlockers(doc(), relaxed)).toEqual([])
	})

	it("clears once the Prefield PDF exists", () => {
		expect(
			packetBlockers(
				doc({
					prefieldNeeded: true,
					prefieldPdfPath: "/u/packets/d1-prefield-1.pdf",
				}),
				relaxed,
			),
		).toEqual([])
	})

	it("a stale package blocks until it is generated again", () => {
		expect(packetBlockers(doc({ packetStale: true }), relaxed)).toContain(
			"stale",
		)
	})

	it("keeps the Claro supervisor's blueprint rule", () => {
		expect(packetBlockers(doc(), { requiresBlueprint: true })).toEqual([
			"blueprint",
		])
		expect(
			packetBlockers(doc({ blueprintPaths: ["/u/plan.pdf"] }), {
				requiresBlueprint: true,
			}),
		).toEqual([])
	})

	it("lists every blocker at once", () => {
		expect(
			packetBlockers(doc({ prefieldNeeded: true, packetStale: true }), {
				requiresBlueprint: true,
			}),
		).toEqual(["prefield_pdf", "blueprint", "stale"])
	})
})
