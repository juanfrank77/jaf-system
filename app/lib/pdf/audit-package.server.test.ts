import { describe, expect, it } from "vitest"
import {
	describeBrigades,
	generateAuditPackagePdf,
} from "./audit-package.server"

describe("describeBrigades", () => {
	it("lists nothing when no brigade is recorded", () => {
		expect(describeBrigades([])).toEqual({ lines: [], note: null })
	})
	it("lists a single brigade without a payment note", () => {
		expect(
			describeBrigades([{ name: "JESUS MARTINEZ", code: "009" }]),
		).toEqual({ lines: ["JESUS MARTINEZ · 009"], note: null })
	})
	it("lists every brigade and says each is paid separately", () => {
		const out = describeBrigades([
			{ name: "JESUS MARTINEZ", code: "009" },
			{ name: "ALEXIS DIAZ", code: null },
		])
		expect(out.lines).toEqual(["JESUS MARTINEZ · 009", "ALEXIS DIAZ"])
		expect(out.note).toBe(
			"Each brigade has its own certificado and is paid separately for its own work.",
		)
	})
})

describe("generateAuditPackagePdf", () => {
	it("renders a PDF for a multi-brigade job", async () => {
		const pdf = await generateAuditPackagePdf(
			{
				controlNumber: "MAINT-261004-001",
				jobType: "Mantenimiento",
				jobAddressEstimated: "CAM 906",
				createdAt: new Date("2026-10-04T12:00:00Z"),
				brigades: [
					{ name: "JESUS MARTINEZ", code: "009" },
					{ name: "ALEXIS DIAZ", code: "025" },
				],
				materialsTaken: [],
				materialsUsed: [],
				auditTrail: [],
				photos: [],
			},
			{},
		)
		expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
	})
})
