import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import {
	buildJournalBlocks,
	closePayrollRunAccount,
	parsePaidDate,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"
import { generateProductionJournalPdf } from "~/lib/pdf/production-journal.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.runs.$runId"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll run — JAF Ops" },
]

/** `t()` is keyed by a strict literal union, so errors map to known keys. */
const ERROR_KEYS = {
	"finance_payroll.errors.unknown_intent":
		"finance_payroll.errors.unknown_intent",
	"finance_payroll.errors.missing_fields":
		"finance_payroll.errors.missing_fields",
	"finance_payroll.errors.invalid_date": "finance_payroll.errors.invalid_date",
	"finance_payroll.errors.future_date": "finance_payroll.errors.future_date",
} as const

type ActionErrorKey = keyof typeof ERROR_KEYS

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const run = await db.payrollRun.findUnique({
		where: { id: params.runId },
		include: { invoices: RUN_INVOICES },
	})
	if (!run) throw new Response("Not Found", { status: 404 })
	const blocks = buildJournalBlocks(run.invoices)
	const blockByCode = new Map(blocks.map((b) => [b.brigadeCode, b]))
	const accountRows = await db.payrollRunAccount.findMany({
		where: { payrollRunId: run.id },
		include: {
			contractorAccount: { select: { code: true, label: true } },
			paidBy: { select: { name: true } },
		},
	})
	const accounts = accountRows
		.map((a) => {
			const block = blockByCode.get(a.contractorAccount.code)
			return {
				accountId: a.contractorAccountId,
				code: a.contractorAccount.code,
				label: a.contractorAccount.label,
				jobs: block?.jobs.length ?? 0,
				gross: block?.gross ?? 0,
				net: block?.net ?? 0,
				retention: block?.retention ?? 0,
				// Total SC: the brigade's final running adj. net, i.e. what to pay.
				toPay: block?.totalSC ?? 0,
				adjNetRunning: block?.totalSC ?? 0,
				paidAt: a.paidAt,
				paidByName: a.paidBy?.name ?? null,
				confirmedByFallback: a.confirmedByFallback,
			}
		})
		.sort((x, y) => x.code.localeCompare(y.code))
	const now = new Date()
	const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
	return {
		user,
		run: { id: run.id, label: run.label, paidAt: run.paidAt },
		accounts,
		today,
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "download_journal_pdf") {
		const run = await db.payrollRun.findUniqueOrThrow({
			where: { id: params.runId },
			include: { invoices: RUN_INVOICES },
		})
		const blocks = buildJournalBlocks(run.invoices)
		const bytes = await generateProductionJournalPdf(run, blocks)
		return new Response(new Uint8Array(bytes), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="journal-${run.label.replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf"`,
			},
		})
	}

	if (intent === "pay_account") {
		const accountId = form.get("accountId")
		if (typeof accountId !== "string" || !accountId) {
			return { errorKey: "finance_payroll.errors.missing_fields" as const }
		}
		const parsed = parsePaidDate(form.get("paidDate") as string | null)
		if ("errorKey" in parsed) return { errorKey: parsed.errorKey }
		await closePayrollRunAccount({
			runId: params.runId,
			accountId,
			paidById: user.id,
			paidDate: parsed.date,
			confirmedByFallback: false,
		})
		return { ok: true as const }
	}

	return { errorKey: "finance_payroll.errors.unknown_intent" as const }
}

export default function ComptrollerPayrollRun({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { run, accounts, today } = loaderData
	const { t } = useTranslation()
	const errorKey =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const error = errorKey
		? t(
				ERROR_KEYS[errorKey as ActionErrorKey] ??
					"finance_payroll.errors.unknown_intent",
			)
		: null
	return (
		<div className="p-6 space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{run.label}</h1>
				<Link to="/comptroller" className="text-sm underline">
					{t("comptroller_payroll.back")}
				</Link>
			</div>
			<Callout title={t("comptroller_payroll.callout_title")}>
				{t("comptroller_payroll.callout_body")}
			</Callout>
			{error && <p className="text-sm text-status-danger">{error}</p>}

			<Form method="post">
				<input type="hidden" name="intent" value="download_journal_pdf" />
				<Button type="submit" variant="secondary">
					{t("comptroller_payroll.download_pdf")}
				</Button>
			</Form>

			<div className="overflow-x-auto bg-card border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-muted-foreground text-left border-b">
							<th className="p-2">{t("comptroller_payroll.col.account")}</th>
							<th className="p-2">{t("comptroller_payroll.col.contractor")}</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.jobs")}
							</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.gross")}
							</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.net")}
							</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.retention")}
							</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.adj_net_running")}
							</th>
							<th className="p-2">{t("comptroller_payroll.col.status")}</th>
						</tr>
					</thead>
					<tbody>
						{accounts.map((a) => (
							<tr key={a.accountId} className="border-b last:border-0">
								<td className="p-2 font-mono">{a.code}</td>
								<td className="p-2 text-muted-foreground">{a.label}</td>
								<td className="p-2 text-right font-mono">{a.jobs}</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(a.gross)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(a.net)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(a.retention)}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(a.adjNetRunning)}
								</td>
								<td className="p-2">
									{a.paidAt ? (
										<span className="flex flex-wrap items-center gap-2">
											<span>
												{t("comptroller_payroll.paid_by", {
													date: new Date(a.paidAt).toLocaleDateString(),
													name: a.paidByName ?? "—",
												})}
											</span>
											{a.confirmedByFallback && (
												<Badge variant="warn">
													{t("comptroller_payroll.from_paper")}
												</Badge>
											)}
										</span>
									) : (
										<Form method="post" className="flex items-center gap-1">
											<input type="hidden" name="intent" value="pay_account" />
											<input
												type="hidden"
												name="accountId"
												value={a.accountId}
											/>
											<input
												type="date"
												name="paidDate"
												required
												max={today}
												className="border rounded px-2 py-1 text-xs"
											/>
											<Button type="submit" size="xs">
												{t("comptroller_payroll.paid_button")}
											</Button>
										</Form>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
