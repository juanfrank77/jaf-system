import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { AddFieldService, RemoveAddedService } from "./add-field-service"

const retensar = {
	id: "svc-ret",
	claroCode: "34006300",
	name: "RETENSAR MENSAJERO MO",
	accountCode: "610",
	unit: "EA",
}

type Posted = Record<string, string>

function mount(
	renderStub: any,
	ui: React.ReactElement,
	reply: (posted: Posted) => unknown = () => ({ ok: true }),
) {
	const posts: Posted[] = []
	const searches: string[] = []
	const done = renderStub({
		entries: [
			{
				path: "/",
				Component: () => ui,
				action: async ({ request }: { request: Request }) => {
					const posted = Object.fromEntries(await request.formData()) as Posted
					posts.push(posted)
					return reply(posted)
				},
			},
			{
				path: "/api/service-codes",
				loader: ({ request }: { request: Request }) => {
					searches.push(new URL(request.url).searchParams.get("q") ?? "")
					// As the API answers a price-blind role: no unitPrice.
					return { results: [retensar], total: 1 }
				},
			},
		],
	})
	return { done, posts, searches }
}

describe("AddFieldService", () => {
	it("searches the catalog, takes the installed qty in a decimal box and posts add_service", async ({
		renderStub,
	}) => {
		const { done, posts, searches } = mount(renderStub, <AddFieldService />)
		await done
		await userEvent.click(screen.getByRole("button", { name: "+ Add service" }))
		await userEvent.type(screen.getByRole("searchbox"), "34006300")
		await userEvent.click(
			await screen.findByRole("button", { name: /RETENSAR MENSAJERO/ }),
		)
		expect(searches.at(-1)).toBe("34006300")

		const panel = screen.getByTestId("add-field-service")
		expect(within(panel).getByText("RETENSAR MENSAJERO MO")).toBeInTheDocument()
		expect(panel.textContent).not.toContain("$")
		const qty = within(panel).getByRole("spinbutton", {
			name: "Installed 34006300",
		})
		expect(qty).toHaveValue(1)
		await userEvent.clear(qty)
		await userEvent.type(qty, "2.5")
		expect(qty).toHaveValue(2.5)

		await userEvent.click(within(panel).getByRole("button", { name: "Add" }))
		await waitFor(() =>
			expect(posts).toEqual([
				{ intent: "add_service", serviceCodeId: "svc-ret", qty: "2.5" },
			]),
		)
		// Accepted: the panel closes; the page reloads with the new row.
		await waitFor(() =>
			expect(screen.queryByTestId("add-field-service")).toBeNull(),
		)
		expect(
			screen.getByRole("button", { name: "+ Add service" }),
		).toBeInTheDocument()
	})

	it("Enter in the qty box adds the service and never submits the Field form around it", async ({
		renderStub,
	}) => {
		const submitted: string[] = []
		const { done, posts } = mount(
			renderStub,
			<form
				onSubmit={(e) => {
					e.preventDefault()
					submitted.push("field-form")
				}}
			>
				<AddFieldService />
				<button type="submit">Save progress</button>
			</form>,
		)
		await done
		await userEvent.click(screen.getByRole("button", { name: "+ Add service" }))
		await userEvent.type(screen.getByRole("searchbox"), "RETENSAR")
		await userEvent.click(
			await screen.findByRole("button", { name: /RETENSAR MENSAJERO/ }),
		)
		const qty = screen.getByRole("spinbutton", { name: "Installed 34006300" })
		await userEvent.clear(qty)
		await userEvent.type(qty, "0.5{Enter}")
		await waitFor(() =>
			expect(posts).toEqual([
				{ intent: "add_service", serviceCodeId: "svc-ret", qty: "0.5" },
			]),
		)
		expect(submitted).toEqual([])
	})

	it("refuses an empty or zero qty without posting", async ({ renderStub }) => {
		const { done, posts } = mount(renderStub, <AddFieldService />)
		await done
		await userEvent.click(screen.getByRole("button", { name: "+ Add service" }))
		await userEvent.type(screen.getByRole("searchbox"), "RETENSAR")
		await userEvent.click(
			await screen.findByRole("button", { name: /RETENSAR MENSAJERO/ }),
		)
		const qty = screen.getByRole("spinbutton", { name: "Installed 34006300" })
		const add = screen.getByRole("button", { name: "Add" })
		await userEvent.clear(qty)
		expect(add).toBeDisabled()
		await userEvent.type(qty, "0")
		expect(add).toBeDisabled()
		await userEvent.type(qty, "{Enter}")
		expect(posts).toEqual([])
	})

	it("keeps the panel open with the reason when the server refuses", async ({
		renderStub,
	}) => {
		const { done } = mount(renderStub, <AddFieldService />, () => ({
			errorKey: "docs_field.errors.service_on_order",
		}))
		await done
		await userEvent.click(screen.getByRole("button", { name: "+ Add service" }))
		await userEvent.type(screen.getByRole("searchbox"), "RETENSAR")
		await userEvent.click(
			await screen.findByRole("button", { name: /RETENSAR MENSAJERO/ }),
		)
		await userEvent.click(screen.getByRole("button", { name: "Add" }))
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"That service is already on the order.",
		)
		expect(screen.getByTestId("add-field-service")).toBeInTheDocument()
	})

	it("Add stays disabled until a service is picked; Cancel closes", async ({
		renderStub,
	}) => {
		const { done, posts } = mount(renderStub, <AddFieldService />)
		await done
		await userEvent.click(screen.getByRole("button", { name: "+ Add service" }))
		expect(screen.getByRole("button", { name: "Add" })).toBeDisabled()
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }))
		expect(screen.queryByTestId("add-field-service")).toBeNull()
		expect(posts).toEqual([])
	})

	it("in Spanish", async ({ renderStub }) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <AddFieldService /> }],
			i18n: { lng: "es" },
		})
		expect(
			screen.getByRole("button", { name: "+ Añadir servicio" }),
		).toBeInTheDocument()
	})
})

describe("RemoveAddedService", () => {
	it("posts remove_added_service for its line", async ({ renderStub }) => {
		const { done, posts } = mount(
			renderStub,
			<RemoveAddedService serviceCodeId="svc-ret" claroCode="34006300" />,
		)
		await done
		await userEvent.click(
			screen.getByRole("button", { name: "Remove 34006300" }),
		)
		await waitFor(() =>
			expect(posts).toEqual([
				{ intent: "remove_added_service", serviceCodeId: "svc-ret" },
			]),
		)
	})
})
