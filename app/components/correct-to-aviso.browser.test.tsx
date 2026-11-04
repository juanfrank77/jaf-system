import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CorrectionHistory, CorrectToAvisoForm } from "./correct-to-aviso"

// Same loose typing the other component tests use for the stub fixtures.
const mount = (renderStub: any, element: React.ReactNode) =>
	renderStub({ entries: [{ path: "/", Component: () => element }] })

const line = {
	serviceCodeId: "s1",
	claroCode: "34006298",
	accountCode: null,
	name: "RECOSER CABLE",
	qty: 2,
	unit: "EA",
	unitPrice: 10,
	lineAmount: 20,
}

describe("CorrectToAvisoForm", () => {
	it("posts the correction with her lines, and offers no price box", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<CorrectToAvisoForm
				lines={[line]}
				materials={[]}
				serviceCodes={[]}
				onCancel={vi.fn()}
				submitting={false}
			/>,
		)
		const form = screen.getByTestId("correct-to-aviso") as HTMLFormElement
		expect(
			form.querySelector<HTMLInputElement>('input[name="intent"]')?.value,
		).toBe("correct_to_aviso")
		expect(
			JSON.parse(
				form.querySelector<HTMLInputElement>('input[name="services"]')?.value ??
					"[]",
			)[0],
		).toMatchObject({ serviceCodeId: "s1", qty: 2 })
		expect(screen.queryByLabelText(/price/i)).toBeNull()
		expect(screen.getByRole("button", { name: "Save correction" })).toBeTruthy()
	})
})

describe("CorrectionHistory", () => {
	it("shows the supervisor's version 1 and who changed what, old to new", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<CorrectionHistory
				correction={{
					version: 2,
					original: {
						lines: [{ claroCode: "34006298", name: "RECOSER", qty: 1 }],
						lineTotal: 10,
					},
					log: [
						{
							id: "a1",
							version: 2,
							at: "2026-11-04T12:00:00.000Z",
							by: "Lissette",
							note: "Aviso says 2",
							changes: [
								{
									kind: "service",
									code: "34006298",
									name: "RECOSER",
									from: 1,
									to: 2,
								},
								{
									kind: "material",
									code: "1005824",
									name: "CABLE SUPPORT",
									from: 3,
									to: null,
								},
							],
						},
					],
				}}
			/>,
		)
		const box = screen.getByTestId("correction-history")
		expect(box).toHaveTextContent("this is version 2")
		expect(box).toHaveTextContent("Version 1, from the supervisor · $10.00")
		expect(box).toHaveTextContent("Version 2 by Lissette")
		expect(box).toHaveTextContent("34006298 RECOSER: 1 → 2")
		expect(box).toHaveTextContent("1005824 CABLE SUPPORT: 3 → removed")
		expect(box).toHaveTextContent("Aviso says 2")
	})
})
