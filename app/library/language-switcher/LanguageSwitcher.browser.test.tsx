import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { LanguageSwitcher } from "./index"

describe("LanguageSwitcher", () => {
	it("renders a button for each supported language", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <LanguageSwitcher />,
				},
			],
		})
		expect(screen.getByRole("button", { name: "en" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "es" })).toBeInTheDocument()
	})
})
