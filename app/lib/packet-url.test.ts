import { describe, expect, it } from "vitest"
import { packetUrl, viewerFrameUrl } from "./packet-url"

describe("packetUrl", () => {
	it("defaults to the whole packet, saved as a file", () => {
		expect(packetUrl("r1", { mode: "whole" })).toBe(
			"/finance/payroll/r1/journal?mode=whole",
		)
	})

	it("lists the picked brigades and can ask for the inline view", () => {
		expect(
			packetUrl(
				"r1",
				{ mode: "brigades", brigades: ["009", "009D"] },
				{ inline: true },
			),
		).toBe(
			"/finance/payroll/r1/journal?mode=brigades&brigades=009%2C009D&inline=1",
		)
	})

	it("opens the viewer frame on a page at a zoom, inline", () => {
		expect(viewerFrameUrl("r1", 7, 125)).toBe(
			"/finance/payroll/r1/journal?mode=whole&inline=1#page=7&zoom=125&navpanes=0",
		)
	})
})
