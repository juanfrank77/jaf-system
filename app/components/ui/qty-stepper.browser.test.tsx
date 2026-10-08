import { screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { QtyStepper } from "./qty-stepper"

function Harness({ min = 0 }: { min?: number }) {
	const [v, setV] = useState(2)
	return <QtyStepper value={v} onChange={setV} min={min} label="Span clamp" />
}

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("QtyStepper", () => {
	it("steps up and down", async ({ renderStub }) => {
		await mount(renderStub, <Harness />)
		await userEvent.click(screen.getByLabelText("Increase: Span clamp"))
		expect(screen.getByLabelText("Span clamp")).toHaveValue("3")
		await userEvent.click(screen.getByLabelText("Decrease: Span clamp"))
		await userEvent.click(screen.getByLabelText("Decrease: Span clamp"))
		expect(screen.getByLabelText("Span clamp")).toHaveValue("1")
	})

	it("disables decrease at the minimum", async ({ renderStub }) => {
		await mount(renderStub, <Harness min={2} />)
		expect(screen.getByLabelText("Decrease: Span clamp")).toBeDisabled()
	})

	it("can be cleared while typing and settles on blur", async ({
		renderStub,
	}) => {
		await mount(renderStub, <Harness />)
		const input = screen.getByLabelText("Span clamp")
		await userEvent.clear(input)
		expect(input).toHaveValue("")
		await userEvent.type(input, "40")
		expect(input).toHaveValue("40")
	})
})
