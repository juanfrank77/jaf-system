import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useRevalidator } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { PayrollRequestCard } from "~/components/payroll-request-card"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { RUN_OVERDUE_DAYS } from "~/lib/finance-stages.server"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import { loadPayrollRequests } from "~/lib/payroll-request-view.server"
import {
	discardDraftRun,
	EmptyRunError,
	sendPayrollRun,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll.$runId"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll request — JAF Ops" },
]

const REFRESH_MS = 5000

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const [req] = await loadPayrollRequests({ id: params.runId }, { take: 1 })
	if (!req) throw new Response("Not Found", { status: 404 })
	return { user, req, overdueDays: RUN_OVERDUE_DAYS }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "send_run") {
			await sendPayrollRun({ runId: params.runId, sentById: user.id })
			throw redirect("/finance/payroll?tab=waiting")
		}
		if (intent === "discard_run") {
			await discardDraftRun(params.runId)
			throw redirect("/finance/payroll")
		}
	} catch (e) {
		if (e instanceof EmptyRunError)
			return { errorKey: "finance_payroll.errors.empty_run" as const }
		// Already sent (double click, stale tab): the screen shows where it stands.
		if (e instanceof Response && e.status === 409)
			return { errorKey: "finance_payroll.errors.already_sent" as const }
		throw e
	}
	return { errorKey: "finance_payroll.errors.unknown_intent" as const }
}

export default function FinancePayrollRequest({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { req, overdueDays } = loaderData
	const { t } = useTranslation()
	const { revalidate, state } = useRevalidator()
	// A sent request is Carmen's to tick: keep looking so her ticks show up.
	const watching = req.status === "waiting"
	useEffect(() => {
		if (!watching) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible" && state === "idle")
				revalidate()
		}, REFRESH_MS)
		return () => window.clearInterval(id)
	}, [watching, revalidate, state])
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_payroll.request_title", { label: req.label })}
				</h1>
				<div className="flex items-center gap-4">
					<Link to="/finance/payroll" className="text-sm underline">
						{t("finance_payroll.back")}
					</Link>
					<StageChip arm="A" step={3} total={FINANCE_STEPS.length} />
				</div>
			</div>
			<FinanceStepRail current="LISTS" />
			<Callout title={t("finance_flow.callout.lists_title")}>
				{req.status === "draft"
					? t("finance_payroll.draft_body")
					: t("finance_flow.callout.lists_body")}
			</Callout>
			{actionData?.errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(actionData.errorKey)}
				</p>
			)}
			<PayrollRequestCard request={req} overdueDays={overdueDays} />
			<div className="flex flex-wrap items-center gap-2">
				<a
					href={`/finance/payroll/${req.id}/journal`}
					download
					className={buttonVariants({ variant: "secondary" })}
				>
					{t("finance_payroll.download_journal_pdf")}
				</a>
				{req.status === "draft" && (
					<>
						<Form method="post">
							<input type="hidden" name="intent" value="send_run" />
							<Button type="submit" disabled={req.lines.length === 0}>
								{t("finance_payroll.send")}
							</Button>
						</Form>
						<Form method="post">
							<input type="hidden" name="intent" value="discard_run" />
							<Button type="submit" variant="outline">
								{t("finance_payroll.discard")}
							</Button>
						</Form>
					</>
				)}
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
