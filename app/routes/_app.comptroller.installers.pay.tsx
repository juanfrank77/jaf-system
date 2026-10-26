import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerStepper } from "~/components/installer-stepper"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import {
	EwitError,
	loadInstallerPayList,
	payInstallers,
	undoInstallerPayment,
} from "~/lib/ewit.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import {
	parsePaidDate,
	puertoRicoDay,
	puertoRicoToday,
} from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.pay"

export const meta: Route.MetaFunction = () => [
	{ title: "Installer pay — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const [list, payments] = await Promise.all([
		loadInstallerPayList(),
		db.installerPayment.findMany({
			where: { undoneAt: null },
			orderBy: { createdAt: "desc" },
			take: 30,
			include: {
				installer: { select: { name: true, installerProfile: true } },
				_count: { select: { completions: true } },
			},
		}),
	])
	const today = puertoRicoToday()
	return {
		today,
		list,
		payments: payments.map((p) => ({
			id: p.id,
			installerName: p.installer.name,
			empNo: p.installer.installerProfile?.jafNumber ?? null,
			paidAt: p.paidAt.toISOString(),
			amount: Number(p.amount),
			jobs: p._count.completions,
			undoable: puertoRicoDay(p.createdAt) === today,
		})),
	}
}

const ERRORS = {
	nothing_to_pay: "installers.errors.nothing_to_pay",
	bad_amount: "installers.errors.bad_amount",
	no_reason: "installers.errors.no_reason",
	undo_expired: "installers.errors.undo_expired",
	not_found: "installers.errors.not_found",
} as const

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const here = "/comptroller/installers/pay"
	try {
		if (form.get("intent") === "pay_installers") {
			const parsed = parsePaidDate(String(form.get("paidDate") ?? ""))
			if (!("date" in parsed))
				return data(
					{ errorKey: "installers.errors.invalid_date" as const },
					400,
				)
			const ids = form.getAll("installerId").map(String)
			if (ids.length === 0)
				return data(
					{ errorKey: "installers.errors.pick_installer" as const },
					400,
				)
			const items = ids.map((installerId) => ({
				installerId,
				amount: Number(
					String(form.get(`amount_${installerId}`) ?? "").replace(
						/[$,\s]/g,
						"",
					),
				),
			}))
			const { paid } = await payInstallers({
				items,
				paidAt: parsed.date,
				userId: user.id,
			})
			return redirect(receiptUrl(here, "installers_paid", { n: paid }))
		}
		if (form.get("intent") === "undo_payment") {
			await undoInstallerPayment({
				paymentId: String(form.get("paymentId") ?? ""),
				reason: String(form.get("reason") ?? ""),
			})
			return redirect(receiptUrl(here, "payment_undone"))
		}
	} catch (e) {
		if (e instanceof EwitError)
			return data(
				{
					errorKey: ERRORS[e.code as keyof typeof ERRORS] ?? ERRORS.not_found,
				},
				400,
			)
		throw e
	}
	return data({ errorKey: ERRORS.not_found }, 400)
}

export default function InstallerPay({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { list, payments, today } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	const [picked, setPicked] = useState<string[]>([])
	const mmddyyyy = (iso: string) => {
		const [y, m, d] = iso.split("-")
		return `${m}/${d}/${y}`
	}
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current="pay" />
			<h1 className="text-2xl font-bold">{t("installers.pay.title")}</h1>
			<p className="text-sm text-muted-foreground">
				{t("installers.pay.hint")}
			</p>
			<ReceiptBanner />
			{actionData && "errorKey" in actionData && (
				<p className="text-sm text-status-danger">
					{t(actionData.errorKey as never)}
				</p>
			)}
			<Card>
				<CardContent className="p-0">
					{list.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("installers.pay.empty")}
						</p>
					) : (
						<Form method="post">
							<input type="hidden" name="intent" value="pay_installers" />
							<table className="w-full text-sm">
								<thead className="border-b bg-muted text-left text-muted-foreground">
									<tr>
										<th className="p-2" />
										<th className="p-2">{t("installers.pay.col_installer")}</th>
										<th className="p-2">{t("installers.pay.col_emp")}</th>
										<th className="p-2 text-right">
											{t("installers.pay.col_jobs")}
										</th>
										<th className="p-2">{t("installers.pay.col_orders")}</th>
										<th className="p-2">{t("installers.pay.col_amount")}</th>
									</tr>
								</thead>
								<tbody>
									{list.map((r) => (
										<tr key={r.installerId} className="border-b last:border-0">
											<td className="p-2">
												<input
													type="checkbox"
													name="installerId"
													value={r.installerId}
													aria-label={r.installerName}
													checked={picked.includes(r.installerId)}
													onChange={(e) =>
														setPicked((p) =>
															e.target.checked
																? [...p, r.installerId]
																: p.filter((x) => x !== r.installerId),
														)
													}
												/>
											</td>
											<td className="p-2">{r.installerName}</td>
											<td className="p-2 font-mono">{r.empNo ?? "—"}</td>
											<td className="p-2 text-right">{r.jobs}</td>
											<td className="p-2 font-mono text-xs">
												{r.orders.join(" · ")}
											</td>
											<td className="p-2">
												<Input
													name={`amount_${r.installerId}`}
													inputMode="decimal"
													placeholder={t("installers.pay.amount")}
													aria-label={`${t("installers.pay.amount")} ${r.installerName}`}
													className="w-32"
												/>
											</td>
										</tr>
									))}
								</tbody>
							</table>
							<div className="flex flex-wrap items-center gap-3 border-t p-3 text-sm">
								<label htmlFor="paidDate">{t("installers.pay.paid_on")}</label>
								<Input
									id="paidDate"
									name="paidDate"
									defaultValue={mmddyyyy(today)}
									placeholder="MM/DD/YYYY"
									className="w-36"
									required
								/>
								<Button
									type="submit"
									disabled={submitting || picked.length === 0}
								>
									{t("installers.pay.mark_paid")}
								</Button>
							</div>
						</Form>
					)}
				</CardContent>
			</Card>
			{payments.length > 0 ? (
				<Card>
					<CardContent className="p-0">
						<h2 className="border-b p-3 text-sm font-semibold">
							{t("installers.pay.history")}
						</h2>
						<ul className="divide-y text-sm">
							{payments.map((p) => (
								<li
									key={p.id}
									className="flex flex-wrap items-center gap-3 p-3"
								>
									<span className="font-medium">{p.installerName}</span>
									<span className="font-mono text-muted-foreground">
										{p.empNo ?? "—"}
									</span>
									<Badge variant="ok">
										{t("installers.pay.paid_status", {
											date: formatShortDate(p.paidAt),
											amount: formatMoney(p.amount),
										})}
									</Badge>
									<span className="text-muted-foreground">
										{t("installers.pay.jobs_closed", { count: p.jobs })}
									</span>
									<div className="flex-1" />
									{p.undoable ? (
										<Form method="post" className="flex items-center gap-1">
											<input type="hidden" name="intent" value="undo_payment" />
											<input type="hidden" name="paymentId" value={p.id} />
											<Input
												name="reason"
												required
												placeholder={t("installers.pay.undo_reason")}
												aria-label={t("installers.pay.undo_reason")}
												className="w-40"
											/>
											<Button
												type="submit"
												size="xs"
												variant="outline"
												disabled={submitting}
											>
												{t("installers.pay.undo")}
											</Button>
										</Form>
									) : null}
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
