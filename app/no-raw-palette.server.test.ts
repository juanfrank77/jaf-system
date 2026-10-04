import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const APP = import.meta.dirname

function* tsxFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "__screenshots__") continue
			yield* tsxFiles(full)
		} else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
			yield full
		}
	}
}

const RAW =
	/\b(?:text|bg|border|divide|ring|from|via|to|fill|stroke|outline|decoration|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\bbg-white\b/g

describe("no raw palette classes", () => {
	it("uses semantic tokens instead of Tailwind palette colours", () => {
		const offenders: string[] = []
		for (const file of tsxFiles(APP)) {
			const hits = readFileSync(file, "utf8").match(RAW)
			if (hits)
				offenders.push(
					`${path.relative(APP, file)}: ${[...new Set(hits)].join(", ")}`,
				)
		}
		expect(offenders).toEqual([])
	})
})
