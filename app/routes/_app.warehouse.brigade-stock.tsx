import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { PageHeader } from "~/components/ui/page-header"
import {
	confirmReturn,
	markRestockReady,
	signPickup,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.brigade-stock"

export const meta: Route.MetaFunction = () => [
	{ title: "Brigade restock — JAF Ops" },
]

/**
 * The warehouse side of brigade stock: prepare a supervisor's restock order
 * (Requested → Ready alerts the supervisor), hand it over (both sides sign the
 * pickup) and confirm the returns supervisors record. No prices.
 */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const [restocks, returns] = await Promise.all([
		db.brigadeRestock.findMany({
			where: { status: { in: ["REQUESTED", "READY"] } },
			include: { lines: true, requestedBy: { select: { name: true } } },
			orderBy: { requestedAt: "asc" },
		}),
		db.brigadeStockReturn.findMany({
			where: { confirmedAt: null },
			include: { requestedBy: { select: { name: true } } },
			orderBy: { requestedAt: "asc" },
		}),
	])
	const brigades = new Map(
		(
			await db.brigade.findMany({
				where: {
					id: {
						in: [
							...restocks.flatMap((r) => r.lines.map((l) => l.brigadeId)),
							...returns.map((r) => r.brigadeId),
						],
					},
				},
				select: { id: true, name: true, code: true },
			})
		).map((b) => [b.id, b]),
	)
	const materials = new Map(
		(
			await db.serviceCode.findMany({
				where: {
					id: {
						in: [
							...restocks.flatMap((r) => r.lines.map((l) => l.serviceCodeId)),
							...returns.map((r) => r.serviceCodeId),
						],
					},
				},
				select: { id: true, claroCode: true, name: true, unit: true },
			})
		).map((m) => [m.id, m]),
	)
	const brigadeName = (id: string) => {
		const b = brigades.get(id)
		return b ? `${b.code ? `${b.code} ` : ""}${b.name}` : id
	}
	const materialLabel = (id: string) => materials.get(id)?.name ?? id
	return {
		restocks: restocks.map((r) => ({
			id: r.id,
			status: r.status,
			supervisor: r.requestedBy.name,
			requestedAt: r.requestedAt.toISOString(),
			warehouseSigned: !!r.warehouseSignedAt,
			supervisorSigned: !!r.supervisorSignedAt,
			lines: r.lines.map((l) => ({
				id: l.id,
				brigade: brigadeName(l.brigadeId),
				material: materialLabel(l.serviceCodeId),
				unit: materials.get(l.serviceCodeId)?.unit ?? null,
				qty: l.qty,
			})),
		})),
		returns: returns.map((r) => ({
			id: r.id,
			supervisor: r.requestedBy.name,
			brigade: brigadeName(r.brigadeId),
			material: materialLabel(r.serviceCodeId),
			unit: materials.get(r.serviceCodeId)?.unit ?? null,
			qty: r.qty,
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, rolesMatching(canReleaseToVan))
	const form = await request.formData()
	const id = String(form.get("id") ?? "")
	const result = await (async () => {
		switch (form.get("intent")) {
			case "ready":
				return markRestockReady(id, user.id)
			case "hand_over":
				return signPickup(id, user, "warehouse")
			case "confirm_return":
				return confirmReturn(id, user.id)
			default:
				return {
					ok: false as const,
					errorKey: "brigade_stock.errors.bad_intent",
				}
		}
	})()
	return result.ok ? { ok: true as const } : { errorKey: result.errorKey }
}

function RowAction({
	id,
	intent,
	label,
}: {
	id: string
	intent: string
	label: string
}) {
	const { t } = useTranslation()
	const fetcher = useFetcher<typeof action>()
	const errorKey =
		fetcher.data && "errorKey" in fetcher.data ? fetcher.data.errorKey : null
	return (
		<fetcher.Form method="post" className="flex flex-col gap-1">
			<input type="hidden" name="id" value={id} />
			<input type="hidden" name="intent" value={intent} />
			<Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
				{label}
			</Button>
			{errorKey && (
				<p role="alert" className="text-xs text-status-danger">
					{t(errorKey as never, errorKey)}
				</p>
			)}
		</fetcher.Form>
	)
}

export default function WarehouseBrigadeStock({
	loaderData,
}: Route.ComponentProps) {
	const { restocks, returns } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-6">
			<PageHeader
				title={t("brigade_stock.wh_title")}
				description={t("brigade_stock.wh_description")}
			/>
			<section className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t("brigade_stock.wh_requests")}
				</h2>
				{restocks.length === 0 && (
					<EmptyState>{t("brigade_stock.wh_no_requests")}</EmptyState>
				)}
				<ul className="space-y-2">
					{restocks.map((r) => (
						<li key={r.id} className="space-y-2 rounded-lg border p-3">
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant={r.status === "READY" ? "ok" : "info"}>
									{t(`brigade_stock.status.${r.status}`)}
								</Badge>
								<span className="text-sm">{r.supervisor}</span>
								<span className="text-xs text-muted-foreground">
									{new Date(r.requestedAt).toLocaleDateString()}
								</span>
							</div>
							<ul className="text-sm">
								{r.lines.map((l) => (
									<li key={l.id}>
										{l.brigade} · {l.material} · {l.qty} {l.unit ?? ""}
									</li>
								))}
							</ul>
							{r.status === "REQUESTED" && (
								<RowAction
									id={r.id}
									intent="ready"
									label={t("brigade_stock.wh_mark_ready")}
								/>
							)}
							{r.status === "READY" && !r.warehouseSigned && (
								<RowAction
									id={r.id}
									intent="hand_over"
									label={t("brigade_stock.wh_hand_over")}
								/>
							)}
							{r.status === "READY" && r.warehouseSigned && (
								<p className="text-xs text-muted-foreground">
									{t("brigade_stock.wh_waiting_supervisor")}
								</p>
							)}
						</li>
					))}
				</ul>
			</section>
			<section className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t("brigade_stock.wh_returns")}
				</h2>
				{returns.length === 0 && (
					<EmptyState>{t("brigade_stock.wh_no_returns")}</EmptyState>
				)}
				<ul className="space-y-2">
					{returns.map((r) => (
						<li
							key={r.id}
							className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
						>
							<span>
								{r.brigade} · {r.material} · {r.qty} {r.unit ?? ""} ·{" "}
								<span className="text-muted-foreground">{r.supervisor}</span>
							</span>
							<RowAction
								id={r.id}
								intent="confirm_return"
								label={t("brigade_stock.wh_confirm_return")}
							/>
						</li>
					))}
				</ul>
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
