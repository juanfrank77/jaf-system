import { screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
	GuideBox,
	GuideCounter,
	type GuideField,
	useFormGuidance,
	useNativeGuidance,
} from "./form-guidance"

function Demo({ extra = false }: { extra?: boolean }) {
	const [a, setA] = useState("")
	const [b, setB] = useState("")
	const fields: GuideField[] = [
		{ id: "box-a", label: "Notes", empty: a.trim() === "" },
		{ id: "box-b", label: "Photos", empty: b.trim() === "" },
		...(extra
			? [{ id: "box-c", label: "Optional", empty: true, blocking: false }]
			: []),
	]
	const guide = useFormGuidance(fields)
	return (
		<form>
			<GuideCounter guide={guide} />
			<GuideBox id="box-a" guide={guide}>
				<input
					aria-label="a"
					value={a}
					onChange={(e) => setA(e.target.value)}
				/>
			</GuideBox>
			<GuideBox id="box-b" guide={guide}>
				<input
					aria-label="b"
					value={b}
					onChange={(e) => setB(e.target.value)}
				/>
			</GuideBox>
			<button type="submit" onClick={(e) => guide.holdContinue(e)}>
				Continue
			</button>
		</form>
	)
}

const mount = (renderStub: any, props = {}) =>
	renderStub({ entries: [{ path: "/", Component: () => <Demo {...props} /> }] })

describe("form guidance", () => {
	it("counts what is missing, names each one as a button, and lights only the first", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(screen.getByText("2 boxes left")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument()
		expect(document.querySelectorAll(".guide-next")).toHaveLength(1)
		expect(document.getElementById("box-a")).toHaveClass("guide-next")
	})

	it("moves the light to the next box when one is filled", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.type(screen.getByLabelText("a"), "x")
		expect(screen.getByText("1 box left")).toBeInTheDocument()
		expect(document.getElementById("box-b")).toHaveClass("guide-next")
		expect(document.getElementById("box-a")).not.toHaveClass("guide-next")
	})

	it("holds Continue back: red outline and Fill this in on the first gap, cleared once filled", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.type(screen.getByLabelText("a"), "x")
		await userEvent.click(screen.getByRole("button", { name: "Continue" }))
		const box = document.getElementById("box-b")
		expect(box).toHaveClass("guide-flagged")
		expect(box).toHaveTextContent("Fill this in")
		await userEvent.type(screen.getByLabelText("b"), "y")
		expect(document.querySelector(".guide-flagged")).toBeNull()
		expect(screen.queryByText("Fill this in")).toBeNull()
		expect(screen.queryByTestId("guide-counter")).toBeNull()
	})

	it("the counter's button flags that box", async ({ renderStub }) => {
		await mount(renderStub)
		await userEvent.click(screen.getByRole("button", { name: "Photos" }))
		expect(document.getElementById("box-b")).toHaveClass("guide-flagged")
	})

	it("a box that never blocks glows but is not counted", async ({
		renderStub,
	}) => {
		await mount(renderStub, { extra: true })
		expect(screen.getByText("2 boxes left")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Optional" })).toBeNull()
	})
})

function NativeDemo() {
	const ref = useRef<HTMLFormElement>(null)
	const [picked, setPicked] = useState<string[]>([])
	const guide = useNativeGuidance(ref, [
		{ id: "g-type", label: "Job type", name: "jobType" },
		{ id: "g-crew", label: "Crew", name: "brigadeId" },
		{ id: "g-choice", label: "Materials?", empty: false },
	])
	return (
		<form ref={ref}>
			<GuideCounter guide={guide} />
			<GuideBox id="g-type" guide={guide}>
				<input aria-label="type" name="jobType" />
			</GuideBox>
			<GuideBox id="g-crew" guide={guide}>
				<button type="button" onClick={() => setPicked(["b1"])}>
					Pick crew
				</button>
				{picked.map((id) => (
					<input key={id} type="hidden" name="brigadeId" value={id} />
				))}
			</GuideBox>
			<button type="submit" onClick={(e) => guide.holdContinue(e)}>
				Create
			</button>
		</form>
	)
}

describe("native form guidance", () => {
	it("reads typed values and hidden picker inputs from the form itself", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <NativeDemo /> }],
		})
		expect(screen.getByText("2 boxes left")).toBeInTheDocument()
		await userEvent.type(screen.getByLabelText("type"), "Mantenimiento")
		expect(screen.getByText("1 box left")).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Create" }))
		expect(document.getElementById("g-crew")).toHaveClass("guide-flagged")
		await userEvent.click(screen.getByRole("button", { name: "Pick crew" }))
		expect(screen.queryByTestId("guide-counter")).toBeNull()
		expect(document.querySelector(".guide-flagged")).toBeNull()
	})
})
