import nodemailer from "nodemailer"

/**
 * Outbound mail for the Claro packet (spec "Step 5 · Packet → Claro"). Unlike
 * `email.server.ts` (internal, best effort, audit only), this one carries an
 * attachment and reports what happened so the send log can record it.
 * Credentials and message bodies are never logged.
 */
type PacketMail = {
	to: string
	subject: string
	text: string
	attachments: { filename: string; content: Buffer }[]
}

export type MailTransport = (m: PacketMail) => Promise<void>

type MailResult = {
	outcome: "SENT" | "FAILED" | "UNCONFIGURED"
	error?: string
}

let injected: MailTransport | null = null

/** Tests (and any future non-SMTP delivery) inject a transport; null clears it. */
export function setMailTransport(t: MailTransport | null): void {
	injected = t
}

/** Same redaction rules as `email.server.ts`, plus the configured password. */
function sanitizedError(error: unknown): string {
	let message = error instanceof Error ? error.message : String(error)
	const password = process.env.SMTP_PASSWORD
	if (password) message = message.split(password).join("[redacted]")
	return message
		.replace(
			/authorization:\s*Bearer\s+\S+|(?:password|secret|token|api_key|authorization)[\s:=]+[^\s,;]*/gi,
			"[redacted]",
		)
		.replace(/"(?:password|secret)":"[^"]*"/gi, "[redacted]")
		.replace(
			/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/gi,
			"[redacted]",
		)
		.slice(0, 300)
}

/** An SMTP transport when every `SMTP_*` setting is present, else null. */
function smtpTransport(): MailTransport | null {
	const host = process.env.SMTP_HOST?.trim()
	const port = Number(process.env.SMTP_PORT)
	const user = process.env.SMTP_USER?.trim()
	const pass = process.env.SMTP_PASSWORD
	const from = process.env.SMTP_FROM?.trim()
	if (!host || !Number.isInteger(port) || port <= 0 || !user || !pass || !from)
		return null
	return async (m) => {
		const transporter = nodemailer.createTransport({
			host,
			port,
			// 465 is implicit TLS; other ports upgrade with STARTTLS.
			secure: port === 465,
			auth: { user, pass },
		})
		await transporter.sendMail({
			from,
			to: m.to,
			subject: m.subject,
			text: m.text,
			attachments: m.attachments,
		})
	}
}

export async function sendPacketEmail(m: PacketMail): Promise<MailResult> {
	const transport = injected ?? smtpTransport()
	if (!transport) return { outcome: "UNCONFIGURED" }
	try {
		await transport(m)
		return { outcome: "SENT" }
	} catch (cause) {
		return { outcome: "FAILED", error: sanitizedError(cause) }
	}
}
