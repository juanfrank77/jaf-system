import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import type { ClaroPoView } from "~/lib/claro-po-view"
import { ClaroReviewView } from "./claro-review-view"

const base: ClaroPoView = {
	id: "po1",
	fileName: "po.pdf",
	status: "NEEDS_LOOK",
	poNumber: "4500526054",
	poDate: "2026-09-04",
	avisoNumber: "10343504",
	avisoCandidates: ["10343504", "10343999"],
	termsDays: 60,
	statedPages: 1,
	filePages: 1,
	lines: [
		{
			item: "10",
			description: "Poste",
			amount: 120,
			ivuRate: 0.115,
			ivu: 13.8,
		},
	],
	subtotal: 120,
	ivu4: 0,
	ivu115: 13.8,
	total: 133.8,
	printed: { subtotal: 100, ivu4: 0, ivu115: 11.5, total: 111.5 },
	checks: [
		{ code: "lines_sum", severity: "needs_look", detail: "120.00 vs 100" },
	],
	readError: null,
	billed: 500,
	alreadyPod: 0,
	supersededById: null,
	original: null,
	invoice: null,
	suggestedMonth: "2026-08",
	step: 2,
}

const render = (renderStub: any, po: ClaroPoView) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => <ClaroReviewView po={po} hasSignature />,
			},
		],
	})

describe("ClaroReviewView", () => {
	it("a failed check sits beside the data, with what is wrong and a reason box", async ({
		renderStub,
	}) => {
		await render(renderStub, base)
		const checks = await screen.findByRole("region", { name: "Checks" })
		const row = within(checks).getByTestId("check-lines_sum")
		expect(row).toHaveAttribute("data-state", "fail")
		expect(row).toHaveTextContent("120.00 vs 100")
		expect(within(row).getByLabelText("Reason to override")).toBeInTheDocument()
		expect(within(checks).getByTestId("check-totals")).toHaveAttribute(
			"data-state",
			"pass",
		)
		// The data it is about is on the same screen.
		expect(screen.getByRole("region", { name: "PO as read" })).toBeVisible()
		expect(screen.getByLabelText("Subtotal")).toHaveAttribute(
			"aria-invalid",
			"true",
		)
		expect(
			screen.getByRole("button", { name: "Generate invoice" }),
		).toBeInTheDocument()
	})

	it("line inputs are editable and a line can be added and deleted", async ({
		renderStub,
	}) => {
		await render(renderStub, base)
		const amount = await screen.findByLabelText("Amount, line 1")
		await userEvent.clear(amount)
		await userEvent.type(amount, "100")
		expect(amount).toHaveValue(100)
		const desc = screen.getByLabelText("Description, line 1")
		await userEvent.clear(desc)
		await userEvent.type(desc, "Poste 40")
		expect(desc).toHaveValue("Poste 40")
		await userEvent.click(screen.getByRole("button", { name: "Add line" }))
		expect(screen.getByLabelText("Amount, line 2")).toBeInTheDocument()
		await userEvent.click(screen.getByRole("button", { name: "Delete line 2" }))
		expect(screen.queryByLabelText("Amount, line 2")).toBeNull()
		// An unsaved edit holds Generate back until it is saved.
		expect(
			screen.getByRole("button", { name: "Generate invoice" }),
		).toBeDisabled()
	})

	it("missing pages: no override box, an upload box and no Generate button", async ({
		renderStub,
	}) => {
		await render(renderStub, {
			...base,
			status: "BLOCKED",
			statedPages: 3,
			checks: [
				{ code: "pages_missing", severity: "blocked", detail: "1 of 3" },
			],
		})
		const row = await screen.findByTestId("check-pages")
		expect(row).toHaveAttribute("data-state", "fail")
		expect(within(row).queryByLabelText("Reason to override")).toBeNull()
		expect(
			screen.getByRole("button", { name: "Upload complete file" }),
		).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Generate invoice" }),
		).toBeNull()
	})

	it("duplicate: links the existing PO and offers to discard this copy", async ({
		renderStub,
	}) => {
		await render(renderStub, {
			...base,
			status: "BLOCKED",
			checks: [
				{ code: "duplicate", severity: "blocked", detail: "4500526054" },
			],
			original: { id: "po0", poNumber: "4500526054" },
		})
		const row = await screen.findByTestId("check-duplicate")
		expect(within(row).queryByLabelText("Reason to override")).toBeNull()
		expect(
			screen.getByRole("link", { name: "Open the existing PO" }),
		).toHaveAttribute("href", "/finance/claro/po0")
		expect(
			screen.getByRole("button", { name: "Discard this copy" }),
		).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Generate invoice" }),
		).toBeNull()
	})

	it("Unmatched: an Aviso row fails with no override box, the Aviso field is marked, no Generate", async ({
		renderStub,
	}) => {
		await render(renderStub, {
			...base,
			status: "UNMATCHED",
			avisoNumber: null,
			checks: [],
		})
		const row = await screen.findByTestId("check-aviso")
		expect(row).toHaveAttribute("data-state", "fail")
		expect(within(row).queryByLabelText("Reason to override")).toBeNull()
		expect(screen.getByLabelText("Aviso #")).toHaveAttribute(
			"aria-invalid",
			"true",
		)
		expect(
			screen.queryByRole("button", { name: "Generate invoice" }),
		).toBeNull()
		expect(screen.getByText(/needs an Aviso/)).toBeInTheDocument()
	})

	it("the money fields show what the PO printed, not the totals rebuilt from lines", async ({
		renderStub,
	}) => {
		await render(renderStub, base)
		expect(await screen.findByLabelText("Subtotal")).toHaveValue(100)
		expect(screen.getByLabelText("Total")).toHaveValue(111.5)
	})

	it("a duplicate whose original is not found offers no Discard", async ({
		renderStub,
	}) => {
		await render(renderStub, {
			...base,
			status: "BLOCKED",
			checks: [{ code: "duplicate", severity: "blocked" }],
			original: null,
		})
		await screen.findByTestId("check-duplicate")
		expect(
			screen.queryByRole("button", { name: "Discard this copy" }),
		).toBeNull()
	})
})
