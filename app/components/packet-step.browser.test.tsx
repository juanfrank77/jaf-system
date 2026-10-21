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
	emailEnabled: true,
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
				Component: () => <PacketStepCard packet={data} interactive />,
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

describe("PacketStepCard work content", () => {
	it("does not repeat the materials already on the work order", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			packet({
				materials: [
					{
						serviceCodeId: "x1",
						claroCode: "",
						name: "Cable drop",
						unit: null,
						used: 1,
						returned: 0,
						source: "WAREHOUSE_ISSUE" as const,
					},
				],
			}),
			async () => null,
		)
		expect(await screen.findByTestId("packet-step")).toBeInTheDocument()
		expect(screen.queryByText("Cable drop")).not.toBeInTheDocument()
	})
})

describe("PacketStepCard with email off (manual only)", () => {
	const manual = (over: Partial<PacketStepData> = {}) =>
		packet({
			emailEnabled: false,
			canMarkManual: true,
			packetHref: "/files/packets/d1-work-order-1.pdf",
			...over,
		})

	it("shows PDF generated, a disabled coming-later send, the manual button and Back", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			manual(),
			vi.fn(async () => null),
		)
		expect(screen.getByText("PDF ✓ generated")).toBeVisible()
		expect(
			screen.getByRole("button", {
				name: "Send to Claro supervisor (coming later)",
			}),
		).toBeDisabled()
		expect(
			screen.getByRole("button", { name: "I sent the PDF to Claro →" }),
		).toBeEnabled()
		expect(
			screen.getByText("For now: email the PDF yourself, then mark it sent."),
		).toBeVisible()
		expect(screen.getByRole("link", { name: /Back/ })).toHaveAttribute(
			"href",
			expect.stringContaining("step=APPROVE"),
		)
		expect(screen.queryByRole("button", { name: "Resend" })).toBeNull()
	})

	it("the manual button posts mark_packet_sent, never send_packet", async ({
		renderStub,
	}) => {
		vi.spyOn(window, "confirm").mockReturnValue(true)
		const action = vi.fn(async () => null)
		await mount(renderStub, manual(), action)
		await userEvent.click(
			screen.getByRole("button", { name: "I sent the PDF to Claro →" }),
		)
		await waitFor(() => expect(action).toHaveBeenCalledWith("mark_packet_sent"))
		expect(action).not.toHaveBeenCalledWith("send_packet")
	})
})
