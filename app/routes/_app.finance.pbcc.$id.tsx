import fs from "node:fs/promises"
import path from "node:path"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { bankInvoiceNumber } from "~/lib/bank-schedule"
import {
	type ContractorPayment,
	type ContractorShareLine,
	computeContractorPayment,
	payeeCode,
	resolveContractorAccount,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	computeFinanceStage,
	financeLineItems,
} from "~/lib/finance-pipeline.server"
import { FINANCE_STEPS, pbccStep, stepNumber } from "~/lib/finance-steps"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { rowAmounts } from "~/lib/pbcc-batch.server"
import { generatePbccRequestPdf } from "~/lib/pdf/pbcc-request.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getBankInvoicePrefix,
	getLcPbccAdvanceRate,
} from "~/lib/system-settings.server"
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
			brigade: { select: { code: true } },
			poLinks: true,
			paymentRecords: { select: { type: true, note: true } },
			payrollRun: { select: { paidAt: true } },
			preCertSheets: { orderBy: { version: "desc" }, take: 1 },
			bankSchedule: { select: { id: true, number: true, sentAt: true } },
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
	const lcPbccAdvanceRate = await getLcPbccAdvanceRate()
	// PBCC documents carry no IVU (Lissette, 2026-11-03): subtotal only.
	const amount = rowAmounts(doc).subtotal

	// A job already swept into a run (grossPayable set) has its payment
	// frozen — show that, never live-recompute it, so a later catalog price
	// change can't appear to move an already-generated run's figures.
	const account = await resolveContractorAccount(payeeCode(doc))
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
		invoiceSubtotal: rowAmounts(doc).subtotal,
		lcPbccAdvanceRate,
		payment,
		frozen,
		contractorAccountResolved: frozen || account !== null,
		bankSchedule: doc.bankSchedule,
		hasBankInvoice: Boolean(doc.bankInvoicePdfPath),
	}
}

function onUnsentSchedule(doc: {
	bankSchedule: { sentAt: Date | null } | null
}): boolean {
	return doc.bankSchedule != null && doc.bankSchedule.sentAt === null
}

function onScheduleError(doc: {
	bankSchedule: { number: number | null } | null
}) {
	return {
		errorKey: "finance_pbcc.errors.on_schedule",
		list: doc.bankSchedule?.number ? `#${doc.bankSchedule.number}` : "(open)",
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			supervisor: true,
			poLinks: true,
			paymentRecords: { select: { type: true } },
			bankSchedule: { select: { number: true, sentAt: true } },
		},
	})
	if (isTerminalStatus(doc.status)) {
		return { errorKey: "finance_pbcc.errors.terminal_status" }
	}
	const form = await request.formData()
	const intent = form.get("intent")

	// Escape hatch: Lissette sends the PBCC packet by hand (outside the system)
	// because the bank-format invoice/schedule generators don't exist yet. This
	// must work even when the Aviso/Claro PDFs the auto-generator insists on are
	// missing — recording "sent" is precisely the case it exists for.
	if (intent === "mark_sent_by_hand") {
		// A packet claimed by an unsent bank schedule is already in the .xlsx
		// the bank will receive; hand-sending it too would fund it twice.
		if (onUnsentSchedule(doc)) return onScheduleError(doc)
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
	if (onUnsentSchedule(doc)) return onScheduleError(doc)
	const stage = computeFinanceStage(
		doc,
		doc.poLinks.length > 0,
		doc.paymentRecords,
	)
	if (stage !== "PBCC_REQUEST_PENDING") {
		throw redirect(`/finance/receivables`)
	}

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(serviceCodes.map((c) => [c.id, c]))
	const lcPbccAdvanceRate = await getLcPbccAdvanceRate()
	const lineItems = financeLineItems(doc, codeMap)

	const uploadDir = process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
	const pbccDir = path.join(uploadDir, "pbcc-requests")
	await fs.mkdir(pbccDir, { recursive: true })

	const today = new Date().toLocaleDateString("en-US")
	const invoiceNumber = bankInvoiceNumber(
		await getBankInvoicePrefix(),
		doc.avisoNumber || doc.controlNumber,
	)

	const pdfBytes = await generatePbccRequestPdf({
		controlNumber: doc.controlNumber,
		avisoNumber: doc.avisoNumber,
		jobType: doc.jobType,
		jobAddress: doc.jobAddressActual ?? doc.jobAddressEstimated,
		invoiceNumber,
		invoiceDate: today,
		debtor: "PRT/CLARO",
		lineItems,
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
		payment,
		frozen,
		contractorAccountResolved,
		bankSchedule,
		hasBankInvoice,
		invoiceSubtotal,
	} = loaderData
	const { t } = useTranslation()

	const errorKey =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const errorList =
		actionData && "list" in actionData ? String(actionData.list) : ""
	const onUnsent = bankSchedule != null && bankSchedule.sentAt === null
	const step = pbccStep(doc)
	let calloutTitle: string
	let calloutBody: string
	switch (step) {
		case "LC_REQUEST":
			calloutTitle = t("finance_flow.callout.lc_request_title")
			calloutBody = t("finance_flow.callout.lc_request_body")
			break
		default:
			calloutTitle = t("finance_flow.callout.lists_title")
			calloutBody = t("finance_flow.callout.lists_body")
	}
	const preCertSheet = doc.preCertSheets?.[0]
	const supervName = preCertSheet?.sigSupervisorName ?? "—"
	const subconName = preCertSheet?.sigSubcontractorName ?? "—"
	const claroName = preCertSheet?.sigClaroName ?? "—"

	return (
		<div className="space-y-5">
			<div className="flex items-center gap-3">
				<h1 className="text-xl font-semibold">{t("finance_pbcc.title")}</h1>
				<StageChip
					arm="A"
					step={stepNumber(step)}
					total={FINANCE_STEPS.length}
				/>
			</div>
			<p className="font-mono text-sm text-muted-foreground">
				{doc.controlNumber}
			</p>
			<FinanceStepRail current={step} />
			<Callout title={calloutTitle}>{calloutBody}</Callout>

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
				</div>
				<table className="w-full">
					<tbody>
						<tr>
							<td className="text-muted-foreground">
								{t("finance_pbcc.gross")}
							</td>
							<td className="text-right font-mono">
								{formatMoney(invoiceSubtotal)}
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

			{(bankSchedule || hasBankInvoice) && (
				<div className="bg-card border rounded-lg p-4 flex flex-wrap items-center gap-4 text-sm">
					{bankSchedule && (
						<Link
							to={`/finance/schedules/${bankSchedule.id}`}
							className="text-accent-text underline"
						>
							{bankSchedule.number
								? t("finance_pbcc.on_schedule", { number: bankSchedule.number })
								: t("finance_pbcc.on_open_batch")}
						</Link>
					)}
					{hasBankInvoice && (
						<a
							href={`/finance/pbcc/${doc.id}/invoice`}
							download
							className="text-accent-text underline"
						>
							{t("finance_pbcc.invoice_pdf")}
						</a>
					)}
				</div>
			)}

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
					{t(errorKey as never, { list: errorList })}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				{!onUnsent && (
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
				)}
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
