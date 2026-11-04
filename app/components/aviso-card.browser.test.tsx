import { fireEvent, screen } from "@testing-library/react"
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
			screen.getByText(
				"JAF checks the number on the file and, when it can read them, compares the materials with your work order.",
			),
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

	const DIFF = {
		claroCode: "4003587",
		name: "poles",
		workOrder: 3,
		aviso: 2,
	}

	it("lists the differing lines and needs a note to continue anyway", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				result={{
					errorKey: "docs_review.errors.aviso_materials_differ",
					differences: [DIFF],
				}}
			/>,
		)
		expect(
			screen.getByText("work order: 3 poles, Aviso: 2 poles"),
		).toBeVisible()
		const go = screen.getByRole("button", { name: "Continue anyway" })
		expect(go).toBeDisabled()
		fireEvent.change(screen.getByLabelText(/Explain the difference/), {
			target: { value: "Claro counted a returned pole" },
		})
		expect(go).toBeEnabled()
		expect(screen.getByLabelText(/Explain the difference/)).toHaveAttribute(
			"name",
			"discrepancyNote",
		)
	})

	it("says when the materials table could not be read, without an error", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				avisoNumber="10353961"
				avisoDocPath="/a"
				result={{ info: "docs_review.aviso_materials_unreadable" }}
			/>,
		)
		expect(screen.getByText(/could not be read with confidence/)).toBeVisible()
		expect(screen.queryByRole("alert")).toBeNull()
	})

	it("shows a saved discrepancy with the Aviso figure beside the work order's, and its note", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				avisoNumber="10353961"
				avisoDocPath="/a"
				discrepancy={{
					detectedAt: "2026-10-20T00:00:00.000Z",
					differences: [DIFF],
					note: "Claro counted a returned pole",
					noteAt: "2026-10-20T00:00:00.000Z",
					noteById: "u1",
				}}
			/>,
		)
		expect(
			screen.getByText("Aviso differs from your work order."),
		).toBeVisible()
		expect(
			screen.getByText("work order: 3 poles, Aviso: 2 poles"),
		).toBeVisible()
		expect(screen.getByText(/Claro counted a returned pole/)).toBeVisible()
	})

	it("offers no note form on a saved discrepancy (a note is always saved with it)", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				avisoNumber="10353961"
				avisoDocPath="/a"
				discrepancy={{
					detectedAt: "2026-10-20T00:00:00.000Z",
					differences: [DIFF],
					note: null,
					noteAt: null,
					noteById: null,
				}}
			/>,
		)
		expect(
			screen.getByText("Aviso differs from your work order."),
		).toBeVisible()
		expect(screen.queryByLabelText(/Explain the difference/)).toBeNull()
	})

	it("lists replaced Avisos in the history, marked replaced", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				readOnly
				avisoNumber="10353962"
				avisoDocPath="/a"
				history={[
					{
						avisoNumber: "10353961",
						href: "/files/aviso-docs/d1-aviso-replaced-1.pdf",
						reason: "Wrong document",
						replacedAt: "2026-10-20T00:00:00.000Z",
					},
				]}
			/>,
		)
		const link = screen.getByRole("link", { name: /10353961/ })
		expect(link).toHaveAttribute(
			"href",
			"/files/aviso-docs/d1-aviso-replaced-1.pdf",
		)
		expect(link.closest("li")).toHaveTextContent("replaced")
		expect(link.closest("li")).toHaveTextContent("Wrong document")
	})

	it("offers Replace Aviso with a required reason while it is allowed", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				canReplace
				avisoNumber="10353961"
				avisoDocPath="/a"
			/>,
		)
		expect(screen.getByRole("button", { name: "Replace Aviso" })).toBeEnabled()
		expect(screen.getByLabelText(/Reason for replacing/)).toBeRequired()
		expect(screen.getByLabelText(/Reason for replacing/)).toHaveAttribute(
			"name",
			"replaceReason",
		)
		// A saved Aviso is not re-saved over: no plain Save button.
		expect(screen.queryByRole("button", { name: "Save Aviso" })).toBeNull()
	})

	it("is view-only once the Pre-cert is signed: no replace form", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				readOnly
				canReplace={false}
				avisoNumber="10353961"
				avisoDocPath="/a"
			/>,
		)
		expect(screen.queryByRole("button", { name: "Replace Aviso" })).toBeNull()
		expect(screen.queryByLabelText(/Reason for replacing/)).toBeNull()
	})

	it("a replacement that still differs asks for a note inside the replace form", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoCard
				{...base}
				saved
				canReplace
				avisoNumber="10353961"
				avisoDocPath="/a"
				result={{
					errorKey: "docs_review.errors.aviso_materials_differ",
					differences: [DIFF],
				}}
			/>,
		)
		const note = screen.getByLabelText(/Explain the difference/)
		const form = note.closest("form") as HTMLFormElement
		expect(form.querySelector('input[name="intent"]')).toHaveValue(
			"replace_aviso",
		)
		expect(note).toHaveAttribute("name", "discrepancyNote")
		expect(
			screen.getByText("work order: 3 poles, Aviso: 2 poles"),
		).toBeVisible()
		const go = screen.getByRole("button", { name: "Continue anyway" })
		expect(go).toBeDisabled()
		fireEvent.change(note, { target: { value: "Claro will not correct it" } })
		expect(go).toBeEnabled()
	})
})
