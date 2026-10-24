import { existsSync, readFileSync } from "node:fs"
import { extractText } from "unpdf"
import { describe, expect, it } from "vitest"
import { parseAdvice } from "./advice-parse"

const REAL_ADVICE =
	"docs/JAF_Package/07 All of JAF Forms/Monica Claro Payment received Sample.pdf"

describe.skipIf(!existsSync(REAL_ADVICE))("the real Claro advice", () => {
	it("reads every row and they add up to the printed total", async () => {
		const bytes = new Uint8Array(readFileSync(REAL_ADVICE))
		const { text } = await extractText(bytes.slice(), { mergePages: true })
		const r = parseAdvice(text)
		expect(r.adviceDate).toBe("2026-08-28")
		expect(r.reference).toBe("5440019914")
		expect(r.total).toBe(107863.5)
		expect(r.rows.filter((x) => x.invoiceRef.startsWith("M19-"))).toHaveLength(
			166,
		)
		const sum = r.rows.reduce((s, x) => s + x.net, 0)
		expect(Math.round(sum * 100) / 100).toBe(107863.5)
	})
})
