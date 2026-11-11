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
	},
	claroSupervisorId: "claro-1",
	claroOptions: [],
	prefieldNeeded: false,
	blockers: [],
	packetHref: null,
	files: [],
	zipHref: null,
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
			screen.getByRole("button", { name: "Send to Ramón Claro" }),
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
			name: "Send to Ramón Claro",
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
				screen.getByRole("button", { name: "Send to Ramón Claro" }),
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
			screen.getByRole("button", { name: "Send to Ramón Claro" }),
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
			screen.getByRole("button", { name: "Send to Ramón Claro" }),
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

	it("shows PDF generated, no send button, the manual button and Back", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			manual(),
			vi.fn(async () => null),
		)
		expect(screen.getByText("Package ✓ generated")).toBeVisible()
		// Nothing greyed-out to puzzle over while emailing is off.
		expect(screen.queryByRole("button", { name: /Send to/ })).toBeNull()
		expect(
			screen.getByRole("button", { name: "I sent the package to Claro →" }),
		).toBeEnabled()
		expect(
			screen.getByText(
				"For now: email the files yourself, then mark the package sent.",
			),
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
			screen.getByRole("button", { name: "I sent the package to Claro →" }),
		)
		await waitFor(() => expect(action).toHaveBeenCalledWith("mark_packet_sent"))
		expect(action).not.toHaveBeenCalledWith("send_packet")
	})
})

describe("PacketStepCard package files", () => {
	const FILES: PacketStepData["files"] = [
		{
			key: "work_order_pdf",
			name: "d1-work-order-1.pdf",
			fileName: "JAF work order MAINT-1.pdf",
			href: "/files/packets/d1-work-order-1.pdf",
		},
		{
			key: "prefield_pdf",
			name: "d1-prefield-2.pdf",
			fileName: "Prefield MAINT-1.pdf",
			href: "/files/packets/d1-prefield-2.pdf",
		},
		{
			key: "photo",
			name: "before.jpg",
			fileName: "Photo 1 - before.jpg",
			href: "/files/photos/d1/before.jpg",
		},
		{
			key: "blueprint",
			name: "plano 1.pdf",
			fileName: "Blueprint 1.pdf",
			href: "/files/blueprints/d1/plano%201.pdf",
		},
	]

	it("lists one download per file and Download all and a small zip link", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			packet({ files: FILES, zipHref: "/docs/d1/package" }),
			vi.fn(),
		)
		for (const f of FILES)
			expect(
				screen.getByRole("link", { name: `Download ${f.fileName}` }),
			).toHaveAttribute("href", f.href)
		expect(screen.getByText("Claro Prefield (PDF)")).toBeVisible()
		expect(screen.getByRole("link", { name: /Download all/ })).toHaveAttribute(
			"href",
			"/docs/d1/package",
		)
		expect(
			screen.getByRole("link", { name: "Download as zip" }),
		).toHaveAttribute("href", "/docs/d1/package?format=zip")
	})

	it("the eye button opens a photo in a pop-up, and a PDF in a frame, without downloading", async ({
		renderStub,
	}) => {
		await mount(renderStub, packet({ files: FILES }), vi.fn())
		await userEvent.click(
			screen.getByRole("button", { name: "View Photo 1 - before.jpg" }),
		)
		const photo = await screen.findByRole("img", {
			name: "Photo 1 - before.jpg",
		})
		expect(photo).toHaveAttribute("src", "/files/photos/d1/before.jpg")
		expect(screen.getByRole("link", { name: "Open in new tab" })).toBeVisible()
		await userEvent.click(screen.getByRole("button", { name: "Close" }))
		await userEvent.click(
			screen.getByRole("button", { name: "View Blueprint 1.pdf" }),
		)
		expect(await screen.findByTitle("Blueprint 1.pdf")).toHaveAttribute(
			"src",
			"/files/blueprints/d1/plano%201.pdf",
		)
	})

	it("has no Prefield inputs: the boxes are Claro's", async ({
		renderStub,
	}) => {
		await mount(renderStub, packet({ files: FILES }), vi.fn())
		for (const name of ["ordenNumber", "pedido", "smr", "titulo"])
			expect(document.querySelector(`[name="${name}"]`)).toBeNull()
		expect(screen.getByLabelText("Claro supervisor")).toBeVisible()
	})

	it.for([
		["prefield_pdf", true],
		["stale", true],
		["blueprint", true],
		[null, false],
	] as const)(
		"with email off, blocker %s → I sent the package to Claro disabled: %s",
		async ([blocker, disabled], { renderStub }) => {
			await mount(
				renderStub,
				packet({
					emailEnabled: false,
					canMarkManual: true,
					packetHref: "/files/packets/d1-work-order-1.pdf",
					files: FILES,
					blockers: blocker ? [blocker] : [],
				}),
				vi.fn(),
			)
			const button = screen.getByRole("button", {
				name: "I sent the package to Claro →",
			})
			if (disabled) expect(button).toBeDisabled()
			else expect(button).toBeEnabled()
		},
	)
})

describe("PacketStepCard Claro supervisor search", () => {
	const options = [
		{ id: "c1", name: "Hector D Hoyos", email: "hector.dehoyos@claropr.com" },
		{ id: "c2", name: "Ramón Claro", email: "ramon.now@claro.example" },
	]

	it("typing part of a name lists the match, and picking it is what Save posts", async ({
		renderStub,
	}) => {
		const action = vi.fn(async () => null)
		await mount(
			renderStub,
			packet({
				claroSupervisorId: null,
				claroSupervisor: null,
				claroOptions: options,
			}),
			action,
		)
		await userEvent.type(screen.getByRole("searchbox"), "hoy")
		expect(screen.queryByRole("button", { name: /Ramón Claro/ })).toBeNull()
		await userEvent.click(
			screen.getByRole("button", { name: /Hector D Hoyos/ }),
		)
		expect(
			(
				document.querySelector(
					'input[name="claroSupervisorId"]',
				) as HTMLInputElement
			).value,
		).toBe("c1")
	})

	it("searches by email too", async ({ renderStub }) => {
		await mount(
			renderStub,
			packet({
				claroSupervisorId: null,
				claroSupervisor: null,
				claroOptions: options,
			}),
			vi.fn(async () => null),
		)
		await userEvent.type(screen.getByRole("searchbox"), "claropr")
		expect(
			screen.getByRole("button", { name: /Hector D Hoyos/ }),
		).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /Ramón Claro/ })).toBeNull()
	})
})
