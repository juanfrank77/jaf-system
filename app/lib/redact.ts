/**
 * An error's message, safe to store in an audit row or send log: credentials,
 * bearer tokens and private keys are redacted and the text is capped. Shared
 * by internal email (`email.server.ts`) and the Claro packet mail.
 */
export function sanitizedError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error)
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
