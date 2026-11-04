import { db } from "~/lib/db.server"
import { Prisma } from "../../generated/prisma/client"

/** "M-3545": JAF's own job number for an Aviso. */
export const jobNumberOf = (jobSeq: number | null | undefined) =>
	jobSeq == null ? null : `M-${jobSeq}`

/** Where the series starts until the first job number exists (prod: Lissette's last M-number + 1). */
async function firstJobSeq(tx: Prisma.TransactionClient): Promise<number> {
	const s = await tx.systemSetting.findUnique({
		where: { key: "job_number_first" },
	})
	const n = s ? Number(s.value) : NaN
	return Number.isInteger(n) && n > 0 ? n : 1
}

/**
 * Give an accepted Aviso its job number if it has none: max + 1, one per
 * Aviso, never reused. The number is unique in the database, so two accepts
 * racing for the same one cannot both win: the loser retries on the next number.
 */
export async function ensureJobNumber(docId: string): Promise<number> {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return await db.$transaction(
				async (tx) => {
					const doc = await tx.jafInvoice.findUniqueOrThrow({
						where: { id: docId },
						select: { jobSeq: true },
					})
					if (doc.jobSeq != null) return doc.jobSeq
					const top = await tx.jafInvoice.aggregate({
						_max: { jobSeq: true },
					})
					const first = await firstJobSeq(tx)
					const next = Math.max((top._max.jobSeq ?? first - 1) + 1, first)
					await tx.jafInvoice.update({
						where: { id: docId },
						data: { jobSeq: next },
					})
					return next
				},
				{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
			)
		} catch (e) {
			const code = (e as { code?: string }).code
			// Unique clash or serialization failure: another accept took the number.
			if ((code === "P2002" || code === "P2034") && attempt < 4) continue
			throw e
		}
	}
	throw new Error("could not assign a job number")
}
