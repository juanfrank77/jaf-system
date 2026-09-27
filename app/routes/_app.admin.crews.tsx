import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button, buttonVariants } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ALL_AREAS } from "~/lib/supervisor-scope"
import type { Route } from "./+types/_app.admin.crews"

type CrewUser = { id: string; name: string; active: boolean }

export const meta: Route.MetaFunction = () => [{ title: "Crews — JAF Ops" }]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const [crews, crewUsers] = await Promise.all([
		db.brigade.findMany({ orderBy: { name: "asc" } }),
		db.user.findMany({
			where: { role: "CREW" },
			orderBy: { name: "asc" },
			select: { id: true, name: true, active: true },
		}),
	])

	return { crews, crewUsers }
}

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const id = form.get("id")
		const name = form.get("name")
		const area = form.get("area")
		const memberIds = form.getAll("memberIds")
		const active = form.get("active") === "on"

		if (
			typeof name !== "string" ||
			!name.trim() ||
			typeof area !== "string" ||
			!(ALL_AREAS as readonly string[]).includes(area) ||
			!memberIds.every((m) => typeof m === "string")
		) {
			return data(
				{ errorKey: "admin_crews.errors.invalid_fields" },
				{ status: 400 },
			)
		}

		const dataPayload = {
			name: name.trim(),
			area,
			memberIds: memberIds as string[],
			active,
		}

		if (intent === "update" && typeof id === "string" && id.trim()) {
			await db.brigade.update({ where: { id }, data: dataPayload })
		} else {
			await db.brigade.create({ data: dataPayload })
		}
		return redirect("/admin/crews")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_crews.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.brigade.findUniqueOrThrow({ where: { id } })
		await db.brigade.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/crews")
	}

	return data(
		{ errorKey: "admin_crews.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function AdminCrews({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { crews, crewUsers } = loaderData as {
		crews: {
			id: string
			name: string
			area: string | null
			memberIds: string[]
			active: boolean
		}[]
		crewUsers: CrewUser[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("admin_crews.title")}</h1>

			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">
					{t("admin_crews.add_heading")}
				</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="space-y-1">
						<Label htmlFor="name">{t("admin_crews.name_label")}</Label>
						<Input id="name" name="name" required />
					</div>
					<div className="space-y-1">
						<Label htmlFor="area">{t("admin_crews.area_label")}</Label>
						<select
							id="area"
							name="area"
							required
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
						>
							{ALL_AREAS.map((a) => (
								<option key={a} value={a}>
									{a}
								</option>
							))}
						</select>
					</div>
					<div className="space-y-2">
						<p className="text-sm font-medium">
							{t("admin_crews.members_label")}
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
												? t("admin_crews.active")
												: t("admin_crews.inactive")}
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
							{t("admin_crews.active_label")}
						</Label>
					</div>
					<Button type="submit">{t("admin_crews.add_submit")}</Button>
					{error && <p className="text-sm text-red-600">{t(error as never)}</p>}
				</Form>
			</section>

			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_crews.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_crews.table.area")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_crews.table.members")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_crews.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_crews.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{crews.map((crew) => {
							const members = crewUsers.filter((u) =>
								crew.memberIds.includes(u.id),
							)
							return (
								<tr key={crew.id} className="hover:bg-slate-50">
									<td className="px-4 py-3 font-medium">{crew.name}</td>
									<td className="px-4 py-3 text-slate-600">
										{crew.area ?? t("admin_crews.no_area")}
									</td>
									<td className="px-4 py-3 text-slate-600">
										{members.map((m) => m.name).join(", ") ||
											t("admin_crews.no_members")}
									</td>
									<td className="px-4 py-3 text-center">
										<span
											className={
												crew.active
													? "text-green-600 font-medium"
													: "text-slate-400"
											}
										>
											{crew.active ? t("admin_crews.yes") : t("admin_crews.no")}
										</span>
									</td>
									<td className="px-4 py-3 text-center">
										<div className="flex items-center justify-center gap-2">
											<Form method="post">
												<input type="hidden" name="intent" value="toggle" />
												<input type="hidden" name="id" value={crew.id} />
												<Button type="submit" variant="outline" size="sm">
													{crew.active
														? t("admin_crews.deactivate")
														: t("admin_crews.activate")}
												</Button>
											</Form>
											<EditCrewDialog crew={crew} crewUsers={crewUsers} />
										</div>
									</td>
								</tr>
							)
						})}
						{crews.length === 0 && (
							<tr>
								<td
									colSpan={5}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("admin_crews.no_crews")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

function EditCrewDialog({
	crew,
	crewUsers,
}: {
	crew: {
		id: string
		name: string
		area: string | null
		memberIds: string[]
		active: boolean
	}
	crewUsers: CrewUser[]
}) {
	const { t } = useTranslation()
	return (
		<details className="group">
			<summary className={buttonVariants({ variant: "outline", size: "sm" })}>
				{t("admin_crews.edit")}
			</summary>
			<Form method="post" className="mt-3 space-y-3 rounded-lg border p-3">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="id" value={crew.id} />
				<div className="space-y-1">
					<Label htmlFor={`name-${crew.id}`}>
						{t("admin_crews.name_label")}
					</Label>
					<Input
						id={`name-${crew.id}`}
						name="name"
						defaultValue={crew.name}
						required
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`area-${crew.id}`}>
						{t("admin_crews.area_label")}
					</Label>
					<select
						id={`area-${crew.id}`}
						name="area"
						required
						defaultValue={crew.area ?? ""}
						className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
					>
						{!crew.area && (
							<option value="" disabled>
								{t("admin_crews.select_area")}
							</option>
						)}
						{ALL_AREAS.map((a) => (
							<option key={a} value={a}>
								{a}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-2">
					<p className="text-sm font-medium">
						{t("admin_crews.members_label")}
					</p>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{crewUsers.map((u) => (
							<label
								key={u.id}
								htmlFor={`member-${crew.id}-${u.id}`}
								className="flex items-center gap-2 text-sm"
							>
								<Checkbox
									id={`member-${crew.id}-${u.id}`}
									name="memberIds"
									value={u.id}
									defaultChecked={crew.memberIds.includes(u.id)}
								/>
								<span>
									{u.name}{" "}
									<span className="text-slate-400">
										(
										{u.active
											? t("admin_crews.active")
											: t("admin_crews.inactive")}
										)
									</span>
								</span>
							</label>
						))}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`active-${crew.id}`}
						name="active"
						defaultChecked={crew.active}
					/>
					<Label htmlFor={`active-${crew.id}`} className="text-sm">
						{t("admin_crews.active_label")}
					</Label>
				</div>
				<Button type="submit" size="sm">
					{t("admin_crews.save")}
				</Button>
			</Form>
		</details>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
