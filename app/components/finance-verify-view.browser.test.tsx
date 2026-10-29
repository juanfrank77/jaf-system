import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { FinanceVerifyView } from "./finance-verify-view"

// The review screen as Lissette sees it: loader data in, no server.
const packetDocs = (over: { precert?: string | null } = {}) => [
	{
		key: "work_order_pdf",
		label: "finance_verify.packet.work_order_pdf",
		detail: "",
		href: "/files/packets/j1.pdf",
		files: [],
	},
	{
		key: "aviso",
		label: "finance_verify.packet.aviso",
		detail: "aviso.pdf",
		href: "/files/aviso-docs/aviso.pdf",
		files: [],
	},
	{
		key: "precert",
		label: "finance_verify.packet.precert",
		detail: "",
		href: over.precert === undefined ? "/files/precert/v1.pdf" : over.precert,
		files: [],
	},
	{
		key: "photos",
		label: "finance_verify.packet.photos",
		detail: "2",
		href: "/files/photos/j1/b.jpg",
		files: [
			{ name: "b.jpg", href: "/files/photos/j1/b.jpg" },
			{ name: "a.jpg", href: "/files/photos/j1/a.jpg" },
		],
	},
]

const data = (over: Record<string, unknown> = {}) =>
	({
		doc: {
			id: "j1",
			controlNumber: "MAINT261022001",
			jobType: "Poste",
			avisoNumber: "10356247",
			jobAddressEstimated: "Calle 1",
			jobAddressActual: null,
			supervisor: { name: "E. Ocasio" },
		},
		user: { id: "f1", role: "FINANCE" },
		serviceCodes: [],
		stage: "TO_VERIFY",
		invoiceLines: [
			{
				serviceCodeId: "s1",
				claroCode: "600X",
				name: "Remoción postes",
				qty: 2,
				unitPrice: 100,
				lineAmount: 200,
				ivuRate: 0.04,
			},
			{
				serviceCodeId: "s2",
				claroCode: "610M",
				name: "Transfer attach",
				qty: 1,
				unitPrice: 50,
				lineAmount: 50,
				ivuRate: 0.115,
			},
		],
		totals: { subtotal: 250, ivu4: 8, ivu115: 5.75, total: 263.75 },
		neighbors: { total: 3, position: 2, prevId: "j0", nextId: "j2" },
		avisoDiscrepancy: null,
		sendBackNotes: [],
		notReleased: false,
		canVerify: true,
		canSendBack: true,
		returnState: {
			returned: false,
			resent: false,
			resentPending: false,
			note: null,
			createdAt: null,
			resentAt: null,
		},
		packetDocs: packetDocs(),
		packetHref: null,
		legacyPricedHref: null,
		pricedInvoiceHref: null,
		brigadeStock: [],
		materials: [],
		...over,
	}) as never

const mount = (renderStub: any, loaderData: never, actionData?: unknown) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<FinanceVerifyView
						loaderData={loaderData}
						actionData={actionData as never}
					/>
				),
			},
		],
	})

const acceptButton = () => screen.getByRole("button", { name: "Accept & next" })

describe("Finance review screen", () => {
	it("keeps Accept grey until all four checks are ticked", async ({
		renderStub,
	}) => {
		await mount(renderStub, data())
		expect(acceptButton()).toBeDisabled()
		const boxes = [
			"Invoice correct",
			"Aviso # matches the Aviso PDF",
			"Photos are this job",
			"Pre-cert signed",
		]
		for (const name of boxes.slice(0, 3))
			await userEvent.click(screen.getByRole("checkbox", { name }))
		expect(acceptButton()).toBeDisabled()
		await userEvent.click(screen.getByRole("checkbox", { name: boxes[3] }))
		expect(acceptButton()).toBeEnabled()
	})

	it("flags a missing document and cannot accept even with every check ticked", async ({
		renderStub,
	}) => {
		await mount(renderStub, data({ packetDocs: packetDocs({ precert: null }) }))
		expect(screen.getByText("Missing")).toBeInTheDocument()
		for (const box of screen.getAllByRole("checkbox"))
			await userEvent.click(box)
		expect(acceptButton()).toBeDisabled()
	})

	it("shows the service lines and the subtotal only: PBCC has no tax", async ({
		renderStub,
	}) => {
		await mount(renderStub, data())
		const row = screen.getByRole("row", { name: /600X/ })
		expect(within(row).getByText("$200.00")).toBeInTheDocument()
		expect(screen.getByText("Subtotal").nextSibling).toHaveTextContent(
			"$250.00",
		)
		expect(screen.queryByText(/IVU/)).not.toBeInTheDocument()
		expect(screen.queryByText("Total")).not.toBeInTheDocument()
	})

	it("opens a document on the page, shows photo thumbnails, and offers Download all", async ({
		renderStub,
	}) => {
		await mount(renderStub, data())
		// The JAF invoice is already in the viewer.
		expect(document.querySelector("iframe")).toHaveAttribute(
			"src",
			"/files/packets/j1.pdf#page=1&zoom=100",
		)
		const openButtons = screen.getAllByRole("button", { name: "Open" })
		await userEvent.click(openButtons[1])
		expect(document.querySelector("iframe")).toHaveAttribute(
			"src",
			"/files/aviso-docs/aviso.pdf#page=1&zoom=100",
		)
		await userEvent.click(screen.getByRole("button", { name: "a.jpg" }))
		expect(document.querySelector("iframe")).toBeNull()
		expect(screen.getAllByAltText("a.jpg").at(-1)).toHaveAttribute(
			"src",
			"/files/photos/j1/a.jpg",
		)
		expect(screen.getByRole("link", { name: "Download all" })).toHaveAttribute(
			"href",
			"/finance/verify/j1/packet.zip",
		)
	})

	it("links to the previous and next packet in the Inbox", async ({
		renderStub,
	}) => {
		await mount(renderStub, data())
		expect(screen.getByText("2 of 3")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: /Prev/ })).toHaveAttribute(
			"href",
			"/finance/verify/j0",
		)
		expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute(
			"href",
			"/finance/verify/j2",
		)
	})
	it("a returned packet shows her note and cannot be accepted; it can be sent back again", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			data({
				canVerify: false,
				returnState: {
					returned: true,
					resent: false,
					resentPending: false,
					note: "Wrong pole on the Aviso",
					createdAt: "2026-10-28T14:00:00.000Z",
					resentAt: null,
				},
			}),
		)
		expect(screen.getByText("Wrong pole on the Aviso")).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Accept & next" }),
		).not.toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Send Back to Supervisor" }),
		).toBeInTheDocument()
	})

	it("an unreleased job offers neither Accept nor Send back", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			data({ notReleased: true, canVerify: false, canSendBack: false }),
		)
		expect(
			screen.queryByRole("button", { name: "Accept & next" }),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Send Back to Supervisor" }),
		).not.toBeInTheDocument()
	})
})
