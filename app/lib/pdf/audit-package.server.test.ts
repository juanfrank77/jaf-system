import { describe, expect, it } from "vitest"
import {
	describeBrigades,
	generateAuditPackagePdf,
} from "./audit-package.server"

describe("describeBrigades", () => {
	it("lists nothing when no brigade is recorded", () => {
		expect(describeBrigades([])).toEqual({ lines: [], note: null })
	})
	it("lists a single brigade without a lead tag or payment note", () => {
		expect(
			describeBrigades([{ name: "JESUS MARTINEZ", code: "009", lead: true }]),
		).toEqual({ lines: ["JESUS MARTINEZ · 009"], note: null })
	})
	it("tags the lead and adds the payment note when several brigades worked it", () => {
		const out = describeBrigades([
			{ name: "JESUS MARTINEZ", code: "009", lead: true },
			{ name: "ALEXIS DIAZ", code: null, lead: false },
		])
		expect(out.lines).toEqual(["JESUS MARTINEZ · 009 (Lead)", "ALEXIS DIAZ"])
		expect(out.note).toBe(
			"Payment goes to the lead brigade only (JESUS MARTINEZ · 009). Finance splits shared jobs manually.",
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
					{ name: "JESUS MARTINEZ", code: "009", lead: true },
					{ name: "ALEXIS DIAZ", code: "025", lead: false },
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
