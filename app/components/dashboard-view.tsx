import { ChevronRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { Pill } from "~/components/ui/pill"
import { Stat } from "~/components/ui/stat"
import type { DashboardAlert, DashboardStat } from "~/lib/dashboard-stats"
import type { DocStatus } from "../../generated/prisma/client"

export type DashboardDocRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
}

const STATUS_BADGE_VARIANT: Record<
	DocStatus,
	"ok" | "warn" | "danger" | "info"
> = {
	CREATED: "warn",
	PREPPED: "info",
	SIGNED: "info",
	FIELD_UPDATED: "warn",
	SUPERVISOR_APPROVED: "info",
	CLARO_UPLOADED: "info",
	LC_GENERATED: "ok",
}

function DashboardView({
	stats,
	alert,
	docs,
}: {
	stats: DashboardStat[]
	alert: DashboardAlert
	docs: DashboardDocRow[]
}) {
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Dashboard</h1>

			{stats.length > 0 && (
				<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
					{stats.map((stat) => (
						<Stat key={stat.label} label={stat.label} value={stat.value} />
					))}
				</div>
			)}

			{alert && (
				<Pill
					variant={alert.variant}
					icon={alert.variant === "warn" ? "⚠" : "🔔"}
				>
					{alert.message}
				</Pill>
			)}

			<Card>
				<CardContent className="space-y-2 p-3">
					{docs.length === 0 && (
						<p className="p-2 text-sm text-muted-foreground">
							No documents yet.
						</p>
					)}
					{docs.map((doc) => (
						<Link
							key={doc.id}
							to={`/docs/${doc.id}`}
							className="block rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/40"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-mono text-sm font-medium">
									{doc.controlNumber}
								</span>
								<div className="flex items-center gap-2">
									<Badge variant={STATUS_BADGE_VARIANT[doc.status]}>
										{doc.status.replace(/_/g, " ")}
									</Badge>
									<HugeiconsIcon
										icon={ChevronRightIcon}
										strokeWidth={2}
										className="size-4 shrink-0 text-muted-foreground"
									/>
								</div>
							</div>
							<p className="mt-1 text-sm text-muted-foreground">
								{doc.jobType} — {doc.jobAddressEstimated}
							</p>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{doc.createdAt.toLocaleDateString()}
							</p>
						</Link>
					))}
				</CardContent>
			</Card>
		</div>
	)
}

export { DashboardView }
