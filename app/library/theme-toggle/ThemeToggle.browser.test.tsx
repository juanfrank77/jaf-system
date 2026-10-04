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

	it("starts on system and cycles light → dark → system", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		const button = screen.getByRole("button", { name: "Theme: System" })
		await userEvent.click(button)
		expect(
			screen.getByRole("button", { name: "Theme: Light" }),
		).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(false)
		await userEvent.click(screen.getByRole("button", { name: "Theme: Light" }))
		expect(
			screen.getByRole("button", { name: "Theme: Dark" }),
		).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(true)
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
		await userEvent.click(screen.getByRole("button", { name: "Theme: Dark" }))
		expect(
			screen.getByRole("button", { name: "Theme: System" }),
		).toBeInTheDocument()
	})

	it("restores a stored dark preference without resetting it to system", async ({
		renderStub,
	}) => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark")
		await mount(renderStub)
		expect(
			await screen.findByRole("button", { name: "Theme: Dark" }),
		).toBeInTheDocument()
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})

	it("treats a garbage stored value as system", async ({ renderStub }) => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "purple")
		await mount(renderStub)
		expect(
			await screen.findByRole("button", { name: "Theme: System" }),
		).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Theme: System" }))
		expect(
			await screen.findByRole("button", { name: "Theme: Light" }),
		).toBeInTheDocument()
	})

	it("still switches when storage writes throw", async ({ renderStub }) => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("denied")
		})
		await mount(renderStub)
		await userEvent.click(screen.getByRole("button", { name: "Theme: System" }))
		await userEvent.click(screen.getByRole("button", { name: "Theme: Light" }))
		expect(document.documentElement.classList.contains("dark")).toBe(true)
	})
})
