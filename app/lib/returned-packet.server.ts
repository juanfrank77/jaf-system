import { db } from "~/lib/db.server"
import {
	isResent,
	isReturned,
	latestReturn,
	type ReturnStateDoc,
} from "~/lib/returned-packet"
import { Prisma } from "../../generated/prisma/client"

/**
 * The ids of the live jobs (within `scope`) Finance sent back: `returned` are
 * waiting on the supervisor, `resent` are back with Finance after his fix
 * (most recently resent first).
 * Only jobs ever sent back and still at Finance's first step (released, not
 * verified, no LC request) are read, so the list stays short and an old
 * return Finance verified past never counts; the JSON history is decided by
 * `isReturned` / `isResent`.
 */
export async function sendBackIds(
	scope: Prisma.JafInvoiceWhereInput = {},
): Promise<{ returned: string[]; resent: string[] }> {
	const rows = await db.jafInvoice.findMany({
		where: {
			AND: [
				scope,
				{
					financeSendBackNotes: { not: Prisma.DbNull },
					status: { not: "CANCELLED" },
					releasedToFinanceAt: { not: null },
					financeVerifiedAt: null,
					pbccRequestSentAt: null,
				},
			],
		},
		select: {
			id: true,
			financeSendBackNotes: true,
			releasedToFinanceAt: true,
			financeVerifiedAt: true,
			pbccRequestSentAt: true,
		},
	})
	return {
		returned: rows.filter(isReturned).map((r) => r.id),
		// Most recently resent first.
		resent: rows
			.filter(isResent)
			.sort((a, b) =>
				(latestReturn(b)?.resentAt ?? "").localeCompare(
					latestReturn(a)?.resentAt ?? "",
				),
			)
			.map((r) => r.id),
	}
}

/** The returned ids alone (the supervisor's lists). */
export async function returnedDocIds(
	scope: Prisma.JafInvoiceWhereInput = {},
): Promise<string[]> {
	return (await sendBackIds(scope)).returned
}

/**
 * The open return on a job, for the red banner: her note, when, and her
 * name. Null once the supervisor resent it, or if it was never sent back.
 */
export async function returnedInfo(
	doc: ReturnStateDoc,
): Promise<{ note: string; byName: string | null; createdAt: string } | null> {
	if (!isReturned(doc)) return null
	const latest = latestReturn(doc)
	if (!latest) return null
	const by = await db.user.findUnique({
		where: { id: latest.byUserId },
		select: { name: true },
	})
	return {
		note: latest.note,
		byName: by?.name ?? null,
		createdAt: latest.createdAt,
	}
}
