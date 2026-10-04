import { ChevronRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import type { DocStatus } from "../../generated/prisma/client"

function toLines(value: unknown): MaterialLine[] {
	if (!Array.isArray(value)) return []
	return value.filter((i): i is MaterialLine => {
		if (typeof i !== "object" || i === null) return false
		const item = i as Record<string, unknown>
		return (
			typeof item.serviceCodeId === "string" && typeof item.qty === "number"
		)
	})
}

function hasOverage(doc: DashboardDocRow): boolean {
	const estimated = toLines(doc.estimatedMaterials)
	const taken = toLines(doc.materialsTaken)
	if (estimated.length === 0 || taken.length === 0) return false
	const estimatedMap = Object.fromEntries(
		estimated.map((e) => [e.serviceCodeId, e.qty]),
	)
	return taken.some((t) => t.qty > (estimatedMap[t.serviceCodeId] ?? 0))
}

function hasQuantityDiscrepancy(doc: DashboardDocRow): boolean {
	const taken = toLines(doc.materialsTaken)
	const used = toLines(doc.materialsUsed)
	if (taken.length === 0 || used.length === 0) return false
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)
	const usedMap = Object.fromEntries(used.map((u) => [u.serviceCodeId, u.qty]))
	const allIds = new Set([...Object.keys(takenMap), ...Object.keys(usedMap)])
	for (const id of allIds) {
		if ((takenMap[id] ?? 0) !== (usedMap[id] ?? 0)) return true
	}
	return false
}

function hasShortage(doc: DashboardDocRow): boolean {
	const returned = Array.isArray(doc.materialsReturned)
		? doc.materialsReturned
		: []
	return returned.some((line) => {
		if (typeof line !== "object" || line === null) return false
		const record = line as Record<string, unknown>
		return (
			typeof record.returnedQty === "number" &&
			typeof record.takenQty === "number" &&
			record.returnedQty < record.takenQty
		)
	})
}

type MaterialLine = { serviceCodeId: string; qty: number }

export type DashboardDocRow = {
	id: string
	controlNumber: string
	status: DocStatus
	jobType: string
	jobAddressEstimated: string
	createdAt: Date
	avisoNumber?: string | null
	assignedCrewIds?: string[]
	sendBackHistory?: unknown
	estimatedMaterials?: unknown
	materialsTaken?: unknown
	materialsUsed?: unknown
	materialsReturned?: unknown
	aged?: boolean
	daysStaged?: number
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
	LC_REQUEST_GENERATED: "ok",
	CANCELLED: "danger",
}

export function DashboardDocList({ docs }: { docs: DashboardDocRow[] }) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardContent className="space-y-2 p-3">
				{docs.length === 0 && (
					<EmptyState>{t("dashboard.no_documents")}</EmptyState>
				)}
				{docs.map((doc) => {
					const overage = hasOverage(doc)
					const discrepancy = hasQuantityDiscrepancy(doc)
					const shortage = hasShortage(doc)
					return (
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
							{(overage || discrepancy || shortage) && (
								<div className="mt-2 flex flex-wrap items-center gap-1">
									{overage && (
										<Badge variant="danger" className="text-xs">
											{t("dashboard.signal.overage")}
										</Badge>
									)}
									{discrepancy && (
										<Badge variant="warn" className="text-xs">
											{t("dashboard.signal.discrepancy")}
										</Badge>
									)}
									{shortage && (
										<Badge variant="info" className="text-xs">
											{t("dashboard.signal.shortage")}
										</Badge>
									)}
									<span className="ml-1 text-xs font-medium text-accent-text">
										{t("dashboard.action.review_signal")}
									</span>
								</div>
							)}
							{doc.avisoNumber && (
								<p className="mt-1 text-xs text-muted-foreground/70">
									{t("dashboard.aviso_number")} {doc.avisoNumber}
								</p>
							)}
							{doc.createdAt && (
								<p className="mt-1 text-xs text-muted-foreground/70">
									{doc.createdAt.toLocaleDateString()}
								</p>
							)}
						</Link>
					)
				})}
			</CardContent>
		</Card>
	)
}
