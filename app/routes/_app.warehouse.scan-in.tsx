import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { BarcodeScanner } from "~/components/barcode-scanner"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { WarehouseStepRail } from "~/components/warehouse-step-rail"
import { db } from "~/lib/db.server"
import { pageTitle } from "~/lib/page-title"
import { canScanInReturn, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import { scanInReturn } from "~/lib/scan-in.server"
import type { Route } from "./+types/_app.warehouse.scan-in"

export const meta: Route.MetaFunction = ({ matches }) => [
	{ title: pageTitle(matches, "page_title.scan_in") },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canScanInReturn))
	const warehouses = await db.warehouse.findMany({ where: { active: true } })
	return { warehouses }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, rolesMatching(canScanInReturn))
	const form = await request.formData()
	const serial = form.get("serial") as string
	const warehouseId = form.get("warehouseId") as string
	return scanInReturn(serial, warehouseId, { id: user.id })
}

export default function WarehouseScanIn({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { warehouses } = loaderData
	const { t } = useTranslation()
	const [scanning, setScanning] = useState(false)
	const [serial, setSerial] = useState("")
	const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "")

	return (
		<div className="space-y-4 max-w-xl">
			<h1 className="text-xl font-semibold">
				{t("warehouse.scan_in.heading", "Scan In Return")}
			</h1>
			<WarehouseStepRail current="SCAN_IN" />
			<Callout title={t("warehouse_flow.callout.scan_in_title")}>
				{t("warehouse_flow.callout.scan_in_body")}
			</Callout>
			<Form method="post" className="space-y-4">
				<input type="hidden" name="serial" value={serial} />
				<input type="hidden" name="warehouseId" value={warehouseId} />
				<Select
					value={warehouseId}
					onValueChange={(v) => setWarehouseId(v ?? "")}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{warehouses.map((w) => (
							<SelectItem key={w.id} value={w.id}>
								{w.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{scanning ? (
					<BarcodeScanner
						onDecode={(text) => {
							setSerial(text)
							setScanning(false)
						}}
						onGiveUp={() => setScanning(false)}
					/>
				) : (
					<div className="flex items-center gap-2">
						<span className="text-sm">{serial || "—"}</span>
						<Button
							type="button"
							variant="outline"
							onClick={() => setScanning(true)}
						>
							{t("installer.completion.scan", "Scan")}
						</Button>
					</div>
				)}
				<Button type="submit" disabled={!serial}>
					{t("warehouse.scan_in.submit", "Scan In")}
				</Button>
			</Form>
			{actionData && !actionData.ok && (
				<Callout
					title={t(
						"warehouse.scan_in.not_owed_back",
						"This serial is not owed back.",
					)}
					tone="danger"
				>
					{t(
						"warehouse_flow.callout.scan_in_not_owed_body",
						"Scan the serial of a unit that is owed back to this warehouse — the unit drops off the installer's owed-back list the moment it is scanned in.",
					)}
				</Callout>
			)}
			{actionData?.ok && (
				<Callout
					title={t("warehouse.scan_in.success", "Returned successfully.")}
					tone="ok"
				>
					{t(
						"warehouse_flow.callout.scan_in_done_body",
						"Unit location updated to this warehouse. It is off the installer's owed-back list and back in your serialized stock.",
					)}
				</Callout>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
