import { createInstance } from "i18next"
import { describe, expect, it } from "vitest"
import { resources } from "~/localization/resource"
import { packetSentSummary } from "./packet-audit"

async function tFor(lng: "en" | "es") {
	const i18n = createInstance()
	await i18n.init({ lng, ns: "common", defaultNS: "common", resources })
	return i18n.t
}

describe("packetSentSummary", () => {
	it("says what happened, to whom, and whether it was the first send", async () => {
		const t = await tFor("en")
		expect(
			packetSentSummary(
				{
					mode: "email",
					outcome: "SENT",
					recipientEmail: "ana@claro.example",
					firstSend: true,
				},
				t,
			),
		).toBe("Sent · ana@claro.example · first send")
		expect(
			packetSentSummary(
				{
					mode: "email",
					outcome: "FAILED",
					recipientEmail: "ana@claro.example",
					firstSend: false,
					error: "Connection refused",
				},
				t,
			),
		).toBe("Failed · ana@claro.example · Connection refused")
	})

	it("speaks Spanish, and tolerates an unknown outcome", async () => {
		const t = await tFor("es")
		expect(
			packetSentSummary(
				{ outcome: "MANUAL", recipientEmail: "a@b.example", firstSend: true },
				t,
			),
		).toContain("primer envío")
		expect(packetSentSummary({}, t)).toBe("— · —")
	})
})
