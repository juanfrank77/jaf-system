import { db } from "~/lib/db.server"
import { billableMaterials } from "~/lib/finance-pipeline.server"
import { getActiveServiceCodes } from "~/lib/service-codes.server"
import {
	buildInvoiceLines,
	type InvoiceLine,
	type ServiceLine,
	sumLines,
} from "~/lib/service-lines"
import type { Prisma } from "../../generated/prisma/client"

type Qty = { serviceCodeId: string; qty: number }

export type CorrectionChange = {
	kind: "service" | "material"
	code: string
	name: string
	from: number | null
	to: number | null
}

export type InvoiceOriginal = {
	lines: InvoiceLine[]
	materials: Qty[]
	lineTotal: number
}

export class CorrectionError extends Error {
	constructor(public code: "no_changes" | "invalid_line" | "no_lines") {
		super(code)
	}
}

/** The quantity changes between two lists; a line added or removed shows as null. */
export function diffQty(
	kind: CorrectionChange["kind"],
	before: Qty[],
	after: Qty[],
	label: (id: string) => { code: string; name: string },
): CorrectionChange[] {
	const old = new Map(before.map((l) => [l.serviceCodeId, Number(l.qty)]))
	const next = new Map(after.map((l) => [l.serviceCodeId, Number(l.qty)]))
	return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
		const from = old.get(id) ?? null
		const to = next.get(id) ?? null
		return from === to ? [] : [{ kind, ...label(id), from, to }]
	})
}

/** Read the posted lines: known shape, positive quantities, each code once. */
export function parseQtyLines(raw: unknown): Qty[] {
	if (!Array.isArray(raw)) throw new CorrectionError("invalid_line")
	const lines = raw.map((l) => ({
		serviceCodeId: String(l?.serviceCodeId ?? ""),
		qty: Number(l?.qty),
	}))
	if (lines.some((l) => !l.serviceCodeId || !(l.qty > 0)))
		throw new CorrectionError("invalid_line")
	if (new Set(lines.map((l) => l.serviceCodeId)).size !== lines.length)
		throw new CorrectionError("invalid_line")
	return lines
}

/**
 * Lissette's "Correct to Aviso". What Claro approved on the Aviso wins, so she
 * fixes a service or material line herself instead of sending the packet back.
 * She never types a price: a changed or added line takes the catalog's, and an
 * untouched line keeps what it was billed at. The supervisor's lines stay as v1,
 * hers become the next version, and the PBCC invoice, Excel and payroll read
 * them from here on. Who, when and old → new go in the job's history.
 */
export async function correctToAviso(opts: {
	docId: string
	userId: string
	services: unknown
	materials: unknown
	note?: string | null
}): Promise<{ version: number; changes: CorrectionChange[] }> {
	const services = parseQtyLines(opts.services)
	const materials = parseQtyLines(opts.materials)
	if (services.length === 0) throw new CorrectionError("no_lines")
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: opts.docId },
		select: {
			jafInvoiceLines: true,
			jafInvoiceLineTotal: true,
			fieldMaterials: true,
			materialsUsed: true,
			materialsTaken: true,
			invoiceVersion: true,
			invoiceOriginal: true,
		},
	})
	const current = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	const currentMaterials = billableMaterials(doc as never) as unknown as Qty[]
	const catalog = await getActiveServiceCodes()
	const byId = Object.fromEntries(catalog.map((c) => [c.id, c]))
	const lines: InvoiceLine[] = services.flatMap((s) => {
		const kept = current.find((l) => l.serviceCodeId === s.serviceCodeId)
		if (kept && Number(kept.qty) === s.qty) return [kept]
		if (!byId[s.serviceCodeId]) throw new CorrectionError("invalid_line")
		return buildInvoiceLines([s as ServiceLine], byId)
	})
	if (materials.some((m) => !byId[m.serviceCodeId]))
		throw new CorrectionError("invalid_line")
	const label = (id: string) => {
		const code = byId[id]
		const line = current.find((l) => l.serviceCodeId === id)
		return {
			code: code?.claroCode ?? line?.claroCode ?? id,
			name: code?.name ?? line?.name ?? id,
		}
	}
	const changes = [
		...diffQty("service", current, lines, label),
		...diffQty("material", currentMaterials, materials, label),
	]
	if (changes.length === 0) throw new CorrectionError("no_changes")
	const version = doc.invoiceVersion + 1
	const original: InvoiceOriginal = {
		lines: current,
		materials: currentMaterials,
		lineTotal: Number(doc.jafInvoiceLineTotal ?? sumLines(current)),
	}
	const note = opts.note?.trim() || null
	await db.$transaction([
		db.jafInvoice.update({
			where: { id: opts.docId },
			data: {
				jafInvoiceLines: lines as unknown as Prisma.InputJsonValue,
				jafInvoiceLineTotal: sumLines(lines),
				materialsUsed: materials as unknown as Prisma.InputJsonValue,
				invoiceVersion: version,
				// The supervisor's v1 is kept once, the first time it changes.
				...(doc.invoiceOriginal
					? {}
					: {
							invoiceOriginal: original as unknown as Prisma.InputJsonValue,
						}),
			},
		}),
		db.auditTrail.create({
			data: {
				docId: opts.docId,
				userId: opts.userId,
				action: "FINANCE_CORRECTED",
				diffJson: {
					version,
					changes,
					note,
				} as unknown as Prisma.InputJsonValue,
			},
		}),
	])
	return { version, changes }
}
