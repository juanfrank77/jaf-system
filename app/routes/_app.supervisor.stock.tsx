import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link, useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import {
	DataTable,
	DataTableHead,
	Td,
	Th,
	Tr,
} from "~/components/ui/data-table"
import { EmptyState } from "~/components/ui/empty-state"
import { Input } from "~/components/ui/input"
import { PageHeader } from "~/components/ui/page-header"
import {
	brigadeBalances,
	cancelRestock,
	createRestock,
	recordCount,
	requestReturn,
	signPickup,
	supervisorBrigadeIds,
} from "~/lib/brigade-inventory.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.supervisor.stock"

export const meta: Route.MetaFunction = () => [
	{ title: "Restock & Brigade inventory — JAF Ops" },
]

const SELECT_CLASS =
	"flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"

/**
 * Restock & Brigade inventory: two tabs on one page. Restock request orders
 * material for any of the supervisor's brigades in one visit; Brigade
 * inventory shows each brigade's balance, with Count and Return. No prices.
 */
export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR"])
	const url = new URL(request.url)
	const tab =
		url.searchParams.get("tab") === "inventory" ? "inventory" : "restock"
	const filter = url.searchParams.get("brigade") || null
	const logKey = url.searchParams.get("log")

	const mineIds = await supervisorBrigadeIds(db, user.id)
	const [brigades, materials, restocks, balances, returns] = await Promise.all([
		db.brigade.findMany({
			where: { id: { in: mineIds } },
			select: { id: true, name: true, code: true },
			orderBy: { name: "asc" },
		}),
		db.serviceCode.findMany({
			where: { active: true, kind: "MATERIAL", serialized: false },
			select: { id: true, claroCode: true, name: true, unit: true },
			orderBy: { name: "asc" },
		}),
		db.brigadeRestock.findMany({
			where: { requestedById: user.id },
			include: { lines: true },
			orderBy: { requestedAt: "desc" },
			take: 20,
		}),
		brigadeBalances(db, mineIds),
		db.brigadeStockReturn.findMany({
			where: { brigadeId: { in: mineIds }, confirmedAt: null },
			orderBy: { requestedAt: "desc" },
		}),
	])

	const brigadeById = new Map(brigades.map((b) => [b.id, b]))
	const materialById = new Map(materials.map((m) => [m.id, m]))
	const [logBrigade, logCode] = logKey?.split("|") ?? []
	const log =
		logBrigade && logCode && brigadeById.has(logBrigade)
			? await db.brigadeStockMovement.findMany({
					where: { brigadeId: logBrigade, serviceCodeId: logCode },
					orderBy: { at: "desc" },
					take: 50,
				})
			: []

	return {
		tab,
		filter,
		brigades,
		materials,
		restocks: restocks.map((r) => ({
			id: r.id,
			status: r.status,
			requestedAt: r.requestedAt.toISOString(),
			supervisorSigned: !!r.supervisorSignedAt,
			warehouseSigned: !!r.warehouseSignedAt,
			lines: r.lines.map((l) => ({
				id: l.id,
				brigade: brigadeById.get(l.brigadeId)?.name ?? l.brigadeId,
				material: materialById.get(l.serviceCodeId)?.name ?? l.serviceCodeId,
				unit: materialById.get(l.serviceCodeId)?.unit ?? null,
				qty: l.qty,
			})),
		})),
		balances: balances
			.filter((b) => !filter || b.brigadeId === filter)
			.map((b) => ({
				brigadeId: b.brigadeId,
				brigade: brigadeById.get(b.brigadeId)?.name ?? b.brigadeId,
				code: brigadeById.get(b.brigadeId)?.code ?? null,
				serviceCodeId: b.serviceCodeId,
				material: materialById.get(b.serviceCodeId)?.name ?? b.serviceCodeId,
				unit: materialById.get(b.serviceCodeId)?.unit ?? null,
				balance: b.balance,
				lastCountAt: b.lastCountAt?.toISOString() ?? null,
			}))
			.sort((a, b) => a.brigade.localeCompare(b.brigade)),
		pendingReturns: returns.length,
		log: log.map((m) => ({
			id: m.id,
			type: m.type,
			qty: m.qty,
			countedQty: m.countedQty,
			expectedQty: m.expectedQty,
			reason: m.reason,
			at: m.at.toISOString(),
		})),
		logKey: log.length > 0 || logKey ? logKey : null,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR"])
	const form = await request.formData()
	const intent = String(form.get("intent") ?? "")
	const str = (k: string) => String(form.get(k) ?? "")
	const result = await (async () => {
		switch (intent) {
			case "create_restock": {
				const brigadeIds = form.getAll("brigadeId").map(String)
				const codes = form.getAll("serviceCodeId").map(String)
				const qtys = form.getAll("qty").map(String)
				const lines = brigadeIds
					.map((brigadeId, i) => ({
						brigadeId,
						serviceCodeId: codes[i] ?? "",
						qty: Number(qtys[i]),
					}))
					// A blank row is not a line.
					.filter((l) => l.brigadeId && l.serviceCodeId)
				return createRestock(user.id, lines)
			}
			case "cancel_restock":
				return cancelRestock(str("id"), user.id)
			case "sign_pickup":
				return signPickup(str("id"), user, "supervisor")
			case "count":
				return recordCount({
					brigadeId: str("brigadeId"),
					serviceCodeId: str("serviceCodeId"),
					counted: Number(str("counted")),
					reason: str("reason") || null,
					supervisorId: user.id,
				})
			case "return":
				return requestReturn({
					brigadeId: str("brigadeId"),
					serviceCodeId: str("serviceCodeId"),
					qty: Number(str("qty")),
					supervisorId: user.id,
				})
			default:
				return {
					ok: false as const,
					errorKey: "brigade_stock.errors.bad_intent",
				}
		}
	})()
	return result.ok ? { ok: true as const } : { errorKey: result.errorKey }
}

function Err({ data }: { data?: { errorKey?: string } | null }) {
	const { t } = useTranslation()
	if (!data?.errorKey) return null
	return (
		<p role="alert" className="text-xs text-status-danger">
			{t(data.errorKey as never, data.errorKey)}
		</p>
	)
}

const STATUS_VARIANT = {
	REQUESTED: "info",
	READY: "ok",
	PICKED_UP: "neutral",
	CANCELLED: "neutral",
} as const

type LoaderData = Route.ComponentProps["loaderData"]

function RestockForm({
	brigades,
	materials,
}: Pick<LoaderData, "brigades" | "materials">) {
	const { t } = useTranslation()
	const fetcher = useFetcher<typeof action>()
	const [rows, setRows] = useState([0])
	return (
		<fetcher.Form
			method="post"
			className="space-y-3 rounded-lg border p-4"
			onSubmit={() => setRows([0])}
		>
			<input type="hidden" name="intent" value="create_restock" />
			<h2 className="text-sm font-semibold">
				{t("brigade_stock.new_request")}
			</h2>
			{rows.map((key) => (
				<div key={key} className="grid gap-2 md:grid-cols-[1fr_2fr_6rem]">
					<select
						name="brigadeId"
						aria-label={t("brigade_stock.col_brigade")}
						className={SELECT_CLASS}
						defaultValue=""
					>
						<option value="">{t("brigade_stock.pick_brigade")}</option>
						{brigades.map((b) => (
							<option key={b.id} value={b.id}>
								{b.code ? `${b.code} ` : ""}
								{b.name}
							</option>
						))}
					</select>
					<select
						name="serviceCodeId"
						aria-label={t("brigade_stock.col_material")}
						className={SELECT_CLASS}
						defaultValue=""
					>
						<option value="">{t("brigade_stock.pick_material")}</option>
						{materials.map((m) => (
							<option key={m.id} value={m.id}>
								{m.claroCode} · {m.name}
								{m.unit ? ` (${m.unit})` : ""}
							</option>
						))}
					</select>
					<Input
						name="qty"
						type="number"
						min={1}
						step={1}
						aria-label={t("brigade_stock.col_qty")}
						placeholder={t("brigade_stock.col_qty")}
					/>
				</div>
			))}
			<div className="flex gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setRows((r) => [...r, (r.at(-1) ?? 0) + 1])}
				>
					{t("brigade_stock.add_line")}
				</Button>
				<Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
					{t("brigade_stock.send")}
				</Button>
			</div>
			<Err data={fetcher.data} />
		</fetcher.Form>
	)
}

function RestockCard({ r }: { r: LoaderData["restocks"][number] }) {
	const { t } = useTranslation()
	const fetcher = useFetcher<typeof action>()
	return (
		<li className="space-y-2 rounded-lg border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={STATUS_VARIANT[r.status]}>
					{t(`brigade_stock.status.${r.status}`)}
				</Badge>
				<span className="text-xs text-muted-foreground">
					{new Date(r.requestedAt).toLocaleDateString()}
				</span>
				{r.status === "READY" && (
					<span className="text-xs text-muted-foreground">
						{t("brigade_stock.signatures", {
							you: r.supervisorSigned ? "✓" : "–",
							warehouse: r.warehouseSigned ? "✓" : "–",
						})}
					</span>
				)}
			</div>
			<ul className="text-sm">
				{r.lines.map((l) => (
					<li key={l.id}>
						{l.brigade} · {l.material} · {l.qty} {l.unit ?? ""}
					</li>
				))}
			</ul>
			{(r.status === "READY" || r.status === "REQUESTED") && (
				<fetcher.Form method="post" className="flex flex-wrap gap-2">
					<input type="hidden" name="id" value={r.id} />
					{r.status === "READY" && !r.supervisorSigned && (
						<Button type="submit" name="intent" value="sign_pickup" size="sm">
							{t("brigade_stock.sign_pickup")}
						</Button>
					)}
					{!r.supervisorSigned && !r.warehouseSigned && (
						<Button
							type="submit"
							name="intent"
							value="cancel_restock"
							variant="outline"
							size="sm"
						>
							{t("brigade_stock.cancel")}
						</Button>
					)}
					<Err data={fetcher.data} />
				</fetcher.Form>
			)}
		</li>
	)
}

function InventoryActions({ row }: { row: LoaderData["balances"][number] }) {
	const { t } = useTranslation()
	const fetcher = useFetcher<typeof action>()
	const [mode, setMode] = useState<"count" | "return" | null>(null)
	return (
		<div className="space-y-1">
			<div className="flex gap-1">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setMode(mode === "count" ? null : "count")}
				>
					{t("brigade_stock.count")}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() => setMode(mode === "return" ? null : "return")}
				>
					{t("brigade_stock.return")}
				</Button>
			</div>
			{mode && (
				<fetcher.Form
					method="post"
					className="flex flex-wrap items-center gap-1"
					onSubmit={() => setMode(null)}
				>
					<input type="hidden" name="intent" value={mode} />
					<input type="hidden" name="brigadeId" value={row.brigadeId} />
					<input type="hidden" name="serviceCodeId" value={row.serviceCodeId} />
					<Input
						name={mode === "count" ? "counted" : "qty"}
						type="number"
						min={mode === "count" ? 0 : 1}
						step={1}
						required
						className="w-24"
						aria-label={t(
							mode === "count"
								? "brigade_stock.counted"
								: "brigade_stock.return_qty",
						)}
					/>
					{mode === "count" && (
						<Input
							name="reason"
							placeholder={t("brigade_stock.reason")}
							className="w-40"
						/>
					)}
					<Button type="submit" size="sm">
						{t("brigade_stock.save")}
					</Button>
				</fetcher.Form>
			)}
			<Err data={fetcher.data} />
		</div>
	)
}

export default function SupervisorStock({ loaderData }: Route.ComponentProps) {
	const { tab, brigades, materials, restocks, balances, filter, log, logKey } =
		loaderData
	const { t } = useTranslation()
	const tabLink = (to: string, active: boolean, label: string) => (
		<Link
			to={to}
			aria-current={active ? "page" : undefined}
			className={`rounded-md px-3 py-1.5 text-sm ${
				active ? "bg-primary text-primary-foreground" : "bg-muted"
			}`}
		>
			{label}
		</Link>
	)
	return (
		<div className="space-y-4">
			<PageHeader
				title={t("brigade_stock.title")}
				description={t("brigade_stock.description")}
			/>
			<nav className="flex gap-2">
				{tabLink(
					"?tab=restock",
					tab === "restock",
					t("brigade_stock.tab_restock"),
				)}
				{tabLink(
					"?tab=inventory",
					tab === "inventory",
					t("brigade_stock.tab_inventory"),
				)}
			</nav>

			{tab === "restock" && (
				<div className="space-y-4">
					{brigades.length === 0 ? (
						<EmptyState>{t("brigade_stock.no_brigades")}</EmptyState>
					) : (
						<RestockForm brigades={brigades} materials={materials} />
					)}
					<p className="text-xs text-muted-foreground">
						{t("brigade_stock.flow")}
					</p>
					{restocks.length > 0 && (
						<ul className="space-y-2">
							{restocks.map((r) => (
								<RestockCard key={r.id} r={r} />
							))}
						</ul>
					)}
				</div>
			)}

			{tab === "inventory" && (
				<div className="space-y-3">
					<form method="get" className="flex items-end gap-2">
						<input type="hidden" name="tab" value="inventory" />
						<select
							name="brigade"
							defaultValue={filter ?? ""}
							aria-label={t("brigade_stock.filter")}
							className={`${SELECT_CLASS} max-w-xs`}
						>
							<option value="">{t("brigade_stock.all_brigades")}</option>
							{brigades.map((b) => (
								<option key={b.id} value={b.id}>
									{b.code ? `${b.code} ` : ""}
									{b.name}
								</option>
							))}
						</select>
						<Button type="submit" variant="outline" size="sm">
							{t("brigade_stock.apply")}
						</Button>
					</form>
					<NewCountForm brigades={brigades} materials={materials} />
					{balances.length === 0 ? (
						<EmptyState>{t("brigade_stock.no_balances")}</EmptyState>
					) : (
						<DataTable>
							<DataTableHead>
								<Th>{t("brigade_stock.col_brigade")}</Th>
								<Th>{t("brigade_stock.col_material")}</Th>
								<Th>{t("brigade_stock.col_balance")}</Th>
								<Th className="hidden md:table-cell">
									{t("brigade_stock.col_last_count")}
								</Th>
								<Th>{null}</Th>
							</DataTableHead>
							<tbody>
								{balances.map((b) => (
									<Tr key={`${b.brigadeId}|${b.serviceCodeId}`}>
										<Td>
											{b.code ? `${b.code} ` : ""}
											{b.brigade}
										</Td>
										<Td>
											<Link
												to={`?tab=inventory&log=${b.brigadeId}|${b.serviceCodeId}`}
												className="underline"
											>
												{b.material}
											</Link>
										</Td>
										<Td className={b.balance < 0 ? "text-status-danger" : ""}>
											{b.balance} {b.unit ?? ""}
										</Td>
										<Td className="hidden text-muted-foreground md:table-cell">
											{b.lastCountAt
												? new Date(b.lastCountAt).toLocaleDateString()
												: "—"}
										</Td>
										<Td>
											<InventoryActions row={b} />
										</Td>
									</Tr>
								))}
							</tbody>
						</DataTable>
					)}
					{logKey && (
						<section className="space-y-1">
							<h2 className="text-sm font-semibold">
								{t("brigade_stock.log")}
							</h2>
							{log.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("brigade_stock.no_log")}
								</p>
							) : (
								<ul className="text-sm">
									{log.map((m) => (
										<li key={m.id}>
											{new Date(m.at).toLocaleDateString()} ·{" "}
											{t(`brigade_stock.type.${m.type}`)}{" "}
											{m.qty > 0 ? `+${m.qty}` : m.qty}
											{m.countedQty != null &&
												` (${t("brigade_stock.counted_of", {
													counted: m.countedQty,
													expected: m.expectedQty ?? 0,
												})})`}
											{m.reason ? ` · "${m.reason}"` : ""}
										</li>
									))}
								</ul>
							)}
						</section>
					)}
				</div>
			)}
		</div>
	)
}

/** The first count of a material for a brigade is its opening count. */
function NewCountForm({
	brigades,
	materials,
}: Pick<LoaderData, "brigades" | "materials">) {
	const { t } = useTranslation()
	const fetcher = useFetcher<typeof action>()
	return (
		<fetcher.Form
			method="post"
			className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_2fr_6rem_auto]"
		>
			<input type="hidden" name="intent" value="count" />
			<select
				name="brigadeId"
				required
				aria-label={t("brigade_stock.col_brigade")}
				className={SELECT_CLASS}
				defaultValue=""
			>
				<option value="">{t("brigade_stock.pick_brigade")}</option>
				{brigades.map((b) => (
					<option key={b.id} value={b.id}>
						{b.code ? `${b.code} ` : ""}
						{b.name}
					</option>
				))}
			</select>
			<select
				name="serviceCodeId"
				required
				aria-label={t("brigade_stock.col_material")}
				className={SELECT_CLASS}
				defaultValue=""
			>
				<option value="">{t("brigade_stock.pick_material")}</option>
				{materials.map((m) => (
					<option key={m.id} value={m.id}>
						{m.claroCode} · {m.name}
					</option>
				))}
			</select>
			<Input
				name="counted"
				type="number"
				min={0}
				step={1}
				required
				aria-label={t("brigade_stock.counted")}
				placeholder={t("brigade_stock.counted")}
			/>
			<Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
				{t("brigade_stock.opening_count")}
			</Button>
			<div className="md:col-span-4">
				<Err data={fetcher.data} />
			</div>
		</fetcher.Form>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
