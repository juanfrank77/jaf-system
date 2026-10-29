import { db } from "~/lib/db.server"
import { saveBuffer } from "~/lib/uploads.server"

/**
 * The Claro half of an installer (EWIT) invoice: attach the PO, work out IVU,
 * mark it sent through Ariba. Payment (claroPaid*) is a later task.
 */

export type ClaroInstallerErrorCode =
	| "not_found"
	| "voided"
	| "po_total_mismatch"
	| "already_sent"
	| "no_po"

export class ClaroInstallerError extends Error {
	constructor(
		public code: ClaroInstallerErrorCode,
		public detail: string[] = [],
	) {
		super(`Claro installer refused: ${code}`)
		this.name = "ClaroInstallerError"
	}
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const DEFAULT_IVU_RATE = 0.04

export type ClaroStage = "no_po" | "ready_for_ariba" | "sent" | "paid" | "short"

type Num = number | { toString(): string } | null | undefined
type ClaroStageInput = {
	poNumber: string | null
	aribaSentAt: Date | null
	claroPaidAt: Date | null
	claroPaidNet: Num
	claroTotal: Num
	shortAcceptedAt: Date | null
}
const n = (v: Num) => (v == null ? 0 : Number(v))

export function claroStage(inv: ClaroStageInput): ClaroStage {
	if (!inv.poNumber) return "no_po"
	if (inv.claroPaidAt) {
		if (inv.shortAcceptedAt) return "paid"
		return r2(n(inv.claroPaidNet)) >= r2(n(inv.claroTotal)) ? "paid" : "short"
	}
	return inv.aribaSentAt ? "sent" : "ready_for_ariba"
}

export async function addPo(opts: {
	invoiceId: string
	poNumber: string
	poDate: Date
	poFile: { name: string; bytes: Uint8Array }
	reprintTotal: number
	ivuRate?: number
	userId: string
}): Promise<void> {
	const inv = await db.ewitInvoice.findUnique({ where: { id: opts.invoiceId } })
	if (!inv) throw new ClaroInstallerError("not_found")
	if (inv.voidedAt || inv.heldAt) throw new ClaroInstallerError("voided")
	const rate = opts.ivuRate ?? DEFAULT_IVU_RATE
	if (inv.aribaSentAt || inv.claroPaidAt)
		throw new ClaroInstallerError("already_sent")
	// Integer cents: half-cent ties must round up, not drift with float error.
	const totalCents = Math.round(Number(inv.total) * 100)
	const ivuCents = Math.round((totalCents * Math.round(rate * 10000)) / 10000)
	const ivuAmount = ivuCents / 100
	const claroTotal = (totalCents + ivuCents) / 100
	if (Math.round(opts.reprintTotal * 100) !== totalCents + ivuCents)
		throw new ClaroInstallerError("po_total_mismatch", [
			`expected ${claroTotal.toFixed(2)}`,
		])
	const safe = opts.poFile.name.replace(/[^\w.-]+/g, "_")
	const poFilePath = await saveBuffer(
		"ewit-po",
		`po-${inv.number}-${Date.now()}-${safe}`,
		Buffer.from(opts.poFile.bytes),
	)
	await db.ewitInvoice.update({
		where: { id: inv.id },
		data: {
			poNumber: opts.poNumber,
			poDate: opts.poDate,
			poFilePath,
			ivuRate: rate,
			ivuAmount,
			claroTotal,
		},
	})
}

export async function markAribaSent(opts: {
	invoiceIds: string[]
	sentOn: Date
	userId: string
}): Promise<void> {
	await db.$transaction(async (tx) => {
		const rows = await tx.ewitInvoice.findMany({
			where: { id: { in: opts.invoiceIds } },
		})
		if (rows.length !== new Set(opts.invoiceIds).size)
			throw new ClaroInstallerError("not_found")
		if (rows.some((r) => r.voidedAt || r.heldAt))
			throw new ClaroInstallerError("voided")
		if (rows.some((r) => !r.poNumber))
			throw new ClaroInstallerError(
				"no_po",
				rows.filter((r) => !r.poNumber).map((r) => r.number),
			)
		if (rows.some((r) => r.aribaSentAt))
			throw new ClaroInstallerError(
				"already_sent",
				rows.filter((r) => r.aribaSentAt).map((r) => r.number),
			)
		const claimed = await tx.ewitInvoice.updateMany({
			where: { id: { in: rows.map((r) => r.id) }, aribaSentAt: null },
			data: { aribaSentAt: opts.sentOn, aribaSentById: opts.userId },
		})
		if (claimed.count !== rows.length)
			throw new ClaroInstallerError("already_sent")
	})
}
