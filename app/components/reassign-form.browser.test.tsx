import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { ReassignForm } from "./reassign-form"

const options = [
	{ id: "b1", name: "ALEXIS DIAZ", area: "CENTRAL", code: "206" },
	{ id: "b2", name: "DINO CASTILLO", area: "CENTRAL", code: "209" },
	{ id: "b3", name: "JESUS MARTINEZ", area: "CENTRAL", code: "204" },
	{ id: "b4", name: "ZARIEL SIERRA", area: "CENTRAL", code: "274" },
]
const shared = [
	{ id: "b3", name: "JESUS MARTINEZ", lead: true },
	{ id: "b1", name: "ALEXIS DIAZ", lead: false },
]
const four = [
	{ id: "b1", name: "ALEXIS DIAZ", lead: true },
	{ id: "b2", name: "DINO CASTILLO", lead: false },
	{ id: "b3", name: "JESUS MARTINEZ", lead: false },
	{ id: "b4", name: "ZARIEL SIERRA", lead: false },
]
const single = [{ id: "b1", name: "ALEXIS DIAZ", lead: true }]

type Posted = { intent: string | null; brigadeId: string | null }

// Same loose typing the other component tests use for the stub fixture.
const mount = (
	renderStub: any,
	assigned: typeof shared,
	posts: Posted[] = [],
	leadLocked = false,
) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<ReassignForm
						brigadeOptions={options}
						assignedBrigades={assigned}
						leadLocked={leadLocked}
					/>
				),
				action: async ({ request }: { request: Request }) => {
					const f = await request.formData()
					posts.push({
						intent: f.get("intent") as string | null,
						brigadeId: f.get("brigadeId") as string | null,
					})
					return null
				},
			},
		],
	})

async function choose(name: string) {
	await userEvent.click(screen.getByRole("combobox"))
	await userEvent.click(
		await screen.findByRole("option", { name: new RegExp(name) }),
	)
}
const start = () =>
	userEvent.click(screen.getByRole("button", { name: "Reassign" }))

describe("ReassignForm", () => {
	it("a single-crew job reassigns in one click, with no confirmation", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, single, posts)
		await choose("JESUS MARTINEZ")
		await start()
		expect(screen.queryByTestId("reassign-confirm")).toBeNull()
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "reassign", brigadeId: "b3" }]),
		)
	})

	it("a brigade not on the job can only replace, with the reworded warning", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, shared, posts)
		await choose("DINO CASTILLO")
		await start()
		const box = screen.getByTestId("reassign-confirm")
		expect(box).toHaveTextContent(
			"This job is shared by 2 crews (lead: JESUS MARTINEZ). Reassigning to DINO CASTILLO will remove JESUS MARTINEZ and ALEXIS DIAZ and make DINO CASTILLO the only payee.",
		)
		expect(box).not.toHaveTextContent("the other")
		expect(screen.queryByRole("button", { name: "Change lead" })).toBeNull()
		expect(posts).toEqual([])
		await userEvent.click(screen.getByRole("button", { name: "Reassign" }))
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "reassign", brigadeId: "b2" }]),
		)
	})

	it("a brigade already on the job offers Change lead (keeps every crew) and Replace all crews", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, four, posts)
		await choose("DINO CASTILLO")
		await start()
		const box = screen.getByTestId("reassign-confirm")
		expect(box).toHaveTextContent(
			"will remove ALEXIS DIAZ, JESUS MARTINEZ, and ZARIEL SIERRA and make DINO CASTILLO the only payee",
		)
		expect(box).toHaveTextContent(
			"keep all 4 crews and only make DINO CASTILLO the lead and payee",
		)
		await userEvent.click(screen.getByRole("button", { name: "Change lead" }))
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "change_lead", brigadeId: "b2" }]),
		)
	})

	it("Replace all crews posts the replace intent", async ({ renderStub }) => {
		const posts: Posted[] = []
		await mount(renderStub, four, posts)
		await choose("DINO CASTILLO")
		await start()
		await userEvent.click(
			screen.getByRole("button", { name: "Replace all crews" }),
		)
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "reassign", brigadeId: "b2" }]),
		)
	})

	it("hides Change lead once the payee is fixed", async ({ renderStub }) => {
		await mount(renderStub, four, [], true)
		await choose("DINO CASTILLO")
		await start()
		expect(screen.queryByRole("button", { name: "Change lead" })).toBeNull()
		expect(screen.getByRole("button", { name: "Reassign" })).toBeInTheDocument()
	})

	it("Cancel closes the confirmation without submitting", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, shared, posts)
		await choose("DINO CASTILLO")
		await start()
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(screen.queryByTestId("reassign-confirm")).toBeNull()
		expect(posts).toEqual([])
	})

	it("marks the current (lead) brigade in the list and explains the history rule", async ({
		renderStub,
	}) => {
		await mount(renderStub, shared)
		expect(
			screen.getByText(
				"Allowed until the work order is cancelled or closed. Every reassignment is written to the crew history.",
			),
		).toBeInTheDocument()
		await userEvent.click(screen.getByRole("combobox"))
		expect(
			await screen.findByRole("option", {
				name: "JESUS MARTINEZ · 204 (CENTRAL) (current)",
			}),
		).toBeInTheDocument()
		expect(
			screen.getByRole("option", { name: "DINO CASTILLO · 209 (CENTRAL)" }),
		).toBeInTheDocument()
	})
})
