import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import {
	computeTriagePrefill,
	type Disposition,
	dispositionSerial,
} from "~/lib/repair.server"
import { getActiveWarehouseId } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.triage"

export const meta: Route.MetaFunction = () => [{ title: "Triage — JAF Ops" }]

const DISPOSITIONS: Disposition[] = ["FAILED", "GOOD", "NEEDS_REVIEW"]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const warehouseId = await getActiveWarehouseId(user.id)
	const units = await db.serialLocation.findMany({
		where: { status: "RETURNED", currentRef: warehouseId },
		select: { serial: true, serviceCodeId: true },
		orderBy: { since: "asc" },
	})
	// Names for display (SerialLocation keys serviceCodeId without a relation).
	const codes = await db.serviceCode.findMany({
		where: { id: { in: [...new Set(units.map((u) => u.serviceCodeId))] } },
		select: { id: true, claroCode: true, name: true },
	})
	const nameById = new Map(codes.map((c) => [c.id, c]))
	const withPrefill = await Promise.all(
		units.map(async (u) => ({
			serial: u.serial,
			claroCode: nameById.get(u.serviceCodeId)?.claroCode ?? null,
			name: nameById.get(u.serviceCodeId)?.name ?? null,
			prefill: await computeTriagePrefill(u.serial),
		})),
	)
	return { units: withPrefill }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const warehouseId = await getActiveWarehouseId(user.id)
	const form = await request.formData()
	await dispositionSerial({
		serial: String(form.get("serial")),
		disposition: String(form.get("disposition")) as Disposition,
		reason: form.get("reason") ? String(form.get("reason")) : undefined,
		byUserId: user.id,
		warehouseId,
	})
	return { ok: true }
}

export default function Triage({ loaderData }: Route.ComponentProps) {
	const { t } = useTranslation()
	const { units } = loaderData
	return (
		<div className="mx-auto w-full max-w-2xl space-y-4 p-4">
			<h1 className="text-lg font-semibold text-foreground">
				{t("triage.title")}
			</h1>
			{units.length === 0 && (
				<p className="text-sm text-muted-foreground">{t("triage.empty")}</p>
			)}
			{units.map((u) => (
				<Card key={u.serial}>
					<CardContent className="space-y-3 p-4">
						<div className="flex items-center justify-between gap-2">
							<span className="font-mono font-medium">{u.serial}</span>
							{u.claroCode && <Badge variant="info">{u.claroCode}</Badge>}
						</div>
						{u.name && (
							<p className="text-xs text-muted-foreground/70">{u.name}</p>
						)}
						<Form
							method="post"
							className="flex flex-col gap-2 sm:flex-row sm:items-end"
						>
							<input type="hidden" name="serial" value={u.serial} />
							<label className="flex-1 text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("triage.disposition_label")}
								</span>
								<select
									name="disposition"
									defaultValue={u.prefill}
									className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
								>
									{DISPOSITIONS.map((d) => (
										<option key={d} value={d}>
											{t(`triage.disposition.${d}`)}
										</option>
									))}
								</select>
							</label>
							<label className="flex-1 text-sm">
								<span className="mb-1 block text-muted-foreground">
									{t("triage.reason_label")}
								</span>
								<input
									type="text"
									name="reason"
									placeholder={t("triage.reason_placeholder")}
									className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
								/>
							</label>
							<Button type="submit">{t("triage.submit")}</Button>
						</Form>
					</CardContent>
				</Card>
			))}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
