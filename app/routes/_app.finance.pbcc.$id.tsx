import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import {
	type ContractorPayment,
	type ContractorShareLine,
	computeContractorPayment,
	resolveContractorAccount,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	computeFinanceStage,
	financeLineItems,
	invoiceTotalUsed,
	isMissingClaroPdf,
} from "~/lib/finance-pipeline.server"
import {
	correctReceivablePayment,
	recordReceivablePayment,
} from "~/lib/payment-records.server"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { generatePbccRequestPdf } from "~/lib/pdf/pbcc-request.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate, getLcPbccAdvanceRate } from "~/lib/system-settings.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.pbcc.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — PBCC Request — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	// The Arm A-open gate, single-sourced instead of restated inline. The
	// packet view is deliberately wider than L1's — it still serves a job
	// already swept into an open, unpaid run, so finance can read the frozen
	// figures off it, and a job whose LC request is already generated. The
	// clauses that decide whether a job is on Arm A at all are inherited, so
	// the CANCELLED guard this loader used to get from `computeFinanceStage` is
	// back: a cancelled job is not on Arm A and belongs back on L1.
	const doc = await db.jafInvoice.findFirst({
		where: { id: params.id, ...armAOpenWhere({ packetView: true }) },
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true, note: true } },
			payrollRun: { select: { paidAt: true } },
			preCertSheets: { orderBy: { version: "desc" }, take: 1 },
		},
	})
	// this phase owns the closable loop, so a job that is closed or was never
	// released is simply not on Arm A any more.
	if (!doc) throw redirect("/finance/queue")

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [
			c.id,
			{ ...c, unitPrice: toNumberPrice(c.unitPrice) },
		]),
	)
	const [ivuRate, lcPbccAdvanceRate] = await Promise.all([
		getIvuRate(),
		getLcPbccAdvanceRate(),
	])
	const amount = invoiceTotalUsed(doc, codeMap, ivuRate)

	// A job already swept into a run (grossPayable set) has its payment
	// frozen — show that, never live-recompute it, so a later catalog price
	// change can't appear to move an already-generated run's figures.
	const account = await resolveContractorAccount(doc.contractorAccountCode)
	const frozen = doc.grossPayable != null
	const payment: ContractorPayment = frozen
		? {
				contractorShareLines: (doc.contractorShareLines ??
					[]) as unknown as ContractorShareLine[],
				grossPayable: toNumberPrice(doc.grossPayable),
				retentionAmount: toNumberPrice(doc.retentionAmount),
				netPayable: toNumberPrice(doc.netPayable),
			}
		: computeContractorPayment(toContractorPaymentLines(doc.jafInvoiceLines))

	return {
		doc,
		user,
		serviceCodes,
		amount,
		ivuRate,
		lcPbccAdvanceRate,
		payment,
		frozen,
		contractorAccountResolved: frozen || account !== null,
		missingClaroPdf: isMissingClaroPdf(doc),
	}
}

/** Shared by mark_funded and correct_funding: funded date (not future),
 * amount (> 0) and optional bank reference. */
function parseFunding(
	form: FormData,
): { date: Date; amount: number; note: string | null } | { errorKey: string } {
	const rawDate = String(form.get("fundedDate") ?? "")
	if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))
		return { errorKey: "finance_pbcc.errors.invalid_date" }
	const date = new Date(`${rawDate}T12:00:00`)
	if (Number.isNaN(date.getTime()))
		return { errorKey: "finance_pbcc.errors.invalid_date" }
	if (date.getTime() > Date.now())
		return { errorKey: "finance_pbcc.errors.future_date" }
	const rawAmount = String(form.get("fundedAmount") ?? "").trim()
	const amount = rawAmount === "" ? Number.NaN : Number(rawAmount)
	if (!Number.isFinite(amount) || amount <= 0)
		return { errorKey: "finance_pbcc.errors.invalid_amount" }
	const note = String(form.get("fundedRef") ?? "").trim() || null
	return { date, amount, note }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true } },
		},
	})
	if (isTerminalStatus(doc.status)) {
		return { errorKey: "finance_pbcc.errors.terminal_status" }
	}
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "mark_funded") {
		if (!doc.pbccRequestSentAt)
			return { errorKey: "finance_pbcc.errors.not_sent" }
		const parsed = parseFunding(form)
		if ("errorKey" in parsed) return parsed
		const result = await recordReceivablePayment({
			jobId: params.id,
			type: "PBCC_ADVANCE",
			amount: parsed.amount,
			date: parsed.date,
			note: parsed.note,
			actorId: user.id,
		})
		if (result.duplicate) {
			return data(
				{ errorKey: "finance_pbcc.errors.already_funded" },
				{ status: 409 },
			)
		}
		return { ok: true }
	}

	if (intent === "correct_funding") {
		// FINANCE + ADMIN: the screen's requireRole already limits to those roles.
		const reason = (form.get("reason") as string | null)?.trim() ?? ""
		if (!reason) return { errorKey: "finance_pbcc.errors.reason_required" }
		const parsed = parseFunding(form)
		if ("errorKey" in parsed) return parsed
		const result = await correctReceivablePayment({
			jobId: params.id,
			...parsed,
			reason,
			actorId: user.id,
			actorRole: user.role,
		})
		if (!result.ok) {
			return {
				errorKey:
					result.error === "locked"
						? "finance_pbcc.errors.locked_in_paid_run"
						: "finance_pbcc.errors.not_funded",
			}
		}
		return { ok: true }
	}

	// Escape hatch: Lissette sends the PBCC packet by hand (outside the system)
	// because the bank-format invoice/schedule generators don't exist yet. This
	// must work even when the Aviso/Claro PDFs the auto-generator insists on are
	// missing — recording "sent" is precisely the case it exists for.
	if (intent === "mark_sent_by_hand") {
		// Same gate the loader uses: only a job that is on Arm A can be marked,
		// and a second click (double-submit, stale tab) is a no-op rather than a
		// duplicate audit row.
		const onArmA = await db.jafInvoice.count({
			where: { id: params.id, ...armAOpenWhere({ packetView: true }) },
		})
		if (onArmA === 0) throw redirect("/finance/queue")
		if (doc.pbccRequestSentAt) return { ok: true }
		const note = (form.get("note") as string | null)?.trim() || null
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: { pbccRequestSentAt: new Date() },
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PBCC_SENT_BY_HAND",
					diffJson: { note },
				},
			}),
		])
		return { ok: true }
	}

	if (intent !== "generate_pbcc")
		return { errorKey: "finance_pbcc.errors.unknown_intent" }
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	if (stage !== "PBCC_REQUEST_PENDING") {
		throw redirect(`/finance/receivables`)
	}
	if (isMissingClaroPdf(doc)) {
		throw redirect(`/finance/receivables`)
	}

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const [ivuRate, lcPbccAdvanceRate] = await Promise.all([
		getIvuRate(),
		getLcPbccAdvanceRate(),
	])
	const lineItems = financeLineItems(doc, codeMap)

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const pbccDir = path.join(uploadDir, "pbcc-requests")
	await fs.mkdir(pbccDir, { recursive: true })

	const today = new Date().toLocaleDateString("en-US")
	const invoiceNumber = doc.avisoNumber
		? `M${new Date().getFullYear()}-${doc.avisoNumber}`
		: `M${new Date().getFullYear()}-${doc.controlNumber}`

	const pdfBytes = await generatePbccRequestPdf({
		controlNumber: doc.controlNumber,
		avisoNumber: doc.avisoNumber,
		jobType: doc.jobType,
		jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
		invoiceNumber,
		invoiceDate: today,
		debtor: "PRT/CLARO",
		lineItems,
		ivuRate,
		supervisorName: doc.supervisor?.name ?? "",
		requestDate: today,
		lcPbccAdvanceRate,
	})

	const localPath = path.join(pbccDir, `${params.id}-pbcc-request.pdf`)
	await fs.writeFile(localPath, pdfBytes)

	const comptrollers = await db.user.findMany({
		where: { role: "COMPTROLLER", active: true },
		select: { id: true, email: true },
	})

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				pbccRequestPdfPath: localPath,
				pbccRequestSentAt: new Date(),
				karmenCopySentAt: new Date(),
			},
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "PBCC_REQUEST_GENERATED",
				diffJson: { path: localPath },
			},
		}),
		...comptrollers.map((c) =>
			db.notification.create({
				data: {
					userId: c.id,
					docId: params.id,
					message: `PBCC payment request generated for job ${doc.controlNumber}.`,
				},
			}),
		),
	])
	await sendInternalEmail({
		docId: params.id,
		actorId: user.id,
		recipients: comptrollers.map((recipient) => recipient.email),
		subject: `PBCC payment request generated: ${doc.controlNumber}`,
		context: "PBCC_REQUEST_GENERATED",
	})

	return new Response(new Uint8Array(pdfBytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-pbcc-request.pdf"`,
		},
	})
}

export default function PbccRequest({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		doc,
		amount,
		ivuRate,
		lcPbccAdvanceRate,
		payment,
		frozen,
		contractorAccountResolved,
		missingClaroPdf,
	} = loaderData
	const { t } = useTranslation()

	const today = new Date().toLocaleDateString("en-CA")
	const errorKey =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const sent = Boolean(doc.pbccRequestSentAt)
	const funded = doc.advanceReceivedAt
		? {
				date: new Date(doc.advanceReceivedAt),
				amount: Number(doc.advanceAmount ?? 0),
				ref:
					doc.paymentRecords.find((r) => r.type === "PBCC_ADVANCE")?.note ?? "",
			}
		: null

	const preCertSheet = doc.preCertSheets?.[0]
	const supervName = preCertSheet?.sigSupervisorName ?? "—"
	const subconName = preCertSheet?.sigSubcontractorName ?? "—"
	const claroName = preCertSheet?.sigClaroName ?? "—"

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("finance_pbcc.title")}</h1>
			<p className="font-mono text-sm text-muted-foreground">
				{doc.controlNumber}
			</p>
			<FinanceStepRail current={sent ? "FUNDING" : "PACKETS"} />
			<Callout title={t("finance_flow.callout.pbcc_title")}>
				{t("finance_flow.callout.pbcc_body")}
			</Callout>

			<div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.job_type")}:
					</span>{" "}
					{doc.jobType}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.address")}:
					</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.aviso_number")}:
					</span>{" "}
					{doc.avisoNumber || "—"}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.amount")}:
					</span>{" "}
					{formatMoney(amount)}
				</p>
				<p>
					<span className="text-muted-foreground">
						{t("finance_pbcc.advance", {
							rate: (lcPbccAdvanceRate * 100).toFixed(1),
						})}
						:
					</span>{" "}
					{formatMoney(amount * lcPbccAdvanceRate)}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("finance_pbcc.ivu_rate", { rate: (ivuRate * 100).toFixed(1) })}
				</p>
			</div>

			{/* Arm A — contractor payment. Live-computed until the job is swept
			    into a payroll run, then read back frozen off the invoice. */}
			<div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				<div className="flex items-center gap-2">
					<h2 className="font-semibold">
						{t("finance_pbcc.contractor_payment")}
					</h2>
					{frozen ? (
						<Badge variant="ok">{t("finance_pbcc.frozen")}</Badge>
					) : (
						<Badge>{t("finance_pbcc.estimated")}</Badge>
					)}
					{!contractorAccountResolved && (
						<Badge variant="warn">{t("finance_pbcc.account_unmapped")}</Badge>
					)}
					{missingClaroPdf && (
						<Badge variant="warn">{t("finance_pbcc.missing_claro_pdf")}</Badge>
					)}
				</div>
				<table className="w-full">
					<tbody>
						<tr>
							<td className="text-muted-foreground">
								{t("finance_pbcc.gross")}
							</td>
							<td className="text-right font-mono">
								{formatMoney(payment.grossPayable)}
							</td>
						</tr>
						<tr>
							<td className="text-muted-foreground">
								{t("finance_pbcc.retention")}
							</td>
							<td className="text-right font-mono">
								{formatMoney(payment.retentionAmount)}
							</td>
						</tr>
						<tr className="font-semibold">
							<td>{t("finance_pbcc.net")}</td>
							<td className="text-right font-mono">
								{formatMoney(payment.netPayable)}
							</td>
						</tr>
					</tbody>
				</table>
			</div>

			<p className="text-sm text-muted-foreground">{t("finance_pbcc.hint")}</p>

			{/* The bank-format invoice / bank Excel schedule have no generator yet —
			    both are explicitly blocked rather than silently missing. */}
			<div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				<p className="text-muted-foreground">
					{t("finance_pbcc.bank_invoice_blocked")}
				</p>
				<p className="text-muted-foreground">
					{t("finance_pbcc.bank_schedule_blocked")}
				</p>
			</div>

			{/* Pre-certification sheet: Doc 3, with three signer names. */}
			<div className="bg-card border rounded-lg p-4 space-y-2 text-sm">
				{preCertSheet?.pdfPath ? (
					<div className="flex items-center justify-between">
						<div>
							<h2 className="font-semibold">
								{t("finance_pbcc.precert_title")}
							</h2>
							{preCertSheet && (
								<p className="text-xs text-muted-foreground mt-1">
									{t("finance_pbcc.precert_signers", {
										supervisor: supervName,
										contractor: subconName,
										claro: claroName,
									})}
								</p>
							)}
						</div>
						<a
							href={`/files/precert/${doc.id}-v${preCertSheet.version}.pdf`}
							className="text-accent-text underline text-sm"
						>
							{t("finance_pbcc.precert_download")}
						</a>
					</div>
				) : (
					<div className="flex items-center justify-between">
						<p className="font-medium text-status-warn">
							{t("finance_pbcc.precert_missing")}
						</p>
					</div>
				)}
			</div>

			{errorKey && (
				<p role="alert" className="text-sm text-destructive">
					{t(errorKey as never)}
				</p>
			)}

			{sent && !funded && (
				<Form
					method="post"
					className="bg-card border rounded-lg p-4 space-y-3 text-sm"
				>
					<input type="hidden" name="intent" value="mark_funded" />
					<div className="flex flex-wrap items-end gap-3">
						<label className="space-y-1">
							<span className="block text-muted-foreground">
								{t("finance_pbcc.funded_date")}
							</span>
							<input
								type="date"
								name="fundedDate"
								required
								max={today}
								className="border rounded px-2 py-1"
							/>
						</label>
						<label className="space-y-1">
							<span className="block text-muted-foreground">
								{t("finance_pbcc.funded_amount")}
							</span>
							<input
								type="number"
								step="0.01"
								min="0.01"
								name="fundedAmount"
								required
								className="border rounded px-2 py-1"
							/>
						</label>
						<label className="space-y-1">
							<span className="block text-muted-foreground">
								{t("finance_pbcc.funded_ref")}
							</span>
							<input
								type="text"
								name="fundedRef"
								className="border rounded px-2 py-1"
							/>
						</label>
						<Button type="submit">{t("finance_pbcc.mark_funded")}</Button>
					</div>
				</Form>
			)}

			{funded && (
				<div className="bg-card border rounded-lg p-4 space-y-3 text-sm">
					<Badge variant="ok">
						{t("finance_pbcc.funded_on", {
							date: funded.date.toLocaleDateString(),
						})}{" "}
						· {formatMoney(funded.amount)}
						{funded.ref ? ` · ${funded.ref}` : ""}
					</Badge>
					{!doc.payrollRun?.paidAt && (
						<details>
							<summary className="cursor-pointer text-accent-text underline">
								{t("finance_pbcc.correct_funding")}
							</summary>
							<Form method="post" className="mt-3 space-y-3">
								<input type="hidden" name="intent" value="correct_funding" />
								<div className="flex flex-wrap items-end gap-3">
									<label className="space-y-1">
										<span className="block text-muted-foreground">
											{t("finance_pbcc.funded_date")}
										</span>
										<input
											type="date"
											name="fundedDate"
											required
											max={today}
											defaultValue={funded.date.toLocaleDateString("en-CA")}
											className="border rounded px-2 py-1"
										/>
									</label>
									<label className="space-y-1">
										<span className="block text-muted-foreground">
											{t("finance_pbcc.funded_amount")}
										</span>
										<input
											type="number"
											step="0.01"
											min="0.01"
											name="fundedAmount"
											required
											defaultValue={funded.amount}
											className="border rounded px-2 py-1"
										/>
									</label>
									<label className="space-y-1">
										<span className="block text-muted-foreground">
											{t("finance_pbcc.funded_ref")}
										</span>
										<input
											type="text"
											name="fundedRef"
											defaultValue={funded.ref}
											className="border rounded px-2 py-1"
										/>
									</label>
								</div>
								<label className="block space-y-1">
									<span className="block text-muted-foreground">
										{t("finance_pbcc.correction_reason")}
									</span>
									<textarea
										name="reason"
										required
										rows={2}
										className="border rounded px-2 py-1 w-full"
									/>
								</label>
								<Button type="submit" variant="secondary">
									{t("finance_pbcc.save_correction")}
								</Button>
							</Form>
						</details>
					)}
				</div>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{/* Disabled on purpose until the Excel-schedule template exists
				    (q&a 13.2): the bank-format generators are pending, so Lissette
				    marks the packet "sent by hand" instead. The generate_pbcc
				    action is kept for when the template lands. */}
				<Form method="post">
					<input type="hidden" name="intent" value="generate_pbcc" />
					<Button type="submit" disabled>
						{t("finance_pbcc.generate_and_download")}
					</Button>
				</Form>
				<Form method="post" className="flex items-center gap-2">
					<input type="hidden" name="intent" value="mark_sent_by_hand" />
					<input
						type="text"
						name="note"
						placeholder={t("finance_pbcc.sent_by_hand_note")}
						className="border rounded px-2 py-1 text-sm"
					/>
					<Button type="submit" variant="secondary">
						{t("finance_pbcc.mark_sent_by_hand")}
					</Button>
				</Form>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
