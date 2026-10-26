import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PacketActions } from "./payroll-packet"

const outline = {
	totalPages: 3,
	brigades: [
		{
			code: "011",
			label: "Fernando Rosario",
			jobs: 1,
			adjNet: 10,
			startPage: 1,
			pages: 1,
		},
		{
			code: "016",
			label: "Carlos Martínez",
			jobs: 2,
			adjNet: 20,
			startPage: 2,
			pages: 1,
		},
	],
}

const mount = (renderStub: any) =>
	renderStub({
		entries: [
			{
				path: "/finance/payroll/:runId/journal/outline",
				loader: () => outline,
			},
			{
				path: "/",
				Component: () => <PacketActions runId="r1" label="10/12 – 10/25" />,
			},
		],
	})

describe("PacketActions", () => {
	it("opens the viewer over the page, pages through it and closes", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		screen.getByRole("button", { name: "View packet" }).click()
		expect(await screen.findByText("Page 1 / 3")).toBeTruthy()
		expect(
			(screen.getByTitle(/Payroll packet/) as HTMLIFrameElement).src,
		).toContain("#page=1&zoom=100")
		screen.getByRole("button", { name: /Next/ }).click()
		expect(await screen.findByText("Page 2 / 3")).toBeTruthy()
		expect(
			(screen.getByTitle(/Payroll packet/) as HTMLIFrameElement).src,
		).toContain("#page=2")
		// Nothing prints or saves from the viewer.
		expect(screen.queryByRole("button", { name: "Print" })).toBeNull()
		screen.getByRole("button", { name: "Close" }).click()
		await expect.poll(() => screen.queryByText("Page 2 / 3")).toBeNull()
	})

	it("offers the three print choices and needs a brigade ticked for 'selected'", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		screen.getByRole("button", { name: "Print packet" }).click()
		expect(await screen.findByText("Whole packet (3 pages)")).toBeTruthy()
		screen.getByLabelText("Selected brigades").click()
		const print = screen.getByRole("button", { name: "Print" })
		expect((print as HTMLButtonElement).disabled).toBe(true)
		screen.getByLabelText(/016 Carlos Martínez/).click()
		await expect.poll(() => (print as HTMLButtonElement).disabled).toBe(false)
		expect(
			screen.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
		).toBe("/finance/payroll/r1/journal?mode=brigades&brigades=016")
		screen.getByLabelText(/Summary page/).click()
		await expect
			.poll(() =>
				screen.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
			)
			.toBe("/finance/payroll/r1/journal?mode=summary")
	})
})
