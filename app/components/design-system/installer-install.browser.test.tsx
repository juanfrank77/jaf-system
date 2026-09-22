import { screen, waitFor } from "@testing-library/react"
import { useActionData } from "react-router"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
	clickWhenReady,
	fillWhenReady,
} from "../../../tests/browser-test-utils"
import { InstallerInstallV2 } from "./installer-install"

const serviceCodes = [
	{ id: "sc-1", claroCode: "111", name: "Cable drop" },
	{ id: "sc-2", claroCode: null, name: "Custom bracket" },
]

const comparison = [
	{
		serviceCodeId: "sc-1",
		claroCode: "111",
		name: "Cable drop",
		onHand: 6,
		standard: 5,
		delta: 1,
	},
]

describe("InstallerInstallV2 wizard", () => {
	it("persists values across steps and submits all stored fields", async ({
		renderStub,
	}) => {
		let posted: Record<string, string | null> | null = null

		await renderStub({
			entries: [
				{
					path: "/",
					action: async ({ request }) => {
						const form = await request.formData()
						posted = {
							claroJobReference: form.get("claroJobReference") as string | null,
							serviceType: form.get("serviceType") as string | null,
							date: form.get("date") as string | null,
							items: form.get("items") as string | null,
							notes: form.get("notes") as string | null,
						}
						return null
					},
					Component: () => (
						<InstallerInstallV2
							serviceCodes={serviceCodes}
							comparison={comparison}
							errorKey={null}
						/>
					),
				},
			],
		})

		await userEvent.fill(
			screen.getByLabelText(/Claro Job Reference/i),
			"87654321",
		)
		await userEvent.selectOptions(
			screen.getByLabelText(/Service Type/i),
			"WIFI",
		)
		await userEvent.fill(screen.getByLabelText(/^Date$/i), "2026-08-13")

		await clickWhenReady(() => screen.getByRole("button", { name: /^Next$/i }))

		await waitFor(() => {
			expect(screen.getByLabelText(/Select material/i)).toBeInTheDocument()
		})
		await userEvent.selectOptions(
			screen.getByLabelText(/Select material/i),
			"sc-1",
		)
		await userEvent.fill(screen.getByLabelText(/Qty used for Cable drop/i), "2")

		await clickWhenReady(() => screen.getByRole("button", { name: /^Next$/i }))

		await waitFor(() => {
			expect(screen.getByLabelText(/^Notes$/i)).toBeInTheDocument()
		})
		await fillWhenReady(
			() => screen.getByLabelText(/^Notes$/i),
			"Completed at curb box",
		)

		expect(
			screen.getByText(
				/Serial number, form photo and signature capture aren't available yet/i,
			),
		).toBeInTheDocument()

		const submit = screen.getByRole("button", { name: /Log Install/i })
		await waitFor(() => {
			expect(submit).toBeEnabled()
		})

		await userEvent.click(submit)

		await waitFor(() => {
			expect(posted).toEqual({
				claroJobReference: "87654321",
				serviceType: "WIFI",
				date: "2026-08-13",
				items: JSON.stringify([{ serviceCodeId: "sc-1", qty: 2 }]),
				notes: "Completed at curb box",
			})
		})
	})

	it("gates Next per step", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<InstallerInstallV2
							serviceCodes={serviceCodes}
							comparison={comparison}
							errorKey={null}
						/>
					),
				},
			],
		})

		const next = screen.getByRole("button", { name: /^Next$/i })
		expect(next).toBeDisabled()

		await userEvent.fill(
			screen.getByLabelText(/Claro Job Reference/i),
			"12345678",
		)
		expect(next).toBeDisabled()

		await userEvent.selectOptions(
			screen.getByLabelText(/Service Type/i),
			"WIFI",
		)
		await userEvent.fill(screen.getByLabelText(/^Date$/i), "2026-08-13")

		await waitFor(() => {
			expect(next).toBeEnabled()
		})

		await clickWhenReady(() => next)

		const materialsNext = screen.getByRole("button", { name: /^Next$/i })
		expect(materialsNext).toBeDisabled()

		await userEvent.selectOptions(
			screen.getByLabelText(/Select material/i),
			"sc-1",
		)

		await waitFor(() => {
			expect(materialsNext).toBeEnabled()
		})
	})

	it("updates the submit gate note live on the Submit step", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<InstallerInstallV2
							serviceCodes={serviceCodes}
							comparison={comparison}
							errorKey={null}
						/>
					),
				},
			],
		})

		await userEvent.click(screen.getByRole("button", { name: /^Submit$/i }))

		expect(
			screen.getByText(/Missing: Claro job reference, service type/i),
		).toBeInTheDocument()

		await userEvent.click(screen.getByRole("button", { name: /^Info$/i }))
		await userEvent.fill(
			screen.getByLabelText(/Claro Job Reference/i),
			"12345678",
		)
		await userEvent.selectOptions(
			screen.getByLabelText(/Service Type/i),
			"WIFI",
		)
		await userEvent.fill(screen.getByLabelText(/^Date$/i), "2026-08-13")

		await userEvent.click(screen.getByRole("button", { name: /^Submit$/i }))

		await waitFor(() => {
			expect(
				screen.getByText(/Missing: at least one material/i),
			).toBeInTheDocument()
		})
	})

	it("re-enables submit after the server returns an error", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					action: async () => {
						await new Promise((resolve) => setTimeout(resolve, 200))
						return { errorKey: "installer_install.errors.missing_fields" }
					},
					Component: () => {
						const actionData = useActionData() as { errorKey?: string } | null
						return (
							<InstallerInstallV2
								serviceCodes={serviceCodes}
								comparison={comparison}
								errorKey={actionData?.errorKey ?? null}
							/>
						)
					},
				},
			],
		})

		await userEvent.fill(
			screen.getByLabelText(/Claro Job Reference/i),
			"12345678",
		)
		await userEvent.selectOptions(
			screen.getByLabelText(/Service Type/i),
			"WIFI",
		)
		await userEvent.fill(screen.getByLabelText(/^Date$/i), "2026-08-13")
		await clickWhenReady(() => screen.getByRole("button", { name: /^Next$/i }))
		await waitFor(() => {
			expect(screen.getByLabelText(/Select material/i)).toBeInTheDocument()
		})
		await userEvent.selectOptions(
			screen.getByLabelText(/Select material/i),
			"sc-1",
		)
		await clickWhenReady(() => screen.getByRole("button", { name: /^Next$/i }))

		const submit = screen.getByRole("button", { name: /Log Install/i })
		await waitFor(() => {
			expect(submit).toBeEnabled()
		})

		await clickWhenReady(() => submit)

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Sending/i })).toBeDisabled()
		})

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Log Install/i })).toBeEnabled()
		})
	})
})
