import { useTranslation } from "react-i18next"
import { Form, Link, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import {
	countSweepableJobs,
	EmptyRunError,
	generateRun,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payroll"

export const meta: Route.MetaFunction = () => [
	{ title: "Awaiting payroll — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const [openRuns, openJobCount] = await Promise.all([
		db.payrollRun.findMany({
			where: { paidAt: null, reversedAt: null },
			orderBy: { generatedAt: "asc" },
			select: {
				id: true,
				label: true,
				generatedAt: true,
				_count: { select: { invoices: true } },
			},
		}),
		countSweepableJobs(),
	])
	return { user, openRuns, openJobCount }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	if (intent !== "generate_run")
		return { errorKey: "finance_payroll.errors.unknown_intent" }
	const label =
		(form.get("label") as string | null)?.trim() ||
		new Date().toISOString().slice(0, 10)
	// Default is every ready job; L1 sends the ones Lissette unticked.
	const excludeIds = form
		.getAll("excludeIds")
		.filter((v): v is string => typeof v === "string" && v !== "")
	try {
		const { run } = await generateRun({
			generatedById: user.id,
			label,
			excludeIds,
		})
		throw redirect(`/finance/payroll/${run.id}`)
	} catch (e) {
		if (e instanceof EmptyRunError)
			return { errorKey: "finance_payroll.errors.empty_run" as const }
		throw e
	}
}

export default function FinancePayrollList({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { openRuns, openJobCount } = loaderData
	const { t } = useTranslation()
	return (
		<div className="p-6 space-y-4">
			<h1 className="text-2xl font-bold">{t("finance_payroll.title")}</h1>
			{actionData?.errorKey && (
				<p className="text-sm text-status-danger">
					{actionData.errorKey === "finance_payroll.errors.empty_run"
						? t("finance_payroll.errors.empty_run")
						: t("finance_payroll.errors.unknown_intent")}
				</p>
			)}
			<Form method="post" className="flex items-center gap-2">
				<input type="hidden" name="intent" value="generate_run" />
				<input
					type="text"
					name="label"
					placeholder={t("finance_payroll.run_label_placeholder")}
					className="border rounded px-2 py-1"
				/>
				<Button type="submit" disabled={openJobCount === 0}>
					{t("finance_payroll.generate_run", { count: openJobCount })}
				</Button>
			</Form>
			<ul className="space-y-1 text-sm">
				{openRuns.map((run) => {
					// A run older than one payroll cycle (14d) with no `paidAt` is
					// overdue — computed from generatedAt, no extra field needed.
					const ageDays = Math.floor(
						(Date.now() - new Date(run.generatedAt).getTime()) / 86400000,
					)
					return (
						<li
							key={run.id}
							className={ageDays > 14 ? "text-status-danger" : undefined}
						>
							<Link to={`/finance/payroll/${run.id}`} className="underline">
								{t("finance_payroll.run_row", {
									label: run.label,
									count: run._count.invoices,
									date: new Date(run.generatedAt).toLocaleDateString(),
								})}
							</Link>
							{ageDays > 14 && (
								<span className="ml-2">
									{t("finance_payroll.overdue", { days: ageDays })}
								</span>
							)}
						</li>
					)
				})}
			</ul>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
