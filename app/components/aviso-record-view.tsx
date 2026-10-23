import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import type { AvisoSummary, Dated } from "~/lib/aviso-summary"
import { formatShortDate } from "~/lib/payroll-request-view"
import { formatMoney } from "~/lib/utils"

type RecordDoc = { label: string; href: string }
type RecordEvent = {
	id: string
	action: string
	at: string
	by: string | null
	source: string | null
}

/** D = read off a document, S = stamped by a click, E = typed in (Rule 4). */
function SourceMark({ source }: { source: Dated["source"] }) {
	const { t } = useTranslation()
	if (source === "DOCUMENT")
		return <abbr title={t("aviso_record.source.document")}>D</abbr>
	if (source === "STAMPED")
		return <abbr title={t("aviso_record.source.stamped")}>S</abbr>
	if (source === "ENTERED")
		return <abbr title={t("aviso_record.source.entered")}>E</abbr>
	return null
}

/** A date with its source, or MISSING in red when it should exist and does not. */
function D({ d, missing = false }: { d: Dated; missing?: boolean }) {
	const { t } = useTranslation()
	if (!d.at)
		return missing ? (
			<span className="font-medium text-status-danger">
				{t("aviso_record.missing")}
			</span>
		) : (
			<span className="text-muted-foreground">—</span>
		)
	return (
		<span>
			{formatShortDate(d.at)} <SourceMark source={d.source} />
		</span>
	)
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border bg-card p-3">
			<div className="text-xs uppercase text-muted-foreground">{label}</div>
			<div className="font-mono text-lg">{formatMoney(value)}</div>
		</div>
	)
}

/** W8: the whole story of one Aviso. Nothing here is typed; it is read from Steps 1-7. */
export function AvisoRecordView({
	aviso,
	documents,
	history,
}: {
	aviso: AvisoSummary
	documents: RecordDoc[]
	history: RecordEvent[]
}) {
	const { t } = useTranslation()
	const a = aviso.armA
	const armBLabel =
		aviso.armB === "CLOSED"
			? t("aviso_record.closed")
			: aviso.armB === "OPEN"
				? t("aviso_record.open")
				: t("aviso_record.not_started")
	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h1 className="text-xl font-semibold">
					{t("aviso_record.title", {
						number: aviso.avisoNumber ?? aviso.controlNumber,
					})}
				</h1>
				<div className="flex flex-wrap gap-2">
					<Badge variant={a.closed ? "ok" : "warn"}>
						{t("aviso_record.arm_a")}:{" "}
						{a.closed ? t("aviso_record.closed") : t("aviso_record.open")}
					</Badge>
					<Badge variant={aviso.armB === "CLOSED" ? "ok" : "warn"}>
						{t("aviso_record.arm_b")}: {armBLabel}
					</Badge>
					{aviso.done && <Badge variant="ok">{t("aviso_record.done")}</Badge>}
				</div>
			</div>
			<p className="text-sm text-muted-foreground">
				{aviso.address} · {t("aviso_record.supervisor")} {aviso.supervisor}
				{aviso.brigades.length > 0 && ` · ${aviso.brigades.join(", ")}`}
				{" · "}
				{t("aviso_record.work_order")} {aviso.controlNumber}
			</p>
			<div className="grid grid-cols-2 gap-3 md:grid-cols-5">
				<Stat label={t("aviso_record.billed")} value={aviso.money.billed} />
				<Stat label={t("aviso_record.pod")} value={aviso.money.poed} />
				<Stat label={t("aviso_record.in_ariba")} value={aviso.money.inAriba} />
				<Stat label={t("aviso_record.paid")} value={aviso.money.paid} />
				<Stat
					label={t("aviso_record.outstanding")}
					value={aviso.money.outstanding}
				/>
			</div>

			<section className="space-y-2">
				<h2 className="font-semibold">{t("aviso_record.arm_a")}</h2>
				<div className="overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="p-2">{t("aviso_record.a.released")}</th>
								<th className="p-2">{t("aviso_record.a.accepted")}</th>
								<th className="p-2">{t("aviso_record.a.sold")}</th>
								<th className="p-2">{t("aviso_record.a.payroll")}</th>
								<th className="p-2">{t("aviso_record.a.paid")}</th>
								<th className="p-2">{t("aviso_record.a.days")}</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td className="p-2">
									<D d={a.released} missing={!!a.accepted.at} />
								</td>
								<td className="p-2">
									<D d={a.accepted} missing={!!a.sold.at} />
								</td>
								<td className="p-2">
									<D d={a.sold} missing={!!a.payrollRequest.at} />
									{a.batchNumber !== null && (
										<span className="text-muted-foreground">
											{" "}
											· {t("aviso_record.batch", { number: a.batchNumber })}
										</span>
									)}
								</td>
								<td className="p-2">
									<D d={a.payrollRequest} missing={!!a.brigadePaid.at} />
								</td>
								<td className="p-2">
									<D d={a.brigadePaid} />
								</td>
								<td className="p-2 font-mono">{a.days ?? "—"}</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>

			<section className="space-y-2">
				<h2 className="font-semibold">{t("aviso_record.arm_b")}</h2>
				{aviso.pos.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("aviso_record.no_pos")}
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="p-2">{t("aviso_record.b.po")}</th>
									<th className="p-2 text-right">
										{t("aviso_record.b.amount")}
									</th>
									<th className="p-2">{t("aviso_record.b.po_date")}</th>
									<th className="p-2">{t("aviso_record.b.invoice")}</th>
									<th className="p-2">{t("aviso_record.b.in_ariba")}</th>
									<th className="p-2">{t("aviso_record.b.due")}</th>
									<th className="p-2">{t("aviso_record.b.paid")}</th>
									<th className="p-2">{t("aviso_record.b.days")}</th>
								</tr>
							</thead>
							<tbody>
								{aviso.pos.map((p) => (
									<tr key={p.poId} className="border-b last:border-0">
										<td className="p-2 font-mono">{p.poNumber}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(p.poAmount)}
										</td>
										<td className="p-2">
											<D d={p.poDate} missing />
										</td>
										<td className="p-2 font-mono">{p.invoiceNumber ?? "—"}</td>
										<td className="p-2">
											<D d={p.loaded} missing={!!p.paid.at} />
										</td>
										<td className="p-2">
											<D d={p.due} />
										</td>
										<td className="p-2">
											<D d={p.paid} />
											{p.shortBy > 0 && !p.closed && (
												<span className="text-status-warn">
													{" "}
													·{" "}
													{t("aviso_record.short", {
														diff: formatMoney(p.shortBy),
													})}
												</span>
											)}
										</td>
										<td className="p-2 font-mono">
											{p.days ?? "—"}
											{p.pastDue && (
												<span className="text-status-danger">
													{" "}
													· {t("aviso_record.past_due")}
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<p className="text-xs text-muted-foreground">
					{t("aviso_record.legend")}
				</p>
			</section>

			<section className="space-y-2">
				<h2 className="font-semibold">{t("aviso_record.documents")}</h2>
				<ul className="list-disc space-y-0.5 pl-5 text-sm">
					{documents.map((d) => (
						<li key={d.href}>
							<a href={d.href} className="underline">
								{d.label}
							</a>
						</li>
					))}
				</ul>
			</section>

			<section className="space-y-2">
				<h2 className="font-semibold">{t("aviso_record.history")}</h2>
				<ul className="space-y-0.5 text-sm">
					{history.map((h) => (
						<li key={h.id}>
							<span className="font-mono">{formatShortDate(h.at)}</span> ·{" "}
							{h.action}
							{h.by && ` · ${h.by}`}
							{h.source && (
								<span className="text-muted-foreground"> · {h.source}</span>
							)}
						</li>
					))}
				</ul>
			</section>
			<Link to="/finance/avisos" className="text-sm underline">
				{t("aviso_record.back")}
			</Link>
		</div>
	)
}
