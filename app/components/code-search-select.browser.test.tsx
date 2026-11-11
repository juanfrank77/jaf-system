import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { CodeSearchSelect } from "./code-search-select"

const items = [
	{ id: "a", claroCode: "1003301", name: "CLAMP, SUSPENSION", unit: "EA" },
	{ id: "b", claroCode: "4003382", name: "POLE CREOSOTED 30 C-5", unit: "EA" },
	{ id: "c", claroCode: "1003999", name: "BRACKET", unit: "EA" },
]

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, onPick = vi.fn()) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<CodeSearchSelect
						items={items}
						onPick={onPick}
						placeholder="Pick one"
					/>
				),
			},
		],
	})

const search = (text: string) =>
	userEvent.type(screen.getByRole("searchbox"), text)

describe("CodeSearchSelect", () => {
	it("filters by part of a code", async ({ renderStub }) => {
		await mount(renderStub)
		await search("1003")
		expect(
			screen.getByRole("button", { name: /CLAMP, SUSPENSION/ }),
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /BRACKET/ })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /POLE CREOSOTED/ })).toBeNull()
	})

	it("filters by a word in the name and picks on tap", async ({
		renderStub,
	}) => {
		const onPick = vi.fn()
		await mount(renderStub, onPick)
		await search("clamp")
		await userEvent.click(
			screen.getByRole("button", { name: /CLAMP, SUSPENSION/ }),
		)
		expect(onPick).toHaveBeenCalledWith(items[0])
	})

	it("says so when nothing matches", async ({ renderStub }) => {
		await mount(renderStub)
		await search("zzz")
		expect(screen.getByText("No materials match.")).toBeInTheDocument()
	})
})
