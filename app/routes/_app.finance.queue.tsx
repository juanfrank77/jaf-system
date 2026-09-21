import { Invoice02Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Card } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import { PageHeader } from "~/components/ui/page-header"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableRow,
	TableToolbar,
} from "~/components/ui/table"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney, toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.finance.queue"

export const meta: Route.MetaFunction = () => [
	{ title: "Payment request queue — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const docs = await db.jafInvoice.findMany({
		where: {
			releasedToFinanceAt: { not: null },
			status: { notIn: ["LC_REQUEST_GENERATED", "CANCELLED"] },
		},
		select: {
			id: true,
			controlNumber: true,
			avisoNumber: true,
			jafInvoiceLineTotal: true,
			releasedToFinanceAt: true,
			contractorAccountCode: true,
			brigade: { select: { name: true, leadName: true } },
			preCertSheets: {
				where: { supersededAt: null },
				select: {
					sigSubcontractorName: true,
					sigClaroAt: true,
					sigClaroScanPath: true,
				},
				take: 1,
			},
		},
		orderBy: { releasedToFinanceAt: "desc" },
		take: 200,
	})
	const rows = docs.map((d) => {
		const sheet = d.preCertSheets[0]
		return {
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			contractorName:
				sheet?.sigSubcontractorName ??
				d.brigade?.leadName ??
				d.brigade?.name ??
				"—",
			contractorCode: d.contractorAccountCode,
			amount: toNumberPrice(d.jafInvoiceLineTotal),
			releasedAt: d.releasedToFinanceAt,
			claroSigned: !!(sheet?.sigClaroAt || sheet?.sigClaroScanPath),
		}
	})
	const claroAcceptancePct =
		rows.length === 0
			? null
			: Math.round(
					(rows.filter((r) => r.claroSigned).length / rows.length) * 100,
				)
	return { user, rows, claroAcceptancePct }
}

export default function FinanceQueue({ loaderData }: Route.ComponentProps) {
	const { rows, claroAcceptancePct } = loaderData
	const { t } = useTranslation()
	const [search, setSearch] = useState("")
	const [packetFilter, setPacketFilter] = useState<
		"all" | "missing_claro" | "has_claro"
	>("all")

	const filtered = useMemo(() => {
		const term = search.trim().toLowerCase()
		return rows.filter((row) => {
			if (packetFilter === "missing_claro" && row.claroSigned) return false
			if (packetFilter === "has_claro" && !row.claroSigned) return false
			if (!term) return true
			return (
				row.controlNumber.toLowerCase().includes(term) ||
				(row.avisoNumber?.toLowerCase().includes(term) ?? false) ||
				row.contractorName.toLowerCase().includes(term) ||
				(row.contractorCode?.toLowerCase().includes(term) ?? false)
			)
		})
	}, [rows, search, packetFilter])

	return (
		<div>
			<PageHeader
				title={t("finance_queue.title")}
				subtitle={t("finance_queue.hint")}
				meta={
					claroAcceptancePct != null && (
						<Badge variant="info">
							{t("finance_queue.claro_pct", { pct: claroAcceptancePct })}
						</Badge>
					)
				}
			/>
			<Card>
				<TableToolbar>
					<Input
						leading={
							<HugeiconsIcon
								icon={Search01Icon}
								strokeWidth={2}
								className="size-4"
							/>
						}
						placeholder={t("finance_queue.search_placeholder")}
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="sm:w-72"
					/>
					<div className="flex flex-wrap items-center gap-3">
						<span className="text-xs text-muted-foreground">
							{t("finance_queue.result_count", { count: filtered.length })}
						</span>
						<Select
							value={packetFilter}
							onValueChange={(value) =>
								setPacketFilter(value as typeof packetFilter)
							}
						>
							<SelectTrigger
								size="sm"
								aria-label={t("finance_queue.col.packet")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">
									{t("finance_queue.filter_all")}
								</SelectItem>
								<SelectItem value="missing_claro">
									{t("finance_queue.filter_missing_claro")}
								</SelectItem>
								<SelectItem value="has_claro">
									{t("finance_queue.filter_has_claro")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</TableToolbar>
				{rows.length === 0 ? (
					<EmptyState icon={Invoice02Icon} title={t("finance_queue.empty")} />
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("finance_queue.col.work_order")}</TableHead>
								<TableHead>{t("finance_queue.col.aviso")}</TableHead>
								<TableHead>{t("finance_queue.col.contractor")}</TableHead>
								<TableHead className="text-right">
									{t("finance_queue.col.amount")}
								</TableHead>
								<TableHead>{t("finance_queue.col.packet")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((r) => (
								<TableRow key={r.id}>
									<TableCell className="font-mono text-xs">
										<Link
											to={`/finance/verify/${r.id}`}
											className="text-foreground hover:underline"
										>
											{r.controlNumber}
										</Link>
									</TableCell>
									<TableCell>{r.avisoNumber ?? "—"}</TableCell>
									<TableCell>
										{r.contractorName}
										{r.contractorCode ? ` · ${r.contractorCode}` : ""}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoney(r.amount)}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											<Badge variant="ok">{t("finance_queue.complete")}</Badge>
											{!r.claroSigned && (
												<Badge variant="warn">
													{t("finance_queue.no_claro_sig")}
												</Badge>
											)}
										</div>
									</TableCell>
								</TableRow>
							))}
							{filtered.length === 0 && (
								<TableEmptyRow colSpan={5}>
									<EmptyState
										icon={Invoice02Icon}
										title={t("finance_queue.no_matches")}
									/>
								</TableEmptyRow>
							)}
						</TableBody>
					</Table>
				)}
			</Card>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
