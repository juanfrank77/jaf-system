import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Badge } from "~/components/ui/badge"
import { buttonVariants } from "~/components/ui/button"
import {
	DataTable,
	DataTableHead,
	Td,
	Th,
	Tr,
} from "~/components/ui/data-table"
import { EmptyState } from "~/components/ui/empty-state"
import { Pager } from "~/components/ui/pager"
import { Stat } from "~/components/ui/stat"
import {
	WAREHOUSE_STEP_HREF,
	WAREHOUSE_STEP_LABEL_KEY,
	type WarehouseStep,
} from "~/lib/warehouse-steps"

export type SerialStatus =
	| "WAREHOUSE"
	| "VAN"
	| "INSTALLED"
	| "REMOVED_PENDING_RETURN"
	| "RETURNED"
	| "SENT_FOR_REPAIR"
	| "NEEDS_REVIEW"
	| "AWAITING_REPAIR"
	| "LOST"

export type SerialRegisterRow = {
	serial: string
	serviceCodeId: string
	claroCode: string
	material: string
	status: SerialStatus
	condition: "NEW" | "REFURBISHED"
	vanName: string | null
	since: string
	lastMovement: { type: string; at: string } | null
}

export type SerialRegisterStats = {
	inWarehouse: number
	onVans: number
	installed: number
	needsAttention: number
}

const STATUS_TONE: Record<
	SerialStatus,
	"ok" | "warn" | "danger" | "info" | "neutral"
> = {
	WAREHOUSE: "info",
	VAN: "neutral",
	INSTALLED: "ok",
	REMOVED_PENDING_RETURN: "warn",
	RETURNED: "warn",
	SENT_FOR_REPAIR: "warn",
	NEEDS_REVIEW: "warn",
	AWAITING_REPAIR: "warn",
	LOST: "danger",
}

// Where a unit in this state is handled next: one consistent "open the right
// workflow screen" button per row, instead of an action per state.
const NEXT_STEP: Partial<Record<SerialStatus, WarehouseStep>> = {
	REMOVED_PENDING_RETURN: "SCAN_IN",
	RETURNED: "TRIAGE",
	NEEDS_REVIEW: "REVIEW",
	AWAITING_REPAIR: "REPAIRS",
	SENT_FOR_REPAIR: "REPAIRS",
}

/**
 * Serial register: a headline strip, then one row per serial with where it is,
 * since when, its last movement and a link to the workflow step that handles
 * it. Server-paged (`hrefFor` builds the `?page=` links).
 */
export function SerialRegister({
	rows,
	stats,
	page,
	pageCount,
	total,
	pageSize,
	hrefFor,
}: {
	rows: SerialRegisterRow[]
	stats: SerialRegisterStats
	page: number
	pageCount: number
	total: number
	pageSize: number
	hrefFor: (page: number) => string
}) {
	const { t, i18n } = useTranslation()
	const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language)
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat
					label={t("stock.serial_register.stats.in_warehouse")}
					value={stats.inWarehouse}
				/>
				<Stat
					label={t("stock.serial_register.stats.on_vans")}
					value={stats.onVans}
				/>
				<Stat
					label={t("stock.serial_register.stats.installed")}
					value={stats.installed}
				/>
				<Stat
					label={t("stock.serial_register.stats.needs_attention")}
					value={stats.needsAttention}
					tone={stats.needsAttention > 0 ? "warn" : "neutral"}
				/>
			</div>
			{rows.length === 0 ? (
				<EmptyState>{t("stock.serial_register.empty")}</EmptyState>
			) : (
				<DataTable>
					<DataTableHead>
						<Th>{t("stock.serial_register.col.serial")}</Th>
						<Th>{t("stock.serial_register.col.sap")}</Th>
						<Th>{t("stock.serial_register.col.material")}</Th>
						<Th>{t("stock.serial_register.col.location")}</Th>
						<Th>{t("stock.serial_register.col.since")}</Th>
						<Th>{t("stock.serial_register.col.last_movement")}</Th>
						<Th>
							<span className="sr-only">
								{t("stock.serial_register.col.action")}
							</span>
						</Th>
					</DataTableHead>
					<tbody>
						{rows.map((r) => {
							const step = NEXT_STEP[r.status]
							return (
								<Tr key={r.serial} data-testid={`serial-row-${r.serial}`}>
									<Td className="font-mono font-semibold">{r.serial}</Td>
									<Td className="font-mono text-xs text-muted-foreground">
										{r.claroCode || "—"}
									</Td>
									<Td>
										{r.material || "—"}
										{r.condition === "REFURBISHED" && (
											<Badge variant="neutral" className="ml-2">
												{t("stock.serial_register.condition.REFURBISHED")}
											</Badge>
										)}
									</Td>
									<Td>
										<Badge variant={STATUS_TONE[r.status]}>
											{t(`stock.serial_register.status.${r.status}`)}
											{r.vanName ? ` · ${r.vanName}` : ""}
										</Badge>
									</Td>
									<Td className="whitespace-nowrap text-muted-foreground">
										{date(r.since)}
									</Td>
									<Td className="text-muted-foreground">
										{r.lastMovement
											? `${t(`stock.movement_type.${r.lastMovement.type}`, { defaultValue: r.lastMovement.type })} · ${date(r.lastMovement.at)}`
											: t("stock.no_movement")}
									</Td>
									<Td className="text-right">
										{step && (
											<Link
												to={WAREHOUSE_STEP_HREF[step]}
												className={buttonVariants({
													variant: "outline",
													size: "sm",
												})}
											>
												{t(WAREHOUSE_STEP_LABEL_KEY[step])}
											</Link>
										)}
									</Td>
								</Tr>
							)
						})}
					</tbody>
				</DataTable>
			)}
			<Pager
				page={page}
				pageCount={pageCount}
				total={total}
				pageSize={pageSize}
				hrefFor={hrefFor}
			/>
		</div>
	)
}
