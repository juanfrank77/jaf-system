import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
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
	undoPayrollRunAccount,
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
	"finance_payroll.errors.undo_reason": "finance_payroll.errors.undo_reason",
	"finance_payroll.errors.undo_expired": "finance_payroll.errors.undo_expired",
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
		const acc = await db.contractorAccount.findUnique({
			where: { id: accountId },
			select: { code: true },
		})
		return redirect(
			receiptUrl(`/comptroller/runs/${params.runId}`, "paid", {
				a: acc?.code,
				b: formatShortDate(parsed.date),
			}),
		)
	}

	if (intent === "pay_accounts") {
		const sent = await db.payrollRun.count({
			where: { id: params.runId, sentAt: { not: null } },
		})
		if (sent === 0) throw new Response("Not Found", { status: 404 })
		const ids = form
			.getAll("accountId")
			.filter((v): v is string => typeof v === "string" && v !== "")
		if (ids.length === 0) {
			return { errorKey: "finance_payroll.errors.missing_fields" as const }
		}
		const parsed = parsePaidDate(form.get("paidDate") as string | null)
		if ("errorKey" in parsed) return { errorKey: parsed.errorKey }
		for (const accountId of ids) {
			try {
				await closePayrollRunAccount({
					runId: params.runId,
					accountId,
					paidById: user.id,
					paidDate: parsed.date,
				})
			} catch (e) {
				// Already paid (stale tab): that brigade is done, carry on.
				if (!(e instanceof Response && e.status === 409)) throw e
			}
		}
		return redirect(
			receiptUrl(`/comptroller/runs/${params.runId}`, "paid", {
				a: `${ids.length} brigades`,
				b: formatShortDate(parsed.date),
			}),
		)
	}

	if (intent === "undo_paid") {
		const accountId = form.get("accountId")
		const reason = String(form.get("reason") ?? "").trim()
		if (typeof accountId !== "string" || !accountId) {
			return { errorKey: "finance_payroll.errors.missing_fields" as const }
		}
		if (!reason) {
			return { errorKey: "finance_payroll.errors.undo_reason" as const }
		}
		try {
			await undoPayrollRunAccount({
				runId: params.runId,
				accountId,
				userId: user.id,
				reason,
			})
		} catch (e) {
			if (e instanceof Response && e.status === 409)
				return { errorKey: "finance_payroll.errors.undo_expired" as const }
			throw e
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
	const [y, m, d] = today.split("-")
	const todayUs = `${m}/${d}/${y}`
	const [picked, setPicked] = useState<string[]>([])
	const unpaid = req.lines.filter((l) => !l.paidAt)
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
			<ReceiptBanner />
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

			{unpaid.length > 1 && (
				<Form
					id="bulk-pay"
					method="post"
					className="flex flex-wrap items-center gap-3 text-sm"
				>
					<input type="hidden" name="intent" value="pay_accounts" />
					<label className="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={picked.length === unpaid.length}
							onChange={(e) =>
								setPicked(
									e.target.checked ? unpaid.map((l) => l.accountId) : [],
								)
							}
						/>
						{t("comptroller_payroll.select_all")}
					</label>
					<label className="flex items-center gap-1 text-xs">
						<span className="text-muted-foreground">
							{t("comptroller_payroll.pay_date")}
						</span>
						<input
							type="text"
							inputMode="numeric"
							name="paidDate"
							required
							pattern="\d{2}/\d{2}/\d{4}"
							placeholder="MM/DD/YYYY"
							defaultValue={todayUs}
							className="border rounded px-2 py-1 text-xs w-28"
						/>
					</label>
					<Button
						type="submit"
						size="sm"
						disabled={submitting || picked.length === 0}
					>
						{t("comptroller_payroll.mark_selected", { count: picked.length })}
					</Button>
				</Form>
			)}
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
									{unpaid.length > 1 && !l.paidAt ? (
										<input
											type="checkbox"
											form="bulk-pay"
											name="accountId"
											value={l.accountId}
											checked={picked.includes(l.accountId)}
											onChange={(e) =>
												setPicked((prev) =>
													e.target.checked
														? [...prev, l.accountId]
														: prev.filter((id) => id !== l.accountId),
												)
											}
											aria-label={l.brigadeCode}
											className="mr-2"
										/>
									) : null}
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
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant="ok">
												{t("comptroller_payroll.paid_by", {
													date: formatShortDate(l.paidAt),
													name: l.paidByName ?? "—",
												})}
											</Badge>
											{l.undoable ? (
												<Form method="post" className="flex items-center gap-1">
													<input
														type="hidden"
														name="intent"
														value="undo_paid"
													/>
													<input
														type="hidden"
														name="accountId"
														value={l.accountId}
													/>
													<input
														name="reason"
														required
														placeholder={t("comptroller_payroll.undo_reason")}
														aria-label={t("comptroller_payroll.undo_reason")}
														className="border rounded px-2 py-1 text-xs"
													/>
													<Button
														type="submit"
														size="xs"
														variant="outline"
														disabled={submitting}
													>
														{t("comptroller_payroll.undo")}
													</Button>
												</Form>
											) : null}
										</div>
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
													type="text"
													inputMode="numeric"
													name="paidDate"
													required
													pattern="\d{2}/\d{2}/\d{4}"
													placeholder="MM/DD/YYYY"
													defaultValue={todayUs}
													className="border rounded px-2 py-1 text-xs w-28"
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
