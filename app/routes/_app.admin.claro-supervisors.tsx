import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button, buttonVariants } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { validateClaroSupervisor } from "~/lib/claro-supervisor"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.admin.claro-supervisors"

export const meta: Route.MetaFunction = () => [
	{ title: "Claro supervisors — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const [rows, jafSupervisors] = await Promise.all([
		db.claroSupervisor.findMany({
			orderBy: { name: "asc" },
			include: { jafSupervisors: { select: { id: true } } },
		}),
		db.user.findMany({
			where: { role: "SUPERVISOR" },
			orderBy: { name: "asc" },
			select: { id: true, name: true },
		}),
	])
	const supervisors = rows.map(({ jafSupervisors: linked, ...c }) => ({
		...c,
		jafSupervisorIds: linked.map((u) => u.id),
	}))
	return { supervisors, jafSupervisors }
}

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create" || intent === "update") {
		const name = form.get("name")
		const email = form.get("email")
		const input = {
			name: typeof name === "string" ? name : "",
			email: typeof email === "string" ? email : "",
		}
		const check = validateClaroSupervisor(input)
		if (!check.ok) {
			return data({ errorKey: check.errorKey }, { status: 400 })
		}
		const payload = {
			name: input.name.trim(),
			email: input.email.trim(),
			requiresPrefield: form.get("requiresPrefield") === "on",
			requiresBlueprint: form.get("requiresBlueprint") === "on",
		}
		const linkIds = form
			.getAll("jafSupervisorIds")
			.filter((v): v is string => typeof v === "string")
			.map((id) => ({ id }))
		if (intent === "update") {
			const id = form.get("id")
			if (typeof id !== "string" || !id.trim()) {
				return data(
					{ errorKey: "claro_supervisors.errors.id_required" },
					{ status: 400 },
				)
			}
			await db.claroSupervisor.update({
				where: { id },
				data: { ...payload, jafSupervisors: { set: linkIds } },
			})
		} else {
			await db.claroSupervisor.create({
				data: { ...payload, jafSupervisors: { connect: linkIds } },
			})
		}
		return redirect("/admin/claro-supervisors")
	}

	if (intent === "toggle_active") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "claro_supervisors.errors.id_required" },
				{ status: 400 },
			)
		}
		const existing = await db.claroSupervisor.findUniqueOrThrow({
			where: { id },
		})
		await db.claroSupervisor.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/claro-supervisors")
	}

	return data(
		{ errorKey: "claro_supervisors.errors.unknown_intent" },
		{ status: 400 },
	)
}

type Entry = {
	id: string
	name: string
	email: string
	active: boolean
	requiresPrefield: boolean
	requiresBlueprint: boolean
	jafSupervisorIds: string[]
}

type JafSupervisor = { id: string; name: string }

export default function AdminClaroSupervisors({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { supervisors, jafSupervisors } = loaderData as {
		supervisors: Entry[]
		jafSupervisors: JafSupervisor[]
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("claro_supervisors.title")}</h1>

			<section className="bg-card border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">
					{t("claro_supervisors.add_heading")}
				</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1">
							<Label htmlFor="name">{t("claro_supervisors.name_label")}</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="email">
								{t("claro_supervisors.email_label")}
							</Label>
							<Input id="email" name="email" type="email" required />
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-6">
						<div className="flex items-center gap-2">
							<Checkbox id="requiresPrefield" name="requiresPrefield" />
							<Label htmlFor="requiresPrefield" className="text-sm">
								{t("claro_supervisors.requires_prefield")}
							</Label>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox id="requiresBlueprint" name="requiresBlueprint" />
							<Label htmlFor="requiresBlueprint" className="text-sm">
								{t("claro_supervisors.requires_blueprint")}
							</Label>
						</div>
					</div>
					<WorksWith idPrefix="new" options={jafSupervisors} selected={[]} />
					<Button type="submit">{t("claro_supervisors.add_submit")}</Button>
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
								{t("claro_supervisors.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("claro_supervisors.table.email")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">
								{t("claro_supervisors.table.works_with")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("claro_supervisors.table.prefield")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("claro_supervisors.table.blueprint")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("claro_supervisors.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-muted-foreground">
								{t("claro_supervisors.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{supervisors.map((s) => (
							<tr key={s.id} className="hover:bg-muted align-top">
								<td className="px-4 py-3 font-medium">{s.name}</td>
								<td className="px-4 py-3 text-muted-foreground">{s.email}</td>
								<td className="px-4 py-3 text-muted-foreground">
									{jafSupervisors
										.filter((u) => s.jafSupervisorIds.includes(u.id))
										.map((u) => u.name)
										.join(", ") || "—"}
								</td>
								<td className="px-4 py-3 text-center">
									{s.requiresPrefield
										? t("claro_supervisors.yes")
										: t("claro_supervisors.no")}
								</td>
								<td className="px-4 py-3 text-center">
									{s.requiresBlueprint
										? t("claro_supervisors.yes")
										: t("claro_supervisors.no")}
								</td>
								<td className="px-4 py-3 text-center">
									<span
										className={
											s.active
												? "text-status-ok font-medium"
												: "text-muted-foreground"
										}
									>
										{s.active
											? t("claro_supervisors.yes")
											: t("claro_supervisors.no")}
									</span>
								</td>
								<td className="px-4 py-3 text-center">
									<div className="flex items-start justify-center gap-2">
										<Form method="post">
											<input
												type="hidden"
												name="intent"
												value="toggle_active"
											/>
											<input type="hidden" name="id" value={s.id} />
											<Button type="submit" variant="outline" size="sm">
												{s.active
													? t("claro_supervisors.deactivate")
													: t("claro_supervisors.activate")}
											</Button>
										</Form>
										<EditEntry entry={s} jafSupervisors={jafSupervisors} />
									</div>
								</td>
							</tr>
						))}
						{supervisors.length === 0 && (
							<tr>
								<td
									colSpan={7}
									className="px-4 py-6 text-center text-muted-foreground text-sm"
								>
									{t("claro_supervisors.empty")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

function WorksWith({
	idPrefix,
	options,
	selected,
}: {
	idPrefix: string
	options: JafSupervisor[]
	selected: string[]
}) {
	const { t } = useTranslation()
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm font-medium">
				{t("claro_supervisors.works_with")}
			</legend>
			<div className="flex flex-wrap gap-x-6 gap-y-2">
				{options.map((u) => (
					<div key={u.id} className="flex items-center gap-2">
						<Checkbox
							id={`${idPrefix}-jaf-${u.id}`}
							name="jafSupervisorIds"
							value={u.id}
							defaultChecked={selected.includes(u.id)}
						/>
						<Label htmlFor={`${idPrefix}-jaf-${u.id}`} className="text-sm">
							{u.name}
						</Label>
					</div>
				))}
			</div>
		</fieldset>
	)
}

function EditEntry({
	entry,
	jafSupervisors,
}: {
	entry: Entry
	jafSupervisors: JafSupervisor[]
}) {
	const { t } = useTranslation()
	return (
		<details className="group text-left">
			<summary className={buttonVariants({ variant: "outline", size: "sm" })}>
				{t("claro_supervisors.edit")}
			</summary>
			<Form method="post" className="mt-3 space-y-3 rounded-lg border p-3">
				<input type="hidden" name="intent" value="update" />
				<input type="hidden" name="id" value={entry.id} />
				<div className="space-y-1">
					<Label htmlFor={`name-${entry.id}`}>
						{t("claro_supervisors.name_label")}
					</Label>
					<Input
						id={`name-${entry.id}`}
						name="name"
						defaultValue={entry.name}
						required
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor={`email-${entry.id}`}>
						{t("claro_supervisors.email_label")}
					</Label>
					<Input
						id={`email-${entry.id}`}
						name="email"
						type="email"
						defaultValue={entry.email}
						required
					/>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`prefield-${entry.id}`}
						name="requiresPrefield"
						defaultChecked={entry.requiresPrefield}
					/>
					<Label htmlFor={`prefield-${entry.id}`} className="text-sm">
						{t("claro_supervisors.requires_prefield")}
					</Label>
				</div>
				<div className="flex items-center gap-2">
					<Checkbox
						id={`blueprint-${entry.id}`}
						name="requiresBlueprint"
						defaultChecked={entry.requiresBlueprint}
					/>
					<Label htmlFor={`blueprint-${entry.id}`} className="text-sm">
						{t("claro_supervisors.requires_blueprint")}
					</Label>
				</div>
				<WorksWith
					idPrefix={entry.id}
					options={jafSupervisors}
					selected={entry.jafSupervisorIds}
				/>
				<Button type="submit" size="sm">
					{t("claro_supervisors.save")}
				</Button>
			</Form>
		</details>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
