import { describe, expect, it } from "vitest"
import { buildVarianceLines, collectVariance } from "./variance.server"

describe("collectVariance", () => {
	it("includes a doc that has BOTH an overage and a shortage (no first-wins)", () => {
		const rows = collectVariance([
			{
				id: "d1",
				claroOrderNo: "JAF-1",
				brigade: "Dino",
				signals: { overage: 1, shortage: 1, discrepancy: 0 },
				lines: [],
			},
		])
		expect(rows[0].kinds).toEqual(
			expect.arrayContaining(["overage", "shortage"]),
		)
	})

	it("omits docs with no variance", () => {
		const rows = collectVariance([
			{
				id: "d2",
				claroOrderNo: "JAF-2",
				brigade: "Alexis",
				signals: { overage: 0, shortage: 0, discrepancy: 0 },
				lines: [],
			},
		])
		expect(rows).toEqual([])
	})

	it("includes all three kinds when all signals fire", () => {
		const rows = collectVariance([
			{
				id: "d3",
				claroOrderNo: "JAF-3",
				brigade: "Nino",
				signals: { overage: 1, shortage: 1, discrepancy: 1 },
				lines: [{ code: "svc-1", ordered: 2, installed: 3, delta: 1 }],
			},
		])
		expect(rows).toHaveLength(1)
		expect(rows[0].kinds).toEqual(
			expect.arrayContaining(["overage", "discrepancy", "shortage"]),
		)
		expect(rows[0].kinds).toHaveLength(3)
		expect(rows[0].lines).toEqual([
			{ code: "svc-1", ordered: 2, installed: 3, delta: 1 },
		])
	})
})

describe("buildVarianceLines", () => {
	it("prefers materialsUsed over materialsTaken when both are present", () => {
		const lines = buildVarianceLines({
			estimatedMaterials: [{ serviceCodeId: "svc-1", qty: 2 }],
			materialsTaken: [{ serviceCodeId: "svc-1", qty: 3 }],
			materialsUsed: [{ serviceCodeId: "svc-1", qty: 1 }],
		})
		expect(lines).toEqual([
			{ code: "svc-1", ordered: 2, installed: 1, delta: -1 },
		])
	})

	it("falls back to materialsTaken when materialsUsed is absent", () => {
		const lines = buildVarianceLines({
			estimatedMaterials: [{ serviceCodeId: "svc-1", qty: 2 }],
			materialsTaken: [{ serviceCodeId: "svc-1", qty: 3 }],
			materialsUsed: undefined,
		})
		expect(lines).toEqual([
			{ code: "svc-1", ordered: 2, installed: 3, delta: 1 },
		])
	})

	it("returns an empty array when nothing is recorded", () => {
		expect(buildVarianceLines({})).toEqual([])
	})
})
