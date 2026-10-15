import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import type { DashboardDocRow } from "~/components/dashboard-doc-list"
import { Badge } from "~/components/ui/badge"

export type WarehouseRowKind = "prep" | "release" | "returns" | "missing"

const ROW = {
	prep: {
		href: (id: string) => `/docs/${id}/prep`,
		badge: "dashboard.to_prep_badge",
		variant: "warn",
	},
	release: {
		href: (id: string) => `/docs/${id}/sign`,
		badge: "dashboard.prepped_awaiting_badge",
		variant: "info",
	},
	returns: {
		href: (id: string) => `/docs/${id}/returns`,
		badge: "dashboard.returns_to_log_badge",
		variant: "warn",
	},
	missing: {
		href: (id: string) => `/docs/${id}/prep`,
		badge: "dashboard.missing_materials_badge",
		variant: "danger",
	},
} as const

export function WarehouseDocList({
	docs,
	kind,
	emptyHref,
}: {
	docs: DashboardDocRow[]
	kind: WarehouseRowKind
	emptyHref?: string
}) {
	const { t } = useTranslation()
	const row = ROW[kind]
	if (docs.length === 0) {
		return emptyHref ? (
			<Link to={emptyHref} className="text-sm text-muted-foreground underline">
				{t("warehouse_queue.empty")}
			</Link>
		) : (
			<p className="text-sm text-muted-foreground">
				{t("warehouse_queue.empty")}
			</p>
		)
	}
	return (
		<div className="space-y-2">
			{docs.map((doc) => (
				<Link
					key={doc.id}
					to={row.href(doc.id)}
					className="block rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
				>
					<div className="flex items-center justify-between gap-2">
						<span className="font-mono font-medium">{doc.controlNumber}</span>
						<div className="flex items-center gap-2">
							{kind === "release" && doc.aged && (
								<Badge variant="danger">
									{t("dashboard.aged_pickup_badge")}
								</Badge>
							)}
							{kind === "release" && doc.daysStaged !== undefined && (
								<Badge variant={doc.aged ? "danger" : "neutral"}>
									{t("dashboard.days_staged", { count: doc.daysStaged })}
								</Badge>
							)}
							<Badge variant={row.variant}>{t(row.badge)}</Badge>
							{kind === "prep" && (
								<span className="text-muted-foreground/50" aria-hidden>
									›
								</span>
							)}
						</div>
					</div>
					<p className="mt-1 text-xs text-muted-foreground/70">
						{doc.jobType} — {doc.jobAddressEstimated}
					</p>
				</Link>
			))}
		</div>
	)
}
