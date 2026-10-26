import { useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, Link, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { FileViewerLink } from "~/components/file-viewer"
import { InstallerStepper } from "~/components/installer-stepper"
import { ReceiptBanner, receiptUrl } from "~/components/receipt-banner"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import {
	checkEwitBatch,
	EWIT_INVOICE_LIMIT,
	EwitError,
	markEwitBatchSent,
	receiveStatement,
} from "~/lib/ewit.server"
import { formatShortDate } from "~/lib/payroll-request-view"
import { parsePaidDate, puertoRicoToday } from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { uploadHref } from "~/lib/upload-href"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.batches.$id"

export const meta: Route.MetaFunction = () => [
	{ title: "PBCC batch — JAF Ops" },
]

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const batch = await db.ewitBatch.findUnique({
		where: { id: params.id },
		include: {
			invoices: {
				where: { voidedAt: null, heldAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				include: { _count: { select: { completions: true } } },
			},
		},
	})
	if (!batch) throw new Response("Not Found", { status: 404 })
	const check = batch.closedAt ? await checkEwitBatch(batch.id) : null
	const total = batch.invoices.reduce((s, i) => s + Number(i.total), 0)
	return {
		today: puertoRicoToday(),
		batch: {
			id: batch.id,
			number: batch.number,
			closed: Boolean(batch.closedAt),
			sentAt: batch.sentAt?.toISOString() ?? null,
			receivedAt: batch.receivedAt?.toISOString() ?? null,
			receivedAmount:
				batch.receivedAmount == null ? null : Number(batch.receivedAmount),
			statementHref: batch.statementPath
				? uploadHref(batch.statementPath)
				: null,
			total,
		},
		check,
		invoices: batch.invoices.map((i, n) => ({
			id: i.id,
			row: n + 1,
			number: i.number,
			date: i.invoiceDate.toISOString(),
			orders: i._count.completions + i.unmatchedOrderNos.length,
			total: Number(i.total),
			pdfHref: uploadHref(i.filePath),
			receivedAt: i.receivedAt?.toISOString() ?? null,
		})),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	const here = `/comptroller/installers/batches/${params.id}`
	try {
		if (intent === "mark_sent") {
			await markEwitBatchSent({ batchId: params.id, userId: user.id })
			const b = await db.ewitBatch.findUniqueOrThrow({
				where: { id: params.id },
			})
			return redirect(receiptUrl(here, "ewit_batch_sent", { a: b.number }))
		}
		if (intent === "receive_statement") {
			const parsed = parsePaidDate(String(form.get("receivedAt") ?? ""))
			if (!("date" in parsed))
				return data(
					{ errorKey: "installers.errors.invalid_date" as const },
					400,
				)
			const ids = form.getAll("invoiceId").map(String)
			const file = form.get("file")
			await receiveStatement({
				batchId: params.id,
				receivedAt: parsed.date,
				amount: Number(String(form.get("amount") ?? "").replace(/[$,\s]/g, "")),
				file: file instanceof File ? file : null,
				invoiceIds: ids,
				userId: user.id,
			})
			return redirect(receiptUrl(here, "statement_saved", { n: ids.length }))
		}
	} catch (e) {
		if (e instanceof EwitError) {
			const keys = {
				not_closed: "installers.errors.not_closed",
				not_sent: "installers.errors.not_sent",
				check_failed: "installers.errors.check_failed",
				bad_amount: "installers.errors.bad_amount",
				no_file: "installers.errors.no_file",
			} as const
			return data(
				{
					errorKey:
						keys[e.code as keyof typeof keys] ??
						("installers.errors.not_found" as const),
				},
				400,
			)
		}
		throw e
	}
	return data({ errorKey: "installers.errors.not_found" as const }, 400)
}

export default function InstallerBatch({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { batch, check, invoices, today } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	const waiting = invoices.filter((i) => !i.receivedAt)
	const [ticked, setTicked] = useState<string[]>(waiting.map((i) => i.id))
	const mmddyyyy = (iso: string) => {
		const [y, m, d] = iso.split("-")
		return `${m}/${d}/${y}`
	}
	const diff =
		batch.receivedAmount == null ? null : batch.total - batch.receivedAmount
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current={batch.sentAt ? "received" : "batch"} />
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-2xl font-bold">
					{batch.number
						? t("installers.batches.batch_n", { n: batch.number })
						: t("installers.batches.open_heading")}
				</h1>
				<Link
					to="/comptroller/installers/batches"
					className={buttonVariants({ variant: "ghost" })}
				>
					{t("installers.batches.back")}
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
					<table className="w-full text-sm">
						<thead className="border-b bg-muted text-left text-muted-foreground">
							<tr>
								<th className="p-2">{t("installers.batches.col_row")}</th>
								<th className="p-2">{t("installers.batches.col_number")}</th>
								<th className="p-2">{t("installers.batches.col_date")}</th>
								<th className="p-2 text-right">
									{t("installers.batches.col_orders")}
								</th>
								<th className="p-2 text-right">
									{t("installers.batches.col_total")}
								</th>
								<th className="p-2">{t("installers.batches.col_pdf")}</th>
								<th className="p-2" />
							</tr>
						</thead>
						<tbody>
							{invoices.map((i) => (
								<tr key={i.id} className="border-b last:border-0">
									<td className="p-2 font-mono">
										{String(i.row).padStart(2, "0")}
									</td>
									<td className="p-2 font-mono">{i.number}</td>
									<td className="p-2">{formatShortDate(i.date)}</td>
									<td className="p-2 text-right">{i.orders}</td>
									<td className="p-2 text-right font-mono">
										{formatMoney(i.total)}
									</td>
									<td className="p-2">
										<FileViewerLink
											href={i.pdfHref}
											label="✓"
											title={t("installers.ewit.viewer_title", {
												number: i.number,
											})}
										/>
									</td>
									<td className="p-2">
										{batch.sentAt ? (
											i.receivedAt ? (
												<Badge variant="ok">
													{t("installers.ewit.status_received", {
														date: formatShortDate(i.receivedAt),
													})}
												</Badge>
											) : (
												<Badge variant="warn">
													{t("installers.batches.status_waiting")}
												</Badge>
											)
										) : null}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</CardContent>
			</Card>
			{check ? (
				<Card>
					<CardContent className="space-y-1 p-4 text-sm">
						<h2 className="font-semibold">
							{t("installers.batches.check_heading")}
						</h2>
						<p className={check.passed ? undefined : "text-status-danger"}>
							{check.rows === check.pdfs && check.pdfs === check.excelLines
								? "✓"
								: "✗"}{" "}
							{t("installers.batches.check_rows", {
								rows: check.rows,
								pdfs: check.pdfs,
								lines: check.excelLines,
							})}
						</p>
						<p>
							{check.overLimit.length === 0 ? "✓" : "✗"}{" "}
							{t("installers.batches.check_limit", {
								limit: formatMoney(EWIT_INVOICE_LIMIT),
							})}
						</p>
						<p>
							{check.totalMatches ? "✓" : "✗"}{" "}
							{t("installers.batches.check_total")}
						</p>
						<div className="flex flex-wrap items-center gap-2 pt-2">
							{check.passed ? (
								<a
									href={`/comptroller/installers/batches/${batch.id}/package`}
									className={buttonVariants({ variant: "outline" })}
								>
									{t("installers.batches.package")}
								</a>
							) : (
								<span
									aria-disabled="true"
									className={`${buttonVariants({ variant: "outline" })} pointer-events-none opacity-50`}
								>
									{t("installers.batches.package")}
								</span>
							)}
							<a
								href={`/comptroller/installers/batches/${batch.id}/xlsx`}
								className={buttonVariants({ variant: "outline" })}
							>
								{t("installers.batches.excel")}
							</a>
							{batch.sentAt ? (
								<Badge variant="ok">
									{t("installers.batches.sent_on", {
										date: formatShortDate(batch.sentAt),
									})}
								</Badge>
							) : (
								<Form method="post">
									<input type="hidden" name="intent" value="mark_sent" />
									<Button type="submit" disabled={!check.passed || submitting}>
										{t("installers.batches.mark_sent")}
									</Button>
								</Form>
							)}
						</div>
					</CardContent>
				</Card>
			) : null}
			{batch.sentAt ? (
				<Card>
					<CardContent className="space-y-3 p-4">
						<h2 className="font-semibold">
							{t("installers.batches.statement_heading", { n: batch.number })}
						</h2>
						{diff != null ? (
							<p className="text-sm text-muted-foreground">
								{t("installers.batches.statement_diff", {
									total: formatMoney(batch.total),
									paid: formatMoney(batch.receivedAmount ?? 0),
									diff: formatMoney(diff),
								})}{" "}
								{batch.statementHref ? (
									<FileViewerLink
										href={batch.statementHref}
										label={t("installers.batches.statement_open")}
										title={t("installers.batches.statement_heading", {
											n: batch.number,
										})}
									/>
								) : null}
							</p>
						) : null}
						{waiting.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t("installers.batches.statement_none")}
							</p>
						) : (
							<Form
								method="post"
								encType="multipart/form-data"
								className="space-y-3"
							>
								<input type="hidden" name="intent" value="receive_statement" />
								<div className="grid gap-3 sm:grid-cols-3">
									<div>
										<Label htmlFor="receivedAt">
											{t("installers.batches.statement_date")}
										</Label>
										<Input
											id="receivedAt"
											name="receivedAt"
											defaultValue={mmddyyyy(today)}
											placeholder="MM/DD/YYYY"
											required
										/>
									</div>
									<div>
										<Label htmlFor="amount">
											{t("installers.batches.statement_amount")}
										</Label>
										<Input
											id="amount"
											name="amount"
											inputMode="decimal"
											required
										/>
									</div>
									<div>
										<Label htmlFor="file">
											{t("installers.batches.statement_pdf")}
										</Label>
										<Input
											id="file"
											name="file"
											type="file"
											accept="application/pdf"
											required
										/>
									</div>
								</div>
								<fieldset className="space-y-1 text-sm">
									<legend className="font-medium">
										{t("installers.batches.statement_tick")}
									</legend>
									{waiting.map((i) => (
										<label key={i.id} className="flex items-center gap-2">
											<input
												type="checkbox"
												name="invoiceId"
												value={i.id}
												checked={ticked.includes(i.id)}
												onChange={(e) =>
													setTicked((p) =>
														e.target.checked
															? [...p, i.id]
															: p.filter((x) => x !== i.id),
													)
												}
											/>
											{String(i.row).padStart(2, "0")} · {i.number} ·{" "}
											{formatMoney(i.total)}
										</label>
									))}
								</fieldset>
								<Button type="submit" disabled={submitting}>
									{t("installers.batches.statement_save")}
								</Button>
							</Form>
						)}
					</CardContent>
				</Card>
			) : null}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
