import { db } from "./db.server"
import { sanitizedError } from "./redact"

type InternalEmailMessage = {
	recipients: string[]
	subject: string
	context: string
}
type InternalEmailTransport = (message: InternalEmailMessage) => Promise<void>

let transport: InternalEmailTransport | null = null

export function setInternalEmailTransport(
	next: InternalEmailTransport | null,
): void {
	transport = next
}

export async function sendInternalEmail(input: {
	docId: string
	actorId: string
	recipients: string[]
	subject: string
	context: string
}): Promise<void> {
	const attemptedAt = new Date().toISOString()
	let outcome: "SENT" | "UNCONFIGURED" | "FAILED" = "UNCONFIGURED"
	let error: string | undefined
	if (transport) {
		try {
			await transport({
				recipients: input.recipients,
				subject: input.subject,
				context: input.context,
			})
			outcome = "SENT"
		} catch (cause) {
			outcome = "FAILED"
			error = sanitizedError(cause)
		}
	}
	try {
		await db.auditTrail.create({
			data: {
				docId: input.docId,
				userId: input.actorId,
				action: "INTERNAL_EMAIL_ATTEMPT",
				diffJson: {
					attemptedAt,
					recipients: input.recipients,
					subject: input.subject,
					context: input.context,
					outcome,
					...(error ? { error } : {}),
				},
			},
		})
	} catch (auditError) {
		void auditError
	}
}
