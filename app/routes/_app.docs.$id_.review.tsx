import type { ParseKeys } from "i18next"
import { type ComponentProps, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { AvisoMatchCard } from "~/components/aviso-match"
import { RouteErrorBoundary } from "~/components/error-boundary"
import type { MaterialLineItems } from "~/components/material-line-items"
import {
	AddressCard,
	OrderedVsInstalledCard,
	PhotosCard,
	ReviewActionsCard,
} from "~/components/review-field-work"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { StepRail } from "~/components/step-rail"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import { Textarea } from "~/components/ui/textarea"
import {
	CONTRACTOR_SHARE_PERCENT,
	RETENTION_RATE,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import type { AddressCorrection } from "~/lib/field-update-helpers"
import { validateFile } from "~/lib/file-upload.server"
import { generateJafInvoicePdf } from "~/lib/pdf/jaf-invoice.server"
import { generatePreCertSheetPdf } from "~/lib/pdf/pre-cert-sheet.server"
import { canTransition, isReviewActionStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getActiveServiceCodes } from "~/lib/service-codes.server"
import {
	type AvisoLine,
	buildInvoiceLines,
	buildPreCertLines,
	type InvoiceLine,
	type PreCertLine,
	parseAvisoLines,
	round2,
	type ServiceLine,
	sumLines,
} from "~/lib/service-lines"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import {
	checkAvisoMatch,
	deriveSupervisorStage,
	evaluateReleaseGate,
	panelForStep,
	resolveStepView,
	SUPERVISOR_STAGES,
} from "~/lib/supervisor-stage"
import {
	getAvisoAmountTolerance,
	getIvuRate,
} from "~/lib/system-settings.server"
import { saveBuffer, saveUpload } from "~/lib/uploads.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { PreCertSheet, Prisma } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.docs.$id_.review"

type MaterialLine = { serviceCodeId: string; qty: number }

type SendBackHistoryEntry = {
	fromStatus: string
	toStatus: string
	note: string
	byUserId: string
	createdAt: string
}

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

async function renderPreCert(
	sheet: PreCertSheet,
	docId: string,
): Promise<string> {
	const pdf = await generatePreCertSheetPdf({
		avisoNumber: sheet.avisoNumber,
		issuedOn: sheet.issuedOn,
		title: sheet.title,
		certifiedAddress: sheet.certifiedAddress,
		lines: sheet.lines as PreCertLine[],
		total: toNumberPrice(sheet.total),
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

const activeSheet = (docId: string) =>
	db.preCertSheet.findFirst({
		where: { docId, supersededAt: null },
		orderBy: { version: "desc" },
	})

const invoiceNumberFor = (doc: {
	avisoNumber: string | null
	controlNumber: string
}) => `M2026-${doc.avisoNumber ?? doc.controlNumber}`

const isSig = (v: unknown) =>
	typeof v === "string" && v.startsWith("data:image") && v !== "data:,"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Supervisor Review — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { brigade: { select: { area: true } } },
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const personIds = [
		...new Set([
			...((doc.addressCorrections as AddressCorrection[] | null) ?? []).map(
				(c) => c.correctedById,
			),
			...(doc.completedById ? [doc.completedById] : []),
		]),
	]
	const [serviceCodes, photos, supervisor, sheet, brigade, tolerance, people] =
		await Promise.all([
			getActiveServiceCodes(),
			db.photo.findMany({ where: { docId: params.id } }),
			db.user.findUnique({ where: { id: doc.supervisorId } }),
			activeSheet(params.id),
			doc.brigadeId
				? db.brigade.findUnique({ where: { id: doc.brigadeId } })
				: Promise.resolve(null),
			getAvisoAmountTolerance(),
			db.user.findMany({
				where: { id: { in: personIds } },
				select: { id: true, name: true },
			}),
		])
	const correctorNames = Object.fromEntries(people.map((u) => [u.id, u.name]))
	const stage = deriveSupervisorStage(doc, sheet)
	const { view, interactive } = resolveStepView(
		stage,
		!!doc.avisoNumber || doc.avisoLines != null,
		new URL(request.url).searchParams.get("step"),
	)
	const gate = evaluateReleaseGate(doc, sheet, photos)
	const lineTotal =
		doc.jafInvoiceLineTotal != null
			? toNumberPrice(doc.jafInvoiceLineTotal)
			: null
	let invoiceSummary: {
		number: string
		lineTotal: number
		ivuRate: number
		ivu: number
		total: number
		sharePercent: number
		contractor: number
		retentionPercent: number
		contractorNet: number
	} | null = null
	if (lineTotal != null) {
		const ivuRate = await getIvuRate()
		const contractor = round2(lineTotal * CONTRACTOR_SHARE_PERCENT)
		invoiceSummary = {
			number: invoiceNumberFor(doc),
			lineTotal,
			ivuRate,
			ivu: round2(lineTotal * ivuRate),
			total: round2(lineTotal + round2(lineTotal * ivuRate)),
			sharePercent: CONTRACTOR_SHARE_PERCENT,
			contractor,
			retentionPercent: RETENTION_RATE,
			contractorNet: round2(contractor - round2(contractor * RETENTION_RATE)),
		}
	}
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		photos,
		supervisor,
		sheet,
		brigade,
		stage,
		view,
		interactive,
		gate,
		invoiceSummary,
		tolerance,
		correctorNames,
		submittedBy: doc.completedById
			? (correctorNames[doc.completedById] ?? null)
			: null,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: { brigade: { select: { area: true } } },
	})
	if (user.role === "SUPERVISOR") {
		await assertDocInSupervisorScope(db, user.id, doc)
	}
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "approve") {
		if (!canTransition(doc.status, "SUPERVISOR_APPROVED", user.role))
			throw redirect(`/docs/${params.id}`)
		const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		if (ordered.length > 0 && installed.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }
		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || doc.avisoNumber
		const claroNotes = (form.get("claroNotes") as string | null)?.trim() || null
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "SUPERVISOR_APPROVED",
					supervisorApprovedAt: new Date(),
					avisoNumber,
					claroNotes,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: doc.status, after: "SUPERVISOR_APPROVED" },
					},
				},
			}),
		])
	}

	if (intent === "upload_claro") {
		if (!canTransition(doc.status, "CLARO_UPLOADED", user.role))
			throw redirect(`/docs/${params.id}`)
		const claroPdf = form.get("claroPdf") as File
		if (!claroPdf || claroPdf.size === 0)
			return { errorKey: "docs_review.errors.pdf_required" }
		const validation = validateFile(claroPdf, "pdf")
		if (!validation.valid) return { errorMessage: validation.error }
		const localPath = await saveUpload(
			"claro-pdfs",
			`${params.id}-claro.pdf`,
			claroPdf,
		)
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					status: "CLARO_UPLOADED",
					claroPdfPath: localPath,
					claroUploadedAt: new Date(),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "STATUS_CHANGED",
					diffJson: {
						status: { before: "SUPERVISOR_APPROVED", after: "CLARO_UPLOADED" },
					},
				},
			}),
			...finance.map((f) =>
				db.notification.create({
					data: {
						userId: f.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} Claro work order uploaded. Ready for LC request.`,
					},
				}),
			),
		])
	}

	if (intent === "generate_jaf_invoice") {
		if (!isReviewActionStatus(doc.status) && doc.status !== "CLARO_UPLOADED")
			throw redirect(`/docs/${params.id}`)
		if (doc.avisoMatchedAt) throw redirect(`/docs/${params.id}/review`)

		const catalog = await getActiveServiceCodes()
		const codeMap = Object.fromEntries(catalog.map((c) => [c.id, c]))
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		const lines = buildInvoiceLines(installed, codeMap)
		if (lines.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }

		const lineTotal = sumLines(lines)
		const ivuRate = await getIvuRate()
		const factor = CONTRACTOR_SHARE_PERCENT
		const contractorAmount = round2(lineTotal * factor)
		const retention = round2(contractorAmount * 0.1)
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null

		const invoiceNumber = invoiceNumberFor(doc)
		const pdf = await generateJafInvoicePdf({
			controlNumber: doc.controlNumber,
			avisoNumber: doc.avisoNumber,
			jobType: doc.jobType,
			jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
			invoiceDate: new Date().toLocaleDateString("en-US"),
			invoiceNumber,
			debtor: "PRT/CLARO",
			lineItems: lines.map((l) => ({
				claroCode: l.claroCode,
				name: l.name,
				qty: l.qty,
				unit: l.unit ?? "",
				unitPrice: l.unitPrice,
				accountCode: l.accountCode,
			})),
			ivuRate,
			supervisorName: user.name,
			contractorShare: {
				factor,
				amount: contractorAmount,
				retention,
				net: round2(contractorAmount - retention),
				brigadeName: brigade?.name ?? null,
			},
		})
		const localPath = await saveBuffer(
			"jaf-invoices",
			`${params.id}-jaf-invoice.pdf`,
			pdf,
		)
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					jafInvoicePdfPath: localPath,
					jafInvoiceLines: lines,
					jafInvoiceLineTotal: lineTotal,
					jafInvoiceGeneratedAt: new Date(),
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "JAF_INVOICE_GENERATED",
					diffJson: { path: localPath, lineTotal, lines },
				},
			}),
		])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "save_aviso") {
		if (!doc.jafInvoiceGeneratedAt || !doc.jafInvoiceLines)
			return { errorKey: "docs_review.errors.invoice_required" }
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)

		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || null
		if (!avisoNumber)
			return { errorKey: "docs_review.errors.aviso_number_required" }

		let rawLines: AvisoLine[]
		try {
			rawLines = parseAvisoLines(form.get("avisoLines") as string | null)
		} catch {
			return { errorKey: "docs_review.errors.invalid_aviso_lines" }
		}
		// Merge duplicate codes (an Aviso may split one service over two rows).
		// Recompute the line from the merged qty when the unit price matches so
		// per-row rounding does not drift from the invoice total.
		const merged = new Map<string, AvisoLine>()
		for (const l of rawLines) {
			const prev = merged.get(l.serviceCodeId)
			if (prev) {
				const qty = prev.qty + l.qty
				prev.lineAmount =
					prev.unitPrice === l.unitPrice
						? round2(qty * prev.unitPrice)
						: round2(prev.lineAmount + l.lineAmount)
				prev.qty = qty
			} else merged.set(l.serviceCodeId, { ...l })
		}
		const avisoLines = [...merged.values()]
		if (avisoLines.length === 0)
			return { errorKey: "docs_review.errors.invalid_aviso_lines" }

		let avisoDocPath = doc.avisoDocPath
		const avisoPdf = form.get("avisoPdf")
		if (avisoPdf instanceof File && avisoPdf.size > 0) {
			const validation = validateFile(avisoPdf, "pdf")
			if (!validation.valid) return { errorMessage: validation.error }
			avisoDocPath = await saveUpload(
				"aviso-docs",
				`${params.id}-aviso.pdf`,
				avisoPdf,
			)
		}
		if (!avisoDocPath)
			return { errorKey: "docs_review.errors.aviso_pdf_required" }

		const tolerance = await getAvisoAmountTolerance()
		const match = checkAvisoMatch(
			doc.jafInvoiceLines as InvoiceLine[],
			avisoLines,
			tolerance,
		)
		const lineNote = (form.get("lineNote") as string | null)?.trim() || null
		if (match.amountOk && match.lineMismatches.length > 0 && !lineNote)
			return {
				errorKey: "docs_review.errors.aviso_line_note_required",
				lineMismatches: match.lineMismatches,
			}

		const baseData = {
			avisoNumber,
			avisoDocPath,
			avisoLines,
			avisoLineTotal: match.avisoTotal,
		}
		const ops: Prisma.PrismaPromise<unknown>[] = [
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_CAPTURED",
					diffJson: {
						avisoNumber,
						avisoTotal: match.avisoTotal,
						invoiceTotal: match.invoiceTotal,
						difference: match.difference,
						amountOk: match.amountOk,
					},
				},
			}),
		]

		if (!match.amountOk) {
			ops.unshift(
				db.jafInvoice.update({ where: { id: params.id }, data: baseData }),
			)
			await db.$transaction(ops)
			return {
				errorKey: "docs_review.errors.aviso_amount_mismatch",
				invoiceTotal: match.invoiceTotal,
				avisoTotal: match.avisoTotal,
				difference: match.difference,
				tolerance,
			}
		}

		const transition = canTransition(doc.status, "CLARO_UPLOADED", user.role)
		ops.unshift(
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					...baseData,
					avisoMatchedAt: new Date(),
					...(transition
						? { status: "CLARO_UPLOADED", claroUploadedAt: new Date() }
						: {}),
				},
			}),
		)
		if (transition)
			ops.push(
				db.auditTrail.create({
					data: {
						docId: params.id,
						userId: user.id,
						action: "STATUS_CHANGED",
						diffJson: {
							status: { before: doc.status, after: "CLARO_UPLOADED" },
						},
					},
				}),
			)
		if (match.lineMismatches.length > 0)
			ops.push(
				db.auditTrail.create({
					data: {
						docId: params.id,
						userId: user.id,
						action: "QUANTITY_DISCREPANCY",
						diffJson: {
							source: "AVISO",
							discrepancies: match.lineMismatches,
							note: lineNote,
							blocksFinance: false,
						},
					},
				}),
			)
		await db.$transaction(ops)
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "generate_precert") {
		if (!doc.avisoMatchedAt)
			return { errorKey: "docs_review.errors.aviso_match_required" }
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)
		const catalog = await getActiveServiceCodes()
		const codeMap = Object.fromEntries(catalog.map((c) => [c.id, c]))
		const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
		const lines = buildPreCertLines(installed, codeMap)
		if (lines.length === 0)
			return { errorKey: "docs_review.errors.installed_lines_required" }
		const previous = await activeSheet(params.id)
		if (previous)
			await db.preCertSheet.update({
				where: { id: previous.id },
				data: { supersededAt: new Date() },
			})
		const revision =
			codeMap[installed[0].serviceCodeId]?.priceListRevision ?? null
		const created = await db.preCertSheet.create({
			data: {
				docId: params.id,
				version: (previous?.version ?? 0) + 1,
				avisoNumber: doc.avisoNumber,
				certifiedAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
				title: doc.jobDescription ?? doc.jobType,
				issuedOn: doc.fieldSubmittedAt ?? new Date(),
				lines,
				priceListRevision: revision,
				total: sumLines(lines),
				issuedById: user.id,
			},
		})
		const pdfPath = await renderPreCert(
			{ ...created, lines, total: sumLines(lines) } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({ where: { id: created.id }, data: { pdfPath } }),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_GENERATED",
					diffJson: {
						version: created.version,
						supersedes: previous?.version ?? null,
					},
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "edit_precert_qty") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		if (sheet.sigSupervisorAt)
			return { errorKey: "docs_review.errors.precert_locked" }
		const reason = (form.get("reason") as string | null)?.trim() || ""
		if (!reason)
			return { errorKey: "docs_review.errors.precert_edit_reason_required" }
		const serviceCodeId = form.get("serviceCodeId") as string
		const certifiedQty = Math.max(
			0,
			Number.parseInt((form.get("certifiedQty") as string) || "0", 10) || 0,
		)
		const lines = (sheet.lines as PreCertLine[]).map((l) =>
			l.serviceCodeId === serviceCodeId
				? {
						...l,
						certifiedQty,
						editReason: reason,
						lineAmount: round2(certifiedQty * l.unitPrice),
					}
				: l,
		)
		const total = sumLines(lines)
		const pdfPath = await renderPreCert(
			{ ...sheet, lines, total } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { lines, total, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_QTY_EDITED",
					diffJson: { serviceCodeId, certifiedQty, reason },
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_supervisor") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		const data = {
			sigSupervisorUserId: user.id,
			sigSupervisorName: user.name,
			sigSupervisorImage: signature as string,
			sigSupervisorAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: { role: "SUPERVISOR", version: sheet.version },
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_subcontractor") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		if (!isSig(signature))
			return { errorKey: "docs_review.errors.signature_required" }
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null
		const typedCode =
			(form.get("contractorCode") as string | null)?.trim() || null
		const code = brigade?.code ?? typedCode
		if (!code)
			return { errorKey: "docs_review.errors.contractor_code_required" }
		const signerName =
			(form.get("signerName") as string | null)?.trim() ||
			brigade?.leadName ||
			brigade?.name ||
			""
		if (brigade && !brigade.code)
			await db.brigade.update({ where: { id: brigade.id }, data: { code } })
		const data = {
			sigSubcontractorCode: code,
			sigSubcontractorName: signerName,
			sigSubcontractorImage: signature as string,
			sigSubcontractorAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.jafInvoice.update({
				where: { id: params.id },
				data: { contractorAccountCode: code },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: {
						role: "SUBCONTRACTOR",
						code,
						signerName,
						version: sheet.version,
					},
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "sign_precert_claro") {
		const sheet = await activeSheet(params.id)
		if (!sheet) return { errorKey: "docs_review.errors.precert_required" }
		const signature = form.get("signature")
		const scan = form.get("scan")
		const signerName = (form.get("signerName") as string | null)?.trim() || null
		let sigClaroScanPath: string | null = null
		if (scan instanceof File && scan.size > 0) {
			const v = validateFile(scan, "file")
			if (!v.valid) return { errorMessage: v.error }
			const ext = scan.name.toLowerCase().match(/\.[^.]+$/)?.[0] || ".jpg"
			sigClaroScanPath = await saveUpload(
				"precert",
				`${params.id}-claro-scan${ext}`,
				scan,
			)
		}
		if (!isSig(signature) && !sigClaroScanPath)
			return { errorKey: "docs_review.errors.signature_required" }
		const data = {
			sigClaroName: signerName,
			sigClaroImage: isSig(signature) ? (signature as string) : null,
			sigClaroScanPath,
			sigClaroAt: new Date(),
		}
		const pdfPath = await renderPreCert(
			{ ...sheet, ...data } as unknown as PreCertSheet,
			params.id,
		)
		await db.$transaction([
			db.preCertSheet.update({
				where: { id: sheet.id },
				data: { ...data, pdfPath },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PRECERT_SIGNED",
					diffJson: {
						role: "CLARO",
						scanned: !!sigClaroScanPath,
						version: sheet.version,
					},
				},
			}),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "release_to_finance") {
		if (doc.releasedToFinanceAt) throw redirect(`/docs/${params.id}/review`)
		const [sheet, photos] = await Promise.all([
			activeSheet(params.id),
			db.photo.findMany({ where: { docId: params.id }, select: { tag: true } }),
		])
		const gate = evaluateReleaseGate(doc, sheet, photos)
		if (!gate.ok)
			return {
				errorKey: "docs_review.errors.release_blocked",
				conditions: gate.conditions,
			}
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null
		const contractor =
			sheet?.sigSubcontractorName ?? brigade?.leadName ?? brigade?.name ?? ""
		const amount = toNumberPrice(doc.jafInvoiceLineTotal).toFixed(2)
		const message = `${doc.controlNumber} · Aviso ${doc.avisoNumber} · ${contractor} · $${amount} — ready for payment request`
		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					releasedToFinanceAt: new Date(),
					releasedToFinanceById: user.id,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "RELEASED_TO_FINANCE",
					diffJson: { conditions: gate.conditions },
				},
			}),
			...finance.map((f) =>
				db.notification.create({
					data: { userId: f.id, docId: params.id, message },
				}),
			),
		] as unknown as Prisma.PrismaPromise<unknown>[])
		throw redirect(`/docs/${params.id}/review`)
	}

	if (intent === "send_back") {
		const note = (form.get("note") as string | null)?.trim() || ""
		if (!note) return { errorKey: "docs_review.errors.send_back_note_required" }
		if (!isReviewActionStatus(doc.status)) throw redirect(`/docs/${params.id}`)

		const crew = await db.user.findMany({
			where: { id: { in: doc.assignedCrewIds }, active: true },
		})
		const history = (
			(doc.sendBackHistory as unknown as SendBackHistoryEntry[]) || []
		).concat([
			{
				fromStatus: doc.status,
				toStatus: "SIGNED",
				note,
				byUserId: user.id,
				createdAt: new Date().toISOString(),
			},
		])
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { status: "SIGNED", sendBackHistory: history },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "SEND_BACK",
					diffJson: { from: doc.status, to: "SIGNED", note },
				},
			}),
			...crew.map((c) =>
				db.notification.create({
					data: {
						userId: c.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} sent back to you: ${note}`,
					},
				}),
			),
		])
	}

	if (intent === "edit_aviso") {
		// PRD §1.5: supervisor can enter/update the Aviso # at any point.
		const avisoNumber =
			(form.get("avisoNumber") as string | null)?.trim() || null
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { avisoNumber },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "AVISO_NUMBER_SET",
					diffJson: { avisoNumber },
				},
			}),
		])
		throw redirect(`/docs/${params.id}`)
	}

	throw redirect(`/docs/${params.id}`)
}

const CONDITION_KEYS = {
	approved: "release.condition.approved",
	invoice: "release.condition.invoice",
	aviso: "release.condition.aviso",
	amount_match: "release.condition.amount_match",
	photos: "release.condition.photos",
	precert_signed: "release.condition.precert_signed",
	contractor_code: "release.condition.contractor_code",
} as const

function SignatureBlock({
	intent,
	labelKey,
	children,
	signed,
	optional = false,
	encType,
	readOnly = false,
}: {
	intent: string
	labelKey: ParseKeys
	/** Fields above the pad (name, contractor code, scan upload). */
	children?: React.ReactNode
	/** Present once this party has signed: replaces the form with a summary. */
	signed?: React.ReactNode
	optional?: boolean
	encType?: "multipart/form-data"
	readOnly?: boolean
}) {
	const { t } = useTranslation()
	const padRef = useRef<SignaturePadHandle>(null)
	const [cleared, setCleared] = useState(0)
	const header = (
		<div className="flex items-start justify-between gap-2">
			<p className="text-sm font-medium">{t(labelKey)}</p>
			{signed ? (
				<span className="shrink-0 rounded-full bg-status-ok-soft px-2 py-0.5 text-xs font-medium text-status-ok">
					✓ {t("precert.signed")}
				</span>
			) : (
				<span className="text-xs text-muted-foreground">
					{optional ? t("precert.optional") : t("precert.required")}
				</span>
			)}
		</div>
	)
	const box = "flex-1 min-w-[14rem] border rounded-lg p-3 space-y-3"
	if (signed || readOnly) {
		return (
			<div className={box}>
				{header}
				{signed ?? (
					<p className="text-xs text-muted-foreground">
						{t("precert.not_captured")}
					</p>
				)}
			</div>
		)
	}
	return (
		<Form
			method="post"
			encType={encType}
			className={box}
			onSubmit={(e) => {
				const pad = padRef.current
				const form = e.currentTarget
				const input = form.elements.namedItem(
					"signature",
				) as HTMLInputElement | null
				const scan = form.elements.namedItem("scan") as HTMLInputElement | null
				const hasScan = !!scan?.files?.length
				if ((!pad || pad.isEmpty()) && !hasScan) {
					e.preventDefault()
				} else if (input && pad && !pad.isEmpty()) {
					input.value = pad.toDataURL()
				}
			}}
		>
			<input type="hidden" name="intent" value={intent} />
			<input type="hidden" name="signature" />
			{header}
			{children}
			<div className="space-y-1">
				<SignaturePad
					key={cleared}
					ref={padRef}
					width={280}
					height={90}
					className="w-full border rounded bg-card"
				/>
				<p className="text-xs text-muted-foreground">
					{t("precert.sign_here")}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => setCleared((c) => c + 1)}
				>
					{t("precert.clear_signature")}
				</Button>
				<Button type="submit" size="sm" className="ml-auto">
					{t("precert.sign")}
				</Button>
			</div>
		</Form>
	)
}

function PreCertPanel({
	sheet,
	doc,
	brigade,
	error,
	readOnly = false,
}: {
	readOnly?: boolean
	sheet: Route.ComponentProps["loaderData"]["sheet"]
	doc: Route.ComponentProps["loaderData"]["doc"]
	brigade: Route.ComponentProps["loaderData"]["brigade"]
	error: { errorKey?: string; errorMessage?: string } | null
}) {
	const { t } = useTranslation()
	const lines = (sheet?.lines as PreCertLine[] | null) ?? []
	const locked = !!sheet?.sigSupervisorAt
	const notCaptured = (
		<p className="text-xs text-muted-foreground">{t("precert.not_captured")}</p>
	)
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="font-medium">
					{t("precert.version", { n: sheet?.version ?? 1 })}
				</span>
				{sheet?.pdfPath && (
					<a
						href={`/files/precert/${doc.id}-v${sheet.version}.pdf`}
						className="text-accent-text underline"
					>
						{t("precert.download")}
					</a>
				)}
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-muted-foreground border-b">
						<th className="py-1">{t("service_picker.col_code")}</th>
						<th className="py-1">{t("service_picker.col_description")}</th>
						<th className="py-1 text-right">
							{t("service_picker.col_installed")}
						</th>
						<th className="py-1 text-right">{t("precert.col_qty")}</th>
						<th className="py-1 text-right">{t("precert.col_cost")}</th>
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => (
						<tr key={l.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1">
								{l.description}
								{l.editReason && (
									<span className="block text-xs text-status-warn">
										{l.editReason}
									</span>
								)}
							</td>
							<td className="py-1 text-right">{l.installedQty}</td>
							<td className="py-1 text-right">{l.certifiedQty}</td>
							<td className="py-1 text-right">${l.lineAmount.toFixed(2)}</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="text-sm text-right font-medium">
				{t("precert.total")} {formatMoney(sheet?.total ?? 0)}
			</p>
			{!readOnly &&
				!locked &&
				lines.map((l) => (
					<Form
						key={l.serviceCodeId}
						method="post"
						className="flex flex-wrap items-center gap-2 text-xs"
					>
						<input type="hidden" name="intent" value="edit_precert_qty" />
						<input type="hidden" name="serviceCodeId" value={l.serviceCodeId} />
						<span className="font-mono">{l.claroCode}</span>
						<Input
							name="certifiedQty"
							type="number"
							min={0}
							defaultValue={l.certifiedQty}
							className="w-20"
						/>
						<Input
							name="reason"
							placeholder={t("precert.reason_placeholder")}
							className="flex-1 min-w-[10rem]"
							required
						/>
						<Button type="submit" size="sm" variant="outline">
							{t("precert.save_qty")}
						</Button>
					</Form>
				))}
			<div className="space-y-2 pt-1">
				<h3 className="text-sm font-medium">{t("precert.signatures")}</h3>
				{!readOnly && (
					<p className="text-xs text-muted-foreground">
						{t("precert.signatures_hint")}
					</p>
				)}
			</div>
			<div className="flex flex-wrap gap-3">
				<SignatureBlock
					intent="sign_precert_supervisor"
					labelKey="precert.sig_supervisor"
					readOnly={readOnly}
					signed={
						sheet?.sigSupervisorName ? (
							<div className="space-y-1">
								{sheet.sigSupervisorImage && (
									<img
										src={sheet.sigSupervisorImage}
										alt=""
										className="h-12 rounded border bg-white"
									/>
								)}
								<p className="text-sm">{sheet.sigSupervisorName}</p>
								<p className="text-xs text-muted-foreground">
									{sheet.sigSupervisorAt
										? new Date(sheet.sigSupervisorAt).toLocaleDateString()
										: ""}
								</p>
							</div>
						) : undefined
					}
				/>
				<SignatureBlock
					intent="sign_precert_subcontractor"
					labelKey="precert.sig_subcontractor"
					readOnly={readOnly}
					signed={
						sheet?.sigSubcontractorName ? (
							<div className="space-y-1">
								{sheet.sigSubcontractorImage && (
									<img
										src={sheet.sigSubcontractorImage}
										alt=""
										className="h-12 rounded border bg-white"
									/>
								)}
								<p className="text-sm">
									{sheet.sigSubcontractorName} · {sheet.sigSubcontractorCode}
								</p>
							</div>
						) : undefined
					}
				>
					<Input
						name="signerName"
						aria-label={t("precert.signer_name")}
						placeholder={t("precert.signer_name")}
						defaultValue={brigade?.leadName ?? ""}
					/>
					{!brigade?.code && (
						<Input
							name="contractorCode"
							placeholder={t("precert.contractor_code")}
							required
						/>
					)}
				</SignatureBlock>
				<SignatureBlock
					intent="sign_precert_claro"
					labelKey="precert.sig_claro"
					encType="multipart/form-data"
					optional
					readOnly={readOnly}
					signed={
						sheet?.sigClaroAt ? (
							<div className="space-y-1">
								{sheet.sigClaroImage && (
									<img
										src={sheet.sigClaroImage}
										alt=""
										className="h-12 rounded border bg-white"
									/>
								)}
								{sheet.sigClaroScanPath && (
									<a
										href={`/files/precert/${doc.id}-claro-scan.jpg`}
										className="text-accent-text underline text-xs"
									>
										{t("precert.download")}
									</a>
								)}
								<p className="text-sm">{sheet.sigClaroName}</p>
							</div>
						) : undefined
					}
				>
					<p className="text-xs text-muted-foreground">
						{t("precert.claro_optional")}
					</p>
					<Input
						name="signerName"
						aria-label={t("precert.signer_name")}
						placeholder={t("precert.signer_name")}
					/>
					<Input
						type="file"
						name="scan"
						accept="image/*,application/pdf"
						aria-label={t("precert.upload_scan")}
						className="h-auto py-1.5 text-xs"
					/>
				</SignatureBlock>
			</div>
			{error?.errorKey ? (
				<p className="text-sm text-status-danger">
					{t(error.errorKey as ParseKeys)}
				</p>
			) : error?.errorMessage ? (
				<p className="text-sm text-status-danger">{error.errorMessage}</p>
			) : null}
			{!readOnly && !doc.releasedToFinanceAt && (
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
					<Form
						method="post"
						onSubmit={(e) => {
							if (locked && !window.confirm(t("precert.regenerate_confirm")))
								e.preventDefault()
						}}
					>
						<input type="hidden" name="intent" value="generate_precert" />
						<Button type="submit" variant="ghost" size="sm">
							{t("precert.regenerate")}
						</Button>
						<p className="text-xs text-muted-foreground">
							{t("precert.regenerate_hint")}
						</p>
					</Form>
					<p className="max-w-xs text-right text-xs text-muted-foreground">
						{t("precert.continue_hint")}
					</p>
				</div>
			)}
			{readOnly && sheet?.sigSupervisorAt && sheet?.sigSubcontractorAt && (
				<div className="flex justify-end border-t pt-3">
					<Link to="?step=RELEASE" className={buttonVariants({})}>
						{t("precert.continue_release")}
					</Link>
				</div>
			)}
		</div>
	)
}

export default function ReviewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		user,
		serviceCodes,
		photos,
		supervisor,
		sheet,
		brigade,
		stage,
		view,
		interactive,
		gate,
		invoiceSummary,
		tolerance,
		correctorNames,
		submittedBy,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as
		| {
				errorKey?: string
				errorMessage?: string
				invoiceTotal?: number
				avisoTotal?: number
				difference?: number
				conditions?: { key: string; ok: boolean }[]
		  }
		| undefined
	// Json columns: tolerate null or a malformed non-array value
	const asLines = (v: unknown) =>
		Array.isArray(v) ? (v as MaterialLine[]) : []
	const estimated = asLines(doc.estimatedMaterials)
	const taken = asLines(doc.materialsTaken)
	const used = asLines(doc.materialsUsed)
	const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
	const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
	const invoiceLines = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	const avisoLines = (doc.avisoLines as AvisoLine[] | null) ?? []
	const precertLines = (sheet?.lines as PreCertLine[] | undefined) ?? undefined

	// Basenames for photos; plain string split because `node:path` is not available in the client bundle
	const photoItems = photos.map((p) => ({
		id: p.id,
		basename: p.localPath.split(/[\\/]/).pop() ?? p.localPath,
		tag: p.tag,
		takenAt: String(p.takenAt),
	}))
	const corrections =
		(doc.addressCorrections as AddressCorrection[] | null) ?? []
	const panel = panelForStep(view)
	// The one-line "Step N of 9" callout under the rail. Approve only shows while
	// it is the live step; later screens show it whenever they can be acted on.
	const calloutKey =
		view === "APPROVE"
			? stage === "APPROVE"
				? "approve"
				: null
			: interactive &&
					(view === "INVOICE" ||
						view === "AVISO" ||
						view === "PRECERT" ||
						view === "RELEASE")
				? (view.toLowerCase() as "invoice" | "aviso" | "precert" | "release")
				: null
	// Once an Aviso number or lines are saved the invoice is what was keyed into
	// Claro, so it can no longer be regenerated from here.
	const avisoStarted = !!doc.avisoNumber || doc.avisoLines != null

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h1 className="font-mono text-xl font-semibold">{doc.controlNumber}</h1>
				<Badge variant="info">{doc.status.replace(/_/g, " ")}</Badge>
			</div>
			<p className="text-sm text-muted-foreground">
				{doc.jobType}
				{submittedBy &&
					` · ${t("docs_review.submitted_by", { name: submittedBy })}`}
				{doc.fieldSubmittedAt &&
					` · ${new Date(doc.fieldSubmittedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`}
			</p>
			<StepRail stage={stage} view={view} />
			{!interactive && (
				<Pill variant="info" icon="🔒">
					<b>{t("docs_review.readonly_title")}</b>{" "}
					{t("docs_review.readonly_body")}{" "}
					<Link to="." className="underline">
						{t("docs_review.readonly_back")}
					</Link>
					{" · "}
					<Link to={`/docs/${doc.id}`} className="underline">
						{t("docs_review.readonly_work_order")}
					</Link>
				</Pill>
			)}
			{calloutKey && (
				<Pill variant="info">
					<b>
						{t(`docs_review.callout_${calloutKey}_title`, {
							n: SUPERVISOR_STAGES.indexOf(view) + 1,
							total: SUPERVISOR_STAGES.length,
						})}
					</b>{" "}
					{t(`docs_review.callout_${calloutKey}_body`)}
				</Pill>
			)}

			{/* A — Approve */}
			{panel === "APPROVE" && (
				<>
					<AddressCard
						estimated={doc.jobAddressEstimated}
						corrections={corrections}
						correctorNames={correctorNames}
						notes={doc.fieldNotes}
					/>
					<PhotosCard docId={doc.id} photos={photoItems} />
					<OrderedVsInstalledCard
						ordered={ordered}
						installed={installed}
						estimated={estimated}
						taken={taken}
						used={used}
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
					/>
					{interactive && (
						<ReviewActionsCard
							canApprove={doc.status === "FIELD_UPDATED"}
							canSendBack={
								doc.status === "FIELD_UPDATED" ||
								doc.status === "SUPERVISOR_APPROVED"
							}
						/>
					)}
				</>
			)}

			{/* B — Invoice */}
			{panel === "INVOICE" && (
				<Card>
					<CardHeader className="items-start">
						<div>
							<div className="text-base font-bold">
								{t("docs_review_steps.invoice_title")}
							</div>
							{invoiceSummary && doc.jafInvoiceGeneratedAt && (
								<div className="mt-0.5 text-xs font-normal text-muted-foreground">
									{t("docs_review_steps.invoice_subtitle", {
										number: invoiceSummary.number,
										date: new Date(
											doc.jafInvoiceGeneratedAt,
										).toLocaleDateString(),
									})}
								</div>
							)}
						</div>
					</CardHeader>
					<CardContent className="space-y-3">
						{invoiceLines.length > 0 && (
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="py-1.5">{t("docs_review.table.code")}</th>
										<th className="py-1.5">
											{t("docs_review.table.description")}
										</th>
										<th className="py-1.5 text-right">
											{t("docs_review.table.qty")}
										</th>
										<th className="py-1.5 text-right">
											{t("docs_review_steps.unit_price")}
										</th>
										<th className="py-1.5 text-right">
											{t("docs_review_steps.line_amount")}
										</th>
									</tr>
								</thead>
								<tbody className="tabular-nums">
									{invoiceLines.map((l) => (
										<tr
											key={l.serviceCodeId}
											className="border-b last:border-0"
										>
											<td className="py-1.5 font-mono text-xs font-semibold">
												{l.claroCode}
											</td>
											<td className="py-1.5">{l.name}</td>
											<td className="py-1.5 text-right">{l.qty}</td>
											<td className="py-1.5 text-right">
												${l.unitPrice.toFixed(4)}
											</td>
											<td className="py-1.5 text-right">
												${l.lineAmount.toFixed(2)}
											</td>
										</tr>
									))}
								</tbody>
								{invoiceSummary && (
									<tfoot className="tabular-nums">
										<tr>
											<td colSpan={4} className="pr-6 pt-5 pb-1.5 text-right">
												{t("docs_review_steps.line_sum_pre_ivu")}
											</td>
											<td className="pt-5 pb-1.5 text-right font-semibold">
												{formatMoney(invoiceSummary.lineTotal)}
											</td>
										</tr>
										<tr className="text-status-warn">
											<td colSpan={4} className="py-1.5 pr-6 text-right">
												{t("docs_review_steps.ivu_row", {
													rate: round2(invoiceSummary.ivuRate * 100),
												})}
											</td>
											<td className="py-1.5 text-right">
												{formatMoney(invoiceSummary.ivu)}
											</td>
										</tr>
										<tr className="border-t font-semibold">
											<td colSpan={4} className="pr-6 pt-3 pb-1.5 text-right">
												{t("docs_review_steps.invoice_total")}
											</td>
											<td className="pt-3 pb-1.5 text-right text-base">
												{formatMoney(invoiceSummary.total)}
											</td>
										</tr>
										<tr className="text-muted-foreground">
											<td colSpan={4} className="pr-6 pt-6 pb-1.5 text-right">
												{t("docs_review_steps.contractor_share", {
													percent: round2(invoiceSummary.sharePercent * 100),
													name: brigade?.name ?? "—",
												})}{" "}
												<span className="text-xs italic">
													{t("docs_review_steps.information_only")}
												</span>
											</td>
											<td className="pt-6 pb-1.5 text-right">
												{formatMoney(invoiceSummary.contractor)}
											</td>
										</tr>
										<tr className="text-muted-foreground">
											<td colSpan={4} className="py-1.5 pr-6 text-right">
												{t("docs_review_steps.retention_row", {
													percent: round2(
														invoiceSummary.retentionPercent * 100,
													),
												})}
											</td>
											<td className="py-1.5 text-right">
												{formatMoney(invoiceSummary.contractorNet)}
											</td>
										</tr>
									</tfoot>
								)}
							</table>
						)}
						{doc.jafInvoicePdfPath && (
							<a
								href={`/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`}
								className="text-accent-text underline text-sm"
							>
								{t("docs_review.download")}
							</a>
						)}
						{interactive && !doc.avisoMatchedAt && !avisoStarted && (
							<Form method="post">
								<input
									type="hidden"
									name="intent"
									value="generate_jaf_invoice"
								/>
								<Button type="submit" variant="outline" size="sm">
									{doc.jafInvoiceGeneratedAt
										? t("docs_review_steps.regenerate_invoice")
										: t("docs_review.generate_jaf_invoice")}
								</Button>
							</Form>
						)}
						{interactive && invoiceLines.length > 0 && !doc.avisoMatchedAt && (
							<Pill variant="warn" icon="→">
								<b>{t("docs_review_steps.next_aviso_title")}</b>{" "}
								{t("docs_review_steps.next_aviso_body")}
							</Pill>
						)}
						{interactive && stage === "AVISO" && (
							<Link
								to="?step=AVISO"
								className={buttonVariants({ className: "w-full" })}
							>
								{t("docs_review_steps.continue_to_aviso")}
							</Link>
						)}
					</CardContent>
				</Card>
			)}

			{/* C — Aviso & match */}
			{panel === "AVISO" && doc.jafInvoiceGeneratedAt && (
				<AvisoMatchCard
					docId={doc.id}
					avisoNumber={doc.avisoNumber}
					avisoDocPath={doc.avisoDocPath}
					storedLines={avisoLines}
					locked={!!doc.releasedToFinanceAt}
					invoiceLines={invoiceLines}
					ordered={ordered}
					certified={precertLines}
					catalogPrices={Object.fromEntries(
						serviceCodes.map((c) => [c.id, c.unitPrice]),
					)}
					tolerance={tolerance}
					error={error ?? null}
					readOnly={!interactive}
					started={avisoStarted}
				>
					{interactive && doc.status === "SUPERVISOR_APPROVED" && (
						<details className="pt-3">
							<summary className="cursor-pointer text-xs text-muted-foreground">
								{t("docs_review_steps.claro_pdf_optional")}
							</summary>
							<Form
								method="post"
								encType="multipart/form-data"
								className="space-y-2 pt-2"
							>
								<input type="hidden" name="intent" value="upload_claro" />
								<Input
									type="file"
									name="claroPdf"
									accept="application/pdf"
									required
								/>
								<Button type="submit" variant="outline" size="sm">
									{t("docs_review.upload_pdf_submit")}
								</Button>
							</Form>
						</details>
					)}
				</AvisoMatchCard>
			)}

			{/* D — Pre-cert sheet */}
			{panel === "PRECERT" && doc.avisoMatchedAt && (
				<section className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">{t("precert.heading")}</h2>
					{!sheet ? (
						interactive && (
							<Form method="post">
								<input type="hidden" name="intent" value="generate_precert" />
								<Button type="submit">{t("precert.generate")}</Button>
							</Form>
						)
					) : (
						<PreCertPanel
							sheet={sheet}
							doc={doc}
							brigade={brigade}
							error={error ?? null}
							readOnly={!interactive}
						/>
					)}
				</section>
			)}

			{/* E — Release */}
			{panel === "RELEASE" && doc.avisoMatchedAt && (
				<section className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">{t("release.heading")}</h2>
					<ul className="text-sm space-y-1">
						{gate.conditions.map((c) => (
							<li
								key={c.key}
								className={c.ok ? "text-status-ok" : "text-muted-foreground"}
							>
								{c.ok ? "✓" : "–"} {t(CONDITION_KEYS[c.key])}
							</li>
						))}
						<li className="text-muted-foreground">
							– {t("release.condition.claro_badge")}
							{sheet?.sigClaroAt
								? " ✓"
								: ` (${t("release.claro_not_captured")})`}
						</li>
					</ul>
					{error?.errorKey === "docs_review.errors.release_blocked" &&
						error.conditions && (
							<p className="text-sm text-status-danger">
								{t("docs_review.errors.release_blocked")}
							</p>
						)}
					{doc.releasedToFinanceAt ? (
						<Pill variant="info" icon="✓">
							{t("release.released_at", {
								date: new Date(doc.releasedToFinanceAt).toLocaleString(),
							})}
						</Pill>
					) : interactive ? (
						<Form method="post">
							<input type="hidden" name="intent" value="release_to_finance" />
							<Button type="submit" disabled={!gate.ok} className="w-full">
								{t("release.button")}
							</Button>
						</Form>
					) : null}
					<p className="text-xs text-muted-foreground">
						{t("docs_review.supervisor")}: {supervisor?.name ?? user.name}
					</p>
				</section>
			)}
		</div>
	)
}
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
