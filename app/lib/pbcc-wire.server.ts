import { db } from "~/lib/db.server"
import { PBCC_WIRE_FEE } from "./bank-schedule"

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export class WireError extends Error {
	constructor(
		public code: "not_found" | "not_sent" | "bad_amount" | "bad_date",
	) {
		super(code)
	}
}

/** The advance PBCC should wire: the batch's 80% less the wire fee. */
export function expectedWire(advance: number): number {
	return round2(advance - PBCC_WIRE_FEE)
}

const prDay = (d: Date) =>
	d.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })

/**
 * Carmen types the date and amount PBCC wired for a sent batch. A difference
 * from the expected wire is reported, never blocked: the money did arrive.
 * Typing it again replaces the earlier entry.
 */
export async function recordWire(input: {
	scheduleId: string
	receivedOn: string
	amount: number
	userId: string
}): Promise<{ expected: number; difference: number }> {
	if (!Number.isFinite(input.amount) || input.amount <= 0)
		throw new WireError("bad_amount")
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn) ||
		Number.isNaN(Date.parse(input.receivedOn)) ||
		input.receivedOn > prDay(new Date())
	)
		throw new WireError("bad_date")
	const batch = await db.bankSchedule.findUnique({
		where: { id: input.scheduleId },
		select: { advanceAmount: true, sentAt: true },
	})
	if (!batch) throw new WireError("not_found")
	if (!batch.sentAt) throw new WireError("not_sent")
	const amount = round2(input.amount)
	await db.bankSchedule.update({
		where: { id: input.scheduleId },
		data: {
			wireAmount: amount,
			wireReceivedAt: new Date(`${input.receivedOn}T12:00:00Z`),
			wireRecordedById: input.userId,
		},
	})
	const expected = expectedWire(Number(batch.advanceAmount))
	return { expected, difference: round2(amount - expected) }
}

export type WireBatchRow = {
	id: string
	number: number | null
	sentAt: Date
	total: number
	advance: number
	held: number
	expected: number
	wireReceivedOn: string | null
	wireAmount: number | null
	difference: number | null
}

/** Every batch sent to PBCC, newest first, with what was sold, advanced and wired. */
export async function listWireBatches(): Promise<WireBatchRow[]> {
	const rows = await db.bankSchedule.findMany({
		where: { sentAt: { not: null } },
		orderBy: { sentAt: "desc" },
	})
	return rows.map((b) => {
		const total = Number(b.total)
		const advance = Number(b.advanceAmount)
		const expected = expectedWire(advance)
		const wireAmount = b.wireAmount === null ? null : Number(b.wireAmount)
		return {
			id: b.id,
			number: b.number,
			sentAt: b.sentAt as Date,
			total,
			advance,
			held: round2(total - advance),
			expected,
			wireReceivedOn: b.wireReceivedAt
				? b.wireReceivedAt.toISOString().slice(0, 10)
				: null,
			wireAmount,
			difference: wireAmount === null ? null : round2(wireAmount - expected),
		}
	})
}
