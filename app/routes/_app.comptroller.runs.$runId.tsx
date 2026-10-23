import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { db } from "~/lib/db.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { loadPayrollRequests } from "~/lib/payroll-request-view.server"
import {
	closePayrollRunAccount,
	parsePaidDate,
	puertoRicoToday,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.runs.$runId"

export const meta: Route.MetaFunction = () => [
	{ title: "Payroll request — JAF Ops" },
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
	// Carmen only ever sees a request Lissette has sent her.
	const [req] = await loadPayrollRequests(
		{ id: params.runId, sentAt: { not: null } },
		{ take: 1 },
	)
	if (!req) throw new Response("Not Found", { status: 404 })
	return { user, req, today: puertoRicoToday() }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string

	if (intent === "pay_account") {
		// The same wall as the loader: a draft is not Carmen's yet. Checked here
		// rather than left to the 409 below, which means "already paid" and is
		// shown as success.
		const sent = await db.payrollRun.count({
			where: { id: params.runId, sentAt: { not: null } },
		})
		if (sent === 0) throw new Response("Not Found", { status: 404 })
		const accountId = form.get("accountId")
		if (typeof accountId !== "string" || !accountId) {
			return { errorKey: "finance_payroll.errors.missing_fields" as const }
		}
		const parsed = parsePaidDate(form.get("paidDate") as string | null)
		if ("errorKey" in parsed) return { errorKey: parsed.errorKey }
		try {
			await closePayrollRunAccount({
				runId: params.runId,
				accountId,
				paidById: user.id,
				paidDate: parsed.date,
			})
		} catch (e) {
			// Already paid (double-click, stale tab): the brigade IS paid, so
			// show success. 403/404 and everything else still propagate.
			if (!(e instanceof Response && e.status === 409)) throw e
		}
		return { ok: true as const }
	}

	return { errorKey: "finance_payroll.errors.unknown_intent" as const }
}

export default function ComptrollerPayrollRun({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { req, today } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
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
				<h1 className="text-2xl font-bold">
					{t("comptroller_payroll.request_title", { label: req.label })}
				</h1>
				<Link to="/comptroller/lists" className="text-sm underline">
					{t("comptroller_payroll.back")}
				</Link>
			</div>
			<Callout title={t("comptroller_payroll.callout_title")}>
				{t("comptroller_payroll.callout_body")}
			</Callout>
			{error && <p className="text-sm text-status-danger">{error}</p>}

			<a
				href={`/finance/payroll/${req.id}/journal`}
				download
				className={buttonVariants({ variant: "secondary" })}
			>
				{t("comptroller_payroll.download_pdf")}
			</a>

			<div className="overflow-x-auto bg-card border rounded-lg">
				<table className="w-full text-sm">
					<thead>
						<tr className="text-xs text-muted-foreground text-left border-b">
							<th className="p-2">{t("comptroller_payroll.col.brigade")}</th>
							<th className="p-2">{t("comptroller_payroll.col.avisos")}</th>
							<th className="p-2 text-right">
								{t("comptroller_payroll.col.to_pay")}
							</th>
							<th className="p-2">{t("comptroller_payroll.col.status")}</th>
						</tr>
					</thead>
					<tbody>
						{req.lines.map((l) => (
							<tr key={l.accountId} className="border-b last:border-0">
								<td className="p-2">
									<span className="font-mono">{l.brigadeCode}</span>{" "}
									<span className="text-muted-foreground">
										{l.brigadeLabel}
									</span>
								</td>
								<td className="p-2 font-mono">
									{l.avisoNumbers.join(" · ") || "—"}
								</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(l.toPay)}
								</td>
								<td className="p-2">
									{l.paidAt ? (
										<Badge variant="ok">
											{t("comptroller_payroll.paid_by", {
												date: formatShortDate(l.paidAt),
												name: l.paidByName ?? "—",
											})}
										</Badge>
									) : (
										<Form method="post" className="flex items-center gap-2">
											<input type="hidden" name="intent" value="pay_account" />
											<input
												type="hidden"
												name="accountId"
												value={l.accountId}
											/>
											<label className="flex items-center gap-1 text-xs">
												<span className="text-muted-foreground">
													{t("comptroller_payroll.pay_date")}
												</span>
												<input
													type="date"
													name="paidDate"
													required
													defaultValue={today}
													max={today}
													className="border rounded px-2 py-1 text-xs"
												/>
											</label>
											<Button type="submit" size="xs" disabled={submitting}>
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
