import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DocStageBadge } from "./doc-stage-badge"
import { ReturnedBanner } from "./returned-banner"

const mount = (renderStub: any, ui: React.ReactElement, lng?: "en" | "es") =>
	renderStub({
		entries: [{ path: "/", Component: () => ui }],
		i18n: lng ? { lng } : undefined,
	})

const returned = {
	note: "Aviso 10359868 lists 3 poles;\nthe work order says 2.",
	byName: "Lissette",
	createdAt: "2026-10-26T14:05:00.000Z",
}

describe("ReturnedBanner", () => {
	it("says who returned it and when, shows her note word for word and opens the step to fix", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<ReturnedBanner
				returned={returned}
				fixHref="/docs/d1/review?step=RELEASE"
			/>,
		)
		const banner = screen.getByTestId("returned-banner")
		const when = new Date(returned.createdAt).toLocaleString(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		})
		expect(banner).toHaveTextContent(`Returned by Lissette on ${when}`)
		expect(
			screen.getByText(
				/Aviso 10359868 lists 3 poles;\s+the work order says 2\./,
			),
		).toBeVisible()
		expect(
			screen.getByRole("link", { name: "Fix and send back to Finance" }),
		).toHaveAttribute("href", "/docs/d1/review?step=RELEASE")
		// The red banner: the danger tone, never a raw palette colour.
		expect(banner.querySelector("[data-slot=pill]")?.className).toMatch(
			/bg-status-danger-soft/,
		)
	})

	it("has no button on the step that fixes it, and reads in Spanish", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<ReturnedBanner
				returned={{ ...returned, byName: null }}
				fixHref={null}
			/>,
			"es",
		)
		expect(screen.getByTestId("returned-banner")).toHaveTextContent(
			/Devuelto por Finanzas el/,
		)
		expect(screen.queryByRole("link")).toBeNull()
	})
})

describe("DocStageBadge: Returned", () => {
	it("is a red Returned chip, never Release or Released to Finance", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<DocStageBadge stage="RELEASE" openLabel="RETURNED" />,
		)
		const chip = screen.getByText("Returned")
		expect(chip).toHaveAttribute("data-variant", "danger")
		expect(screen.queryByText("Release")).toBeNull()
		expect(screen.queryByText("Released to Finance")).toBeNull()
	})

	it("reads Devuelto in Spanish", async ({ renderStub }) => {
		await mount(
			renderStub,
			<DocStageBadge stage="RELEASE" openLabel="RETURNED" />,
			"es",
		)
		expect(screen.getByText("Devuelto")).toHaveAttribute(
			"data-variant",
			"danger",
		)
	})
})
