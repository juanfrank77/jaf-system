import { describe, expect, it } from "vitest"
import { Role } from "../../generated/prisma/client"
import en from "../../resources/locales/en/common.json"
import es from "../../resources/locales/es/common.json"

describe("app_shell.role labels", () => {
	for (const [name, locale] of [
		["en", en],
		["es", es],
	] as const) {
		it(`${name} has a label for every Role`, () => {
			const labels = (locale.app_shell as { role?: Record<string, string> })
				.role
			expect(labels).toBeDefined()
			for (const role of Object.values(Role)) {
				expect(labels?.[role], `missing ${name} label for ${role}`).toBeTruthy()
			}
		})
	}
})
