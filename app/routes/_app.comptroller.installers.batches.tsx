import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerStepper } from "~/components/installer-stepper"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { closeEwitBatch, EwitError } from "~/lib/ewit.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.batches"

export const meta: Route.MetaFunction = () => [
	{ title: "PBCC batches — JAF Ops" },
]

const live = { voidedAt: null, heldAt: null }

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const batches = await db.ewitBatch.findMany({
		orderBy: [{ createdAt: "desc" }],
		take: 60,
		include: {
			invoices: {
				where: live,
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				include: { _count: { select: { completions: true } } },
			},
		},
	})
	const view = (b: (typeof batches)[number]) => ({
		id: b.id,
		number: b.number,
		sentAt: b.sentAt?.toISOString() ?? null,
		receivedAt: b.receivedAt?.toISOString() ?? null,
		receivedAmount: b.receivedAmount == null ? null : Number(b.receivedAmount),
		waiting: b.invoices.filter((i) => !i.receivedAt).length,
		total: b.invoices.reduce((s, i) => s + Number(i.total), 0),
		orders: b.invoices.reduce(
			(s, i) => s + i._count.completions + i.unmatchedOrderNos.length,
			0,
		),
		rows: b.invoices.map((i, n) => ({
			id: i.id,
			row: n + 1,
			number: i.number,
			date: i.invoiceDate.toISOString(),
			orders: i._count.completions + i.unmatchedOrderNos.length,
			total: Number(i.total),
		})),
	})
	const open = batches.find((b) => !b.closedAt)
	return {
		open: open ? view(open) : null,
		ready: batches.filter((b) => b.closedAt && !b.sentAt).map(view),
		sent: batches.filter((b) => b.sentAt).map(view),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "close_batch")
		return data({ errorKey: "installers.errors.not_found" as const }, 400)
	const batchId = String(form.get("batchId") ?? "")
	try {
		await closeEwitBatch({ batchId, userId: user.id })
	} catch (e) {
		if (e instanceof EwitError)
			return data(
				{
					errorKey:
						e.code === "empty"
							? ("installers.errors.empty" as const)
							: ("installers.errors.not_open" as const),
				},
				400,
			)
		throw e
	}
	const closed = await db.ewitBatch.findUniqueOrThrow({
		where: { id: batchId },
		include: { _count: { select: { invoices: true } } },
	})
	return redirect(
		receiptUrl(
			`/comptroller/installers/batches/${batchId}`,
			"ewit_batch_closed",
			{ a: closed.number, n: closed._count.invoices },
		),
	)
}

type BatchView = Route.ComponentProps["loaderData"]["ready"][number]

function BatchList({
	title,
	batches,
}: {
	title: string
	batches: BatchView[]
}) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardContent className="p-0">
				<h2 className="border-b p-3 text-sm font-semibold">{title}</h2>
				{batches.length === 0 ? (
					<p className="p-3 text-sm text-muted-foreground">
						{t("installers.batches.none")}
					</p>
				) : (
					<ul className="divide-y text-sm">
						{batches.map((b) => (
							<li key={b.id} className="flex flex-wrap items-center gap-3 p-3">
								<span className="font-medium">
									{t("installers.batches.batch_n", { n: b.number })}
								</span>
								<span className="text-muted-foreground">
									{t("installers.batches.summary", {
										count: b.rows.length,
										orders: b.orders,
										total: formatMoney(b.total),
									})}
								</span>
								{b.sentAt ? (
									b.waiting === 0 ? (
										<Badge variant="ok">
											{t("installers.batches.status_received", {
												date: formatShortDate(b.receivedAt ?? b.sentAt),
												amount: formatMoney(b.receivedAmount ?? 0),
											})}
										</Badge>
									) : b.receivedAt ? (
										<Badge variant="warn">
											{t("installers.batches.status_partial", {
												waiting: b.waiting,
											})}
										</Badge>
									) : (
										<Badge variant="warn">
											{t("installers.batches.status_waiting")}
										</Badge>
									)
								) : null}
								<div className="flex-1" />
								<Link
									to={`/comptroller/installers/batches/${b.id}`}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									{t("installers.batches.view")}
								</Link>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}

export default function InstallerBatches({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { open, ready, sent } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current="batch" />
			<h1 className="text-2xl font-bold">{t("installers.batches.title")}</h1>
			<ReceiptBanner />
			{actionData && "errorKey" in actionData && (
				<p className="text-sm text-status-danger">
					{t(actionData.errorKey as never)}
				</p>
			)}
			<Card>
				<CardContent className="space-y-3 p-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<h2 className="font-semibold">
							{t("installers.batches.open_heading")}
						</h2>
						{open && open.rows.length > 0 ? (
							<Form method="post">
								<input type="hidden" name="intent" value="close_batch" />
								<input type="hidden" name="batchId" value={open.id} />
								<Button type="submit" disabled={submitting}>
									{t("installers.batches.close")}
								</Button>
							</Form>
						) : null}
					</div>
					{!open || open.rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("installers.batches.empty_open")}
						</p>
					) : (
						<>
							<table className="w-full text-sm">
								<thead className="border-b text-left text-muted-foreground">
									<tr>
										<th className="p-2">{t("installers.batches.col_row")}</th>
										<th className="p-2">
											{t("installers.batches.col_number")}
										</th>
										<th className="p-2">{t("installers.batches.col_date")}</th>
										<th className="p-2 text-right">
											{t("installers.batches.col_orders")}
										</th>
										<th className="p-2 text-right">
											{t("installers.batches.col_total")}
										</th>
									</tr>
								</thead>
								<tbody>
									{open.rows.map((r) => (
										<tr key={r.id} className="border-b last:border-0">
											<td className="p-2 font-mono">
												{String(r.row).padStart(2, "0")}
											</td>
											<td className="p-2 font-mono">{r.number}</td>
											<td className="p-2">{formatShortDate(r.date)}</td>
											<td className="p-2 text-right">{r.orders}</td>
											<td className="p-2 text-right font-mono">
												{formatMoney(r.total)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
							<p className="text-sm text-muted-foreground">
								{t("installers.batches.summary", {
									count: open.rows.length,
									orders: open.orders,
									total: formatMoney(open.total),
								})}
							</p>
						</>
					)}
				</CardContent>
			</Card>
			<BatchList
				title={t("installers.batches.ready_heading")}
				batches={ready}
			/>
			<BatchList title={t("installers.batches.sent_heading")} batches={sent} />
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
