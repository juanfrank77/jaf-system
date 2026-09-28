import { RouteErrorBoundary } from "~/components/error-boundary"
import { StockScreen } from "~/components/stock-screen"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveMaterialCodes } from "~/lib/service-codes.server"
import { toNumberPrice } from "~/lib/utils"
import { isWarehouseLead } from "~/lib/warehouse-lead.server"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import {
	getWarehouseBulkStock,
	getWarehouseSerialStock,
} from "~/lib/warehouse-stock.server"
import type { Route } from "./+types/_app.warehouse.stock"

export const meta: Route.MetaFunction = () => [
	{ title: "Stock & Audit — JAF Ops" },
]

// Screen loader: scopes bulk + serialized stock to the selected warehouse
// (Task 4's resolveWarehouseScope — the same `wh` cookie the header switch
// writes), plus the small amount of extra display/gating data the on-page
// Receive/Adjust/Snapshot actions and serial-register need. `bulk`/`serial`
// themselves are untouched pass-throughs of Task 2's helpers. The screen's
// actual UI lives in `~/components/stock-screen` (kept out of this file so
// it can be rendered/tested without pulling in this loader's server-only
// imports).
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const { warehouses, selectedId } = await resolveWarehouseScope(
		db,
		request,
		user,
	)
	const query = new URL(request.url).searchParams.get("q") ?? ""

	if (!selectedId) {
		return {
			warehouses,
			selectedId,
			bulk: [],
			serial: [],
			query,
			isLead: false,
			materialCodes: [],
			serialCodeNames: {} as Record<
				string,
				{ claroCode: string; name: string }
			>,
			snapshots: [],
		}
	}

	const [bulk, serial, isLead, snapshots, materialCodesRaw] = await Promise.all(
		[
			getWarehouseBulkStock(db, selectedId),
			getWarehouseSerialStock(db, selectedId),
			user.role === "ADMIN"
				? Promise.resolve(true)
				: isWarehouseLead(user.id, selectedId),
			db.stockSnapshot.findMany({
				where: { warehouseId: selectedId },
				orderBy: { generatedAt: "desc" },
				take: 5,
			}),
			getActiveMaterialCodes(),
		],
	)

	// SerialLocation keys serviceCodeId without a relation (same convention as
	// triage.tsx), so resolve display names for the serial-register here.
	const codes = await db.serviceCode.findMany({
		where: { id: { in: [...new Set(serial.map((s) => s.serviceCodeId))] } },
		select: { id: true, claroCode: true, canonicalName: true, name: true },
	})
	const serialCodeNames = Object.fromEntries(
		codes.map((c) => [
			c.id,
			{ claroCode: c.claroCode, name: c.canonicalName ?? c.name },
		]),
	)
	const materialCodes = materialCodesRaw.map((c) => ({
		id: c.id,
		claroCode: c.claroCode,
		name: c.canonicalName ?? c.name,
		unit: c.unit,
		unitPrice: toNumberPrice(c.unitPrice),
	}))

	return {
		warehouses,
		selectedId,
		bulk,
		serial,
		query,
		isLead,
		materialCodes,
		serialCodeNames,
		snapshots,
	}
}

export default function StockAndAudit({ loaderData }: Route.ComponentProps) {
	return <StockScreen {...loaderData} />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
