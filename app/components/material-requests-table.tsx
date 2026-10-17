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

type MaterialRequestRow = {
	id: string
	vanName: string
	status: string
	submittedAt: string
	materialCount: number
	unitCount: number
}

/**
 * Every van restock request, in the same table layout as the serial register.
 * Read-only: releasing to a van happens from Restocks to Release. Server-paged
 * (`hrefFor` builds the `?page=` links).
 */
export function MaterialRequestsTable({
	requests,
	page,
	pageCount,
	total,
	pageSize,
	hrefFor,
}: {
	requests: MaterialRequestRow[]
	page: number
	pageCount: number
	total: number
	pageSize: number
	hrefFor: (page: number) => string
}) {
	const { t, i18n } = useTranslation()
	if (requests.length === 0) {
		return <EmptyState>{t("warehouse.requests.empty")}</EmptyState>
	}
	return (
		<div className="space-y-4">
			<DataTable>
				<DataTableHead>
					<Th>{t("warehouse.requests.col.van")}</Th>
					<Th>{t("warehouse.requests.col.request")}</Th>
					<Th>{t("warehouse.requests.col.submitted")}</Th>
					<Th>{t("warehouse.requests.col.items")}</Th>
					<Th>{t("warehouse.requests.col.status")}</Th>
				</DataTableHead>
				<tbody>
					{requests.map((r) => (
						<Tr key={r.id} data-testid={`request-row-${r.id}`}>
							<Td className="font-semibold">{r.vanName}</Td>
							<Td className="font-mono text-xs text-muted-foreground">
								#{r.id.slice(-6)}
							</Td>
							<Td className="whitespace-nowrap text-muted-foreground">
								{new Date(r.submittedAt).toLocaleString(i18n.language)}
							</Td>
							<Td className="text-muted-foreground">
								{t("warehouse.restock_list.materials", {
									count: r.materialCount,
								})}
								{" · "}
								{t("warehouse.restock_list.units", { count: r.unitCount })}
							</Td>
							<Td>
								<Badge
									variant={
										r.status === "SUBMITTED" || r.status === "APPROVED"
											? "warn"
											: "info"
									}
								>
									{t(`restock_status.${r.status}`, r.status)}
								</Badge>
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
