import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { NewCompletionForm } from "./new-completion-form"

const loaderData = {
	user: { id: "u1", name: "Alfredo Rosario" },
	identity: { name: "Alfredo Rosario", jafNumber: "1820", login: "jaf98549" },
	van: { id: "v1", name: "Van 12", active: true },
	brackets: [100],
	limitRows: [],
	serializedCodes: [{ id: "m1", name: "Nokia G-240W", serialPrefix: "ALCLED" }],
	accessoryCodes: [],
	vanSerials: [],
}

const mount = (renderStub: any) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<NewCompletionForm
						loaderData={loaderData as never}
						actionData={undefined}
					/>
				),
			},
		],
	})

async function toStep2() {
	await userEvent.fill(await screen.findByLabelText("Order #"), "430920")
	await userEvent.fill(screen.getByLabelText("Address"), "Morovis")
	await userEvent.click(
		screen.getByRole("button", { name: /Next → scan the modem/ }),
	)
}

describe("New completion form", () => {
	it("step 1 shows the installer and the auto date with a step-aware callout", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(await screen.findByText(/Step 1 of 4/)).toBeInTheDocument()
		expect(
			screen.getByText(/Alfredo Rosario · JAF 1820 · jaf98549/),
		).toBeInTheDocument()
		await waitFor(() =>
			expect(screen.getByText(/\(auto\)/)).toBeInTheDocument(),
		)
	})

	it("numbers each step pill once", async ({ renderStub }) => {
		await mount(renderStub)
		await screen.findByText(/Step 1 of 4/)
		const list = screen.getByRole("list", { name: "Completion steps" })
		expect(list.textContent).toContain("1. Order")
		expect(list.textContent).toContain("3. Drop & materials")
		expect(list.textContent).not.toMatch(/\d\. \d\./)
	})

	it("step 2 follows the callout and shows a large tappable scan box", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await toStep2()
		expect(await screen.findByText(/Step 2 of 4/)).toBeInTheDocument()
		expect(screen.getByText(/Scan the modem box/)).toBeInTheDocument()
		const box = screen.getByTestId("scan-box")
		expect(box.getBoundingClientRect().height).toBeGreaterThanOrEqual(160)
		expect(box).toHaveTextContent("Point the camera at the barcode")
		expect(box).toHaveTextContent("serial + photo in one shot")
	})

	it("steps 3 and 4 show their own callout and a full-width submit with a large form-photo box", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await toStep2()
		// Mark the modem unreadable-by-scan is not needed: gate on the serial
		// by going through the scanner's give-up path.
		await userEvent.click(screen.getByTestId("scan-box"))
		const cant = await screen.findByRole("button", { name: /scan/i })
		await userEvent.click(cant)
		await userEvent.click(cant)
		await userEvent.click(
			await screen.findByRole("button", { name: /Next → drop & materials/ }),
		)
		expect(await screen.findByText(/Step 3 of 4/)).toBeInTheDocument()
		await userEvent.fill(screen.getByLabelText("Drop (ft)"), "100")
		await userEvent.click(
			screen.getByRole("button", { name: /Next → paperwork/ }),
		)
		expect(await screen.findByText(/Step 4 of 4/)).toBeInTheDocument()
		expect(
			screen.getByText(/Photo of the signed Claro form/),
		).toBeInTheDocument()
		expect(
			screen.getByTestId("form-photo-box").getBoundingClientRect().height,
		).toBeGreaterThanOrEqual(160)
		const submit = screen.getByRole("button", { name: "Submit completion" })
		expect(submit.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
		expect(submit.getBoundingClientRect().width).toBeGreaterThan(300)
	})
})
