import { evaluateReleaseGate } from "~/lib/release-gate"
import { uploadHref } from "~/lib/upload-href"

type PacketDocumentKey = "work_order_pdf" | "aviso" | "precert" | "photos"

type PacketDocument = {
	key: PacketDocumentKey
	/** i18n key of the row's label. */
	label: string
	/** The Aviso file name, or the photo count; "" when there is nothing to show. */
	detail: string
	/** Where the document opens, or null when it is missing. */
	href: string | null
	/** Every original photo, in `takenAt` order; empty for the other rows. */
	files: { name: string; href: string }[]
}

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? ""

type PacketSheet = {
	pdfPath: string | null
	sigSupervisorAt: Date | null
	sigSubcontractorAt: Date | null
	avisoNumber: string | null
	/** Set on a job with a certificate per crew. */
	brigadeName?: string | null
	brigadeCode?: string | null
}

/**
 * The released packet's four documents as Finance opens them (Finance/Admin
 * only). A document links only when the release gate counts it as present.
 */
export function packetDocuments(
	doc: {
		id: string
		jafInvoicePdfPath: string | null
		avisoNumber: string | null
		avisoDocPath: string | null
	},
	sheet: PacketSheet | PacketSheet[] | null,
	photos: {
		localPath: string
		tag: "BEFORE" | "DURING" | "AFTER" | null
		takenAt: Date
	}[],
): PacketDocument[] {
	const sheets = Array.isArray(sheet) ? sheet : sheet ? [sheet] : []
	const gate = evaluateReleaseGate({ doc, sheet: sheets, photos })
	const ok = (key: string) => gate.rows.find((r) => r.key === key)?.ok === true
	const sorted = [...photos].sort(
		(a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
	)
	// The photos route serves per-job folders: /files/photos/<docId>/<file>.
	const photoFiles = sorted.map((p) => ({
		name: basename(p.localPath),
		href: `/files/photos/${encodeURIComponent(doc.id)}/${encodeURIComponent(basename(p.localPath))}`,
	}))
	const first = photoFiles[0]
	const row = (
		key: PacketDocumentKey,
		detail: string,
		href: string | null,
		files: PacketDocument["files"] = [],
	): PacketDocument => ({
		key,
		label: `finance_verify.packet.${key}`,
		detail,
		href,
		files,
	})
	return [
		row(
			"work_order_pdf",
			"",
			ok("work_order_pdf") && doc.jafInvoicePdfPath
				? uploadHref(doc.jafInvoicePdfPath)
				: null,
		),
		row(
			"aviso",
			doc.avisoDocPath ? basename(doc.avisoDocPath) : "",
			ok("aviso") && doc.avisoDocPath ? uploadHref(doc.avisoDocPath) : null,
		),
		// One certificate per crew opens as a list; a single one as a link.
		sheets.length > 1
			? row(
					"precert",
					String(sheets.length),
					ok("precert_signed") && sheets[0].pdfPath
						? uploadHref(sheets[0].pdfPath)
						: null,
					ok("precert_signed")
						? sheets.flatMap((s, i) =>
								s.pdfPath
									? [
											{
												name: `${i + 1}/${sheets.length} · ${s.brigadeName ?? ""}${s.brigadeCode ? ` · ${s.brigadeCode}` : ""}`,
												href: uploadHref(s.pdfPath),
											},
										]
									: [],
							)
						: [],
				)
			: row(
					"precert",
					"",
					ok("precert_signed") && sheets[0]?.pdfPath
						? uploadHref(sheets[0].pdfPath)
						: null,
				),
		row(
			"photos",
			String(photos.length),
			// Kept for callers that open one file: the first photo taken.
			ok("photos") && first ? first.href : null,
			photoFiles,
		),
	]
}
