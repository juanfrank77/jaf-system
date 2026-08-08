import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import {
	FINANCE_STAGES,
	type FinanceStage,
	financeStageLabelKey,
} from "~/lib/finance-pipeline"
import {
	computeFinanceStage,
	daysInStage,
	type FinancePipelineRow,
	financeStageAlertDays,
	invoiceTotalUsed,
	isMissingAviso,
	isMissingClaroPdf,
} from "~/lib/finance-pipeline.server"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { DocStatus } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.finance.receivables"

export const meta: Route.MetaFunction = () => [
	{ title: "Finance Pipeline — JAF Ops" },
]

const FINANCEABLE_STATUSES: DocStatus[] = [
	"SUPERVISOR_APPROVED",
	"CLARO_UPLOADED",
	"LC_GENERATED",
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const stageFilter = url.searchParams.get("stage") as FinanceStage | null

	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [c.id, { unitPrice: toNumberPrice(c.unitPrice) }]),
	)
	const ivuRate = await getIvuRate()

	const invoices = await db.jafInvoice.findMany({
		where: { status: { in: FINANCEABLE_STATUSES } },
		include: { supervisor: true, poLinks: { orderBy: { id: "asc" } } },
		orderBy: { supervisorApprovedAt: "asc" },
	})

	const rows: FinancePipelineRow[] = invoices.map((inv) => {
		const stage = computeFinanceStage(
			inv,
			inv.poLinks.length > 0,
		) as FinanceStage
		const ageDays = daysInStage(inv, stage)
		const alertDays = financeStageAlertDays(stage)
		const isAlert = alertDays !== null && ageDays > alertDays
		return {
			id: inv.id,
			controlNumber: inv.controlNumber,
			avisoNumber: inv.avisoNumber,
			supervisorName: inv.supervisor?.name ?? "—",
			jobType: inv.jobType,
			stage,
			ageDays,
			alertDays,
			isAlert,
			amount: invoiceTotalUsed(inv, codeMap, ivuRate),
			missingAviso: isMissingAviso(inv),
			missingClaroPdf: isMissingClaroPdf(inv),
			advanceAmount: inv.advanceAmount ? Number(inv.advanceAmount) : null,
			finalPaymentAmount: inv.finalPaymentAmount
				? Number(inv.finalPaymentAmount)
				: null,
		}
	})

	const filtered = stageFilter
		? rows.filter((r) => r.stage === stageFilter)
		: rows
	const totals = FINANCE_STAGES.reduce<
		Record<FinanceStage, { count: number; amount: number }>
	>(
		(acc, stage) => {
			const stageRows = rows.filter((r) => r.stage === stage)
			acc[stage] = {
				count: stageRows.length,
				amount: stageRows.reduce((sum, r) => sum + r.amount, 0),
			}
			return acc
		},
		{} as Record<FinanceStage, { count: number; amount: number }>,
	)

	return { rows: filtered, totals, stageFilter, ivuRate }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	const docId = form.get("docId") as string

	if (intent === "record_advance") {
		const amount = parseFloat(form.get("advanceAmount") as string)
		if (Number.isNaN(amount))
			return { errorKey: "finance_receivables.errors.invalid_amount" }
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: docId },
				data: { advanceReceivedAt: new Date(), advanceAmount: amount },
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "ADVANCE_RECEIVED",
					diffJson: { advanceAmount: amount },
				},
			}),
		])
	}

	if (intent === "record_final") {
		const amount = parseFloat(form.get("finalAmount") as string)
		if (Number.isNaN(amount))
			return { errorKey: "finance_receivables.errors.invalid_amount" }
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: docId },
				data: {
					finalPaymentReceivedAt: new Date(),
					finalPaymentAmount: amount,
				},
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "FINAL_PAYMENT_RECEIVED",
					diffJson: { finalPaymentAmount: amount },
				},
			}),
		])
	}

	if (intent === "close") {
		const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })
		if (!doc.advanceReceivedAt || !doc.finalPaymentReceivedAt) {
			return { errorKey: "finance_receivables.errors.record_both_first" }
		}
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: docId },
				data: { receivableClosedAt: new Date(), receivableClosedById: user.id },
			}),
			db.auditTrail.create({
				data: {
					docId,
					userId: user.id,
					action: "RECEIVABLE_CLOSED",
					diffJson: {},
				},
			}),
		])
	}

	return null
}

const AGE_COLOR = (days: number, isAlert: boolean) => {
	if (isAlert) return "text-red-600 font-semibold"
	if (days > 90) return "text-orange-600"
	if (days > 60) return "text-yellow-700"
	return "text-slate-700"
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
	const { rows, totals, stageFilter } = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | null

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_receivables.title")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t("finance_receivables.total_open", { count: rows.length })}
				</p>
			</div>

			{error?.errorKey && (
				<p className="text-sm text-red-600">{t(error.errorKey as any)}</p>
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
								{(row.missingAviso || row.missingClaroPdf) && (
									<span className="text-amber-700">
										{t("finance_receivables.missing_docs")}
									</span>
								)}
							</div>

							<div className="flex flex-wrap items-center gap-2">
								<Link
									to={`/finance/verify/${row.id}`}
									className={buttonVariants({
										variant: "outline",
										size: "sm",
									})}
								>
									{t("finance_receivables.verify")}
								</Link>

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
										<Button type="submit" size="sm">
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

								{(row.stage === "WAITING_PBCC_FUNDING" ||
									row.stage === "IN_CLARO_QUEUE") && (
									<div className="flex items-center gap-2">
										<Form method="post" className="flex gap-2">
											<input
												type="hidden"
												name="intent"
												value="record_advance"
											/>
											<input type="hidden" name="docId" value={row.id} />
											<Input
												name="advanceAmount"
												type="number"
												step="0.01"
												placeholder={t(
													"finance_receivables.advance_placeholder",
												)}
												className="h-8 w-28 text-sm"
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-8 text-sm"
											>
												{t("finance_receivables.record_advance")}
											</Button>
										</Form>
										<Form method="post" className="flex gap-2">
											<input type="hidden" name="intent" value="record_final" />
											<input type="hidden" name="docId" value={row.id} />
											<Input
												name="finalAmount"
												type="number"
												step="0.01"
												placeholder={t("finance_receivables.final_placeholder")}
												className="h-8 w-28 text-sm"
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-8 text-sm"
											>
												{t("finance_receivables.record_final")}
											</Button>
										</Form>
									</div>
								)}
							</div>
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
