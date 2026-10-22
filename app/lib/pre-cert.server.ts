import { db } from "~/lib/db.server"
import { generatePreCertSheetPdf } from "~/lib/pdf/pre-cert-sheet.server"
import { getActiveServiceCodes } from "~/lib/service-codes.server"
import {
	buildPreCertLines,
	type PreCertLine,
	type ServiceLine,
	sumLines,
} from "~/lib/service-lines"
import { isPreCertSigned } from "~/lib/supervisor-stage"
import { saveBuffer } from "~/lib/uploads.server"
import type { PreCertSheet, Prisma, Role } from "../../generated/prisma/client"

/** Renders a sheet's PDF and stores it as `precert/<docId>-v<version>.pdf`. */
export async function renderPreCert(
	sheet: PreCertSheet,
	docId: string,
): Promise<string> {
	const pdf = await generatePreCertSheetPdf({
		avisoNumber: sheet.avisoNumber,
		issuedOn: sheet.issuedOn,
		title: sheet.title,
		certifiedAddress: sheet.certifiedAddress,
		lines: sheet.lines as PreCertLine[],
		sigSupervisor: sheet.sigSupervisorName
			? {
					name: sheet.sigSupervisorName,
					image: sheet.sigSupervisorImage,
					at: sheet.sigSupervisorAt,
				}
			: null,
		sigSubcontractor: sheet.sigSubcontractorName
			? {
					name: sheet.sigSubcontractorName,
					code: sheet.sigSubcontractorCode,
					image: sheet.sigSubcontractorImage,
					at: sheet.sigSubcontractorAt,
				}
			: null,
		sigClaro: sheet.sigClaroAt
			? {
					name: sheet.sigClaroName,
					image: sheet.sigClaroImage,
					at: sheet.sigClaroAt,
				}
			: null,
	})
	return saveBuffer("precert", `${docId}-v${sheet.version}.pdf`, pdf)
}

/** The job's current (not superseded) pre-cert sheet. */
export const activeSheet = (docId: string) =>
	db.preCertSheet.findFirst({
		where: { docId, supersededAt: null },
		orderBy: { version: "desc" },
	})

/** Any signature on the sheet: it is then never regenerated silently. */
export const isSheetSigned = isPreCertSigned

/**
 * The sheet's lines: what the crew reported installed (extras included), never
 * the Aviso. Empty when nothing billable was installed.
 */
export async function preCertLinesFor(installed: ServiceLine[]) {
	const catalog = await getActiveServiceCodes()
	const codeMap = Object.fromEntries(catalog.map((c) => [c.id, c]))
	return {
		lines: buildPreCertLines(installed, codeMap),
		revision: installed[0]
			? (codeMap[installed[0].serviceCodeId]?.priceListRevision ?? null)
			: null,
	}
}

/**
 * Creates the next pre-cert sheet version for the job, superseding the active
 * one, with a `PRECERT_GENERATED` audit row. Called when the Aviso is saved
 * (step 6). Throws if nothing was installed: callers check `preCertLinesFor`
 * first so they can refuse before writing anything.
 */
export async function createPreCertSheet(args: {
	docId: string
	actor: { id: string; role: Role }
}): Promise<{ version: number }> {
	const { docId, actor } = args
	const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })
	const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
	const { lines, revision } = await preCertLinesFor(installed)
	if (lines.length === 0) throw new Error("installed_lines_required")
	const previous = await activeSheet(docId)
	const version = (previous?.version ?? 0) + 1
	const issuedOn = doc.fieldSubmittedAt ?? new Date()
	const certifiedAddress = doc.jobAddressActual ?? doc.jobAddressEstimated
	const title = doc.jobDescription ?? doc.jobType
	// Render the PDF BEFORE touching the database: if rendering/saving fails,
	// the previous version must stay the active sheet instead of being
	// superseded by a new version that has no PDF.
	const pdfPath = await renderPreCert(
		{
			version,
			avisoNumber: doc.avisoNumber,
			issuedOn,
			title,
			certifiedAddress,
			lines,
		} as unknown as PreCertSheet,
		docId,
	)
	await db.$transaction([
		...(previous
			? [
					db.preCertSheet.update({
						where: { id: previous.id },
						data: { supersededAt: new Date() },
					}),
				]
			: []),
		db.preCertSheet.create({
			data: {
				docId,
				version,
				avisoNumber: doc.avisoNumber,
				certifiedAddress,
				title,
				issuedOn,
				lines,
				priceListRevision: revision,
				total: sumLines(lines),
				issuedById: actor.id,
				pdfPath,
			},
		}),
		db.auditTrail.create({
			data: {
				docId,
				userId: actor.id,
				action: "PRECERT_GENERATED",
				diffJson: { version, supersedes: previous?.version ?? null },
			},
		}),
	] as unknown as Prisma.PrismaPromise<unknown>[])
	return { version }
}
