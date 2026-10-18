import { describe, expect, it } from "vitest"
import { packetBlockers, prefieldMissing } from "./prefield"

const blank = { ordenNumber: null, pedido: null, smr: null, titulo: null }

describe("prefieldMissing", () => {
	it("lists all four when blank", () => {
		expect(prefieldMissing(blank)).toEqual([
			"ordenNumber",
			"pedido",
			"smr",
			"titulo",
		])
	})
	it("treats whitespace as blank and omits filled fields", () => {
		expect(
			prefieldMissing({ ...blank, ordenNumber: "1", pedido: "  " }),
		).toEqual(["pedido", "smr", "titulo"])
	})
})

describe("packetBlockers", () => {
	const doc = { ...blank, blueprintPaths: [] as string[] }
	it("is empty when the supervisor requires nothing", () => {
		expect(
			packetBlockers(doc, {
				requiresPrefield: false,
				requiresBlueprint: false,
			}),
		).toEqual([])
	})
	it("blocks on prefield and blueprint when required and blank", () => {
		expect(
			packetBlockers(doc, { requiresPrefield: true, requiresBlueprint: true }),
		).toEqual(["prefield", "blueprint"])
	})
	it("clears when provided", () => {
		expect(
			packetBlockers(
				{
					ordenNumber: "1",
					pedido: "2",
					smr: "3",
					titulo: "4",
					blueprintPaths: ["/x.pdf"],
				},
				{ requiresPrefield: true, requiresBlueprint: true },
			),
		).toEqual([])
	})
})
