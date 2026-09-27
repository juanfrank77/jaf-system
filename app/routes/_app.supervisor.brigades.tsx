import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button, buttonVariants } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { supervisorAreas } from "~/lib/supervisor-scope"
import type { Route } from "./+types/_app.supervisor.brigades"

type CrewUser = { id: string; name: string; active: boolean }

export const meta: Route.MetaFunction = () => [{ title: "Brigades — JAF Ops" }]

/** Throws unless `area` is one of the supervisor's own areas. */
export async function assertBrigadeAreaAllowed({
	area,
	supervisorAreas,
}: {
	area: string | null
	supervisorAreas: (string | null)[]
}) {
	if (!supervisorAreas.includes(area)) {
		throw new Error("Area is outside the supervisor's scope")
	}
}

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const areas = (await supervisorAreas(db, user.id)).filter(
		(a): a is string => a !== null,
	)

	const [brigades, crewUsers] = await Promise.all([
		db.brigade.findMany({
			where: { area: { in: areas } },
			orderBy: { name: "asc" },
		}),
		db.user.findMany({
			where: { role: "CREW" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true },
		}),
	])

	return { brigades, crewUsers, areas }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const areas = (await supervisorAreas(db, user.id)).filter(
		(a): a is string => a !== null,
	)
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const area = form.get("area")
		const code = form.get("code")
		const memberIds = form.getAll("memberIds")
		const active = form.get("active") === "on"

		if (
			typeof name !== "string" ||
			!name.trim() ||
			typeof area !== "string" ||
			!area.trim() ||
			!memberIds.every((m): m is string => typeof m === "string")
		) {
			return data(
				{ errorKey: "supervisor_brigades.errors.invalid_fields" },
				{ status: 400 },
			)
		}

		await assertBrigadeAreaAllowed({ area, supervisorAreas: areas })

		const dataPayload = {
			name: name.trim(),
			memberIds: memberIds as string[],
			active,
			area,
			supervisorId: user.id,
			code: typeof code === "string" && code.trim() ? code.trim() : null,
		}

		if (intent === "update" && typeof id === "string" && id.trim()) {
			const existing = await db.brigade.findUniqueOrThrow({ where: { id } })
			await assertBrigadeAreaAllowed({
				area: existing.area,
				supervisorAreas: areas,
			})
			await db.brigade.update({ where: { id }, data: dataPayload })
		} else {
			await db.brigade.create({ data: dataPayload })
		}
		return redirect("/supervisor/brigades")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "supervisor_brigades.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.brigade.findUniqueOrThrow({ where: { id } })
		await assertBrigadeAreaAllowed({
			area: existing.area,
			supervisorAreas: areas,
		})
		await db.brigade.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/supervisor/brigades")
	}

	return data(
		{ errorKey: "supervisor_brigades.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function SupervisorBrigades({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { brigades, crewUsers, areas } = loaderData as {
		brigades: {
			id: string
			name: string
			memberIds: string[]
			active: boolean
			area: string | null
			code: string | null
		}[]
		crewUsers: CrewUser[]
		areas: (string | null)[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">
				{t("supervisor_brigades.title")}
			</h1>

			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">
					{t("supervisor_brigades.add_heading")}
				</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="space-y-1">
						<Label htmlFor="name">{t("supervisor_brigades.name_label")}</Label>
						<Input id="name" name="name" required />
					</div>
					<div className="space-y-1">
						<Label htmlFor="area">{t("supervisor_brigades.area_label")}</Label>
						<select
							id="area"
							name="area"
							required
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
						>
							{areas.map((a) => (
								<option key={a} value={a ?? ""}>
									{a}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-1">
						<Label htmlFor="code">{t("supervisor_brigades.code_label")}</Label>
						<Input id="code" name="code" />
					</div>
					<div className="space-y-2">
						<p className="text-sm font-medium">
							{t("supervisor_brigades.members_label")}
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
										<span className="text-slate-400">
											(
											{u.active
												? t("supervisor_brigades.active")
												: t("supervisor_brigades.inactive")}
											)
										</span>
									</span>
								</label>
							))}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox id="active" name="active" defaultChecked />
						<Label htmlFor="active" className="text-sm">
							{t("supervisor_brigades.active_label")}
						</Label>
					</div>
					<Button type="submit">{t("supervisor_brigades.add_submit")}</Button>
					{error && <p className="text-sm text-red-600">{t(error as never)}</p>}
				</Form>
			</section>

			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_brigades.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_brigades.table.area")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("supervisor_brigades.table.members")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("supervisor_brigades.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("supervisor_brigades.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{brigades.map((brigade) => {
							const members = crewUsers.filter((u) =>
								brigade.memberIds.includes(u.id),
							)
							return (
								<tr key={brigade.id} className="hover:bg-slate-50">
									<td className="px-4 py-3 font-medium">{brigade.name}</td>
									<td className="px-4 py-3 text-slate-600">{brigade.area}</td>
									<td className="px-4 py-3 text-slate-600">
										{members.map((m) => m.name).join(", ") ||
											t("supervisor_brigades.no_members")}
									</td>
									<td className="px-4 py-3 text-center">
										<span
											className={
												brigade.active
													? "text-green-600 font-medium"
													: "text-slate-400"
											}
										>
											{brigade.active
												? t("supervisor_brigades.yes")
												: t("supervisor_brigades.no")}
										</span>
									</td>
									<td className="px-4 py-3 text-center">
										<div className="flex items-center justify-center gap-2">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle" />
												<input type="hidden" name="id" value={brigade.id} />
												<Button type="submit" variant="outline" size="sm">
													{brigade.active
														? t("supervisor_brigades.deactivate")
														: t("supervisor_brigades.activate")}
												</Button>
											</Form>
											<EditBrigadeDialog
												brigade={brigade}
												crewUsers={crewUsers}
												areas={areas}
											/>
										</div>
									</td>
								</tr>
							)
						})}
						{brigades.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("supervisor_brigades.no_brigades")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

function EditBrigadeDialog({
	brigade,
	crewUsers,
	areas,
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
	areas: (string | null)[]
}) {
	const { t } = useTranslation()
	return (
		<details className="group">
			<summary className={buttonVariants({ variant: "outline", size: "sm" })}>
				{t("supervisor_brigades.edit")}
			</summary>
			<Form method="post" className="mt-3 space-y-3 rounded-lg border p-3">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="id" value={brigade.id} />
				<div className="space-y-1">
					<Label htmlFor={`name-${brigade.id}`}>
						{t("supervisor_brigades.name_label")}
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
						{t("supervisor_brigades.area_label")}
					</Label>
					<select
						id={`area-${brigade.id}`}
						name="area"
						required
						defaultValue={brigade.area ?? ""}
						className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
					>
						{areas.map((a) => (
							<option key={a} value={a ?? ""}>
								{a}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`code-${brigade.id}`}>
						{t("supervisor_brigades.code_label")}
					</Label>
					<Input
						id={`code-${brigade.id}`}
						name="code"
						defaultValue={brigade.code ?? ""}
					/>
				</div>
				<div className="space-y-2">
					<p className="text-sm font-medium">
						{t("supervisor_brigades.members_label")}
					</p>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
									<span className="text-slate-400">
										(
										{u.active
											? t("supervisor_brigades.active")
											: t("supervisor_brigades.inactive")}
										)
									</span>
								</span>
							</label>
						))}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`active-${brigade.id}`}
						name="active"
						defaultChecked={brigade.active}
					/>
					<Label htmlFor={`active-${brigade.id}`} className="text-sm">
						{t("supervisor_brigades.active_label")}
					</Label>
				</div>
				<Button type="submit" size="sm">
					{t("supervisor_brigades.save")}
				</Button>
			</Form>
		</details>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
