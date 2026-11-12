import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { RestockHandOver } from "~/components/restock-hand-over"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { PageHeader } from "~/components/ui/page-header"
import {
	confirmReturn,
	handOverRestock,
	markRestockReady,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import { canReleaseToVan, rolesMatching } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	findPickupSigner,
	type PickupSignerGroup,
	pickupSignerGroups,
} from "~/lib/pickup-signer.server"
import type { Route } from "./+types/_app.warehouse.brigade-stock"

export const meta: Route.MetaFunction = () => [
	{ title: "Brigade restock — JAF Ops" },
]

/**
 * The warehouse side of brigade stock: prepare a supervisor's restock order
 * (Requested → Ready alerts the supervisor), hand it over (the brigade's crew
 * signs with the warehouse; the supervisor signs nothing) and confirm the
 * returns supervisors record. No prices.
 */

/** Who can sign for a restock: the people of every brigade it is for. */
async function signerGroupsFor(
	brigadeIds: string[],
): Promise<PickupSignerGroup[]> {
	if (brigadeIds.length === 0) return []
	const [brigades, crewUsers] = await Promise.all([
		db.brigade.findMany({
			where: { id: { in: brigadeIds } },
			select: {
				id: true,
				name: true,
				code: true,
				leadName: true,
				memberIds: true,
			},
		}),
		db.user.findMany({
			where: { role: "CREW", active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		}),
	])
	const inOrder = brigadeIds.flatMap((id) => {
		const b = brigades.find((x) => x.id === id)
		return b ? [b] : []
	})
	return pickupSignerGroups(inOrder, crewUsers)
}
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, rolesMatching(canReleaseToVan))
	const [restocks, returns, warehouseUsers] = await Promise.all([
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
		db.user.findMany({
			where: { role: "WAREHOUSE", active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		}),
	])
	const groupsByRestock = new Map(
		await Promise.all(
			restocks.map(
				async (r) =>
					[
						r.id,
						await signerGroupsFor([
							...new Set(r.lines.map((l) => l.brigadeId)),
						]),
					] as const,
			),
		),
	)
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
			number: r.number,
			status: r.status,
			supervisor: r.requestedBy.name,
			requestedAt: r.requestedAt.toISOString(),
			signerGroups: (groupsByRestock.get(r.id) ?? []).map((g) => ({
				brigadeId: g.brigadeId,
				brigadeName: g.brigadeName,
				brigadeCode: g.brigadeCode,
				signers: g.signers.map((x) => ({ key: x.key, name: x.name })),
			})),
			lines: r.lines.map((l) => ({
				id: l.id,
				brigade: brigadeName(l.brigadeId),
				material: materialLabel(l.serviceCodeId),
				unit: materials.get(l.serviceCodeId)?.unit ?? null,
				qty: l.qty,
			})),
		})),
		warehouseUsers,
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
			case "hand_over": {
				const restock = await db.brigadeRestock.findUnique({
					where: { id },
					include: { lines: true },
				})
				if (!restock)
					return {
						ok: false as const,
						errorKey: "brigade_stock.errors.not_found",
					}
				const groups = await signerGroupsFor([
					...new Set(restock.lines.map((l) => l.brigadeId)),
				])
				const crew = findPickupSigner(
					groups,
					String(form.get("crewSigner") ?? ""),
				)
				if (!crew)
					return {
						ok: false as const,
						errorKey: "brigade_stock.errors.crew_signer_required",
					}
				const releaser = await db.user.findFirst({
					where: {
						id: String(form.get("releasedById") ?? ""),
						role: "WAREHOUSE",
						active: true,
					},
					select: { id: true },
				})
				if (!releaser)
					return {
						ok: false as const,
						errorKey: "docs_sign.alerts.release_signer_required",
					}
				let lines: { lineId: string; givenQty: number; note?: string }[] = []
				try {
					lines = JSON.parse(String(form.get("lines") ?? "[]"))
				} catch {
					return {
						ok: false as const,
						errorKey: "brigade_stock.errors.bad_given",
					}
				}
				return handOverRestock({
					id,
					releasedById: releaser.id,
					crewSignerName: crew.name,
					crewSignerBrigadeId: crew.brigadeId,
					releaseSignature: String(form.get("releaseSignature") ?? ""),
					crewSignature: String(form.get("crewSignature") ?? ""),
					lines,
				})
			}
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

/** "Ready. Waiting for the crew…" with a Hand over button that opens the signing. */
function HandOver({
	restock,
	warehouseUsers,
}: {
	restock: { id: string } & Pick<
		Route.ComponentProps["loaderData"]["restocks"][number],
		"lines" | "signerGroups"
	>
	warehouseUsers: { id: string; name: string }[]
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">
				{t("brigade_stock.wh_waiting_crew")}
			</p>
			{open ? (
				<RestockHandOver
					id={restock.id}
					lines={restock.lines}
					warehouseUsers={warehouseUsers}
					signerGroups={restock.signerGroups}
				/>
			) : (
				<Button type="button" size="sm" onClick={() => setOpen(true)}>
					{t("brigade_stock.wh_hand_over")}
				</Button>
			)}
		</div>
	)
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
	const { restocks, returns, warehouseUsers } = loaderData
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
								{r.number && (
									<span className="font-mono text-sm font-medium">
										{r.number}
									</span>
								)}
								<span className="text-sm">{r.supervisor}</span>
								<span
									className="text-xs text-muted-foreground"
									suppressHydrationWarning
								>
									{new Date(r.requestedAt).toLocaleString()}
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
							{r.status === "READY" && (
								<HandOver restock={r} warehouseUsers={warehouseUsers} />
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
