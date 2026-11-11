import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { formatPackageSize, formatShortDate } from "~/lib/payroll-request-view"
import type { BatchView } from "~/lib/pbcc-batch-view"
import { formatMoney } from "~/lib/utils"

/** The parts of BatchCheck the screen draws (see checkBatch). */
export type BatchCheckView = {
	rows: number
	avisoPdfs: number
	invoicePdfs: number
	avisoMismatches: string[]
	totalMatches: boolean
	duplicates: string[]
	noArea: string[]
	excel: boolean
	passed: boolean
}

type PackagePartView = {
	part: number
	of: number
	rowFrom: number
	rowTo: number
	megabytes: number
	hasExcel: boolean
	subject: string
}

type ActionResult = { errorKey?: string; list?: string } | undefined

function CheckLine({
	ok,
	label,
	detail,
}: {
	ok: boolean
	label: string
	detail?: string
}) {
	return (
		<li className="flex items-center justify-between gap-3 py-1.5 text-sm">
			<span>{label}</span>
			<span className="flex items-center gap-2">
				{detail && (
					<span className="font-mono text-xs text-muted-foreground">
						{detail}
					</span>
				)}
				<Badge variant={ok ? "ok" : "warn"}>{ok ? "✓" : "✗"}</Badge>
			</span>
		</li>
	)
}

/** W3: a closed batch — check it, take the package, mark it sent. */
export function PbccBatchDetailView({
	batch,
	check,
	parts,
	pbccEmail = null,
	emailLog = [],
	action,
	submitting = false,
}: {
	batch: BatchView
	check: BatchCheckView | null
	parts: PackagePartView[]
	/** Where Send to PBCC goes; null until it is set in Admin. */
	pbccEmail?: string | null
	emailLog?: {
		part: number
		of: number
		to: string
		outcome: string
		at: string
	}[]
	action?: ActionResult
	submitting?: boolean
}) {
	const { t } = useTranslation()
	const sent = batch.status === "sent"
	const green = sent || check?.passed === true
	const date = (iso: string) => formatShortDate(iso)
	return (
		<div className="space-y-4">
			<h2 className="text-sm font-semibold">
				{sent && batch.sentAt
					? t("pbcc_batch.detail.heading_sent", {
							number: batch.number ?? "",
							date: date(batch.sentAt),
						})
					: t("pbcc_batch.detail.heading_closed", {
							number: batch.number ?? "",
						})}
			</h2>
			<p className="text-sm">
				{t("pbcc_batch.summary", {
					count: batch.count,
					max: batch.capacity,
					subtotal: formatMoney(batch.subtotal),
					percent: +(batch.advanceRate * 100).toFixed(2),
					advance: formatMoney(batch.advance),
				})}
			</p>

			{check && !sent && (
				<section className="space-y-1 rounded-lg border bg-card p-4">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium">
							{t("pbcc_batch.detail.check")}
						</h3>
						<Badge variant={check.passed ? "ok" : "warn"}>
							{check.passed
								? t("pbcc_batch.detail.check_passed")
								: t("pbcc_batch.detail.check_failed")}
						</Badge>
					</div>
					<ul className="divide-y">
						<CheckLine
							ok={
								check.rows > 0 &&
								check.avisoPdfs === check.rows &&
								check.invoicePdfs === check.rows
							}
							label={t("pbcc_batch.detail.check_rows")}
							detail={`${check.rows} · ${check.avisoPdfs} · ${check.invoicePdfs}`}
						/>
						<CheckLine
							ok={check.avisoMismatches.length === 0}
							label={t("pbcc_batch.detail.check_aviso")}
							detail={t("pbcc_batch.detail.of_rows", {
								ok: check.rows - check.avisoMismatches.length,
								total: check.rows,
							})}
						/>
						<CheckLine
							ok={check.totalMatches}
							label={t("pbcc_batch.detail.check_total")}
							detail={formatMoney(batch.subtotal)}
						/>
						<CheckLine
							ok={check.duplicates.length === 0}
							label={t("pbcc_batch.detail.check_duplicates")}
							detail={t("pbcc_batch.detail.found", {
								count: check.duplicates.length,
							})}
						/>
						<CheckLine
							ok={check.noArea.length === 0}
							label={t("pbcc_batch.detail.check_area")}
							detail={
								check.noArea.length > 0 ? check.noArea.join(", ") : undefined
							}
						/>
						<CheckLine
							ok={check.excel}
							label={t("pbcc_batch.detail.check_excel")}
						/>
					</ul>
				</section>
			)}

			<section className="space-y-2 rounded-lg border bg-card p-4">
				<h3 className="text-sm font-medium">
					{t("pbcc_batch.detail.package")}
				</h3>
				<p className="text-xs text-muted-foreground">
					{t("pbcc_batch.detail.package_note")}
				</p>
				{!green && (
					<p className="text-xs text-status-warn">
						{t("pbcc_batch.detail.download_blocked")}
					</p>
				)}
				<ul className="divide-y text-sm">
					{parts.map((p) => (
						<li key={p.part} className="space-y-2 py-3">
							<div>
								<p className="font-medium">
									{t("pbcc_batch.detail.part", { part: p.part, of: p.of })}
								</p>
								<p className="text-xs text-muted-foreground">
									{p.hasExcel && `${t("pbcc_batch.detail.part_excel")} `}
									{t("pbcc_batch.detail.part_rows", {
										from: String(p.rowFrom).padStart(3, "0"),
										to: String(p.rowTo).padStart(3, "0"),
									})}{" "}
									· {formatPackageSize(p.megabytes)}
								</p>
								<label
									htmlFor={`subject-${p.part}`}
									className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"
								>
									{t("pbcc_batch.detail.subject")}
									<Input
										id={`subject-${p.part}`}
										readOnly
										value={p.subject}
										onFocus={(e) => e.currentTarget.select()}
										className="h-7 w-72 text-xs"
									/>
								</label>
							</div>
							{green ? (
								<a
									href={`/finance/schedules/${batch.id}/package/${p.part}`}
									download
									className={buttonVariants({ size: "sm" })}
								>
									{t("pbcc_batch.detail.download")}
								</a>
							) : (
								<Button variant="outline" size="sm" disabled>
									{t("pbcc_batch.detail.download")}
								</Button>
							)}
						</li>
					))}
				</ul>
				{batch.hasExcel && (
					<a
						href={`/finance/schedules/${batch.id}/xlsx`}
						download
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("pbcc_batch.detail.download_excel")}
					</a>
				)}
			</section>

			{action?.errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(action.errorKey as never, { list: action.list })}
				</p>
			)}
			{sent ? (
				<p className="text-sm text-muted-foreground">
					{t("pbcc_batch.detail.locked")}
				</p>
			) : (
				<Form method="post" className="space-y-1">
					<input type="hidden" name="intent" value="send_pbcc" />
					<Button type="submit" disabled={!green || submitting || !pbccEmail}>
						{t("pbcc_batch.detail.send_pbcc")}
					</Button>
					<p className="text-xs text-muted-foreground">
						{pbccEmail
							? t("pbcc_batch.detail.send_pbcc_note", { email: pbccEmail })
							: t("pbcc_batch.detail.send_pbcc_no_email")}
					</p>
				</Form>
			)}
			{batch.status === "closed" && (
				<Form method="post" className="space-y-1">
					<input type="hidden" name="intent" value="mark_sent" />
					<Button
						type="submit"
						variant="success"
						disabled={!green || submitting}
					>
						{t("pbcc_batch.detail.mark_sent")}
					</Button>
					<p className="text-xs text-muted-foreground">
						{t("pbcc_batch.detail.mark_sent_note")}
					</p>
				</Form>
			)}

			{emailLog.length > 0 && (
				<ul className="space-y-0.5 text-xs text-muted-foreground">
					{emailLog.map((e) => (
						<li key={`${e.at}-${e.part}`} suppressHydrationWarning>
							{new Date(e.at).toLocaleString()} ·{" "}
							{t("pbcc_batch.detail.part", { part: e.part, of: e.of })} · {e.to}{" "}
							· {e.outcome}
						</li>
					))}
				</ul>
			)}

			<div className="overflow-x-auto rounded-lg border bg-card">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b text-left text-xs text-muted-foreground">
							<th className="p-2">{t("pbcc_batch.col.row")}</th>
							<th className="p-2">{t("pbcc_batch.col.work_order")}</th>
							<th className="p-2">{t("pbcc_batch.col.aviso")}</th>
							<th className="p-2">{t("pbcc_batch.col.brigade")}</th>
							<th className="p-2">{t("pbcc_batch.col.invoice")}</th>
							<th className="p-2 text-right">{t("pbcc_batch.col.subtotal")}</th>
						</tr>
					</thead>
					<tbody>
						{batch.rows.map((r) => (
							<tr key={r.id} className="border-b last:border-0">
								<td className="p-2 font-mono">
									{String(r.row).padStart(3, "0")}
								</td>
								<td className="p-2 font-mono">{r.controlNumber}</td>
								<td className="p-2">{r.avisoNumber ?? "—"}</td>
								<td className="p-2">{r.brigade ?? "—"}</td>
								<td className="p-2 font-mono">{r.invoiceNumber}</td>
								<td className="p-2 text-right font-mono">
									{formatMoney(r.subtotal)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
