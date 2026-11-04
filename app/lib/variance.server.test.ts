import { describe, expect, it } from "vitest"
import { buildVarianceLines, collectVariance } from "./variance.server"

describe("collectVariance", () => {
	it("includes a doc that has BOTH an overage and a shortage (no first-wins)", () => {
		const rows = collectVariance([
			{
				id: "d1",
				claroOrderNo: "JAF-1",
				brigade: "Dino",
				signals: { overage: 1, shortage: 1 },
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
				signals: { overage: 0, shortage: 0 },
				lines: [],
			},
		])
		expect(rows).toEqual([])
	})

	it("includes both kinds when both signals fire", () => {
		const rows = collectVariance([
			{
				id: "d3",
				claroOrderNo: "JAF-3",
				brigade: "Nino",
				signals: { overage: 1, shortage: 1 },
				lines: [{ code: "svc-1", ordered: 2, installed: 3, delta: 1 }],
			},
		])
		expect(rows).toHaveLength(1)
		expect(rows[0].kinds).toEqual(
			expect.arrayContaining(["overage", "shortage"]),
		)
		expect(rows[0].kinds).toHaveLength(2)
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

	it("counts brigade's stock as installed (tracked) though it is not billed", () => {
		// Field save under the ruling: materialsUsed = 6 (warehouse only).
		const lines = buildVarianceLines({
			estimatedMaterials: [{ serviceCodeId: "svc-1", qty: 10 }],
			materialsTaken: [{ serviceCodeId: "svc-1", qty: 10 }],
			materialsUsed: [{ serviceCodeId: "svc-1", qty: 6 }],
			fieldMaterials: [
				{ serviceCodeId: "svc-1", used: 6, returned: 4, source: "WAREHOUSE" },
				{
					serviceCodeId: "svc-1",
					used: 4,
					returned: 0,
					source: "BRIGADE_STOCK",
				},
			],
		})
		expect(lines).toEqual([
			{ code: "svc-1", ordered: 10, installed: 10, delta: 0 },
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
