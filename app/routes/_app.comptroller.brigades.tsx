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

type CrewUser = { id: string; name: string; active: boolean }

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

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

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
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const [editingId, setEditingId] = useState<string | null>(null)
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
				<h2 className="text-base font-medium">
					{t("comptroller_brigades.add_heading")}
				</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="space-y-1">
						<Label htmlFor="name">{t("comptroller_brigades.name_label")}</Label>
						<Input id="name" name="name" required />
					</div>
					<div className="space-y-1">
						<Label htmlFor="area">{t("comptroller_brigades.area_label")}</Label>
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
						<Label htmlFor="code">{t("comptroller_brigades.code_label")}</Label>
						<Input id="code" name="code" />
					</div>
					<div className="space-y-2">
						<p className="text-sm font-medium">
							{t("comptroller_brigades.members_label")}
						</p>
						<p className="text-xs text-muted-foreground">
							{t("comptroller_brigades.members_hint")}
						</p>
						<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
							{crewUsers.map((u) => (
								<label
									key={u.id}
									htmlFor={`member-${u.id}`}
									className="flex items-center gap-2 text-sm"
								>
									<Checkbox
										id={`member-${u.id}`}
										name="memberIds"
										value={u.id}
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
						defaultValue={brigade.code ?? ""}
					/>
				</div>
			</div>
			<div className="space-y-2">
				<p className="text-sm font-medium">
					{t("comptroller_brigades.members_label")}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("comptroller_brigades.members_hint")}
				</p>
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{crewUsers.map((u) => (
						<label
							key={u.id}
							htmlFor={`member-${brigade.id}-${u.id}`}
							className="flex items-center gap-2 text-sm"
						>
							<Checkbox
								id={`member-${brigade.id}-${u.id}`}
								name="memberIds"
								value={u.id}
								defaultChecked={brigade.memberIds.includes(u.id)}
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
