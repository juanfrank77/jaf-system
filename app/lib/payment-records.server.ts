import type { PaymentType } from "../../generated/prisma/client"
import { db } from "./db.server"

type ReceivablePaymentType = Extract<
	PaymentType,
	"PBCC_ADVANCE" | "CLARO_FINAL"
>

export async function recordReceivablePayment(input: {
	jobId: string
	type: ReceivablePaymentType
	amount: number
	date: Date
	note: string | null
	actorId: string
	auditDiff?: Record<string, unknown>
}) {
	try {
		return await db.$transaction(async (tx) => {
			const existing = await tx.paymentRecord.findUnique({
				where: { jobId_type: { jobId: input.jobId, type: input.type } },
			})
			if (existing) return { duplicate: true, record: existing }

			const record = await tx.paymentRecord.create({
				data: {
					jobId: input.jobId,
					type: input.type,
					amount: input.amount,
					date: input.date,
					recordedById: input.actorId,
					note: input.note,
				},
			})
			const scalarData =
				input.type === "PBCC_ADVANCE"
					? { advanceReceivedAt: input.date, advanceAmount: input.amount }
					: {
							finalPaymentReceivedAt: input.date,
							finalPaymentAmount: input.amount,
						}
			await tx.jafInvoice.update({
				where: { id: input.jobId },
				data: scalarData,
			})
			await tx.auditTrail.create({
				data: {
					docId: input.jobId,
					userId: input.actorId,
					action:
						input.type === "PBCC_ADVANCE"
							? "ADVANCE_RECEIVED"
							: "FINAL_PAYMENT_RECEIVED",
					diffJson: {
						type: input.type,
						amount: input.amount,
						date: input.date.toISOString(),
						note: input.note,
						source: "PaymentRecord",
						...input.auditDiff,
					},
				},
			})
			return { duplicate: false, record }
		})
	} catch (error) {
		if ((error as { code?: string }).code !== "P2002") throw error
		const existing = await db.paymentRecord.findUnique({
			where: { jobId_type: { jobId: input.jobId, type: input.type } },
		})
		if (existing) return { duplicate: true, record: existing }
		throw error
	}
}
