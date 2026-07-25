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
		expect(screen.getByRole("button", { name: "EN" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "ES" })).toBeInTheDocument()
	})

	it("marks the active language as pressed and the other as not pressed", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <LanguageSwitcher />,
				},
			],
			i18n: { lng: "en" },
		})
		expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute(
			"aria-pressed",
			"true",
		)
		expect(screen.getByRole("button", { name: "ES" })).toHaveAttribute(
			"aria-pressed",
			"false",
		)
	})

	it("exposes an accessible group label", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <LanguageSwitcher />,
				},
			],
		})
		expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument()
	})
})
