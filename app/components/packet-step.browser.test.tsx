import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { PacketStepCard, type PacketStepData } from "./packet-step"

const packet = (over: Partial<PacketStepData> = {}): PacketStepData => ({
	sent: false,
	sentAt: null,
	claroSupervisor: {
		name: "Ramón Claro",
		email: "ramon.now@claro.example",
		requiresPrefield: false,
	},
	claroSupervisorId: "claro-1",
	claroOptions: [],
	showPrefield: false,
	prefield: {
		avisoNumber: null,
		ordenNumber: null,
		pedido: null,
		smr: null,
		titulo: null,
		description: null,
	},
	prefieldMissing: [],
	blockers: [],
	packetHref: null,
	blueprints: [],
	materials: [],
	history: [],
	canMarkManual: false,
	...over,
})

async function mount(
	renderStub: any,
	data: PacketStepData,
	action: (intent: string) => Promise<unknown>,
) {
	await renderStub({
		entries: [
			{
				path: "/",
				action: async ({ request }: { request: Request }) =>
					action(String((await request.formData()).get("intent"))),
				Component: () => (
					<PacketStepCard packet={data} interactive workSummary={null} />
				),
			},
		],
	})
}

describe("PacketStepCard send button", () => {
	it("asks first, naming the Claro supervisor's current email, and sends nothing on cancel", async ({
		renderStub,
	}) => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		const action = vi.fn(async () => null)
		await mount(renderStub, packet(), action)
		await userEvent.click(
			screen.getByRole("button", { name: "Send to Claro supervisor" }),
		)
		expect(confirm).toHaveBeenCalledWith(
			"Email the packet to ramon.now@claro.example?",
		)
		expect(action).not.toHaveBeenCalled()
	})

	it("disables while the send is in flight, so a double click sends once", async ({
		renderStub,
	}) => {
		vi.spyOn(window, "confirm").mockReturnValue(true)
		let release: () => void = () => {}
		const action = vi.fn(
			() => new Promise((resolve) => (release = () => resolve(null))),
		)
		await mount(renderStub, packet(), action)
		const button = screen.getByRole("button", {
			name: "Send to Claro supervisor",
		})
		await userEvent.dblClick(button)
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled(),
		)
		await userEvent.click(screen.getByRole("button", { name: "Sending…" }), {
			force: true,
		})
		release()
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Send to Claro supervisor" }),
			).toBeEnabled(),
		)
		expect(action).toHaveBeenCalledTimes(1)
		expect(action).toHaveBeenCalledWith("send_packet")
	})

	it("Resend after the first send confirms against the current address", async ({
		renderStub,
	}) => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
		const action = vi.fn(async () => null)
		await mount(
			renderStub,
			packet({ sent: true, sentAt: "2026-10-18T15:00:00.000Z" }),
			action,
		)
		await userEvent.click(screen.getByRole("button", { name: "Resend" }))
		expect(confirm.mock.calls[0][0]).toContain("ramon.now@claro.example")
		await waitFor(() => expect(action).toHaveBeenCalledWith("send_packet"))
	})

	it("Mark as sent manually posts the manual intent after an UNCONFIGURED attempt", async ({
		renderStub,
	}) => {
		vi.spyOn(window, "confirm").mockReturnValue(true)
		const action = vi.fn(async () => null)
		await mount(
			renderStub,
			packet({
				canMarkManual: true,
				packetHref: "/files/packets/d1-packet-1-ab.pdf",
				history: [
					{
						id: "p1",
						sentAt: "2026-10-18T14:00:00.000Z",
						sentBy: "Edgard Ocasio",
						recipientEmail: "ramon.now@claro.example",
						outcome: "UNCONFIGURED",
						error: null,
					},
				],
			}),
			action,
		)
		expect(
			screen.getByRole("link", { name: "Download packet" }),
		).toHaveAttribute("href", "/files/packets/d1-packet-1-ab.pdf")
		await userEvent.click(
			screen.getByRole("button", { name: "Mark as sent manually" }),
		)
		await waitFor(() => expect(action).toHaveBeenCalledWith("mark_packet_sent"))
	})

	it("Mark as sent manually is disabled while a send is in flight", async ({
		renderStub,
	}) => {
		vi.spyOn(window, "confirm").mockReturnValue(true)
		let release: () => void = () => {}
		const action = vi.fn(
			() => new Promise((resolve) => (release = () => resolve(null))),
		)
		await mount(renderStub, packet({ canMarkManual: true }), action)
		await userEvent.click(
			screen.getByRole("button", { name: "Send to Claro supervisor" }),
		)
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Mark as sent manually" }),
			).toBeDisabled(),
		)
		await userEvent.click(
			screen.getByRole("button", { name: "Mark as sent manually" }),
			{ force: true },
		)
		release()
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "Mark as sent manually" }),
			).toBeEnabled(),
		)
		expect(action).toHaveBeenCalledTimes(1)
		expect(action).toHaveBeenCalledWith("send_packet")
	})

	it("cannot be pressed while a blocker stands", async ({ renderStub }) => {
		await mount(renderStub, packet({ blockers: ["blueprint"] }), vi.fn())
		expect(
			screen.getByRole("button", { name: "Send to Claro supervisor" }),
		).toBeDisabled()
	})
})

describe("PacketStepCard materials", () => {
	it("renders every row, even two uncatalogued codes with no Claro code", async ({
		renderStub,
	}) => {
		const row = (serviceCodeId: string) => ({
			serviceCodeId,
			claroCode: "",
			name: serviceCodeId,
			unit: null,
			used: 1,
			returned: 0,
			source: "WAREHOUSE_ISSUE" as const,
		})
		await mount(
			renderStub,
			packet({ materials: [row("x1"), row("x2")] }),
			async () => null,
		)
		expect(await screen.findByText("x1")).toBeInTheDocument()
		expect(screen.getByText("x2")).toBeInTheDocument()
	})
})
