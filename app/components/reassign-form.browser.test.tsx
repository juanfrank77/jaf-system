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
	{ id: "b3", name: "JESUS MARTINEZ" },
	{ id: "b1", name: "ALEXIS DIAZ" },
]
const four = [
	{ id: "b1", name: "ALEXIS DIAZ" },
	{ id: "b2", name: "DINO CASTILLO" },
	{ id: "b3", name: "JESUS MARTINEZ" },
	{ id: "b4", name: "ZARIEL SIERRA" },
]
const single = [{ id: "b1", name: "ALEXIS DIAZ" }]

type Posted = { intent: string | null; brigadeId: string | null }

// Same loose typing the other component tests use for the stub fixture.
const mount = (
	renderStub: any,
	assigned: typeof shared,
	posts: Posted[] = [],
) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<ReassignForm brigadeOptions={options} assignedBrigades={assigned} />
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

	it("a shared job warns that the brigade replaces every crew", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, shared, posts)
		await choose("DINO CASTILLO")
		await start()
		const box = screen.getByTestId("reassign-confirm")
		expect(box).toHaveTextContent(
			"This job has 2 crews. Reassigning to DINO CASTILLO will remove JESUS MARTINEZ and ALEXIS DIAZ and make DINO CASTILLO the only crew on this job.",
		)
		expect(box).not.toHaveTextContent("the other")
		expect(posts).toEqual([])
		await userEvent.click(screen.getByRole("button", { name: "Reassign" }))
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "reassign", brigadeId: "b2" }]),
		)
	})

	it("a brigade already on the job replaces the others too", async ({
		renderStub,
	}) => {
		const posts: Posted[] = []
		await mount(renderStub, four, posts)
		await choose("DINO CASTILLO")
		await start()
		await userEvent.click(screen.getByRole("button", { name: "Reassign" }))
		await waitFor(() =>
			expect(posts).toEqual([{ intent: "reassign", brigadeId: "b2" }]),
		)
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
				"Allowed until the crew reports from the field. Every reassignment is written to the crew history.",
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
