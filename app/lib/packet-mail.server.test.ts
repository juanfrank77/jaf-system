import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { sendMail, createTransport } = vi.hoisted(() => {
	const sendMail = vi.fn()
	return {
		sendMail,
		createTransport: vi.fn((_opts: unknown) => ({ sendMail })),
	}
})
vi.mock("nodemailer", () => ({ default: { createTransport } }))

import { sendPacketEmail, setMailTransport } from "./packet-mail.server"

const SMTP_KEYS = [
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASSWORD",
	"SMTP_FROM",
] as const
const saved: Record<string, string | undefined> = {}

const message = {
	to: "claro@example.test",
	subject: "Packet",
	text: "body",
	attachments: [{ filename: "p.pdf", content: Buffer.from("%PDF") }],
}

beforeEach(() => {
	for (const k of SMTP_KEYS) {
		saved[k] = process.env[k]
		delete process.env[k]
	}
	setMailTransport(null)
	sendMail.mockReset()
	createTransport.mockClear()
})
afterEach(() => {
	for (const k of SMTP_KEYS) {
		if (saved[k] === undefined) delete process.env[k]
		else process.env[k] = saved[k]
	}
	setMailTransport(null)
})

describe("sendPacketEmail", () => {
	it("is UNCONFIGURED with no transport and no SMTP settings", async () => {
		expect(await sendPacketEmail(message)).toEqual({ outcome: "UNCONFIGURED" })
		expect(createTransport).not.toHaveBeenCalled()
	})

	it("is UNCONFIGURED when only some SMTP settings are set", async () => {
		process.env.SMTP_HOST = "smtp.example.test"
		process.env.SMTP_PORT = "587"
		expect(await sendPacketEmail(message)).toEqual({ outcome: "UNCONFIGURED" })
	})

	it("sends through the injected transport with the attachment", async () => {
		const transport = vi.fn(async () => {})
		setMailTransport(transport)
		expect(await sendPacketEmail(message)).toEqual({ outcome: "SENT" })
		expect(transport).toHaveBeenCalledWith(message)
	})

	it("is FAILED with a redacted error when the transport throws", async () => {
		setMailTransport(async () => {
			throw new Error("535 auth failed password=hunter2 for user")
		})
		const r = await sendPacketEmail(message)
		expect(r.outcome).toBe("FAILED")
		expect(r.error).toContain("[redacted]")
		expect(r.error).not.toContain("hunter2")
	})

	it("redacts the configured SMTP password wherever it appears", async () => {
		process.env.SMTP_PASSWORD = "Zq9-unusual"
		setMailTransport(async () => {
			throw new Error("server echoed Zq9-unusual back")
		})
		const r = await sendPacketEmail(message)
		expect(r.outcome).toBe("FAILED")
		expect(r.error).toBe("server echoed [redacted] back")
	})

	it("uses SMTP from the SMTP_* settings when all are set", async () => {
		process.env.SMTP_HOST = "smtp.example.test"
		process.env.SMTP_PORT = "587"
		process.env.SMTP_USER = "packets@example.test"
		process.env.SMTP_PASSWORD = "s3cret"
		process.env.SMTP_FROM = "IMS <packets@example.test>"
		sendMail.mockResolvedValue({})
		expect(await sendPacketEmail(message)).toEqual({ outcome: "SENT" })
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({
				host: "smtp.example.test",
				port: 587,
				auth: { user: "packets@example.test", pass: "s3cret" },
			}),
		)
		expect(sendMail).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "IMS <packets@example.test>",
				to: "claro@example.test",
				subject: "Packet",
				attachments: message.attachments,
			}),
		)
	})

	it("is FAILED when SMTP rejects, without echoing the password", async () => {
		process.env.SMTP_HOST = "smtp.example.test"
		process.env.SMTP_PORT = "465"
		process.env.SMTP_USER = "u"
		process.env.SMTP_PASSWORD = "s3cret"
		process.env.SMTP_FROM = "f@example.test"
		sendMail.mockRejectedValue(new Error("Invalid login: password: s3cret"))
		const r = await sendPacketEmail(message)
		expect(r.outcome).toBe("FAILED")
		expect(r.error).not.toContain("s3cret")
		expect(createTransport).toHaveBeenCalledWith(
			expect.objectContaining({ port: 465, secure: true }),
		)
	})
})
