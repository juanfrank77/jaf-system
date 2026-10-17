import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
	SerialRegister,
	type SerialRegisterRow,
	type SerialRegisterStats,
} from "./serial-register"

const stats: SerialRegisterStats = {
	inWarehouse: 18,
	onVans: 11,
	installed: 27,
	needsAttention: 3,
}

const row = (over: Partial<SerialRegisterRow>): SerialRegisterRow => ({
	serial: "4009642-A8812",
	serviceCodeId: "sc-1",
	claroCode: "4009642",
	material: "MODEM 788 ADSL/VDSL V3",
	status: "WAREHOUSE",
	condition: "NEW",
	vanName: null,
	since: "2026-08-29T12:00:00.000Z",
	lastMovement: { type: "RETURN", at: "2026-08-29T12:00:00.000Z" },
	...over,
})

const pageProps = {
	page: 1,
	pageCount: 1,
	total: 2,
	pageSize: 15,
	hrefFor: (p: number) => `?page=${p}`,
}

describe("SerialRegister", () => {
	it("lists one row per serial with its status and the headline counts", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<SerialRegister
							{...pageProps}
							stats={stats}
							rows={[
								row({}),
								row({
									serial: "4012210-C4471",
									status: "VAN",
									vanName: "J. Colón",
								}),
							]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("18")).toBeInTheDocument()
		expect(screen.getByTestId("serial-row-4009642-A8812")).toHaveTextContent(
			"In warehouse",
		)
		expect(screen.getByTestId("serial-row-4012210-C4471")).toHaveTextContent(
			"On van · J. Colón",
		)
	})

	it("links a unit awaiting triage to the Triage step, and gives stocked units no action", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<SerialRegister
							{...pageProps}
							stats={stats}
							rows={[
								row({ serial: "R-1", status: "RETURNED" }),
								row({ serial: "W-1", status: "WAREHOUSE" }),
							]}
						/>
					),
				},
			],
		})
		const link = screen.getByRole("link", { name: "Triage" })
		expect(link).toHaveAttribute("href", "/warehouse/triage")
		expect(screen.getAllByRole("link")).toHaveLength(1)
	})

	it("shows an empty state when there are no serials", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<SerialRegister {...pageProps} total={0} stats={stats} rows={[]} />
					),
				},
			],
		})
		expect(screen.getByText("No serials to show.")).toBeInTheDocument()
	})
})
