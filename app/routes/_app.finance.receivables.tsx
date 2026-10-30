import type { ParseKeys } from "i18next"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ArmBStepRail, StageChip } from "~/components/finance-step-rail"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import { sendInternalEmail } from "~/lib/email.server"
import {
	FINANCE_STAGES,
	type FinanceStage,
	financeStageLabelKey,
} from "~/lib/finance-pipeline"
import {
	checkAmountTolerance,
	computeFinanceStage,
	daysInStage,
	FINANCEABLE_STATUSES,
	type FinancePipelineRow,
	fetchInvoiceTotalContext,
	financeStageAlertDays,
	invoiceTotalUsed,
	isMissingAvisoPdf,
} from "~/lib/finance-pipeline.server"
import { parsePaymentDate, paymentForType } from "~/lib/payment-records"
import { recordReceivablePayment } from "~/lib/payment-records.server"
import { requireRole } from "~/lib/permissions.server"
import { isReturned } from "~/lib/returned-packet"
import { getAgingAlertDays } from "~/lib/system-settings.server"
import { formatMoney } from "~/lib/utils"
import type { DocStatus } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.finance.receivables"

export const meta: Route.MetaFunction = () => [
	{ title: "Receivables — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const stageFilter = url.searchParams.get("stage") as FinanceStage | null

	const [{ codeMap, ivuRate, tolerance }, agingAlertDays] = await Promise.all([
		fetchInvoiceTotalContext(),
		getAgingAlertDays(),
	])

	const financeStatuses: DocStatus[] = FINANCEABLE_STATUSES
	const invoices = await db.jafInvoice.findMany({
		where: {
			status: { in: financeStatuses },
			// Only work orders released to Finance. Legacy exception (Arm A spec
			// §5): a job with an existing PBCC_ADVANCE payment record keeps
			// flowing through this page.
			OR: [
				{ releasedToFinanceAt: { not: null } },
				{ paymentRecords: { some: { type: "PBCC_ADVANCE" } } },
			],
		},
		include: {
			supervisor: true,
			poLinks: { orderBy: { id: "asc" } },
			paymentRecords: { select: { type: true, amount: true, date: true } },
		},
		orderBy: { supervisorApprovedAt: "asc" },
		take: 200,
	})

	// A packet Finance sent back is the supervisor's until he resends it (S4):
	// it sits under Returned on Packets in, not in this list.
	// (A row that already carries money stays visible.)
	const open = invoices.filter(
		(inv) => !(isReturned(inv) && inv.paymentRecords.length === 0),
	)
	const rows: FinancePipelineRow[] = open.map((inv) => {
		const stage = computeFinanceStage(
			inv,
			inv.poLinks.length > 0,
			inv.paymentRecords,
		) as FinanceStage
		const poDate = inv.poLinks[0]?.poDate ?? null
		const advancePayment = paymentForType(inv.paymentRecords, "PBCC_ADVANCE")
		const finalPayment = paymentForType(inv.paymentRecords, "CLARO_FINAL")
		const ageDays = daysInStage(inv, stage, poDate, inv.paymentRecords)
		const alertDays = financeStageAlertDays(stage, agingAlertDays)
		const isAlert = alertDays !== null && ageDays > alertDays
		const amount = invoiceTotalUsed(inv, codeMap, ivuRate)
		const poLink = inv.poLinks[0] ?? null
		const poAmount = poLink?.amount ? Number(poLink.amount) : null
		const poMismatch =
			poAmount !== null &&
			checkAmountTolerance(amount, poAmount, tolerance).withinTolerance ===
				false
		return {
			id: inv.id,
			status: inv.status,
			controlNumber: inv.controlNumber,
			avisoNumber: inv.avisoNumber,
			supervisorName: inv.supervisor?.name ?? "—",
			jobType: inv.jobType,
			stage,
			ageDays,
			alertDays,
			isAlert,
			amount,
			missingAvisoPdf: isMissingAvisoPdf(inv),
			advanceAmount:
				advancePayment?.amount != null ? Number(advancePayment.amount) : null,
			finalPaymentAmount:
				finalPayment?.amount != null ? Number(finalPayment.amount) : null,
			poMismatch,
			poAmount,
		}
	})

	const alertRows = rows.filter((r) => r.isAlert)
	if (alertRows.length > 0) {
		const adminUsers = await db.user.findMany({
			where: { role: "ADMIN", active: true },
			select: { id: true },
		})

		const existingNotifications = await db.notification.findMany({
			where: {
				userId: { in: adminUsers.map((u) => u.id) },
				docId: { in: alertRows.map((r) => r.id) },
				read: false,
			},
			select: { userId: true, docId: true },
		})

		const notifiedPairs = new Set(
			existingNotifications.map((n) => `${n.userId}:${n.docId}`),
		)

		const notificationsToCreate = adminUsers.flatMap((admin) =>
			alertRows
				.filter((r) => !notifiedPairs.has(`${admin.id}:${r.id}`))
				.map((r) => ({
					userId: admin.id,
					docId: r.id,
					message: `Aging alert: job ${r.controlNumber} has been in stage ${r.stage.replace(/_/g, " ")} for ${r.ageDays} days (threshold: ${r.alertDays} days).`,
				})),
		)

		if (notificationsToCreate.length > 0) {
			await db.notification.createMany({
				data: notificationsToCreate,
			})
		}
	}

	const filtered = stageFilter
		? rows.filter((r) => r.stage === stageFilter)
		: rows
	// Single pass for per-stage totals (previously re-scanned the full list once
	// per stage).
	const totals = {} as Record<FinanceStage, { count: number; amount: number }>
	for (const stage of FINANCE_STAGES) totals[stage] = { count: 0, amount: 0 }
	for (const r of rows) {
		totals[r.stage].count += 1
		totals[r.stage].amount += r.amount
	}

	return { rows: filtered, totals, stageFilter, ivuRate, user, agingAlertDays }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	const docId = form.get("docId") as string

	if (intent === "record_advance" || intent === "record_final") {
		const doc = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docId },
			include: { poLinks: true, paymentRecords: { select: { type: true } } },
		})
		if (doc.status === "LC_REQUEST_GENERATED")
			return { errorKey: "finance_receivables.errors.invalid_stage" }
		const stage = computeFinanceStage(
			doc,
			doc.poLinks.length > 0,
			doc.paymentRecords,
		)
		const expectedStage =
			intent === "record_advance" ? "WAITING_PBCC_FUNDING" : "IN_CLARO_QUEUE"
		if (stage !== expectedStage)
			return { errorKey: "finance_receivables.errors.invalid_stage" }
		const amount = Number(
			form.get(intent === "record_advance" ? "advanceAmount" : "finalAmount"),
		)
		const date = parsePaymentDate(form.get("paymentDate") as string | null)
		const note = (form.get("paymentNote") as string | null)?.trim() || null
		if (!Number.isFinite(amount) || amount <= 0 || !date)
			return { errorKey: "finance_receivables.errors.invalid_payment" }
		const result = await recordReceivablePayment({
			jobId: docId,
			type: intent === "record_advance" ? "PBCC_ADVANCE" : "CLARO_FINAL",
			amount,
			date,
			note,
			actorId: user.id,
		})
		if (result.duplicate)
			return {
				errorKey:
					intent === "record_advance"
						? "finance_receivables.errors.advance_already_recorded"
						: "finance_receivables.errors.final_already_recorded",
			}
		const financeUsers = await db.user.findMany({
			where: { role: "FINANCE", active: true },
			select: { id: true, email: true },
		})
		const label =
			intent === "record_advance" ? "PBCC advance" : "Claro final payment"
		await db.notification.createMany({
			data: financeUsers.map((recipient) => ({
				userId: recipient.id,
				docId,
				message: `${label} recorded for ${doc.controlNumber}.`,
			})),
		})
		await sendInternalEmail({
			docId,
			actorId: user.id,
			recipients: financeUsers.map((recipient) => recipient.email),
			subject: `${label}: ${doc.controlNumber}`,
			context: "RECEIVABLE_PAYMENT",
		})
		return null
	}

	if (intent === "close") {
		const doc = await db.jafInvoice.findUniqueOrThrow({
			where: { id: docId },
			include: { poLinks: true, paymentRecords: { select: { type: true } } },
		})
		if (doc.status === "LC_REQUEST_GENERATED")
			return { errorKey: "finance_receivables.errors.invalid_stage" }
		if (doc.receivableClosedAt)
			return { errorKey: "finance_receivables.errors.already_closed" }
		if (isMissingAvisoPdf(doc))
			return { errorKey: "finance_receivables.errors.missing_aviso_pdf" }
		const stage = computeFinanceStage(
			doc,
			doc.poLinks.length > 0,
			doc.paymentRecords,
		)
		if (stage !== "READY_TO_CLOSE")
			return { errorKey: "finance_receivables.errors.record_both_first" }
		const closedAt = new Date()
		const updated = await db.$transaction(async (tx) => {
			const result = await tx.jafInvoice.updateMany({
				where: { id: docId, receivableClosedAt: null },
				data: { receivableClosedAt: closedAt, receivableClosedById: user.id },
			})
			if (result.count !== 1) return false
			await tx.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "RECEIVABLE_CLOSED",
					diffJson: {
						source: "receivableClosedAt",
						paymentTypes: ["PBCC_ADVANCE", "CLARO_FINAL"],
					},
				},
			})
			return true
		})
		if (!updated)
			return { errorKey: "finance_receivables.errors.already_closed" }
		return null
	}

	return { errorKey: "finance_receivables.errors.unknown_intent" }
}

const AGE_COLOR = (days: number, isAlert: boolean) => {
	if (isAlert) return "text-status-danger font-semibold"
	if (days > 90) return "text-status-warn"
	if (days > 60) return "text-status-warn"
	return "text-foreground"
}

function StageBadge({ stage }: { stage: FinanceStage }) {
	const variantMap: Record<FinanceStage, "info" | "warn" | "ok" | "neutral"> = {
		TO_VERIFY: "info",
		PBCC_REQUEST_PENDING: "info",
		WAITING_PBCC_FUNDING: "warn",
		WAITING_CLARO_PO: "warn",
		PO_RECEIVED_UPLOAD: "info",
		IN_CLARO_QUEUE: "warn",
		READY_TO_CLOSE: "ok",
		CLOSED: "neutral",
	}
	return <Badge variant={variantMap[stage]}>{stage.replace(/_/g, " ")}</Badge>
}

export default function FinancePipeline({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { rows, totals, stageFilter, user } = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | null
	const canRecordPayment = ["FINANCE", "ADMIN"].includes(user.role)
	const today = new Date().toISOString().slice(0, 10)

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<h1 className="text-xl font-semibold">
						{t("finance_receivables.title")}
					</h1>
					<StageChip arm="B" name={t("finance_flow.arm_b.step.receivables")} />
				</div>
				<p className="text-sm text-muted-foreground">
					{t("finance_receivables.total_open", { count: rows.length })}
				</p>
			</div>
			<ArmBStepRail current="RECEIVABLES" />
			<Callout title={t("finance_flow.callout.arm_b_receivables_title")}>
				{t("finance_flow.callout.arm_b_receivables_body")}
			</Callout>

			{error?.errorKey && (
				<p className="text-sm text-status-danger">
					{t(error.errorKey as ParseKeys)}
				</p>
			)}

			{/* Stage totals */}
			<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
				{FINANCE_STAGES.map((stage) => {
					const active = stageFilter === stage
					return (
						<Link
							key={stage}
							to={active ? "/finance/receivables" : `?stage=${stage}`}
							className={buttonVariants({
								variant: active ? "default" : "outline",
								className: "h-auto flex-col items-start gap-1 py-3 px-4",
							})}
						>
							<span className="text-xs font-normal opacity-80">
								{t(financeStageLabelKey(stage))}
							</span>
							<span className="text-lg font-semibold">
								{totals[stage].count}
							</span>
							<span className="text-xs font-normal opacity-80">
								{formatMoney(totals[stage].amount)}
							</span>
						</Link>
					)
				})}
			</div>

			<div className="space-y-3">
				{rows.map((row) => (
					<Card key={row.id}>
						<CardContent className="space-y-4 p-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<span className="font-mono text-sm font-medium">
										{row.controlNumber}
									</span>
									{row.avisoNumber && (
										<span className="ml-2 text-sm text-foreground">
											{t("finance_receivables.aviso", {
												number: row.avisoNumber,
											})}
										</span>
									)}
									<p className="text-sm text-foreground">
										{row.supervisorName} — {row.jobType}
									</p>
								</div>
								<div className="flex items-center gap-2">
									<StageBadge stage={row.stage} />
									<span
										className={`text-sm ${AGE_COLOR(row.ageDays, row.isAlert)}`}
									>
										{t("finance_receivables.age_days", {
											count: row.ageDays,
										})}
									</span>
								</div>
							</div>

							<div className="flex flex-wrap items-center gap-3 text-sm">
								<span className="font-medium">
									{t("finance_receivables.amount_label")}:{" "}
									{formatMoney(row.amount)}
								</span>
								{row.poMismatch && row.poAmount !== null && (
									<span className="text-status-warn">
										{t("finance_receivables.po_mismatch", {
											poAmount: formatMoney(row.poAmount),
										})}
									</span>
								)}
								{row.missingAvisoPdf && (
									<span className="text-status-warn">
										{t("finance_receivables.missing_aviso_pdf")}
									</span>
								)}
							</div>

							{row.status !== "LC_REQUEST_GENERATED" && (
								<div className="flex flex-wrap items-center gap-2">
									{row.stage === "TO_VERIFY" && (
										<Link
											to={`/finance/verify/${row.id}`}
											className={buttonVariants({
												variant: "outline",
												size: "sm",
											})}
										>
											{t("finance_receivables.verify")}
										</Link>
									)}

									{row.stage === "PBCC_REQUEST_PENDING" && (
										<Link
											to={`/finance/pbcc/${row.id}`}
											className={buttonVariants({ size: "sm" })}
										>
											{t("finance_receivables.generate_pbcc")}
										</Link>
									)}

									{row.stage === "PO_RECEIVED_UPLOAD" && (
										<Link
											to={`/finance/po/${row.id}`}
											className={buttonVariants({ size: "sm" })}
										>
											{t("finance_receivables.upload_final_doc")}
										</Link>
									)}

									{row.stage === "READY_TO_CLOSE" && (
										<Form method="post" className="inline">
											<input type="hidden" name="intent" value="close" />
											<input type="hidden" name="docId" value={row.id} />
											<Button
												type="submit"
												size="sm"
												disabled={row.missingAvisoPdf}
												title={
													row.missingAvisoPdf
														? t("finance_receivables.errors.missing_aviso_pdf")
														: undefined
												}
											>
												{t("finance_receivables.close")}
											</Button>
										</Form>
									)}

									{row.stage === "WAITING_CLARO_PO" && (
										<Link
											to={`/finance/po/${row.id}`}
											className={buttonVariants({
												variant: "outline",
												size: "sm",
											})}
										>
											{t("finance_receivables.record_po")}
										</Link>
									)}

									{canRecordPayment && row.stage === "WAITING_PBCC_FUNDING" && (
										<Form
											method="post"
											className="flex flex-wrap items-end gap-2"
										>
											<input
												type="hidden"
												name="intent"
												value="record_advance"
											/>
											<input type="hidden" name="docId" value={row.id} />
											<div>
												<label
													htmlFor={`advance-amount-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.amount_label")}
												</label>
												<Input
													id={`advance-amount-${row.id}`}
													name="advanceAmount"
													type="number"
													step="0.01"
													min="0.01"
													placeholder={t(
														"finance_receivables.advance_placeholder",
													)}
													className="h-8 w-28 text-sm"
													required
												/>
											</div>
											<div>
												<label
													htmlFor={`advance-date-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.payment_date")}
												</label>
												<Input
													id={`advance-date-${row.id}`}
													name="paymentDate"
													type="date"
													defaultValue={today}
													className="h-8 text-sm"
													required
												/>
											</div>
											<div>
												<label
													htmlFor={`advance-note-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.payment_note")}
												</label>
												<Input
													id={`advance-note-${row.id}`}
													name="paymentNote"
													className="h-8 w-36 text-sm"
												/>
											</div>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-8"
											>
												{t("finance_receivables.record_advance")}
											</Button>
										</Form>
									)}
									{canRecordPayment && row.stage === "IN_CLARO_QUEUE" && (
										<Form
											method="post"
											className="flex flex-wrap items-end gap-2"
										>
											<input type="hidden" name="intent" value="record_final" />
											<input type="hidden" name="docId" value={row.id} />
											<div>
												<label
													htmlFor={`final-amount-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.amount_label")}
												</label>
												<Input
													id={`final-amount-${row.id}`}
													name="finalAmount"
													type="number"
													step="0.01"
													min="0.01"
													placeholder={t(
														"finance_receivables.final_placeholder",
													)}
													className="h-8 w-28 text-sm"
													required
												/>
											</div>
											<div>
												<label
													htmlFor={`final-date-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.payment_date")}
												</label>
												<Input
													id={`final-date-${row.id}`}
													name="paymentDate"
													type="date"
													defaultValue={today}
													className="h-8 text-sm"
													required
												/>
											</div>
											<div>
												<label
													htmlFor={`final-note-${row.id}`}
													className="text-xs text-muted-foreground"
												>
													{t("finance_receivables.payment_note")}
												</label>
												<Input
													id={`final-note-${row.id}`}
													name="paymentNote"
													className="h-8 w-36 text-sm"
												/>
											</div>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-8"
											>
												{t("finance_receivables.record_final")}
											</Button>
										</Form>
									)}
									{!canRecordPayment &&
										(row.stage === "WAITING_PBCC_FUNDING" ||
											row.stage === "IN_CLARO_QUEUE") && (
											<span className="text-xs text-muted-foreground">
												{t("finance_receivables.waiting_for_payment")}
											</span>
										)}
								</div>
							)}
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
