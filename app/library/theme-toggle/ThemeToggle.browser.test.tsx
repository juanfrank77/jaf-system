import { screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { THEME_STORAGE_KEY } from "~/lib/theme"
import { ThemeToggle } from "./index"

async function mount(renderStub: (a: any) => Promise<unknown>) {
	await renderStub({
		entries: [{ path: "/", Component: () => <ThemeToggle /> }],
	})
}

describe("ThemeToggle", () => {
	beforeEach(() => {
		window.localStorage.clear()
		document.documentElement.classList.remove("dark")
	})
	afterEach(() => {
		vi.restoreAllMocks()
		window.localStorage.clear()
		document.documentElement.classList.remove("dark")
	})

	const toDark = { name: "Switch to dark theme" }
	const toLight = { name: "Switch to light theme" }

	it("defaults to light and toggles light -> dark -> light", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		const button = screen.getByRole("button", toDark)
		expect(document.documentElement.classList.contains("dark")).toBe(false)
		await userEvent.click(button)
		expect(screen.getByRole("button", toLight)).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(true)
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
		await userEvent.click(screen.getByRole("button", toLight))
		expect(screen.getByRole("button", toDark)).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(false)
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light")
	})

	it("restores a stored dark preference without resetting it", async ({
		renderStub,
	}) => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark")
		await mount(renderStub)
		expect(await screen.findByRole("button", toLight)).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})

	for (const value of ["purple", "system"]) {
		it(`treats stored ${value} as light`, async ({ renderStub }) => {
			window.localStorage.setItem(THEME_STORAGE_KEY, value)
			await mount(renderStub)
			expect(await screen.findByRole("button", toDark)).toBeInTheDocument()
			expect(document.documentElement.classList.contains("dark")).toBe(false)
		})
	}

	it("still switches when storage writes throw", async ({ renderStub }) => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied")
		})
		await mount(renderStub)
		await userEvent.click(screen.getByRole("button", toDark))
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})
})
