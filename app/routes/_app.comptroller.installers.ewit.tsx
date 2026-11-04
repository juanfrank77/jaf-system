import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FileViewerLink } from "~/components/file-viewer"
import { InstallerStepper } from "~/components/installer-stepper"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { EwitError, removeEwitInvoice } from "~/lib/ewit.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import { uploadHref } from "~/lib/upload-href"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.ewit"

export const meta: Route.MetaFunction = () => [
	{ title: "EWIT invoices — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const invoices = await db.ewitInvoice.findMany({
		where: { voidedAt: null },
		orderBy: [{ createdAt: "desc" }],
		include: {
			batch: { select: { number: true, closedAt: true, sentAt: true } },
			_count: { select: { completions: true } },
		},
		take: 200,
	})
	return {
		invoices: invoices.map((i) => ({
			id: i.id,
			number: i.number,
			date: i.invoiceDate.toISOString(),
			total: Number(i.total),
			orders: i._count.completions + i.unmatchedOrderNos.length,
			unmatched: i.unmatchedOrderNos.length,
			pdfHref: uploadHref(i.filePath),
			state: i.heldAt
				? ("held" as const)
				: i.receivedAt
					? ("received" as const)
					: i.batch?.sentAt
						? ("sent" as const)
						: i.batch?.closedAt
							? ("closed" as const)
							: ("open" as const),
			batchNumber: i.batch?.number ?? null,
			receivedAt: i.receivedAt?.toISOString() ?? null,
			holdReason: i.holdReason,
			// Taking back is only offered while the batch is still open, or once sent (as a hold).
			canTakeBack:
				!i.heldAt && !i.receivedAt && (!i.batch?.closedAt || !!i.batch?.sentAt),
			needsReason: !!i.batch?.sentAt,
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "take_back")
		return data({ errorKey: "installers.errors.not_found" as const }, 400)
	const id = String(form.get("invoiceId") ?? "")
	const inv = await db.ewitInvoice.findUnique({
		where: { id },
		select: { number: true },
	})
	try {
		await removeEwitInvoice({
			invoiceId: id,
			userId: user.id,
			reason: String(form.get("reason") ?? ""),
		})
	} catch (e) {
		if (e instanceof EwitError) {
			const key = {
				no_reason: "installers.errors.no_reason",
				batch_closed: "installers.errors.batch_closed",
				claro_started: "installers.errors.claro_started",
			}[e.code as "no_reason" | "batch_closed" | "claro_started"]
			return data({ errorKey: key ?? "installers.errors.not_found" }, 400)
		}
		throw e
	}
	return redirect(
		receiptUrl("/comptroller/installers/ewit", "ewit_removed", {
			a: inv?.number,
		}),
	)
}

export default function EwitInvoices({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { invoices } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current="ewit" />
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{t("installers.ewit.title")}</h1>
				<Link
					to="/comptroller/installers/ewit/new"
					className={buttonVariants({ variant: "default" })}
				>
					{t("installers.ewit.add")}
				</Link>
			</div>
			<ReceiptBanner />
			{actionData && "errorKey" in actionData && (
				<p className="text-sm text-status-danger">
					{t(actionData.errorKey as never)}
				</p>
			)}
			<Card>
				<CardContent className="p-0">
					{invoices.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("installers.ewit.empty")}
						</p>
					) : (
						<table className="w-full text-sm">
							<thead className="border-b bg-muted text-left text-muted-foreground">
								<tr>
									<th className="p-2">{t("installers.ewit.col_number")}</th>
									<th className="p-2">{t("installers.ewit.col_date")}</th>
									<th className="p-2 text-right">
										{t("installers.ewit.col_orders")}
									</th>
									<th className="p-2 text-right">
										{t("installers.ewit.col_total")}
									</th>
									<th className="p-2">{t("installers.ewit.col_status")}</th>
									<th className="p-2">{t("installers.ewit.col_pdf")}</th>
									<th className="p-2" />
								</tr>
							</thead>
							<tbody>
								{invoices.map((i) => (
									<tr key={i.id} className="border-b last:border-0">
										<td className="p-2 font-mono">{i.number}</td>
										<td className="p-2">{formatShortDate(i.date)}</td>
										<td className="p-2 text-right">{i.orders}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(i.total)}
										</td>
										<td className="p-2">
											<div className="flex flex-wrap items-center gap-1">
												{i.state === "held" ? (
													<Badge variant="danger">
														{t("installers.ewit.status_held", {
															reason: i.holdReason ?? "",
														})}
													</Badge>
												) : i.state === "received" ? (
													<Badge variant="ok">
														{t("installers.ewit.status_received", {
															date: formatShortDate(i.receivedAt ?? i.date),
														})}
													</Badge>
												) : i.state === "sent" ? (
													<Badge variant="warn">
														{t("installers.ewit.status_sent", {
															n: i.batchNumber ?? "",
														})}
													</Badge>
												) : i.state === "closed" ? (
													<Badge variant="info">
														{t("installers.ewit.status_closed", {
															n: i.batchNumber ?? "",
														})}
													</Badge>
												) : (
													<Badge variant="info">
														{t("installers.ewit.status_open")}
													</Badge>
												)}
												{i.unmatched > 0 ? (
													<Badge variant="warn">
														{t("installers.ewit.status_unmatched", {
															count: i.unmatched,
														})}
													</Badge>
												) : null}
											</div>
										</td>
										<td className="p-2">
											<FileViewerLink
												href={i.pdfHref}
												label={t("installers.ewit.open_pdf")}
												title={t("installers.ewit.viewer_title", {
													number: i.number,
												})}
											/>
										</td>
										<td className="p-2">
											{i.canTakeBack ? (
												<Form method="post" className="flex items-center gap-1">
													<input
														type="hidden"
														name="intent"
														value="take_back"
													/>
													<input type="hidden" name="invoiceId" value={i.id} />
													<input
														name="reason"
														required={i.needsReason}
														placeholder={t("installers.ewit.take_back_reason")}
														aria-label={t("installers.ewit.take_back_reason")}
														className="w-28 rounded border bg-background px-2 py-1 text-xs"
													/>
													<Button
														type="submit"
														size="xs"
														variant="outline"
														disabled={submitting}
													>
														{t("installers.ewit.take_back_confirm")}
													</Button>
												</Form>
											) : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
