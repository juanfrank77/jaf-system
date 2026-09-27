import path from "node:path"
import type { ParseKeys } from "i18next"
import { type ComponentProps, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServiceLinesTable } from "~/components/service-lines-table"
import {
	SignaturePad,
	type SignaturePadHandle,
} from "~/components/signature-pad"
import { StepRail } from "~/components/step-rail"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
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

type AvisoRow = {
	serviceCodeId: string
	claroCode: string
	qty: number
	unitPrice: number
}

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
	const [serviceCodes, photos, supervisor, sheet, brigade, tolerance] =
		await Promise.all([
			getActiveServiceCodes(),
			db.photo.findMany({ where: { docId: params.id } }),
			db.user.findUnique({ where: { id: doc.supervisorId } }),
			activeSheet(params.id),
			doc.brigadeId
				? db.brigade.findUnique({ where: { id: doc.brigadeId } })
				: Promise.resolve(null),
			getAvisoAmountTolerance(),
		])
	const stage = deriveSupervisorStage(doc, sheet)
	const gate = evaluateReleaseGate(doc, sheet, photos)
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
		gate,
		tolerance,
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
		const factors = installed.map((l) =>
			toNumberPrice(codeMap[l.serviceCodeId]?.contractorFactor),
		)
		const factor = factors.find((f) => f > 0) ?? 0.65
		const contractorAmount = round2(
			lines.reduce(
				(s, l) =>
					s +
					l.lineAmount *
						(toNumberPrice(codeMap[l.serviceCodeId]?.contractorFactor) ||
							factor),
				0,
			),
		)
		const retention = round2(contractorAmount * 0.1)
		const brigade = doc.brigadeId
			? await db.brigade.findUnique({ where: { id: doc.brigadeId } })
			: null

		const invoiceNumber = doc.avisoNumber
			? `M2026-${doc.avisoNumber}`
			: `M2026-${doc.controlNumber}`
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

function AvisoCaptureForm({
	doc,
	invoiceLines,
	error,
	tolerance,
}: {
	doc: Route.ComponentProps["loaderData"]["doc"]
	invoiceLines: InvoiceLine[]
	error: {
		errorKey?: string
		errorMessage?: string
		invoiceTotal?: number
		avisoTotal?: number
		difference?: number
		tolerance?: number
	} | null
	tolerance: number
}) {
	const { t } = useTranslation()
	const stored = (doc.avisoLines as AvisoLine[] | null) ?? []
	const [rows, setRows] = useState<AvisoRow[]>(
		invoiceLines.map((l) => ({
			serviceCodeId: l.serviceCodeId,
			claroCode: l.claroCode,
			qty:
				stored.find((s) => s.serviceCodeId === l.serviceCodeId)?.qty ?? l.qty,
			unitPrice:
				stored.find((s) => s.serviceCodeId === l.serviceCodeId)?.unitPrice ??
				l.unitPrice,
		})),
	)
	const locked = !!doc.releasedToFinanceAt
	return (
		<Form method="post" encType="multipart/form-data" className="space-y-3">
			<input type="hidden" name="intent" value="save_aviso" />
			<div className="flex flex-wrap items-end gap-3">
				<div>
					<Label htmlFor="avisoNumber" className="text-xs">
						{t("docs_review.aviso_number")}
					</Label>
					<Input
						id="avisoNumber"
						name="avisoNumber"
						defaultValue={doc.avisoNumber ?? ""}
						className="w-40"
					/>
				</div>
				<div>
					<Label htmlFor="avisoPdf" className="text-xs">
						{t("docs_review_steps.aviso_pdf_label")}
					</Label>
					<Input
						id="avisoPdf"
						type="file"
						name="avisoPdf"
						accept="application/pdf"
						className="w-64"
					/>
				</div>
				{doc.avisoDocPath && (
					<a
						href={`/files/aviso-docs/${doc.id}-aviso.pdf`}
						className="text-primary underline text-sm"
					>
						{t("docs_review.download")}
					</a>
				)}
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-slate-500 border-b">
						<th className="py-1">{t("docs_review.table.code")}</th>
						<th className="py-1">{t("docs_review.table.description")}</th>
						<th className="py-1 text-right">
							{t("docs_review_steps.charged_qty")}
						</th>
						<th className="py-1 text-right">
							{t("docs_review_steps.aviso_unit_price")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={r.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{r.claroCode}</td>
							<td className="py-1">
								{
									invoiceLines.find((l) => l.serviceCodeId === r.serviceCodeId)
										?.name
								}
							</td>
							<td className="py-1 text-right">
								<Input
									type="number"
									min={0}
									value={r.qty}
									className="w-20 ml-auto"
									onChange={(e) =>
										setRows(
											rows.map((row, j) =>
												j === i
													? {
															...row,
															qty: Number.parseInt(e.target.value, 10) || 0,
														}
													: row,
											),
										)
									}
								/>
							</td>
							<td className="py-1 text-right">
								<Input
									type="number"
									step="0.0001"
									min={0}
									value={r.unitPrice}
									className="w-28 ml-auto"
									onChange={(e) =>
										setRows(
											rows.map((row, j) =>
												j === i
													? { ...row, unitPrice: Number(e.target.value) || 0 }
													: row,
											),
										)
									}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<input type="hidden" name="avisoLines" value={JSON.stringify(rows)} />
			<div>
				<Label htmlFor="lineNote" className="text-xs">
					{t("docs_review_steps.line_note_hint")}
				</Label>
				<Textarea id="lineNote" name="lineNote" rows={2} className="mt-1" />
			</div>
			{error?.errorKey === "docs_review.errors.aviso_amount_mismatch" ? (
				<p className="text-sm text-red-600">
					{t("docs_review.errors.aviso_amount_mismatch", {
						avisoTotal: formatMoney(error.avisoTotal ?? 0),
						invoiceTotal: formatMoney(error.invoiceTotal ?? 0),
						difference: formatMoney(error.difference ?? 0),
						tolerance: formatMoney(error.tolerance ?? tolerance),
					})}
				</p>
			) : error?.errorMessage ? (
				<p className="text-sm text-red-600">{error.errorMessage}</p>
			) : error?.errorKey ? (
				<p className="text-sm text-red-600">{t(error.errorKey as ParseKeys)}</p>
			) : null}
			<Button type="submit" disabled={locked}>
				{t("docs_review_steps.save_aviso")}
			</Button>
		</Form>
	)
}

function SignatureBlock({
	intent,
	labelKey,
	children,
	encType,
}: {
	intent: string
	labelKey: ParseKeys
	children: React.ReactNode
	encType?: "multipart/form-data"
}) {
	const { t } = useTranslation()
	const padRef = useRef<SignaturePadHandle>(null)
	const [cleared, setCleared] = useState(0)
	return (
		<Form
			method="post"
			encType={encType}
			className="flex-1 min-w-[12rem] border rounded-lg p-3 space-y-2"
			onSubmit={(e) => {
				const pad = padRef.current
				const input = e.currentTarget.elements.namedItem(
					"signature",
				) as HTMLInputElement | null
				if (!pad || pad.isEmpty()) {
					e.preventDefault()
				} else if (input) {
					input.value = pad.toDataURL()
				}
			}}
		>
			<input type="hidden" name="intent" value={intent} />
			<p className="text-xs font-medium">{t(labelKey)}</p>
			{children}
			<SignaturePad
				key={cleared}
				ref={padRef}
				width={280}
				height={90}
				className="w-full border rounded bg-white"
			/>
			<button
				type="button"
				className="text-xs text-slate-400 hover:text-slate-600"
				onClick={() => setCleared((c) => c + 1)}
			>
				{t("precert.clear_signature")}
			</button>
			<Button type="submit" size="sm" variant="outline" className="w-full">
				{t("precert.sign")}
			</Button>
		</Form>
	)
}

function PreCertPanel({
	sheet,
	doc,
	brigade,
	error,
}: {
	sheet: Route.ComponentProps["loaderData"]["sheet"]
	doc: Route.ComponentProps["loaderData"]["doc"]
	brigade: Route.ComponentProps["loaderData"]["brigade"]
	error: { errorKey?: string; errorMessage?: string } | null
}) {
	const { t } = useTranslation()
	const lines = (sheet?.lines as PreCertLine[] | null) ?? []
	const locked = !!sheet?.sigSupervisorAt
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="font-medium">
					{t("precert.version", { n: sheet?.version ?? 1 })}
				</span>
				{sheet?.pdfPath && (
					<a
						href={`/files/precert/${doc.id}-v${sheet.version}.pdf`}
						className="text-primary underline"
					>
						{t("precert.download")}
					</a>
				)}
			</div>
			<table className="w-full text-sm">
				<thead>
					<tr className="text-left text-xs text-slate-500 border-b">
						<th className="py-1">{t("service_picker.col_code")}</th>
						<th className="py-1">{t("service_picker.col_description")}</th>
						<th className="py-1 text-right">
							{t("service_picker.col_installed")}
						</th>
						<th className="py-1 text-right">Cant.</th>
						<th className="py-1 text-right">Costo</th>
					</tr>
				</thead>
				<tbody>
					{lines.map((l) => (
						<tr key={l.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1">
								{l.description}
								{l.editReason && (
									<span className="block text-xs text-amber-700">
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
				TOTAL {formatMoney(sheet?.total ?? 0)}
			</p>
			{!locked &&
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
			<div className="flex flex-wrap gap-3">
				<SignatureBlock
					intent="sign_precert_supervisor"
					labelKey="precert.sig_supervisor"
				>
					{sheet?.sigSupervisorName ? (
						<div className="space-y-1">
							{sheet.sigSupervisorImage && (
								<img src={sheet.sigSupervisorImage} alt="" className="h-12" />
							)}
							<p className="text-xs">{sheet.sigSupervisorName}</p>
							<p className="text-xs text-slate-400">
								{sheet.sigSupervisorAt
									? new Date(sheet.sigSupervisorAt).toLocaleDateString()
									: ""}
							</p>
						</div>
					) : null}
				</SignatureBlock>
				<SignatureBlock
					intent="sign_precert_subcontractor"
					labelKey="precert.sig_subcontractor"
				>
					{sheet?.sigSubcontractorName ? (
						<div className="space-y-1">
							{sheet.sigSubcontractorImage && (
								<img
									src={sheet.sigSubcontractorImage}
									alt=""
									className="h-12"
								/>
							)}
							<p className="text-xs">
								{sheet.sigSubcontractorName} · {sheet.sigSubcontractorCode}
							</p>
						</div>
					) : (
						<>
							<Input
								name="signerName"
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
						</>
					)}
				</SignatureBlock>
				<SignatureBlock
					intent="sign_precert_claro"
					labelKey="precert.sig_claro"
					encType="multipart/form-data"
				>
					<p className="text-xs text-slate-500">
						{t("precert.claro_optional")}
					</p>
					{sheet?.sigClaroAt ? (
						<div className="space-y-1">
							{sheet.sigClaroImage && (
								<img src={sheet.sigClaroImage} alt="" className="h-12" />
							)}
							{sheet.sigClaroScanPath && (
								<a
									href={`/files/precert/${doc.id}-claro-scan.jpg`}
									className="text-primary underline text-xs"
								>
									{t("precert.download")}
								</a>
							)}
							<p className="text-xs">{sheet.sigClaroName}</p>
						</div>
					) : (
						<>
							<Input name="signerName" placeholder={t("precert.signer_name")} />
							<input type="file" name="scan" accept="image/*,application/pdf" />
						</>
					)}
				</SignatureBlock>
			</div>
			{error?.errorKey ? (
				<p className="text-sm text-red-600">{t(error.errorKey as ParseKeys)}</p>
			) : error?.errorMessage ? (
				<p className="text-sm text-red-600">{error.errorMessage}</p>
			) : null}
			{!doc.releasedToFinanceAt && (
				<Form method="post" className="pt-1">
					<input type="hidden" name="intent" value="generate_precert" />
					<Button type="submit" variant="outline" size="sm">
						{t("precert.regenerate")}
					</Button>
					<p className="text-xs text-slate-400 mt-1">
						{t("precert.regenerate_hint")}
					</p>
				</Form>
			)}
		</div>
	)
}

function FourColumnTable({
	ordered,
	installed,
	certified,
	charged,
}: {
	ordered: ServiceLine[]
	installed: ServiceLine[]
	certified: PreCertLine[] | undefined
	charged: AvisoLine[] | null
}) {
	const { t } = useTranslation()
	return (
		<table className="w-full text-sm">
			<thead>
				<tr className="text-left text-xs text-slate-500 border-b">
					<th className="py-1">{t("service_picker.col_code")}</th>
					<th className="py-1 text-right">{t("release.col_ordered")}</th>
					<th className="py-1 text-right">{t("release.col_installed")}</th>
					<th className="py-1 text-right">{t("release.col_certified")}</th>
					<th className="py-1 text-right">{t("release.col_charged")}</th>
					<th className="py-1 text-right">Status</th>
				</tr>
			</thead>
			<tbody>
				{ordered.map((l) => {
					const inst = installed.find(
						(x) => x.serviceCodeId === l.serviceCodeId,
					)?.qty
					const cert = certified?.find(
						(x) => x.serviceCodeId === l.serviceCodeId,
					)?.certifiedQty
					const chg = charged?.find(
						(x) => x.serviceCodeId === l.serviceCodeId,
					)?.qty
					const allEqual = l.qty === inst && l.qty === cert && l.qty === chg
					return (
						<tr key={l.serviceCodeId} className="border-b last:border-0">
							<td className="py-1 font-mono text-xs">{l.claroCode}</td>
							<td className="py-1 text-right">{l.qty}</td>
							<td className="py-1 text-right">{inst ?? "—"}</td>
							<td className="py-1 text-right">{cert ?? "—"}</td>
							<td className="py-1 text-right">{chg ?? "—"}</td>
							<td
								className={`py-1 text-right ${
									allEqual ? "text-green-700" : "text-amber-700"
								}`}
							>
								{allEqual ? t("release.match") : t("release.mismatch")}
							</td>
						</tr>
					)
				})}
			</tbody>
		</table>
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
		gate,
		tolerance,
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
	const estimated = (doc.estimatedMaterials as unknown as MaterialLine[]) || []
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const used = (doc.materialsUsed as unknown as MaterialLine[]) || []
	const ordered = (doc.serviceLines as ServiceLine[] | null) ?? []
	const installed = (doc.installedServiceLines as ServiceLine[] | null) ?? []
	const invoiceLines = (doc.jafInvoiceLines as InvoiceLine[] | null) ?? []
	const avisoLines = (doc.avisoLines as AvisoLine[] | null) ?? []
	const precertLines = (sheet?.lines as PreCertLine[] | undefined) ?? undefined

	// Extract basenames for photos in JSX (avoid path module in client bundle)
	const photoItems = photos.map((p) => ({
		id: p.id,
		basename: path.basename(p.localPath),
	}))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_review.title")}</h1>
			<p className="font-mono text-sm text-slate-500">{doc.controlNumber}</p>
			<StepRail stage={stage} />

			{/* A — Approve */}
			<section className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("docs_review_steps.approve_heading")}
				</h2>
				<div className="text-sm space-y-1">
					<p>
						<span className="text-slate-500">
							{t("docs_review.estimated_address")}:
						</span>{" "}
						{doc.jobAddressEstimated}
					</p>
					{doc.jobAddressActual && (
						<p>
							<span className="text-slate-500">
								{t("docs_review.actual_address")}:
							</span>{" "}
							{doc.jobAddressActual}
						</p>
					)}
					{doc.fieldNotes && (
						<p>
							<span className="text-slate-500">
								{t("docs_review.field_notes")}:
							</span>{" "}
							{doc.fieldNotes}
						</p>
					)}
				</div>
				{ordered.length > 0 && (
					<ServiceLinesTable lines={ordered} installed={installed} />
				)}
				<div className="grid grid-cols-3 gap-3 text-sm">
					<div className="border rounded-lg p-3">
						<p className="text-xs text-slate-500 mb-1">
							{t("docs_review.estimated")}
						</p>
						<MaterialLineItems
							serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
							initialItems={estimated}
							readOnly
						/>
					</div>
					<div className="border rounded-lg p-3">
						<p className="text-xs text-slate-500 mb-1">
							{t("docs_review.taken")}
						</p>
						<MaterialLineItems
							serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
							initialItems={taken}
							readOnly
						/>
					</div>
					<div className="border rounded-lg p-3">
						<p className="text-xs text-slate-500 mb-1">
							{t("docs_review.used")}
						</p>
						<MaterialLineItems
							serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
							initialItems={used}
							readOnly
						/>
					</div>
				</div>
				{photoItems.length > 0 && (
					<div>
						<p className="text-sm font-medium mb-2">
							{t("docs_review.job_photos", { count: photoItems.length })}
						</p>
						<div className="grid grid-cols-3 gap-2">
							{photoItems.map((p) => (
								<a
									key={p.id}
									href={`/files/photos/${doc.id}/${p.basename}`}
									target="_blank"
									rel="noreferrer"
								>
									<img
										src={`/files/photos/${doc.id}/${p.basename}`}
										alt={t("docs_review.job_site_alt")}
										className="w-full h-24 object-cover rounded border"
									/>
								</a>
							))}
						</div>
					</div>
				)}
				{doc.status === "FIELD_UPDATED" && (
					<Form method="post" className="space-y-3 border-t pt-3">
						<div>
							<Label htmlFor="claroNotes">
								{t("docs_review.notes_for_finance_label")}
							</Label>
							<Textarea id="claroNotes" name="claroNotes" rows={2} />
						</div>
						<input type="hidden" name="intent" value="approve" />
						<Button type="submit" className="w-full">
							{t("docs_review.approve")}
						</Button>
					</Form>
				)}
				{(doc.status === "FIELD_UPDATED" ||
					doc.status === "SUPERVISOR_APPROVED") && (
					<Form method="post" className="space-y-2 border-t pt-3">
						<h3 className="font-medium text-sm">
							{t("docs_review.send_back_heading")}
						</h3>
						<p className="text-xs text-slate-500">
							{t("docs_review.send_back_hint")}
						</p>
						<Textarea name="note" rows={2} required />
						<input type="hidden" name="intent" value="send_back" />
						<Button type="submit" variant="outline">
							{t("docs_review.send_back")}
						</Button>
					</Form>
				)}
			</section>

			{/* B — Invoice */}
			{stage !== "INTAKE" &&
				stage !== "WAREHOUSE" &&
				stage !== "FIELD" &&
				stage !== "APPROVE" && (
					<section className="bg-white border rounded-lg p-4 space-y-3">
						<h2 className="font-medium text-sm">
							{t("docs_review_steps.invoice_heading")}
						</h2>
						{invoiceLines.length > 0 && (
							<table className="w-full text-sm">
								<thead>
									<tr className="text-left text-xs text-slate-500 border-b">
										<th className="py-1">{t("docs_review.table.code")}</th>
										<th className="py-1">
											{t("docs_review.table.description")}
										</th>
										<th className="py-1 text-right">
											{t("docs_review.table.qty")}
										</th>
										<th className="py-1 text-right">
											{t("docs_review_steps.unit_price")}
										</th>
										<th className="py-1 text-right">
											{t("docs_review_steps.line_amount")}
										</th>
									</tr>
								</thead>
								<tbody>
									{invoiceLines.map((l) => (
										<tr
											key={l.serviceCodeId}
											className="border-b last:border-0"
										>
											<td className="py-1 font-mono text-xs">{l.claroCode}</td>
											<td className="py-1">{l.name}</td>
											<td className="py-1 text-right">{l.qty}</td>
											<td className="py-1 text-right">
												${l.unitPrice.toFixed(4)}
											</td>
											<td className="py-1 text-right">
												${l.lineAmount.toFixed(2)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
						{doc.jafInvoiceLineTotal != null && (
							<p className="text-sm text-right">
								{t("docs_review_steps.line_sum_pre_ivu")}:{" "}
								<strong>{formatMoney(doc.jafInvoiceLineTotal)}</strong>
							</p>
						)}
						{doc.jafInvoicePdfPath && (
							<a
								href={`/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`}
								className="text-primary underline text-sm"
							>
								{t("docs_review.download")}
							</a>
						)}
						{!doc.avisoMatchedAt && (
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
					</section>
				)}

			{/* C — Aviso & match */}
			{doc.jafInvoiceGeneratedAt && (
				<section className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">
						{t("docs_review_steps.aviso_heading")}
					</h2>
					<p className="text-xs text-slate-500">
						{t("docs_review_steps.aviso_hint")}
					</p>
					<AvisoCaptureForm
						doc={doc}
						invoiceLines={invoiceLines}
						error={error ?? null}
						tolerance={tolerance}
					/>
					{doc.avisoMatchedAt ? (
						<Pill variant="info" icon="✓">
							{t("docs_review_steps.amount_match_ok", {
								total: formatMoney(doc.avisoLineTotal),
							})}
						</Pill>
					) : doc.avisoLineTotal != null ? (
						<Pill variant="warn" icon="⚠">
							{t("docs_review_steps.amount_match_blocked", {
								aviso: formatMoney(doc.avisoLineTotal),
								invoice: formatMoney(doc.jafInvoiceLineTotal),
							})}
						</Pill>
					) : null}
					{doc.status === "SUPERVISOR_APPROVED" && (
						<details>
							<summary className="text-xs text-slate-500 cursor-pointer">
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
				</section>
			)}

			{/* D — Pre-cert sheet */}
			{doc.avisoMatchedAt && (
				<section className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">{t("precert.heading")}</h2>
					{!sheet ? (
						<Form method="post">
							<input type="hidden" name="intent" value="generate_precert" />
							<Button type="submit">{t("precert.generate")}</Button>
						</Form>
					) : (
						<PreCertPanel
							sheet={sheet}
							doc={doc}
							brigade={brigade}
							error={error ?? null}
						/>
					)}
				</section>
			)}

			{/* E — Release */}
			{doc.avisoMatchedAt && (
				<section className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="font-medium text-sm">{t("release.heading")}</h2>
					<FourColumnTable
						ordered={ordered}
						installed={installed}
						certified={precertLines}
						charged={avisoLines}
					/>
					<ul className="text-sm space-y-1">
						{gate.conditions.map((c) => (
							<li
								key={c.key}
								className={c.ok ? "text-green-700" : "text-slate-500"}
							>
								{c.ok ? "✓" : "–"} {t(CONDITION_KEYS[c.key])}
							</li>
						))}
						<li className="text-slate-500">
							– {t("release.condition.claro_badge")}
							{sheet?.sigClaroAt
								? " ✓"
								: ` (${t("release.claro_not_captured")})`}
						</li>
					</ul>
					{error?.errorKey === "docs_review.errors.release_blocked" &&
						error.conditions && (
							<p className="text-sm text-red-600">
								{t("docs_review.errors.release_blocked")}
							</p>
						)}
					{doc.releasedToFinanceAt ? (
						<Pill variant="info" icon="✓">
							{t("release.released_at", {
								date: new Date(doc.releasedToFinanceAt).toLocaleString(),
							})}
						</Pill>
					) : (
						<Form method="post">
							<input type="hidden" name="intent" value="release_to_finance" />
							<Button type="submit" disabled={!gate.ok} className="w-full">
								{t("release.button")}
							</Button>
						</Form>
					)}
					<p className="text-xs text-slate-400">
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
