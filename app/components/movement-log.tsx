import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import {
	DataTable,
	DataTableHead,
	Td,
	Th,
	Tr,
} from "~/components/ui/data-table"
import { EmptyState } from "~/components/ui/empty-state"
import { Pager } from "~/components/ui/pager"

type MovementLogRow = {
	id: string
	type: string
	qty: number
	serial: string | null
	at: string
	actor: string
	material: string
	job: string | null
	note: string | null
}

const TYPE_TONE: Record<string, "ok" | "warn" | "danger" | "info" | "neutral"> =
	{
		RECEIVE: "ok",
		STARTING_BALANCE: "ok",
		RELEASE: "info",
		PICKUP: "info",
		INSTALL: "info",
		ADJUST: "warn",
		DISPOSITION: "warn",
		SENT_FOR_REPAIR: "warn",
	}

/**
 * The warehouse ledger, newest first, in the same table layout as the serial
 * register. Server-paged (`hrefFor` builds the `?page=` links).
 */
export function MovementLog({
	movements,
	page,
	pageCount,
	total,
	pageSize,
	hrefFor,
}: {
	movements: MovementLogRow[]
	page: number
	pageCount: number
	total: number
	pageSize: number
	hrefFor: (page: number) => string
}) {
	const { t, i18n } = useTranslation()
	if (movements.length === 0) {
		return <EmptyState>{t("stock.trail.empty")}</EmptyState>
	}
	return (
		<div className="space-y-4">
			<DataTable>
				<DataTableHead>
					<Th>{t("stock.movement_log.col.when")}</Th>
					<Th>{t("stock.movement_log.col.type")}</Th>
					<Th>{t("stock.movement_log.col.material")}</Th>
					<Th>{t("stock.movement_log.col.serial")}</Th>
					<Th className="text-right">{t("stock.movement_log.col.qty")}</Th>
					<Th>{t("stock.movement_log.col.who")}</Th>
					<Th>{t("stock.movement_log.col.reference")}</Th>
				</DataTableHead>
				<tbody>
					{movements.map((m) => (
						<Tr key={m.id} data-testid={`movement-row-${m.id}`}>
							<Td className="whitespace-nowrap text-muted-foreground">
								{new Date(m.at).toLocaleString(i18n.language)}
							</Td>
							<Td>
								<Badge variant={TYPE_TONE[m.type] ?? "neutral"}>
									{t(`stock.movement_type.${m.type}`, {
										defaultValue: m.type,
									})}
								</Badge>
							</Td>
							<Td>{m.material || "—"}</Td>
							<Td className="font-mono text-xs">{m.serial ?? "—"}</Td>
							<Td className="text-right font-mono font-semibold">{m.qty}</Td>
							<Td className="whitespace-nowrap">{m.actor}</Td>
							<Td className="text-muted-foreground">
								{m.job ?? m.note ?? "—"}
							</Td>
						</Tr>
					))}
				</tbody>
			</DataTable>
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
