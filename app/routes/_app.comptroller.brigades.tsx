import { Fragment, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	BrigadeImportError,
	type BrigadeImportRow,
	parseBrigadeImportFile,
} from "~/lib/brigade-import"
import {
	applyBrigadeImport,
	BrigadeImportStaleError,
} from "~/lib/brigade-import-apply.server"
import {
	type BrigadeImportPlan,
	planBrigadeImport,
} from "~/lib/brigade-import-plan"
import { syncContractorAccount } from "~/lib/contractor-account-sync"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ALL_AREAS } from "~/lib/supervisor-scope"
import type { Route } from "./+types/_app.comptroller.brigades"

type CrewUser = { id: string; name: string; active: boolean }

/** Shared area `<select>` for the brigade create and edit forms. */
function BrigadeAreaSelect({
	id,
	defaultValue,
	areaOptions,
}: {
	id: string
	defaultValue?: string
	areaOptions: string[]
}) {
	const { t } = useTranslation()
	return (
		<>
			<Label htmlFor={id}>{t("comptroller_brigades.area_label")}</Label>
			<select
				id={id}
				name="area"
				required
				defaultValue={defaultValue}
				className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
			>
				{areaOptions.map((a) => (
					<option key={a} value={a}>
						{a}
					</option>
				))}
			</select>
		</>
	)
}

/** Shared member-checkbox list for the brigade create and edit forms. */
function BrigadeMemberList({
	idPrefix,
	crewUsers,
	selectedIds,
	gridCols,
}: {
	idPrefix: string
	crewUsers: CrewUser[]
	selectedIds: string[]
	gridCols: string
}) {
	const { t } = useTranslation()
	return (
		<>
			<p className="text-sm font-medium">
				{t("comptroller_brigades.members_label")}
			</p>
			<p className="text-xs text-muted-foreground">
				{t("comptroller_brigades.members_hint")}
			</p>
			<div className={`grid grid-cols-1 gap-2 ${gridCols}`}>
				{crewUsers.map((u) => (
					<label
						key={u.id}
						htmlFor={`${idPrefix}-${u.id}`}
						className="flex items-center gap-2 text-sm"
					>
						<Checkbox
							id={`${idPrefix}-${u.id}`}
							name="memberIds"
							value={u.id}
							defaultChecked={selectedIds.includes(u.id)}
						/>
						<span>
							{u.name}{" "}
							<span className="text-muted-foreground">
								(
								{u.active
									? t("comptroller_brigades.active")
									: t("comptroller_brigades.inactive")}
								)
							</span>
						</span>
					</label>
				))}
			</div>
		</>
	)
}

export const meta: Route.MetaFunction = () => [{ title: "Brigades — JAF Ops" }]

/**
 * Brigade management belongs to the Comptroller (she pays the brigades and
 * decides who is added or deactivated). Supervisors get a read-only view at
 * `/supervisor/brigades`. Admin keeps access too.
 */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])

	const [brigades, crewUsers] = await Promise.all([
		db.brigade.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "CREW" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true },
		}),
	])

	return { brigades, crewUsers, areaOptions: [...ALL_AREAS] }
}

const isP2002 = (error: unknown) =>
	!!error &&
	typeof error === "object" &&
	"code" in error &&
	(error as { code?: string }).code === "P2002"

const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const MAX_IMPORT_ROWS = 2000
const ERR = "comptroller_brigades.errors."

const importError = (key: string) =>
	data({ errorKey: `${ERR}${key}`, scope: "import" as const }, { status: 400 })

const str = (v: unknown, max: number): v is string =>
	typeof v === "string" && v.length <= max
const strOrNull = (v: unknown, max: number): v is string | null =>
	v === null || str(v, max)

/** The hidden `rows` field is user input: check its shape and size strictly. */
function parseImportRows(raw: unknown): BrigadeImportRow[] | null {
	if (typeof raw !== "string") return null
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!Array.isArray(parsed) || parsed.length > MAX_IMPORT_ROWS) return null
	const rows: BrigadeImportRow[] = []
	for (const r of parsed) {
		if (!r || typeof r !== "object") return null
		const o = r as Record<string, unknown>
		if (
			!str(o.code, 64) ||
			!o.code.trim() ||
			!str(o.name, 200) ||
			!strOrNull(o.baseCode, 64) ||
			typeof o.isEquipmentAccount !== "boolean" ||
			(o.status !== "ACTIVE" && o.status !== "INACTIVE") ||
			!strOrNull(o.typeHint, 500) ||
			!strOrNull(o.checkWithLissette, 500) ||
			(o.warning !== undefined && o.warning !== "numeric_code")
		) {
			return null
		}
		rows.push({
			code: o.code,
			name: o.name,
			baseCode: o.baseCode,
			isEquipmentAccount: o.isEquipmentAccount,
			status: o.status,
			typeHint: o.typeHint,
			checkWithLissette: o.checkWithLissette,
			...(o.warning ? { warning: "numeric_code" as const } : {}),
		})
	}
	return rows
}

export type BrigadeImportPreview = {
	rows: BrigadeImportRow[]
	plan: BrigadeImportPlan
	/** Every existing brigade not matched by code, with its choices. */
	brigades: {
		id: string
		name: string
		code: string | null
		selected: string
		options: { code: string; name: string; suggested: boolean }[]
	}[]
}

function buildPreview(
	rows: BrigadeImportRow[],
	existing: { id: string; name: string; code: string | null }[],
	overrides: Record<string, string> = {},
): BrigadeImportPreview {
	const plan = planBrigadeImport(rows, existing, overrides)
	const csvCodes = new Set(rows.map((r) => r.code))
	const claimed = new Set(
		existing.map((b) => b.code).filter((c): c is string => !!c),
	)
	const targets: BrigadeImportRow[] = []
	const seen = new Set<string>()
	for (const r of rows) {
		if (r.isEquipmentAccount || claimed.has(r.code) || seen.has(r.code))
			continue
		seen.add(r.code)
		targets.push(r)
	}
	const brigades = existing
		.filter((b) => !(b.code && csvCodes.has(b.code)))
		.map((b) => {
			const suggested = new Set(
				plan.suggestions
					.filter((s) => s.brigadeId === b.id)
					.map((s) => s.csvCode),
			)
			const named = plan.recodes.find(
				(r) => r.brigadeId === b.id && r.confidence === "name",
			)
			const ordered = [
				...targets.filter((r) => suggested.has(r.code)),
				...targets.filter((r) => !suggested.has(r.code)),
			]
			return {
				id: b.id,
				name: b.name,
				code: b.code,
				selected: named?.to ?? "",
				options: ordered.map((r) => ({
					code: r.code,
					name: r.name,
					suggested: suggested.has(r.code),
				})),
			}
		})
	return { rows, plan, brigades }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "import_preview") {
		const file = form.get("file")
		if (!(file instanceof File) || file.size === 0) {
			return importError("import_empty")
		}
		if (file.size > MAX_IMPORT_BYTES) return importError("import_too_large")
		let rows: BrigadeImportRow[]
		try {
			rows = await parseBrigadeImportFile(
				file.name,
				new Uint8Array(await file.arrayBuffer()),
			)
		} catch (error) {
			if (error instanceof BrigadeImportError)
				return importError(error.key.replace(ERR, ""))
			return importError("import_unreadable")
		}
		// The apply refuses more rows than this: never preview what can't apply.
		if (rows.length > MAX_IMPORT_ROWS) return importError("import_too_large")
		const existing = await db.brigade.findMany({
			select: { id: true, name: true, code: true },
			orderBy: { name: "asc" },
		})
		return { preview: buildPreview(rows, existing) }
	}

	if (intent === "import_apply") {
		const rows = parseImportRows(form.get("rows"))
		if (!rows) return importError("import_invalid")
		const overrides: Record<string, string> = {}
		for (const [key, value] of form.entries()) {
			if (key.startsWith("override-") && typeof value === "string") {
				overrides[key.slice("override-".length)] = value
			}
		}
		const existing = await db.brigade.findMany({
			select: { id: true, name: true, code: true },
		})
		try {
			const plan = planBrigadeImport(rows, existing, overrides)
			const applied = await applyBrigadeImport(db, plan, user.id)
			return { applied, ignoredOverrides: plan.ignoredOverrides }
		} catch (error) {
			if (error instanceof BrigadeImportStaleError) {
				return importError("import_stale")
			}
			throw error
		}
	}

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const areaRaw = form.get("area")
		const code = form.get("code")
		const memberIds = form.getAll("memberIds")
		const active = form.get("active") === "on"
		const area = typeof areaRaw === "string" ? areaRaw.trim() : ""

		if (
			typeof name !== "string" ||
			!name.trim() ||
			!(ALL_AREAS as readonly string[]).includes(area) ||
			!memberIds.every((m): m is string => typeof m === "string")
		) {
			return data(
				{ errorKey: "comptroller_brigades.errors.invalid_fields" },
				{ status: 400 },
			)
		}

		// Branch on the stated intent, not on whether a lookup happened to
		// find something — an update with no usable id must fail as an
		// update, never silently become a create.
		if (intent === "update" && (typeof id !== "string" || !id.trim())) {
			return data(
				{ errorKey: "comptroller_brigades.errors.id_required" },
				{ status: 400 },
			)
		}
		let existing: Awaited<ReturnType<typeof db.brigade.findUnique>> = null
		if (intent === "update" && typeof id === "string") {
			existing = await db.brigade.findUnique({ where: { id } })
			if (!existing) {
				return data(
					{ errorKey: "comptroller_brigades.errors.id_required" },
					{ status: 400 },
				)
			}
		}

		const existingMemberIds = existing?.memberIds ?? []
		const newMemberIds = (memberIds as string[]).filter(
			(m) => !existingMemberIds.includes(m),
		)
		if (newMemberIds.length > 0) {
			const validMembers = await db.user.findMany({
				where: { id: { in: newMemberIds }, role: "CREW", active: true },
				select: { id: true },
			})
			if (validMembers.length !== new Set(newMemberIds).size) {
				return data(
					{ errorKey: "comptroller_brigades.errors.invalid_fields" },
					{ status: 400 },
				)
			}
		}

		try {
			const payload = {
				name: name.trim(),
				memberIds: memberIds as string[],
				area,
				code: typeof code === "string" && code.trim() ? code.trim() : null,
			}
			// An update keeps the brigade's existing owner (`supervisorId`) and
			// its active flag: only the toggle button changes that.
			const saved = existing
				? await db.brigade.update({ where: { id: existing.id }, data: payload })
				: await db.brigade.create({ data: { ...payload, active } })
			await syncContractorAccount(db, saved)
		} catch (error) {
			if (isP2002(error)) {
				return data(
					{ errorKey: "comptroller_brigades.errors.duplicate_code" },
					{ status: 400 },
				)
			}
			throw error
		}
		return redirect("/comptroller/brigades")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "comptroller_brigades.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.brigade.findUnique({ where: { id } })
		if (!existing) {
			return data(
				{ errorKey: "comptroller_brigades.errors.id_required" },
				{ status: 400 },
			)
		}
		const toggled = await db.brigade.update({
			where: { id },
			data: { active: !existing.active },
		})
		await syncContractorAccount(db, toggled)
		return redirect("/comptroller/brigades")
	}

	return data(
		{ errorKey: "comptroller_brigades.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function ComptrollerBrigades({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { brigades, crewUsers, areaOptions } = loaderData as {
		brigades: {
			id: string
			name: string
			memberIds: string[]
			active: boolean
			area: string | null
			code: string | null
		}[]
		crewUsers: CrewUser[]
		areaOptions: string[]
	}
	const { t } = useTranslation()
	const importResult = (actionData ?? {}) as {
		errorKey?: string
		scope?: string
		preview?: BrigadeImportPreview
		applied?: { created: number; recoded: number; keptAccounts?: string[] }
		ignoredOverrides?: BrigadeImportPlan["ignoredOverrides"]
	}
	const importFailed = importResult.scope === "import"
	const error =
		!importFailed && actionData && "errorKey" in actionData
			? (actionData.errorKey as string)
			: null
	const [editingId, setEditingId] = useState<string | null>(null)
	const hasImportResult =
		importFailed || !!importResult.preview || !!importResult.applied
	const [showImport, setShowImport] = useState(hasImportResult)
	useEffect(() => {
		if (hasImportResult) setShowImport(true)
	}, [hasImportResult])
	const navigation = useNavigation()
	// A finished save (or toggle) collapses the open edit form; a failed one
	// keeps it open so the error stays next to the fields.
	useEffect(() => {
		if (navigation.state === "idle" && !error) setEditingId(null)
	}, [navigation.state, error])

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">
				{t("comptroller_brigades.title")}
			</h1>

			<section className="bg-card border rounded-lg p-6 space-y-4">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-base font-medium">
						{t("comptroller_brigades.add_heading")}
					</h2>
					<Button
						type="button"
						variant="outline"
						size="sm"
						aria-expanded={showImport}
						onClick={() => setShowImport((v) => !v)}
					>
						{t("comptroller_brigades.import.button")}
					</Button>
				</div>
				{showImport && (
					<ImportPanel
						errorKey={importFailed ? (importResult.errorKey ?? null) : null}
						preview={importResult.preview ?? null}
						applied={importResult.applied ?? null}
						ignoredOverrides={importResult.ignoredOverrides ?? []}
					/>
				)}
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="space-y-1">
						<Label htmlFor="name">{t("comptroller_brigades.name_label")}</Label>
						<Input id="name" name="name" required />
					</div>
					<div className="space-y-1">
						<BrigadeAreaSelect id="area" areaOptions={areaOptions} />
					</div>
					<div className="space-y-1">
						<Label htmlFor="code">{t("comptroller_brigades.code_label")}</Label>
						<Input id="code" name="code" />
					</div>
					<div className="space-y-2">
						<BrigadeMemberList
							idPrefix="member"
							crewUsers={crewUsers}
							selectedIds={[]}
							gridCols="sm:grid-cols-2"
						/>
					</div>
					<div className="flex items-start gap-2">
						<Checkbox
							id="active"
							name="active"
							defaultChecked
							aria-describedby="active-hint"
							className="mt-0.5"
						/>
						<div className="space-y-0.5">
							<Label htmlFor="active" className="text-sm">
								{t("comptroller_brigades.active_label")}
							</Label>
							<p id="active-hint" className="text-xs text-muted-foreground">
								{t("comptroller_brigades.active_hint")}
							</p>
						</div>
					</div>
					<Button type="submit">{t("comptroller_brigades.add_submit")}</Button>
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
				</Form>
			</section>

			<section className="bg-card border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-muted border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.area")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.members")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("comptroller_brigades.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("comptroller_brigades.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{brigades.map((brigade) => {
							const members = crewUsers.filter((u) =>
								brigade.memberIds.includes(u.id),
							)
							const editing = editingId === brigade.id
							return (
								<Fragment key={brigade.id}>
									<tr className="hover:bg-muted">
										<td className="px-4 py-3 font-medium">
											{brigade.code ? (
												<span className="font-mono">{brigade.code} </span>
											) : null}
											{brigade.name}
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{brigade.area}
										</td>
										<td
											className={
												brigade.active && members.length === 0
													? "px-4 py-3 font-medium text-status-warn"
													: "px-4 py-3 text-muted-foreground"
											}
										>
											{members.map((m) => m.name).join(", ") ||
												t("comptroller_brigades.no_members")}
										</td>
										<td className="px-4 py-3 text-center">
											<span
												className={
													brigade.active
														? "text-status-ok font-medium"
														: "text-muted-foreground"
												}
											>
												{brigade.active
													? t("comptroller_brigades.yes")
													: t("comptroller_brigades.no")}
											</span>
										</td>
										<td className="px-4 py-3 text-center">
											<div className="flex items-center justify-center gap-2">
												<Form method="post">
													<input type="hidden" name="intent" value="toggle" />
													<input type="hidden" name="id" value={brigade.id} />
													<Button type="submit" variant="outline" size="sm">
														{brigade.active
															? t("comptroller_brigades.deactivate")
															: t("comptroller_brigades.activate")}
													</Button>
												</Form>
												<Button
													type="button"
													variant="outline"
													size="sm"
													aria-expanded={editing}
													onClick={() =>
														setEditingId(editing ? null : brigade.id)
													}
												>
													{t("comptroller_brigades.edit")}
												</Button>
											</div>
										</td>
									</tr>
									{editing && (
										<tr>
											<td colSpan={5} className="bg-muted/40 px-4 py-4">
												<EditBrigadeForm
													brigade={brigade}
													crewUsers={crewUsers}
													areaOptions={areaOptions}
													error={error}
													onCancel={() => setEditingId(null)}
												/>
											</td>
										</tr>
									)}
								</Fragment>
							)
						})}
						{brigades.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-4 py-6 text-center text-muted-foreground text-sm"
								>
									{t("comptroller_brigades.no_brigades")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

function ImportPanel({
	errorKey,
	preview,
	applied,
	ignoredOverrides,
}: {
	errorKey: string | null
	preview: BrigadeImportPreview | null
	applied: {
		created: number
		recoded: number
		keptAccounts?: string[]
	} | null
	ignoredOverrides: BrigadeImportPlan["ignoredOverrides"]
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const busy = navigation.state !== "idle"
	return (
		<div className="space-y-4 border-t pt-4" data-testid="brigade-import">
			<Form method="post" encType="multipart/form-data" className="space-y-2">
				<input type="hidden" name="intent" value="import_preview" />
				<Label htmlFor="import-file">
					{t("comptroller_brigades.import.file_label")}
				</Label>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						id="import-file"
						name="file"
						type="file"
						accept=".csv,.xlsx"
						required
						className="max-w-xs"
					/>
					<Button type="submit" size="sm" disabled={busy}>
						{t("comptroller_brigades.import.preview_submit")}
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					{t("comptroller_brigades.import.file_hint")}
				</p>
			</Form>
			{errorKey && (
				<p className="text-sm text-status-danger" role="alert">
					{t(errorKey as never)}
				</p>
			)}
			{applied && (
				<p className="text-sm text-status-ok" role="status">
					{t("comptroller_brigades.import.result", {
						created: applied.created,
						recoded: applied.recoded,
					})}
				</p>
			)}
			{applied?.keptAccounts && applied.keptAccounts.length > 0 && (
				<div className="text-sm text-status-warn space-y-1" role="alert">
					<p>{t("comptroller_brigades.import.kept_accounts_heading")}</p>
					<ul className="list-disc pl-5">
						{applied.keptAccounts.map((code) => (
							<li key={code} className="font-mono">
								{code}
							</li>
						))}
					</ul>
				</div>
			)}
			{ignoredOverrides.length > 0 && (
				<div className="text-sm text-status-warn space-y-1" role="alert">
					<p>{t("comptroller_brigades.import.ignored_heading")}</p>
					<ul className="list-disc pl-5">
						{ignoredOverrides.map((o) => (
							<li key={`${o.brigadeId}-${o.code}`}>
								{o.code}:{" "}
								{t(`comptroller_brigades.import.ignored.${o.reason}` as never)}
							</li>
						))}
					</ul>
				</div>
			)}
			{preview && <ImportPreview preview={preview} />}
		</div>
	)
}

function ImportPreview({ preview }: { preview: BrigadeImportPreview }) {
	const { t } = useTranslation()
	const { plan, brigades, rows } = preview
	const equipment = plan.creates.filter((r) => r.isEquipmentAccount).length
	const recodeCount = plan.recodes.length
	return (
		<Form method="post" className="space-y-4">
			<input type="hidden" name="intent" value="import_apply" />
			<input type="hidden" name="rows" value={JSON.stringify(rows)} />
			<h3 className="text-sm font-medium">
				{t("comptroller_brigades.import.preview_heading")}
			</h3>
			<ul className="text-sm space-y-1">
				<li>
					{t("comptroller_brigades.import.will_create", {
						total: plan.creates.length,
						equipment,
					})}
				</li>
				<li>
					{t("comptroller_brigades.import.will_recode", { total: recodeCount })}
				</li>
				<li>
					{t("comptroller_brigades.import.flagged_count", {
						total: plan.flagged.length,
					})}
				</li>
				<li>
					{t("comptroller_brigades.import.skipped_count", {
						total: plan.skipped.length,
					})}
				</li>
			</ul>
			<p className="text-xs text-muted-foreground">
				{t("comptroller_brigades.import.inactive_note")}
			</p>

			{plan.flagged.length > 0 && (
				<div className="space-y-1">
					<h4 className="text-sm font-medium">
						{t("comptroller_brigades.import.flagged_heading")}
					</h4>
					<ul className="text-sm space-y-1">
						{plan.flagged.map((r) => (
							<li key={r.code}>
								<span className="font-medium">{r.code}</span> {r.name}
								{r.typeHint && (
									<span className="text-muted-foreground"> · {r.typeHint}</span>
								)}
								{r.checkWithLissette && (
									<span className="text-status-warn">
										{" "}
										· {r.checkWithLissette}
									</span>
								)}
								{r.warning === "numeric_code" && (
									<span className="text-status-warn">
										{" "}
										· {t("comptroller_brigades.import.numeric_code_warning")}
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{brigades.length > 0 && (
				<div className="space-y-2">
					<h4 className="text-sm font-medium">
						{t("comptroller_brigades.import.match_heading")}
					</h4>
					<p className="text-xs text-muted-foreground">
						{t("comptroller_brigades.import.match_hint")}
					</p>
					<div className="space-y-2">
						{brigades.map((b) => {
							const suggested = b.options.filter((o) => o.suggested)
							const others = b.options.filter((o) => !o.suggested)
							return (
								<div
									key={b.id}
									className="grid gap-1 md:grid-cols-[1fr_2fr] md:items-center"
								>
									<Label htmlFor={`override-${b.id}`} className="text-sm">
										{b.name}{" "}
										<span className="text-muted-foreground">
											({b.code ?? t("comptroller_brigades.import.no_code")})
										</span>
									</Label>
									<select
										id={`override-${b.id}`}
										name={`override-${b.id}`}
										defaultValue={b.selected}
										className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
									>
										<option value="">
											{t("comptroller_brigades.import.leave_alone")}
										</option>
										{suggested.length > 0 && (
											<optgroup
												label={t("comptroller_brigades.import.suggested")}
											>
												{suggested.map((o) => (
													<option key={o.code} value={o.code}>
														{o.code} · {o.name}
													</option>
												))}
											</optgroup>
										)}
										{others.map((o) => (
											<option key={o.code} value={o.code}>
												{o.code} · {o.name}
											</option>
										))}
									</select>
								</div>
							)
						})}
					</div>
				</div>
			)}

			<Button type="submit">{t("comptroller_brigades.import.confirm")}</Button>
		</Form>
	)
}

function EditBrigadeForm({
	brigade,
	crewUsers,
	areaOptions,
	error,
	onCancel,
}: {
	brigade: {
		id: string
		name: string
		memberIds: string[]
		active: boolean
		area: string | null
		code: string | null
	}
	crewUsers: CrewUser[]
	areaOptions: string[]
	error: string | null
	onCancel: () => void
}) {
	const { t } = useTranslation()
	return (
		<Form method="post" className="space-y-4 text-left">
			<input type="hidden" name="intent" value="update" />
			<input type="hidden" name="id" value={brigade.id} />
			<div className="grid gap-3 md:grid-cols-3">
				<div className="space-y-1">
					<Label htmlFor={`name-${brigade.id}`}>
						{t("comptroller_brigades.name_label")}
					</Label>
					<Input
						id={`name-${brigade.id}`}
						name="name"
						defaultValue={brigade.name}
						required
					/>
				</div>
				<div className="space-y-1">
					<BrigadeAreaSelect
						id={`area-${brigade.id}`}
						defaultValue={brigade.area ?? ""}
						areaOptions={areaOptions}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`code-${brigade.id}`}>
						{t("comptroller_brigades.code_label")}
					</Label>
					<Input
						id={`code-${brigade.id}`}
						name="code"
						defaultValue={brigade.code ?? ""}
					/>
				</div>
			</div>
			<div className="space-y-2">
				<BrigadeMemberList
					idPrefix={`member-${brigade.id}`}
					crewUsers={crewUsers}
					selectedIds={brigade.memberIds}
					gridCols="sm:grid-cols-2 lg:grid-cols-3"
				/>
			</div>
			<div className="flex items-center gap-2">
				<Button type="submit" size="sm">
					{t("comptroller_brigades.save")}
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					{t("comptroller_brigades.cancel")}
				</Button>
			</div>
			{error && (
				<p className="text-sm text-status-danger">{t(error as never)}</p>
			)}
		</Form>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
