import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { formatMoney } from "~/lib/utils"

export type StageRow = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	contractorLabel: string | null
	ageDays: number
	amount: number
	docs: {
		jafInvoice: boolean
		aviso: boolean
		preCert: boolean
		photos: boolean
		account: boolean
	}
	/** Step 4 only: contractor account resolves, so a list can include it. */
	accountResolved?: boolean
	/** The supervisor fixed a return and sent it back: look at it first. */
	resent?: boolean
	/** Finance sent it back and the supervisor has not resent it yet. */
	returned?: boolean
}

/** Shared by steps 1-3. `showDocs` adds the documents-received column
 * (step 1); `action` renders the per-row action cell (links or a form). */
export function FinanceStageTable({
	rows,
	to,
	showDocs = false,
	ageLabelKey,
	action,
}: {
	rows: StageRow[]
	to: (row: StageRow) => string
	showDocs?: boolean
	ageLabelKey: string
	action?: (row: StageRow) => ReactNode
}) {
	const { t } = useTranslation()
	return (
		<div className="overflow-x-auto bg-card border rounded-lg">
			<table className="w-full text-sm">
				<thead>
					<tr className="text-xs text-muted-foreground text-left border-b">
						<th className="p-2">{t("finance_stage.col.work_order")}</th>
						<th className="p-2">{t("finance_stage.col.aviso")}</th>
						<th className="p-2">{t("finance_stage.col.contractor")}</th>
						<th className="p-2 text-right">{t("finance_stage.col.amount")}</th>
						{showDocs && <th className="p-2">{t("finance_stage.col.docs")}</th>}
						<th className="p-2 text-right">{t(ageLabelKey as never)}</th>
						{action && <th className="p-2" />}
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
							<td className="p-2 font-mono">
								<Link to={to(r)} className="underline">
									{r.controlNumber}
								</Link>
								{r.returned && (
									<Badge variant="danger" className="ml-2">
										{t("open_job.returned")}
									</Badge>
								)}
								{r.resent && (
									<Badge variant="info" className="ml-2">
										{t("returned_packet.resent")}
									</Badge>
								)}
							</td>
							<td className="p-2">{r.avisoNumber ?? "—"}</td>
							<td className="p-2">{r.contractorLabel ?? "—"}</td>
							<td className="p-2 text-right font-mono">
								{formatMoney(r.amount)}
							</td>
							{showDocs && (
								<td className="p-2 space-x-1">
									<Badge variant={r.docs.jafInvoice ? "ok" : "warn"}>
										{t("finance_stage.doc.jaf_invoice")}
									</Badge>
									<Badge variant={r.docs.aviso ? "ok" : "warn"}>
										{t("finance_stage.doc.aviso")}
									</Badge>
									<Badge variant={r.docs.preCert ? "ok" : "warn"}>
										{t("finance_stage.doc.precert")}
									</Badge>
									<Badge variant={r.docs.photos ? "ok" : "warn"}>
										{t("finance_stage.doc.photos")}
									</Badge>
									<Badge variant={r.docs.account ? "ok" : "warn"}>
										{t("finance_stage.doc.account")}
									</Badge>
								</td>
							)}
							<td className="p-2 text-right font-mono">{r.ageDays}</td>
							{action && <td className="p-2">{action(r)}</td>}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}

/** Prev / next footer shared by the three list screens. */
export function StagePagination({
	basePath,
	pagination,
	pageSize,
}: {
	basePath: string
	pagination: { page: number; totalPages: number; totalCount: number }
	pageSize: number
}) {
	const { t } = useTranslation()
	if (pagination.totalPages <= 1) return null
	// basePath may already carry a query (the Returned view).
	const sep = basePath.includes("?") ? "&" : "?"
	return (
		<div className="flex items-center justify-between text-sm">
			<span className="text-muted-foreground">
				{t("finance_queue.pagination.summary", {
					from: (pagination.page - 1) * pageSize + 1,
					to: Math.min(pagination.page * pageSize, pagination.totalCount),
					total: pagination.totalCount,
				})}
			</span>
			<div className="flex gap-2">
				<Link
					to={`${basePath}${sep}page=${Math.max(1, pagination.page - 1)}`}
					className={
						pagination.page <= 1 ? "pointer-events-none opacity-50" : undefined
					}
				>
					{t("finance_queue.pagination.prev")}
				</Link>
				<span>
					{t("finance_queue.pagination.page", {
						current: pagination.page,
						total: pagination.totalPages,
					})}
				</span>
				<Link
					to={`${basePath}${sep}page=${pagination.page + 1}`}
					className={
						pagination.page >= pagination.totalPages
							? "pointer-events-none opacity-50"
							: undefined
					}
				>
					{t("finance_queue.pagination.next")}
				</Link>
			</div>
		</div>
	)
}
