import { db } from "~/lib/db.server"
import { zipPackage } from "~/lib/package-zip.server"
import { packetDocuments } from "~/lib/packet-documents"
import { requireRole } from "~/lib/permissions.server"
import { photoFile } from "~/lib/uploads.server"
import type { Route } from "./+types/_app.finance.verify.$id.packet.zip"

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p

/**
 * "Download all" on the review screen: the released packet's documents in one
 * zip, byte for byte as stored, numbered in review order (JAF invoice, Aviso,
 * pre-cert, photos). A document the release gate does not count as present is
 * left out, the same as the review lists it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUnique({
		where: { id: params.id },
		include: {
			preCertSheets: {
				where: { supersededAt: null },
				orderBy: { version: "desc" },
				take: 1,
				select: {
					pdfPath: true,
					sigSupervisorAt: true,
					sigSubcontractorAt: true,
					// The gate counts a signed sheet only for the current Aviso.
					avisoNumber: true,
				},
			},
			photos: { select: { localPath: true, tag: true, takenAt: true } },
		},
	})
	if (!doc?.releasedToFinanceAt)
		return new Response("Not found", { status: 404 })

	const sheet = doc.preCertSheets[0] ?? null
	const present = new Map(
		packetDocuments(doc, sheet, doc.photos).map((d) => [d.key, d]),
	)
	const files: { name: string; path: string }[] = []
	if (present.get("work_order_pdf")?.href && doc.jafInvoicePdfPath)
		files.push({
			name: `1_JAF_invoice_${basename(doc.jafInvoicePdfPath)}`,
			path: doc.jafInvoicePdfPath,
		})
	if (present.get("aviso")?.href && doc.avisoDocPath)
		files.push({
			name: `2_Aviso_${doc.avisoNumber ?? ""}_${basename(doc.avisoDocPath)}`,
			path: doc.avisoDocPath,
		})
	if (present.get("precert")?.href && sheet?.pdfPath)
		files.push({
			name: `3_Precert_${basename(sheet.pdfPath)}`,
			path: sheet.pdfPath,
		})
	if (present.get("photos")?.href) {
		const byTime = [...doc.photos].sort(
			(a, b) => a.takenAt.getTime() - b.takenAt.getTime(),
		)
		for (const [i, p] of byTime.entries())
			files.push({
				name: `4_Photo_${String(i + 1).padStart(2, "0")}_${basename(p.localPath)}`,
				path: photoFile(doc.id, p.localPath),
			})
	}
	if (files.length === 0) return new Response("Not found", { status: 404 })

	const zip = await zipPackage(files)
	return new Response(new Uint8Array(zip), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-packet.zip"`,
		},
	})
}
