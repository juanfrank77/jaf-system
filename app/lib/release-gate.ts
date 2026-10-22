import { isLegacyPricedInvoice } from "~/lib/upload-href"

type ReleaseRowKey = "work_order_pdf" | "aviso" | "precert_signed" | "photos"

type ReleaseRow = {
	key: ReleaseRowKey
	ok: boolean
	/** The Aviso number, or the photo count; null when there is nothing to show. */
	detail: string | number | null
}

const present = (v: string | null | undefined) => !!v && v.trim() !== ""

/**
 * A stored work-order PDF counts only when it is the packet under `packets/`:
 * not an old priced invoice (`jaf-invoices/`), and not nothing.
 */
export function isPacketPath(path: string | null): boolean {
	if (!present(path) || isLegacyPricedInvoice(path)) return false
	return (path as string).split(/[\\/]/).filter(Boolean).at(-2) === "packets"
}

/**
 * The release gate is exactly four documents: the JAF work order PDF, the
 * Aviso (number + file), the pre-cert sheet signed by the supervisor and before + after photos.
 */
export function evaluateReleaseGate(input: {
	doc: {
		jafInvoicePdfPath: string | null
		avisoNumber: string | null
		avisoDocPath: string | null
	}
	sheet: {
		sigSupervisorAt: Date | null
		sigSubcontractorAt: Date | null
	} | null
	photos: { tag: "BEFORE" | "DURING" | "AFTER" | null }[]
}): { ok: boolean; rows: ReleaseRow[] } {
	const { doc, sheet, photos } = input
	const rows: ReleaseRow[] = [
		{
			key: "work_order_pdf",
			ok: isPacketPath(doc.jafInvoicePdfPath),
			detail: null,
		},
		{
			key: "aviso",
			ok: present(doc.avisoNumber) && present(doc.avisoDocPath),
			detail: present(doc.avisoNumber) ? (doc.avisoNumber as string) : null,
		},
		{
			key: "precert_signed",
			ok: !!sheet?.sigSupervisorAt,
			detail: null,
		},
		{
			key: "photos",
			ok:
				photos.some((p) => p.tag === "BEFORE") &&
				photos.some((p) => p.tag === "AFTER"),
			detail: photos.length,
		},
	]
	return { ok: rows.every((r) => r.ok), rows }
}
