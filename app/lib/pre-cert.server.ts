import { assignedBrigadeIds } from "~/lib/crew-assignment"
import { crewLinesOf, readCrewLines } from "~/lib/crew-field"
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

/**
 * The job's current (not superseded) certificates, lead crew first. A job with
 * several crews has one per crew, issued together, so the lead's has the lowest
 * version.
 */
export const activeSheets = (docId: string) =>
	db.preCertSheet.findMany({
		where: { docId, supersededAt: null },
		orderBy: { version: "asc" },
	})

/** The lead crew's current certificate: the only one on a one-crew job. */
export const activeSheet = (docId: string) =>
	db.preCertSheet.findFirst({
		where: { docId, supersededAt: null },
		orderBy: { version: "asc" },
	})

/** One current certificate by id, or null when it is not this job's active one. */
export const activeSheetById = (docId: string, sheetId: string) =>
	db.preCertSheet.findFirst({
		where: { id: sheetId, docId, supersededAt: null },
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
 * ones, with a `PRECERT_GENERATED` audit row each. Called when the Aviso is
 * saved (step 6). A job with several crews gets one certificate per crew, built
 * from that crew's own installed lines (lead first, each with the job's Aviso);
 * a crew with no lines has nothing to certify and gets none. Throws if nothing
 * was installed: callers check `preCertLinesFor` first so they can refuse
 * before writing anything.
 */
export async function createPreCertSheet(args: {
	docId: string
	actor: { id: string; role: Role }
}): Promise<{ version: number; count: number }> {
	const { docId, actor } = args
	const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })
	const crewIds = assignedBrigadeIds(doc)
	const multiCrew = crewIds.length > 1
	const crewLines = readCrewLines(doc.crewServiceLines)
	const brigades = multiCrew
		? await db.brigade.findMany({
				where: { id: { in: crewIds } },
				select: { id: true, name: true, code: true },
			})
		: []
	const wanted: {
		brigade: { id: string; name: string; code: string | null } | null
		installed: ServiceLine[]
	}[] = multiCrew
		? crewIds.flatMap((id) => {
				const brigade = brigades.find((b) => b.id === id)
				return brigade
					? [{ brigade, installed: crewLinesOf(crewLines, id) }]
					: []
			})
		: [
				{
					brigade: null,
					installed: (doc.installedServiceLines as ServiceLine[] | null) ?? [],
				},
			]
	const built = (
		await Promise.all(
			wanted.map(async (w) => ({
				...w,
				...(await preCertLinesFor(w.installed)),
			})),
		)
	).filter((b) => b.lines.length > 0)
	if (built.length === 0) throw new Error("installed_lines_required")

	const previous = await activeSheets(docId)
	const first = (previous.at(-1)?.version ?? 0) + 1
	const issuedOn = doc.fieldSubmittedAt ?? new Date()
	const certifiedAddress = doc.jobAddressActual ?? doc.jobAddressEstimated
	const jobTitle = doc.jobDescription ?? doc.jobType
	const sheets = built.map((b, i) => ({
		version: first + i,
		brigade: b.brigade,
		lines: b.lines,
		revision: b.revision,
		// The certificate names its crew, so the printed sheet says whose it is.
		title: b.brigade
			? `${jobTitle} — ${b.brigade.name}${b.brigade.code ? ` (${b.brigade.code})` : ""}`
			: jobTitle,
	}))
	// Render every PDF BEFORE touching the database: if rendering/saving
	// fails, the previous certificates must stay active instead of being
	// superseded by new versions that have no PDF.
	const pdfPaths: string[] = []
	for (const sh of sheets)
		pdfPaths.push(
			await renderPreCert(
				{
					version: sh.version,
					avisoNumber: doc.avisoNumber,
					issuedOn,
					title: sh.title,
					certifiedAddress,
					lines: sh.lines,
				} as unknown as PreCertSheet,
				docId,
			),
		)
	await db.$transaction([
		...previous.map((p) =>
			db.preCertSheet.update({
				where: { id: p.id },
				data: { supersededAt: new Date() },
			}),
		),
		...sheets.flatMap((sh, i) => [
			db.preCertSheet.create({
				data: {
					docId,
					version: sh.version,
					avisoNumber: doc.avisoNumber,
					certifiedAddress,
					title: sh.title,
					issuedOn,
					lines: sh.lines,
					priceListRevision: sh.revision,
					total: sumLines(sh.lines),
					issuedById: actor.id,
					pdfPath: pdfPaths[i],
					...(sh.brigade
						? {
								brigadeId: sh.brigade.id,
								brigadeName: sh.brigade.name,
								brigadeCode: sh.brigade.code,
							}
						: {}),
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: actor.id,
					action: "PRECERT_GENERATED",
					diffJson: {
						version: sh.version,
						supersedes: previous[i]?.version ?? null,
						...(sh.brigade ? { brigadeId: sh.brigade.id } : {}),
					},
				},
			}),
		]),
	] as unknown as Prisma.PrismaPromise<unknown>[])
	return { version: first, count: sheets.length }
}
