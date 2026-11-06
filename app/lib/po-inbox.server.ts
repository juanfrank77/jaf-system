import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { getDocumentProxy } from "unpdf"
import { db } from "~/lib/db.server"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import { getPoReader, type PoReader } from "~/lib/po-reader.server"
import {
	cents,
	HARD_STOPS,
	isOverridable,
	type PoCheck,
	type PoCheckCode,
	type PoLine,
	type PoRead,
	recomputeFromLines,
	runPoChecks,
	statusFromChecks,
} from "~/lib/po-reading"
import { saveBuffer } from "~/lib/uploads.server"
import type { Prisma } from "../../generated/prisma/client"

type PoErrorCode =
	| "not_confirmable"
	| "incomplete"
	| "duplicate"
	| "aviso_not_found"
	| "already_confirmed"
	| "not_pdf"
	| "unknown_po"
	| "not_discardable"

export class PoError extends Error {
	constructor(readonly code: PoErrorCode) {
		super(code)
		this.name = "PoError"
	}
}

const PENDING_STUCK_MINUTES = 10
const POOL_SIZE = 4

const num = (d: Prisma.Decimal | null | undefined) =>
	d === null || d === undefined ? null : Number(d)

/** Save the uploaded PDFs and queue them to be read. Returns the new row ids. */
export async function ingestPoFiles(
	files: { name: string; bytes: Uint8Array }[],
	uploadedById: string,
): Promise<string[]> {
	const ids: string[] = []
	for (const f of files) {
		// %PDF-: refuse anything else before it reaches the reader.
		if (Buffer.from(f.bytes.subarray(0, 5)).toString() !== "%PDF-")
			throw new PoError("not_pdf")
		const hash = createHash("sha256").update(f.bytes).digest("hex")
		// Idempotent by file: the same bytes again (a double-click, a re-upload)
		// reuses the live row rather than adding a hard-stopped duplicate.
		const existing = await db.claroPo.findFirst({
			where: { fileHash: hash, status: { not: "SUPERSEDED" } },
			orderBy: { receivedAt: "asc" },
			select: { id: true },
		})
		if (existing) {
			ids.push(existing.id)
			continue
		}
		const stored = await saveBuffer(
			"claro-po",
			`${randomUUID()}.pdf`,
			Buffer.from(f.bytes),
		)
		const row = await db.claroPo.create({
			data: {
				filePath: stored,
				fileName: f.name.slice(0, 200),
				fileHash: hash,
				uploadedById,
			},
			select: { id: true },
		})
		ids.push(row.id)
	}
	return ids
}

async function pagesIn(bytes: Uint8Array): Promise<number> {
	const pdf = await getDocumentProxy(bytes.slice())
	return pdf.numPages
}

type RowLike = {
	id: string
	poNumber: string | null
	poDate: Date | null
	termsDays: number | null
	statedPages: number | null
	filePages: number | null
	docId: string | null
	fileHash: string
	receivedAt: Date
	avisoCandidates: string[]
	lines: Prisma.JsonValue | null
	subtotal: Prisma.Decimal | null
	ivu4: Prisma.Decimal | null
	ivu115: Prisma.Decimal | null
	total: Prisma.Decimal | null
}

function readOf(row: RowLike): PoRead {
	return {
		poNumber: row.poNumber,
		poDate: row.poDate ? row.poDate.toISOString().slice(0, 10) : null,
		statedPages: row.statedPages,
		termsDays: row.termsDays,
		avisoCandidates: row.avisoCandidates,
		lines: Array.isArray(row.lines) ? (row.lines as unknown as PoLine[]) : [],
		subtotal: num(row.subtotal),
		ivu4: num(row.ivu4),
		ivu115: num(row.ivu115),
		total: num(row.total),
	}
}

type Printed = Pick<PoRead, "subtotal" | "ivu4" | "ivu115" | "total">

/** What the PO printed, as first read; null for rows read before it was kept. */
function printedOf(v: Prisma.JsonValue | null): Printed | null {
	if (!v || typeof v !== "object" || Array.isArray(v)) return null
	const o = v as Record<string, unknown>
	const n = (x: unknown) => (typeof x === "number" ? x : null)
	return {
		subtotal: n(o.subtotal),
		ivu4: n(o.ivu4),
		ivu115: n(o.ivu115),
		total: n(o.total),
	}
}

const checksOf = (v: Prisma.JsonValue | null): PoCheck[] =>
	Array.isArray(v) ? (v as unknown as PoCheck[]) : []

/** The file has every page the PO says it has. */
const isComplete = (r: {
	statedPages: number | null
	filePages: number | null
}) => r.statedPages !== null && r.statedPages === (r.filePages ?? 0)

/** Stopped by missing pages and nothing else that stops a PO. */
const onlyPagesMissing = (checks: PoCheck[]) => {
	const hard = checks.filter((c) => HARD_STOPS.has(c.code))
	return hard.length > 0 && hard.every((c) => c.code === "pages_missing")
}

/** The PO number was typed by hand, not read off the file. */
const typedNumber = (entered: Prisma.JsonValue | null) =>
	!!entered &&
	typeof entered === "object" &&
	!Array.isArray(entered) &&
	"poNumber" in entered

type Twin = {
	id: string
	status: string
	checks: Prisma.JsonValue | null
	receivedAt: Date
	invoice: { id: string } | null
}

/**
 * The first-copy rule: a twin makes `row` a duplicate when it is confirmed or
 * invoiced, or was uploaded earlier and is not stopped only by missing pages.
 */
const counts = (o: Twin, row: { id: string; receivedAt: Date }) =>
	o.status === "CONFIRMED" ||
	o.invoice !== null ||
	((o.receivedAt < row.receivedAt ||
		(o.receivedAt.getTime() === row.receivedAt.getTime() && o.id < row.id)) &&
		!onlyPagesMissing(checksOf(o.checks)))

/** Only these rows may still get a verdict; a confirm or a supersede wins. */
const STILL_OPEN = {
	notIn: ["CONFIRMED", "SUPERSEDED"],
} as Prisma.EnumClaroPoStatusFilter

/**
 * Work out an Aviso for the PO (the one already linked, else the first
 * candidate number that is an Aviso) and run the checks. Writes the verdict,
 * unless the row was confirmed or superseded meanwhile. Safe to call again
 * after any field changes. With `supersede` (a read, or pages corrected by
 * hand), a complete copy replaces copies of the same number stuck on missing
 * pages; never on a number typed by hand, since a supersede cannot be undone.
 */
export async function evaluatePo(
	id: string,
	opts: { supersede?: boolean } = {},
): Promise<void> {
	const row = await db.claroPo.findUnique({ where: { id } })
	if (!row) throw new PoError("unknown_po")
	if (row.status === "CONFIRMED" || row.status === "SUPERSEDED") return

	// Other read copies of the same PO number not yet confirmed, oldest first.
	const open = row.poNumber
		? await db.claroPo.findMany({
				where: {
					poNumber: row.poNumber,
					id: { not: id },
					status: { notIn: ["CONFIRMED", "SUPERSEDED", "PENDING", "READING"] },
					invoice: null,
				},
				orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
				select: {
					id: true,
					checks: true,
					statedPages: true,
					filePages: true,
					entered: true,
				},
			})
		: []
	// A complete file supersedes the copies stuck on missing pages.
	if (opts.supersede && isComplete(row) && !typedNumber(row.entered)) {
		const short = open
			.filter((o) => checksOf(o.checks).some((c) => c.code === "pages_missing"))
			.map((o) => o.id)
		if (short.length > 0)
			await db.claroPo.updateMany({
				where: { id: { in: short }, status: STILL_OPEN },
				data: { status: "SUPERSEDED", supersededById: id },
			})
	}

	let docId = row.docId
	if (!docId && row.avisoCandidates.length > 0) {
		const found = await db.jafInvoice.findMany({
			where: {
				avisoNumber: { in: row.avisoCandidates },
				status: { not: "CANCELLED" },
			},
			select: { id: true, avisoNumber: true },
		})
		docId =
			row.avisoCandidates
				.map((n) => found.find((f) => f.avisoNumber === n)?.id)
				.find(Boolean) ?? null
	}

	let billedPreIvu: number | null = null
	let alreadyPod = 0
	if (docId) {
		const [doc, others] = await Promise.all([
			db.jafInvoice.findUnique({
				where: { id: docId },
				select: { jafInvoiceLines: true },
			}),
			db.claroPo.findMany({
				where: { docId, status: "CONFIRMED", id: { not: id } },
				select: { subtotal: true },
			}),
		])
		const lines = Array.isArray(doc?.jafInvoiceLines)
			? (doc.jafInvoiceLines as { qty: number; unitPrice: number }[])
			: []
		billedPreIvu = computeInvoiceTotals(lines).subtotal
		alreadyPod = others.reduce((s, o) => s + (num(o.subtotal) ?? 0), 0)
	}

	// The first copy wins: a PO number (or a file) already confirmed or
	// invoiced, or uploaded earlier, makes this one the duplicate. A replaced
	// copy, or one stopped only by missing pages, does not count.
	const twins = await db.claroPo.findMany({
		where: {
			id: { not: id },
			status: { not: "SUPERSEDED" },
			OR: [
				...(row.poNumber ? [{ poNumber: row.poNumber }] : []),
				{ fileHash: row.fileHash },
			],
		},
		select: {
			id: true,
			status: true,
			checks: true,
			receivedAt: true,
			invoice: { select: { id: true } },
		},
	})
	const duplicate = twins.some((o) => counts(o, row))

	const ctx = {
		filePages: row.filePages ?? 0,
		duplicate,
		billedPreIvu,
		alreadyPod,
	}
	const stored = readOf(row)
	let checks = runPoChecks(stored, ctx)
	// Lines edited by hand are checked against what the PO printed, not against
	// the totals rebuilt from them.
	const printed = printedOf(row.printed)
	if (printed) {
		const vsPrinted = (c: PoCheck) =>
			c.code === "lines_sum" || c.code === "totals"
		const asPrinted = runPoChecks(
			{
				...stored,
				subtotal: printed.subtotal ?? stored.subtotal,
				ivu4: printed.ivu4 ?? stored.ivu4,
				ivu115: printed.ivu115 ?? stored.ivu115,
				total: printed.total ?? stored.total,
			},
			ctx,
		)
		checks = [
			...checks.filter((c) => !vsPrinted(c)),
			...asPrinted.filter(vsPrinted),
		]
		// The money to be invoiced must also be what the PO printed.
		const off = (["subtotal", "ivu4", "ivu115", "total"] as const).filter(
			(k) => {
				const [s, p] = [stored[k], printed[k]]
				return p !== null && (s === null || cents(s) !== cents(p))
			},
		)
		if (off.length > 0 && !checks.some((c) => c.code === "totals"))
			checks.push({
				code: "totals",
				severity: "needs_look",
				detail: `${off.join(", ")} vs printed`,
			})
	}
	// A short copy read after its complete twin (both in one batch) is the one
	// replaced; the twin is looked at again now that this copy no longer counts.
	const full =
		opts.supersede && checks.some((c) => c.code === "pages_missing")
			? open.find((o) => isComplete(o) && !typedNumber(o.entered))
			: undefined
	if (full) {
		const r = await db.claroPo.updateMany({
			where: { id, status: STILL_OPEN },
			data: {
				docId,
				checks: checks as unknown as Prisma.InputJsonValue,
				status: "SUPERSEDED",
				supersededById: full.id,
			},
		})
		if (r.count > 0) await evaluatePo(full.id)
		return
	}
	await db.claroPo.updateMany({
		where: { id, status: STILL_OPEN },
		data: {
			docId,
			checks: checks as unknown as Prisma.InputJsonValue,
			status: statusFromChecks(checks, docId !== null),
		},
	})
}

/** Read one queued PO and store what it says. A failure leaves it Needs a look, never lost. */
async function readPo(id: string, reader: PoReader) {
	const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
	const bytes = new Uint8Array(await fs.readFile(row.filePath))
	const filePages = await pagesIn(bytes).catch(() => 0)
	const unreadable = async (why: string) => {
		const checks: PoCheck[] = [
			{ code: "unreadable", severity: "needs_look", detail: why },
		]
		await db.claroPo.update({
			where: { id },
			data: {
				filePages,
				readError: why,
				checks: checks as unknown as Prisma.InputJsonValue,
				status: "NEEDS_LOOK",
			},
		})
	}
	let read: PoRead
	try {
		read = await reader(bytes)
	} catch (e) {
		return unreadable(e instanceof Error ? e.message : "read_failed")
	}
	const prev = printedOf(row.printed)
	await db.claroPo.update({
		where: { id },
		data: {
			filePages,
			readError: null,
			poNumber: read.poNumber,
			poDate: read.poDate ? new Date(`${read.poDate}T12:00:00Z`) : null,
			statedPages: read.statedPages,
			termsDays: read.termsDays,
			avisoCandidates: read.avisoCandidates,
			lines: read.lines as unknown as Prisma.InputJsonValue,
			subtotal: read.subtotal,
			ivu4: read.ivu4,
			ivu115: read.ivu115,
			total: read.total,
			// Kept from the first read on, so hand edits are checked against it;
			// a value already known (read earlier or stated by hand) is kept.
			printed: {
				subtotal: prev?.subtotal ?? read.subtotal,
				ivu4: prev?.ivu4 ?? read.ivu4,
				ivu115: prev?.ivu115 ?? read.ivu115,
				total: prev?.total ?? read.total,
			},
		},
	})
	await evaluatePo(id, { supersede: true })
}

/** Take the oldest queued PO for this worker; two workers never get the same one. */
async function claimNext(): Promise<string | null> {
	const rows = await db.$queryRaw<{ id: string }[]>`
		UPDATE "ClaroPo" SET "status" = 'READING', "readStartedAt" = now()
		WHERE "id" = (
			SELECT "id" FROM "ClaroPo" WHERE "status" = 'PENDING'
			ORDER BY "receivedAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		RETURNING "id"`
	return rows[0]?.id ?? null
}

/** A read that died with the process is put back in the queue. */
async function requeueStuckReads(now = new Date()) {
	await db.claroPo.updateMany({
		where: {
			status: "READING",
			readStartedAt: {
				lt: new Date(now.getTime() - PENDING_STUCK_MINUTES * 60_000),
			},
		},
		data: { status: "PENDING" },
	})
}

/** Read everything queued, a few at a time. Resolves when the queue is empty. */
export async function processPending(
	reader: PoReader = getPoReader(),
	size = POOL_SIZE,
): Promise<void> {
	const worker = async () => {
		for (;;) {
			const id = await claimNext()
			if (!id) return
			try {
				await readPo(id, reader)
			} catch {
				await db.claroPo
					.update({
						where: { id },
						data: { status: "NEEDS_LOOK", readError: "read_failed" },
					})
					.catch(() => {})
			}
		}
	}
	await Promise.all(Array.from({ length: size }, worker))
}

let draining: Promise<void> | null = null
/** Start reading in the background; one drain per process at a time. */
export function kickProcessing(): void {
	if (draining) return
	draining = requeueStuckReads()
		.then(() => processPending())
		.catch(() => {})
		.finally(() => {
			draining = null
		})
}

/** Put a PO back in the queue to be read again. */
export async function rereadPo(id: string) {
	const r = await db.claroPo.updateMany({
		where: {
			id,
			status: { in: ["NEEDS_LOOK", "BLOCKED", "UNMATCHED", "READY"] },
		},
		data: { status: "PENDING", readError: null },
	})
	if (r.count === 0) throw new PoError("not_confirmable")
	kickProcessing()
}

type PoFixFields = {
	poNumber?: string
	poDate?: string
	termsDays?: number
	subtotal?: number
	ivu4?: number
	ivu115?: number
	total?: number
	avisoNumber?: string
}

/** A line as typed on Review; its IVU is worked out from amount and rate. */
type PoLineInput = Omit<PoLine, "ivu"> & { ivu?: number }

/**
 * Fix a field by hand. The change is remembered as ENTERED, with who and when
 * (Rule 4). A subtotal, IVU or total typed by hand is what the PO really
 * prints, so it is written to `printed` too. Lines replace the read ones whole
 * and rebuild subtotal, IVU and total, leaving `printed` alone so the checks
 * compare the edited lines against it. A row read before `printed` was kept
 * gets it from its header as it stood before this edit.
 */
export async function fixPo(
	id: string,
	byId: string,
	f: PoFixFields & { statedPages?: number; lines?: PoLineInput[] },
) {
	const row = await db.claroPo.findUnique({ where: { id } })
	if (!row) throw new PoError("unknown_po")
	if (row.status === "CONFIRMED") throw new PoError("already_confirmed")
	if (row.status === "SUPERSEDED") throw new PoError("not_confirmable")
	const data: Prisma.ClaroPoUpdateInput = {}
	const touched: string[] = []
	if (f.poNumber !== undefined) {
		data.poNumber = f.poNumber.replace(/\D/g, "") || null
		touched.push("poNumber")
	}
	if (f.poDate !== undefined) {
		data.poDate = f.poDate ? new Date(`${f.poDate}T12:00:00Z`) : null
		touched.push("poDate")
	}
	for (const k of [
		"termsDays",
		"statedPages",
		"subtotal",
		"ivu4",
		"ivu115",
		"total",
	] as const) {
		if (f[k] !== undefined) {
			data[k] = f[k]
			touched.push(k)
		}
	}
	const printed = printedOf(row.printed) ?? {
		subtotal: num(row.subtotal),
		ivu4: num(row.ivu4),
		ivu115: num(row.ivu115),
		total: num(row.total),
	}
	for (const k of ["subtotal", "ivu4", "ivu115", "total"] as const)
		if (f[k] !== undefined) printed[k] = f[k]
	data.printed = printed as unknown as Prisma.InputJsonValue
	if (f.lines !== undefined) {
		const lines: PoLine[] = f.lines.map((l) => ({
			item: l.item,
			description: l.description,
			amount: l.amount,
			ivuRate: l.ivuRate,
			ivu: cents(l.amount * l.ivuRate) / 100,
		}))
		data.lines = lines as unknown as Prisma.InputJsonValue
		Object.assign(data, recomputeFromLines(lines))
		touched.push("lines")
	}
	if (f.avisoNumber !== undefined) {
		const n = f.avisoNumber.replace(/\D/g, "")
		const doc = await db.jafInvoice.findFirst({
			where: { avisoNumber: n, status: { not: "CANCELLED" } },
			select: { id: true },
		})
		if (!doc) throw new PoError("aviso_not_found")
		data.doc = { connect: { id: doc.id } }
		touched.push("aviso")
	}
	const entered = {
		...((row.entered as Record<string, unknown> | null) ?? {}),
		...Object.fromEntries(
			touched.map((k) => [k, { byId, at: new Date().toISOString() }]),
		),
	}
	await db.claroPo.update({
		where: { id },
		data: { ...data, entered: entered as Prisma.InputJsonValue },
	})
	await evaluatePo(id, { supersede: f.statedPages !== undefined })
}

export type PoOverride = { check: PoCheckCode; reason: string }

const REVIEWABLE = ["READY", "NEEDS_LOOK", "BLOCKED", "UNMATCHED"] as const

/** Run the checks again on a PO under review; an edit can leave them stale. */
async function refreshChecks(id: string) {
	const before = await db.claroPo.findUnique({
		where: { id },
		select: { status: true },
	})
	if (!before) throw new PoError("unknown_po")
	if ((REVIEWABLE as readonly string[]).includes(before.status))
		await evaluatePo(id)
}

/**
 * Whether a PO can be confirmed as its checks stand, and with `overrides` the
 * reasons to record: one per failing check, however many lines it failed on.
 * A hard stop, or a failing check without a reason, refuses.
 */
function gate(
	row: { status: string; checks: Prisma.JsonValue | null },
	overrides: PoOverride[] | undefined,
	byId: string,
) {
	const failing = checksOf(row.checks)
	const confirmable =
		row.status === "READY" ||
		row.status === "NEEDS_LOOK" ||
		(row.status === "BLOCKED" && failing.every(isOverridable))
	if (!confirmable) throw new PoError("not_confirmable")
	if (!overrides) return null
	const at = new Date().toISOString()
	return [...new Set(failing.map((c) => c.code))].map((check) => {
		const reason = overrides.find((o) => o.check === check)?.reason.trim()
		if (HARD_STOPS.has(check) || !reason) throw new PoError("not_confirmable")
		return { check, reason, byId, at }
	})
}

/**
 * The Generate step's review gate, before anything is made: the checks as
 * they stand now, with these reasons, must allow a confirm. A PO already
 * confirmed passes (the make decides what happens next).
 */
export async function assertReviewed(
	id: string,
	overrides: PoOverride[],
	byId: string,
) {
	await refreshChecks(id)
	const row = await db.claroPo.findUniqueOrThrow({
		where: { id },
		select: { status: true, checks: true },
	})
	if (row.status !== "CONFIRMED") gate(row, overrides, byId)
}

/**
 * Confirm one PO under its Aviso: saves it there and stamps received /
 * confirmed. The checks are run again first, since an edit can leave the
 * status stale. A Blocked PO is accepted only when nothing failing is a hard
 * stop. With `overrides` (the Generate step), every failing check must carry
 * a reason; they are stored and each is audited in the same transaction.
 */
export async function confirmPo(
	id: string,
	userId: string,
	opts: { overrides?: PoOverride[] } = {},
) {
	await refreshChecks(id)
	await db.$transaction(async (tx) => {
		const row = await tx.claroPo.findUnique({ where: { id } })
		if (!row) throw new PoError("unknown_po")
		if (row.status === "CONFIRMED") throw new PoError("already_confirmed")
		const accepted = gate(row, opts.overrides, userId)
		if (!row.docId || !row.poNumber || !row.poDate)
			throw new PoError("incomplete")
		// Two copies read side by side can both look new: the first to confirm wins.
		const twin = await tx.claroPo.count({
			where: { poNumber: row.poNumber, status: "CONFIRMED", id: { not: id } },
		})
		if (twin > 0) {
			await tx.claroPo.update({
				where: { id },
				data: {
					status: "BLOCKED",
					checks: [
						{ code: "duplicate", severity: "blocked", detail: row.poNumber },
					] as unknown as Prisma.InputJsonValue,
				},
			})
			throw new PoError("duplicate")
		}
		const claimed = await tx.claroPo.updateMany({
			where: { id, status: row.status },
			data: {
				status: "CONFIRMED",
				confirmedAt: new Date(),
				confirmedById: userId,
				...(accepted
					? { overrides: accepted as unknown as Prisma.InputJsonValue }
					: {}),
			},
		})
		if (claimed.count === 0) throw new PoError("already_confirmed")
		for (const o of accepted ?? [])
			await tx.auditTrail.create({
				data: {
					docId: row.docId,
					userId,
					action: "PO_CHECK_OVERRIDDEN",
					diffJson: { source: "ENTERED", claroPoId: id, ...o },
				},
			})
		// The older Receivables screens look for a PoLink to know a PO arrived.
		await tx.poLink.create({
			data: {
				docId: row.docId,
				claroPONumber: row.poNumber,
				poDate: row.poDate,
				amount: row.total,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: row.docId,
				userId,
				action: "PO_CONFIRMED",
				diffJson: {
					source: "STAMPED",
					poNumber: row.poNumber,
					poDate: row.poDate.toISOString().slice(0, 10),
					total: num(row.total),
					receivedAt: row.receivedAt.toISOString(),
					claroPoId: id,
				},
			},
		})
	})
}

/**
 * The copy a duplicate repeats: one already confirmed or invoiced, else the
 * first earlier copy that counts. Null when no twin makes this a duplicate.
 */
export async function findOriginal(row: {
	id: string
	poNumber: string | null
	fileHash: string
	receivedAt: Date
}): Promise<{
	id: string
	poNumber: string | null
	docId: string | null
} | null> {
	const twins = await db.claroPo.findMany({
		where: {
			id: { not: row.id },
			status: { not: "SUPERSEDED" },
			OR: [
				...(row.poNumber ? [{ poNumber: row.poNumber }] : []),
				{ fileHash: row.fileHash },
			],
		},
		orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
		select: {
			id: true,
			poNumber: true,
			docId: true,
			status: true,
			checks: true,
			receivedAt: true,
			invoice: { select: { id: true } },
		},
	})
	// Only a twin that makes this a duplicate (the rule `evaluatePo` uses).
	const qualifying = twins.filter((o) => counts(o, row))
	const pick =
		qualifying.find((o) => o.status === "CONFIRMED" || o.invoice !== null) ??
		qualifying[0]
	return pick
		? { id: pick.id, poNumber: pick.poNumber, docId: pick.docId }
		: null
}

/**
 * Retire a copy stopped only as a duplicate: it is kept, marked Superseded
 * and linked to the original, and leaves the queue. Who and when are kept on
 * the row and in the audit trail. Returns the original's id.
 */
export async function discardPo(id: string, userId: string): Promise<string> {
	await refreshChecks(id)
	const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
	const hard = checksOf(row.checks).filter((c) => HARD_STOPS.has(c.code))
	const reviewable = (REVIEWABLE as readonly string[]).includes(row.status)
	if (
		!reviewable ||
		hard.length === 0 ||
		hard.some((c) => c.code !== "duplicate")
	)
		throw new PoError("not_discardable")
	const original = await findOriginal(row)
	if (!original) throw new PoError("not_discardable")
	const at = new Date().toISOString()
	const r = await db.claroPo.updateMany({
		where: { id, status: STILL_OPEN },
		data: {
			status: "SUPERSEDED",
			supersededById: original.id,
			entered: {
				...((row.entered as Record<string, unknown> | null) ?? {}),
				discarded: { byId: userId, at },
			} as Prisma.InputJsonValue,
		},
	})
	if (r.count === 0) throw new PoError("not_discardable")
	const docId = row.docId ?? original.docId
	if (docId)
		await db.auditTrail.create({
			data: {
				docId,
				userId,
				action: "PO_DISCARDED",
				diffJson: {
					source: "ENTERED",
					claroPoId: id,
					poNumber: row.poNumber,
					originalId: original.id,
				},
			},
		})
	return original.id
}

/** Confirm every green PO. Only green ones: anything else is left for a look. */
export async function confirmAllGreen(
	userId: string,
): Promise<{ confirmed: number; skipped: number }> {
	const ids = await db.claroPo.findMany({
		where: { status: "READY" },
		orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
		select: { id: true },
	})
	let confirmed = 0
	let skipped = 0
	for (const { id } of ids) {
		try {
			await confirmPo(id, userId)
			confirmed++
		} catch (e) {
			if (!(e instanceof PoError)) throw e
			skipped++
		}
	}
	return { confirmed, skipped }
}

/** Counts for the tabs and the Home box. */
export async function poInboxCounts(now = new Date()) {
	const groups = await db.claroPo.groupBy({ by: ["status"], _count: true })
	const by = Object.fromEntries(groups.map((g) => [g.status, g._count]))
	const dayStart = new Date(
		`${now.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })}T00:00:00-04:00`,
	)
	const uploadedToday = await db.claroPo.count({
		where: { receivedAt: { gte: dayStart } },
	})
	const n = (k: string) => by[k] ?? 0
	return {
		reading: n("PENDING") + n("READING"),
		ready: n("READY"),
		needsLook: n("NEEDS_LOOK"),
		blocked: n("BLOCKED"),
		unmatched: n("UNMATCHED"),
		confirmed: n("CONFIRMED"),
		uploadedToday,
	}
}
