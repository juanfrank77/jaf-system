import { useTranslation } from "react-i18next"
import { data, Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	FinanceStageTable,
	StagePagination,
} from "~/components/finance-stage-table"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import {
	fetchInvoiceTotalContext,
	invoiceTotalUsed,
} from "~/lib/finance-pipeline.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { loadStageRows } from "~/lib/finance-stage-rows.server"
import { parseFunding } from "~/lib/funding-form"
import { recordReceivablePayment } from "~/lib/payment-records.server"
import { isTerminalStatus } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { getLcPbccAdvanceRate } from "~/lib/system-settings.server"
import type { Route } from "./+types/_app.finance.lc-funded"

export const meta: Route.MetaFunction = () => [{ title: "LC funded — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const url = new URL(request.url)
	const page = Math.max(
		1,
		Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
	)
	const { rows, totalCount } = await loadStageRows({
		stage: "LC_FUNDED",
		page,
		pageSize: PAGE_SIZE,
		ageFrom: "sent",
	})
	// Suggested funded amount per row, computed the way the PBCC screen does.
	const full = await db.jafInvoice.findMany({
		where: { id: { in: rows.map((r) => r.id) } },
	})
	const [{ codeMap, ivuRate }, advanceRate] = await Promise.all([
		fetchInvoiceTotalContext(),
		getLcPbccAdvanceRate(),
	])
	const defaultAdvance: Record<string, number> = {}
	for (const d of full) {
		defaultAdvance[d.id] =
			Math.round(invoiceTotalUsed(d, codeMap, ivuRate) * advanceRate * 100) /
			100
	}
	return {
		user,
		jobs: rows,
		defaultAdvance,
		pagination: {
			page,
			totalPages: Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
			totalCount,
		},
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "mark_funded")
		return { errorKey: "finance_pbcc.errors.unknown_intent" }
	const jobId = String(form.get("jobId") ?? "")
	const doc = await db.jafInvoice.findUnique({
		where: { id: jobId },
		select: { id: true, pbccRequestSentAt: true, status: true },
	})
	if (!doc || isTerminalStatus(doc.status))
		return { errorKey: "finance_pbcc.errors.terminal_status" }
	if (!doc.pbccRequestSentAt)
		return { errorKey: "finance_pbcc.errors.not_sent" }
	const parsed = parseFunding(form)
	if ("errorKey" in parsed) return parsed
	const result = await recordReceivablePayment({
		jobId,
		type: "PBCC_ADVANCE",
		amount: parsed.amount,
		date: parsed.date,
		note: parsed.note,
		actorId: user.id,
	})
	if (result.duplicate)
		return data(
			{ errorKey: "finance_pbcc.errors.already_funded" },
			{ status: 409 },
		)
	return { ok: true }
}

export default function FinanceLcFunded({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { jobs, pagination, defaultAdvance } = loaderData
	const { t } = useTranslation()
	const today = new Date().toLocaleDateString("en-CA")
	const errorKey =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.step.lc_funded")}
				</h1>
				<StageChip arm="A" step={3} total={5} />
			</div>
			<FinanceStepRail current="LC_FUNDED" />
			<Callout title={t("finance_flow.callout.lc_funded_title")}>
				{t("finance_flow.callout.lc_funded_body")}
			</Callout>
			{errorKey && (
				<p role="alert" className="text-sm text-destructive">
					{t(errorKey as never)}
				</p>
			)}
			{jobs.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("finance_queue.empty")}
				</p>
			) : (
				<FinanceStageTable
					rows={jobs}
					to={(r) => `/finance/pbcc/${r.id}`}
					ageLabelKey="finance_stage.age.sent"
					action={(r) => (
						<Form method="post" className="flex flex-wrap items-end gap-2">
							<input type="hidden" name="intent" value="mark_funded" />
							<input type="hidden" name="jobId" value={r.id} />
							<label className="text-xs">
								{t("finance_stage.funded.date")}
								<input
									type="date"
									name="fundedDate"
									required
									max={today}
									className="block border rounded px-1 py-0.5"
								/>
							</label>
							<label className="text-xs">
								{t("finance_stage.funded.amount")}
								<input
									name="fundedAmount"
									inputMode="decimal"
									required
									defaultValue={defaultAdvance[r.id]}
									className="block w-24 border rounded px-1 py-0.5"
								/>
							</label>
							<label className="text-xs">
								{t("finance_stage.funded.ref")}
								<input
									name="fundedRef"
									className="block w-28 border rounded px-1 py-0.5"
								/>
							</label>
							<Button type="submit" size="sm">
								{t("finance_stage.funded.mark")}
							</Button>
						</Form>
					)}
				/>
			)}
			<StagePagination
				basePath="/finance/lc-funded"
				pagination={pagination}
				pageSize={PAGE_SIZE}
			/>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
