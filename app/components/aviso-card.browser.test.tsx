import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AvisoCard } from "./aviso-card"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

const base = {
	docId: "d1",
	avisoNumber: null,
	avisoDocPath: null,
	saved: false,
	locked: false,
	readOnly: false,
	result: null,
}

describe("AvisoCard (step 6)", () => {
	it("asks only for the number and the file, with no match table", async ({
		renderStub,
	}) => {
		await mount(renderStub, <AvisoCard {...base} />)
		expect(screen.getByRole("heading", { name: "Aviso" })).toBeInTheDocument()
		expect(
			screen.getByText("JAF does not match labor or materials against it."),
		).toBeInTheDocument()
		expect(screen.getByLabelText("Aviso # (8 digits)")).toBeInTheDocument()
		expect(screen.getByLabelText(/Aviso document \(PDF\)/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Save Aviso" })).toBeEnabled()
		expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute(
			"href",
			"/?step=INVOICE",
		)
		expect(screen.queryByRole("table")).toBeNull()
		expect(screen.queryByText(/Charged/)).toBeNull()
		expect(screen.queryByText(/\$/)).toBeNull()
	})

	it("confirms the number once the Aviso is saved", async ({ renderStub }) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				avisoNumber="10353961"
				avisoDocPath="/x/aviso-docs/d1-aviso.pdf"
			/>,
		)
		expect(
			screen.getByText(
				"Number on the file matches (10353961). Pre-cert sheet is generated automatically.",
			),
		).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "d1-aviso.pdf" })).toHaveAttribute(
			"href",
			"/files/aviso-docs/d1-aviso.pdf",
		)
	})

	it("shows both numbers when the file is not the typed Aviso", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				result={{
					errorKey: "docs_review.errors.aviso_number_mismatch",
					typedNumber: "10353961",
					pdfAvisoNumber: "10353962",
				}}
			/>,
		)
		expect(screen.getByRole("alert")).toHaveTextContent("10353961")
		expect(screen.getByRole("alert")).toHaveTextContent("10353962")
	})

	it("says a signed pre-cert sheet was kept when the Aviso is re-saved", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				avisoNumber="10353961"
				avisoDocPath="/x/a.pdf"
				result={{ noteKey: "docs_review.aviso_resaved_signed" }}
			/>,
		)
		expect(screen.getByText(/already signed/)).toBeInTheDocument()
	})

	it("is read-only when looking back", async ({ renderStub }) => {
		await mount(
			renderStub,
			<AvisoCard {...base} readOnly saved avisoNumber="1" avisoDocPath="/a" />,
		)
		expect(screen.queryByRole("button", { name: "Save Aviso" })).toBeNull()
	})
})
