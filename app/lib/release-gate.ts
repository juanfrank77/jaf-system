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

type GateSheet = {
	sigSupervisorAt: Date | null
	sigSubcontractorAt: Date | null
	/** The Aviso number the sheet was issued for. */
	avisoNumber: string | null
}

/**
 * The release gate is exactly four documents: the JAF work order PDF, the
 * Aviso (number + file), the pre-cert sheet signed by the supervisor and before + after photos.
 * The signed sheet must be the one for the job's current Aviso: a sheet that
 * records another Aviso number (the Aviso was replaced and the new sheet was
 * never created or signed) does not count. Sheets with no number pass. A job
 * with several crews has one certificate per crew, and every one must be signed.
 */
export function evaluateReleaseGate(input: {
	doc: {
		jafInvoicePdfPath: string | null
		avisoNumber: string | null
		avisoDocPath: string | null
	}
	/** The job's certificates: one on a one-crew job, one per crew otherwise. */
	sheet: GateSheet | GateSheet[] | null
	photos: { tag: "BEFORE" | "DURING" | "AFTER" | null }[]
}): { ok: boolean; rows: ReleaseRow[] } {
	const { doc, photos } = input
	const sheets = Array.isArray(input.sheet)
		? input.sheet
		: input.sheet
			? [input.sheet]
			: []
	const signed = sheets.filter(
		(sheet) =>
			!!sheet.sigSupervisorAt &&
			// A missing Aviso number is the aviso row's failure, not this one.
			(sheet.avisoNumber == null ||
				!present(doc.avisoNumber) ||
				sheet.avisoNumber === doc.avisoNumber),
	)
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
			ok: sheets.length > 0 && signed.length === sheets.length,
			// "1/2" when there is a certificate per crew.
			detail: sheets.length > 1 ? `${signed.length}/${sheets.length}` : null,
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
