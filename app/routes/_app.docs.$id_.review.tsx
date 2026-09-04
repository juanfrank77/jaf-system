import path from "node:path"
import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { generateJafInvoicePdf } from "~/lib/pdf/jaf-invoice.server"
import { canTransition, isReviewActionStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getActiveServiceCodes } from "~/lib/service-codes.server"
import {
	type AvisoLine,
	buildInvoiceLines,
	type InvoiceLine,
	parseAvisoLines,
	round2,
	type ServiceLine,
	sumLines,
} from "~/lib/service-lines"
import { checkAvisoMatch } from "~/lib/supervisor-stage"
import {
	getAvisoAmountTolerance,
	getIvuRate,
} from "~/lib/system-settings.server"
import { saveBuffer, saveUpload } from "~/lib/uploads.server"
import { toNumberPrice } from "~/lib/utils"
import type { Prisma } from "../../generated/prisma/client"
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
	})
	const serviceCodes = await getActiveServiceCodes()
	const photos = await db.photo.findMany({ where: { docId: params.id } })
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		photos,
		supervisor,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
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

	if (intent === "send_to_finance") {
		if (doc.status !== "SUPERVISOR_APPROVED")
			throw redirect(`/docs/${params.id}`)
		const existing = await db.auditTrail.findFirst({
			where: { docId: params.id, action: "SENT_TO_FINANCE" },
			select: { id: true },
		})
		if (existing) throw redirect(`/docs/${params.id}`)

		const finance = await db.user.findMany({
			where: { role: "FINANCE", active: true },
		})
		await db.$transaction([
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "SENT_TO_FINANCE",
					diffJson: { sentAt: new Date().toISOString() },
				},
			}),
			...finance.map((f) =>
				db.notification.create({
					data: {
						userId: f.id,
						docId: params.id,
						message: `Job ${doc.controlNumber} has been sent to finance for review.`,
					},
				}),
			),
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

export default function ReviewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, photos, supervisor } = loaderData
	const { t } = useTranslation()
	const error = actionData as
		| { errorKey?: string; errorMessage?: string }
		| undefined
	const estimated = (doc.estimatedMaterials as unknown as MaterialLine[]) || []
	const taken = (doc.materialsTaken as unknown as MaterialLine[]) || []
	const used = (doc.materialsUsed as unknown as MaterialLine[]) || []
	const isApproved = [
		"SUPERVISOR_APPROVED",
		"CLARO_UPLOADED",
		"LC_REQUEST_GENERATED",
	].includes(doc.status)

	// Build Claro submission helper data
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const takenItems = taken.map((t) => {
		const code = codeMap[t.serviceCodeId]
		return {
			claroCode: code?.claroCode,
			name: code?.name,
			qty: t.qty,
			unit: code?.unit,
		}
	})

	// Extract basenames for photos in JSX (avoid path module in client bundle)
	const photoItems = photos.map((p) => ({
		id: p.id,
		basename: path.basename(p.localPath),
	}))

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("docs_review.title")}</h1>
			<p className="font-mono text-sm text-slate-500">{doc.controlNumber}</p>

			{/* Materials variance */}
			<div className="grid grid-cols-3 gap-3 text-sm">
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">
						{t("docs_review.estimated")}
					</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={estimated}
						readOnly
					/>
				</div>
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">
						{t("docs_review.taken")}
					</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={taken}
						readOnly
					/>
				</div>
				<div className="bg-white border rounded-lg p-3">
					<p className="text-xs text-slate-500 mb-1">{t("docs_review.used")}</p>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={used}
						readOnly
					/>
				</div>
			</div>

			{/* Job address comparison */}
			<div className="bg-white border rounded-lg p-4 text-sm space-y-1">
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

			{/* Documents kit for the Claro Aviso (supervisor) */}
			{(doc.status === "FIELD_UPDATED" || isApproved) && (
				<div className="bg-white border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium text-slate-600">
						{t("docs_review.aviso_docs_heading")}
					</h2>
					<ul className="text-sm space-y-1">
						<li className="flex justify-between">
							<span>JAF Invoice PDF</span>
							{doc.jafInvoicePdfPath ? (
								<a
									href={`/files/jaf-invoices/${doc.id}-jaf-invoice.pdf`}
									className="text-primary underline"
								>
									{t("docs_review.download")}
								</a>
							) : (
								<span className="text-slate-400">
									{t("docs_review.not_generated")}
								</span>
							)}
						</li>
						<li className="flex justify-between">
							<span>{t("docs_review.aviso_number")}:</span>
							<span>
								{doc.avisoNumber || t("docs_review.aviso_number_missing")}
							</span>
						</li>
						<li className="flex justify-between">
							<span>Claro work-order PDF</span>
							{doc.claroPdfPath ? (
								<a
									href={`/files/claro-pdfs/${doc.id}-claro.pdf`}
									className="text-primary underline"
								>
									{t("docs_review.download")}
								</a>
							) : (
								<span className="text-slate-400">
									{t("docs_review.not_uploaded")}
								</span>
							)}
						</li>
					</ul>
					{doc.status === "SUPERVISOR_APPROVED" && (
						<Form method="post" className="pt-2 space-y-2">
							<Label htmlFor="avisoNumberEdit" className="text-xs">
								{t("docs_review.aviso_number_confirm_label")}
							</Label>
							<div className="flex gap-2">
								<Input
									id="avisoNumberEdit"
									name="avisoNumber"
									defaultValue={doc.avisoNumber || ""}
									placeholder="10333185"
								/>
								<input type="hidden" name="intent" value="edit_aviso" />
								<Button type="submit" size="sm">
									{t("docs_review.save_aviso")}
								</Button>
							</div>
						</Form>
					)}
					{!doc.jafInvoicePdfPath &&
						(used.length > 0 ||
							taken.length > 0 ||
							((doc.installedServiceLines as ServiceLine[] | null)?.length ??
								0) > 0) && (
							<Form method="post">
								<input
									type="hidden"
									name="intent"
									value="generate_jaf_invoice"
								/>
								<Button type="submit" variant="outline" size="sm">
									{t("docs_review.generate_jaf_invoice")}
								</Button>
							</Form>
						)}
				</div>
			)}

			{/* Inline photos */}
			{photoItems.length > 0 && (
				<div className="bg-white border rounded-lg p-4">
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

			{/* Claro submission helper */}
			<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
				<h2 className="text-sm font-semibold text-blue-900 mb-2">
					{t("docs_review.claro_helper_title")}
				</h2>
				<p className="text-xs text-blue-700 mb-3">
					{t("docs_review.claro_helper_hint")}
				</p>
				<div className="space-y-1 text-sm">
					<p>
						<span className="font-medium">
							{t("docs_review.aviso_number")}:
						</span>{" "}
						{doc.avisoNumber ?? t("docs_review.aviso_number_missing")}
					</p>
					<p>
						<span className="font-medium">{t("docs_review.job_type")}:</span>{" "}
						{doc.jobType}
					</p>
					<p>
						<span className="font-medium">{t("docs_review.address")}:</span>{" "}
						{doc.jobAddressActual ?? doc.jobAddressEstimated}
					</p>
					<p>
						<span className="font-medium">{t("docs_review.supervisor")}:</span>{" "}
						{supervisor?.name}
					</p>
				</div>
				{takenItems.length > 0 && (
					<table className="w-full text-xs mt-3 border-collapse">
						<thead>
							<tr className="text-left text-blue-800 border-b border-blue-200">
								<th className="pb-1">{t("docs_review.table.code")}</th>
								<th className="pb-1">{t("docs_review.table.description")}</th>
								<th className="pb-1 text-right">
									{t("docs_review.table.qty")}
								</th>
								<th className="pb-1 text-right">
									{t("docs_review.table.unit")}
								</th>
							</tr>
						</thead>
						<tbody>
							{takenItems.map((item) => (
								<tr
									key={item.claroCode ?? item.name}
									className="border-b border-blue-100"
								>
									<td className="py-1 font-mono">{item.claroCode}</td>
									<td className="py-1">{item.name}</td>
									<td className="py-1 text-right">{item.qty}</td>
									<td className="py-1 text-right">{item.unit}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{doc.status === "FIELD_UPDATED" && (
				<Form
					method="post"
					className="space-y-3 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">
						{t("docs_review.approve_job_heading")}
					</h2>
					<div>
						<Label htmlFor="avisoNumber">
							{t("docs_review.aviso_number_confirm_label")}
						</Label>
						<Input
							id="avisoNumber"
							name="avisoNumber"
							defaultValue={doc.avisoNumber || ""}
						/>
					</div>
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

			{doc.status === "SUPERVISOR_APPROVED" && (
				<Form
					method="post"
					className="space-y-3 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">
						{t("docs_review.send_to_finance_heading")}
					</h2>
					<p className="text-xs text-slate-500">
						{t("docs_review.send_to_finance_hint")}
					</p>
					<input type="hidden" name="intent" value="send_to_finance" />
					<Button type="submit" className="w-full">
						{t("docs_review.send_to_finance")}
					</Button>
				</Form>
			)}

			{doc.status === "SUPERVISOR_APPROVED" && (
				<Form
					method="post"
					encType="multipart/form-data"
					className="space-y-3 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">
						{t("docs_review.upload_pdf_heading")}
					</h2>
					<p className="text-xs text-slate-500">
						{t("docs_review.upload_pdf_hint")}
					</p>
					<input type="hidden" name="intent" value="upload_claro" />
					<Input
						type="file"
						name="claroPdf"
						accept="application/pdf"
						required
					/>
					{error?.errorKey && (
						<p className="text-sm text-red-600">
							{t(error.errorKey as ParseKeys)}
						</p>
					)}
					{error?.errorMessage && (
						<p className="text-sm text-red-600">{error.errorMessage}</p>
					)}
					<Button type="submit">{t("docs_review.upload_pdf_submit")}</Button>
				</Form>
			)}

			{(doc.status === "FIELD_UPDATED" ||
				doc.status === "SUPERVISOR_APPROVED") && (
				<Form
					method="post"
					className="space-y-2 bg-white border rounded-lg p-4"
				>
					<h2 className="font-medium text-sm">
						{t("docs_review.send_back_heading")}
					</h2>
					<p className="text-xs text-slate-500">
						{t("docs_review.send_back_hint")}
					</p>
					<Textarea name="note" rows={2} required />
					<input type="hidden" name="intent" value="send_back" />
					<div className="flex gap-2">
						<Button type="submit" variant="outline">
							{t("docs_review.send_back")}
						</Button>
					</div>
					{error?.errorKey && (
						<p className="text-sm text-red-600">
							{t(error.errorKey as ParseKeys)}
						</p>
					)}
				</Form>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
