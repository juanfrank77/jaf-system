import { Fragment, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { data, Form, redirect, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { syncContractorAccount } from "~/lib/contractor-account-sync"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ALL_AREAS } from "~/lib/supervisor-scope"
import type { Route } from "./+types/_app.comptroller.brigades"

type Supervisor = { id: string; name: string }

export const meta: Route.MetaFunction = () => [{ title: "Brigades — JAF Ops" }]

/**
 * Brigade management belongs to the Comptroller (she pays the brigades and
 * decides who is added or deactivated). Supervisors get a read-only view at
 * `/supervisor/brigades`. Admin keeps access too.
 */
export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])

	const [brigades, supervisors] = await Promise.all([
		db.brigade.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "SUPERVISOR", active: true },
			orderBy: { name: "asc" },
			select: { id: true, name: true },
		}),
	])

	return { brigades, supervisors, areaOptions: [...ALL_AREAS] }
}

const isP2002 = (error: unknown) =>
	!!error &&
	typeof error === "object" &&
	"code" in error &&
	(error as { code?: string }).code === "P2002"

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const areaRaw = form.get("area")
		const code = form.get("code")
		const supervisorRaw = form.get("supervisorId")
		const active = form.get("active") === "on"
		const area = typeof areaRaw === "string" ? areaRaw.trim() : ""

		if (
			typeof name !== "string" ||
			!name.trim() ||
			!(ALL_AREAS as readonly string[]).includes(area) ||
			// The Acct # is what the journal prints and Carmen pays by.
			typeof code !== "string" ||
			!code.trim()
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

		const supervisorId =
			typeof supervisorRaw === "string" && supervisorRaw.trim()
				? supervisorRaw.trim()
				: null
		if (supervisorId) {
			const ok = await db.user.count({
				where: { id: supervisorId, role: "SUPERVISOR", active: true },
			})
			if (ok === 0) {
				return data(
					{ errorKey: "comptroller_brigades.errors.invalid_fields" },
					{ status: 400 },
				)
			}
		}

		try {
			const payload = {
				name: name.trim(),
				area,
				code: code.trim(),
				supervisorId,
			}
			// Crews have no logins, so Members is no longer edited here: whatever
			// is stored stays. An update keeps the active flag: only the toggle
			// button changes that.
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
	const { brigades, supervisors, areaOptions } = loaderData as {
		brigades: {
			id: string
			name: string
			active: boolean
			area: string | null
			code: string | null
			supervisorId: string | null
		}[]
		supervisors: Supervisor[]
		areaOptions: string[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const [editingId, setEditingId] = useState<string | null>(null)
	const [adding, setAdding] = useState(false)
	const navigation = useNavigation()
	// A finished save (or toggle) collapses the open edit form; a failed one
	// keeps it open so the error stays next to the fields.
	useEffect(() => {
		if (navigation.state === "idle" && !error) {
			setEditingId(null)
			setAdding(false)
		}
	}, [navigation.state, error])

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("comptroller_brigades.title")}
				</h1>
				<Button type="button" onClick={() => setAdding((v) => !v)}>
					{t("comptroller_brigades.add_button")}
				</Button>
			</div>

			{adding && (
				<section className="bg-card border rounded-lg p-6 space-y-4">
					<h2 className="text-base font-medium">
						{t("comptroller_brigades.add_heading")}
					</h2>
					<Form method="post" className="space-y-4">
						<input type="hidden" name="intent" value="create" />
						<div className="space-y-1">
							<Label htmlFor="name">
								{t("comptroller_brigades.name_label")}
							</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="area">
								{t("comptroller_brigades.area_label")}
							</Label>
							<select
								id="area"
								name="area"
								required
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
							>
								{areaOptions.map((a) => (
									<option key={a} value={a}>
										{a}
									</option>
								))}
							</select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="code">
								{t("comptroller_brigades.code_label")}
							</Label>
							<Input id="code" name="code" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="supervisorId">
								{t("comptroller_brigades.supervisor_label")}
							</Label>
							<select
								id="supervisorId"
								name="supervisorId"
								className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
							>
								<option value="">—</option>
								{supervisors.map((u) => (
									<option key={u.id} value={u.id}>
										{u.name}
									</option>
								))}
							</select>
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
						<Button type="submit">
							{t("comptroller_brigades.add_submit")}
						</Button>
						{error && (
							<p className="text-sm text-status-danger">{t(error as never)}</p>
						)}
					</Form>
				</section>
			)}

			<section className="bg-card border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-muted border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.code")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.area")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("comptroller_brigades.table.supervisor")}
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
							const supervisor = supervisors.find(
								(u) => u.id === brigade.supervisorId,
							)
							const editing = editingId === brigade.id
							return (
								<Fragment key={brigade.id}>
									<tr className="hover:bg-muted">
										<td
											className={
												brigade.active && !brigade.code
													? "px-4 py-3 font-mono font-medium text-status-warn"
													: "px-4 py-3 font-mono"
											}
										>
											{brigade.code ?? t("comptroller_brigades.no_code")}
										</td>
										<td className="px-4 py-3 font-medium">{brigade.name}</td>
										<td className="px-4 py-3 text-muted-foreground">
											{brigade.area}
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{supervisor?.name ?? "—"}
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
											<td colSpan={6} className="bg-muted/40 px-4 py-4">
												<EditBrigadeForm
													brigade={brigade}
													supervisors={supervisors}
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
									colSpan={6}
									className="px-4 py-6 text-center text-muted-foreground text-sm"
								>
									{t("comptroller_brigades.no_brigades")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
			<p className="text-xs text-muted-foreground">
				{t("comptroller_brigades.deactivate_hint")}
			</p>
		</div>
	)
}

function EditBrigadeForm({
	brigade,
	supervisors,
	areaOptions,
	error,
	onCancel,
}: {
	brigade: {
		id: string
		name: string
		active: boolean
		area: string | null
		code: string | null
		supervisorId: string | null
	}
	supervisors: Supervisor[]
	areaOptions: string[]
	error: string | null
	onCancel: () => void
}) {
	const { t } = useTranslation()
	return (
		<Form method="post" className="space-y-4 text-left">
			<input type="hidden" name="intent" value="update" />
			<input type="hidden" name="id" value={brigade.id} />
			<div className="grid gap-3 md:grid-cols-4">
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
					<Label htmlFor={`area-${brigade.id}`}>
						{t("comptroller_brigades.area_label")}
					</Label>
					<select
						id={`area-${brigade.id}`}
						name="area"
						required
						defaultValue={brigade.area ?? ""}
						className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
					>
						{areaOptions.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`code-${brigade.id}`}>
						{t("comptroller_brigades.code_label")}
					</Label>
					<Input
						id={`code-${brigade.id}`}
						name="code"
						required
						defaultValue={brigade.code ?? ""}
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`supervisor-${brigade.id}`}>
						{t("comptroller_brigades.supervisor_label")}
					</Label>
					<select
						id={`supervisor-${brigade.id}`}
						name="supervisorId"
						defaultValue={brigade.supervisorId ?? ""}
						className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm"
					>
						<option value="">—</option>
						{supervisors.map((u) => (
							<option key={u.id} value={u.id}>
								{u.name}
							</option>
						))}
					</select>
				</div>
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
