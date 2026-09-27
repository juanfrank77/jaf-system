import { hashPassword } from "better-auth/crypto"
import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { ALL_AREAS } from "~/lib/supervisor-scope"
import type { Role } from "../../generated/prisma/client"
import type { Route } from "./+types/_app.admin.users"

type UserRow = {
	id: string
	name: string
	email: string
	role: string
	active: boolean
	supervisorAreas: string[]
}

const ROLES: { value: string; labelKey: string }[] = [
	{ value: "SUPERVISOR", labelKey: "admin_users.role.supervisor" },
	{ value: "WAREHOUSE", labelKey: "admin_users.role.warehouse" },
	{ value: "CREW", labelKey: "admin_users.role.crew" },
	{ value: "INSTALLER", labelKey: "admin_users.role.installer" },
	{ value: "FINANCE", labelKey: "admin_users.role.finance" },
	{ value: "COMPTROLLER", labelKey: "admin_users.role.comptroller" },
	{ value: "ADMIN", labelKey: "admin_users.role.admin" },
]

export const meta: Route.MetaFunction = () => [{ title: "Users — JAF Ops" }]

function validateEmail(email: unknown): email is string {
	return (
		typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
	)
}

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const users = await db.user.findMany({
		orderBy: { name: "asc" },
		take: 200,
	})

	return { users, roles: ROLES }
}

export async function action({ request }: Route.ActionArgs) {
	const { user: admin } = await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "create") {
		const name = form.get("name")
		const email = form.get("email")
		const role = form.get("role")
		const tempPassword = form.get("tempPassword")

		if (
			typeof name !== "string" ||
			!name.trim() ||
			!validateEmail(email) ||
			typeof role !== "string" ||
			!ROLES.some((r) => r.value === role) ||
			typeof tempPassword !== "string" ||
			tempPassword.length < 8
		) {
			return data(
				{ errorKey: "admin_users.errors.create_invalid" },
				{ status: 400 },
			)
		}

		const existing = await db.user.findUnique({
			where: { email: email.trim() },
		})
		if (existing) {
			return data(
				{ errorKey: "admin_users.errors.email_exists" },
				{ status: 409 },
			)
		}

		const passwordHash = await hashPassword(tempPassword)
		await db.$transaction(async (tx) => {
			const newUser = await tx.user.create({
				data: {
					email: email.trim(),
					name: name.trim(),
					role: role as Role,
				},
			})
			await tx.account.create({
				data: {
					id: `admin-${newUser.email}`,
					userId: newUser.id,
					accountId: newUser.id,
					providerId: "credential",
					password: passwordHash,
				},
			})
		})

		return redirect("/admin/users")
	}

	if (intent === "toggle") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_users.errors.id_required" },
				{ status: 400 },
			)
		}
		if (id === admin.id) {
			return data(
				{ errorKey: "admin_users.errors.cannot_deactivate_self" },
				{ status: 400 },
			)
		}
		const existing = await db.user.findUniqueOrThrow({ where: { id } })
		await db.user.update({
			where: { id },
			data: { active: !existing.active },
		})
		return redirect("/admin/users")
	}

	if (intent === "resetPassword") {
		const id = form.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_users.errors.id_required" },
				{ status: 400 },
			)
		}
		const tempPassword = crypto.randomUUID().slice(0, 12)
		const passwordHash = await hashPassword(tempPassword)
		const account = await db.account.findFirst({ where: { userId: id } })
		if (!account) {
			return data(
				{ errorKey: "admin_users.errors.no_account" },
				{ status: 404 },
			)
		}
		await db.account.update({
			where: { id: account.id },
			data: { password: passwordHash },
		})
		return { resetSuccess: true }
	}

	if (intent === "updateAreas") {
		const id = form.get("id")
		const areas = form.getAll("areas")
		if (
			typeof id !== "string" ||
			!id.trim() ||
			!areas.every(
				(a): a is string =>
					typeof a === "string" && (ALL_AREAS as readonly string[]).includes(a),
			)
		) {
			return data(
				{ errorKey: "admin_users.errors.update_invalid" },
				{ status: 400 },
			)
		}
		await db.user.update({
			where: { id },
			data: { supervisorAreas: areas as string[] },
		})
		return redirect("/admin/users")
	}

	if (intent === "updateRole") {
		const id = form.get("id")
		const role = form.get("role")
		if (
			typeof id !== "string" ||
			!id.trim() ||
			typeof role !== "string" ||
			!ROLES.some((r) => r.value === role)
		) {
			return data(
				{ errorKey: "admin_users.errors.update_invalid" },
				{ status: 400 },
			)
		}
		if (id === admin.id) {
			return data(
				{ errorKey: "admin_users.errors.cannot_change_own_role" },
				{ status: 400 },
			)
		}
		await db.user.update({
			where: { id },
			data: { role: role as Role },
		})
		return redirect("/admin/users")
	}

	return data(
		{ errorKey: "admin_users.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function AdminUsers({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { users, roles } = loaderData as {
		users: UserRow[]
		roles: typeof ROLES
	}
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const resetSuccess =
		actionData && "resetSuccess" in actionData
			? (actionData.resetSuccess as boolean)
			: false

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("admin_users.title")}</h1>

			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">
					{t("admin_users.add_heading")}
				</h2>
				<Form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="space-y-1">
							<Label htmlFor="name">{t("admin_users.name_label")}</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="email">{t("admin_users.email_label")}</Label>
							<Input id="email" name="email" type="email" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="role">{t("admin_users.role_label")}</Label>
							<Select name="role" required>
								<SelectTrigger id="role">
									<SelectValue
										placeholder={t("admin_users.role_placeholder")}
									/>
								</SelectTrigger>
								<SelectContent>
									{roles.map((r) => (
										<SelectItem key={r.value} value={r.value}>
											{t(r.labelKey as never)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="tempPassword">
								{t("admin_users.temp_password_label")}
							</Label>
							<Input
								id="tempPassword"
								name="tempPassword"
								type="text"
								minLength={8}
								required
							/>
						</div>
					</div>
					<Button type="submit">{t("admin_users.add_submit")}</Button>
					{error && <p className="text-sm text-red-600">{t(error as never)}</p>}
				</Form>
			</section>

			{resetSuccess && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
					<p className="font-medium">
						{t("admin_users.reset_password_notice")}
					</p>
					<p className="mt-1">{t("admin_users.reset_password_detail")}</p>
					<Button
						variant="ghost"
						size="sm"
						className="mt-2"
						onClick={() => {
							/* actionData clears on next action */
						}}
					>
						{t("admin_users.dismiss")}
					</Button>
				</div>
			)}

			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_users.table.name")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_users.table.email")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_users.table.role")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_users.table.areas")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_users.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_users.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{users.map((user) => (
							<tr key={user.id} className="hover:bg-slate-50">
								<td className="px-4 py-3">{user.name}</td>
								<td className="px-4 py-3">{user.email}</td>
								<td className="px-4 py-3">
									<Form method="post" className="flex items-center gap-2">
										<input type="hidden" name="intent" value="updateRole" />
										<input type="hidden" name="id" value={user.id} />
										<Select name="role" defaultValue={user.role}>
											<SelectTrigger className="w-40">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{roles.map((r) => (
													<SelectItem key={r.value} value={r.value}>
														{t(r.labelKey as never)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Button type="submit" variant="outline" size="sm">
											{t("admin_users.update_role")}
										</Button>
									</Form>
								</td>
								<td className="px-4 py-3">
									{user.role === "SUPERVISOR" ? (
										<Form
											method="post"
											className="flex flex-wrap items-center gap-2"
										>
											<input type="hidden" name="intent" value="updateAreas" />
											<input type="hidden" name="id" value={user.id} />
											{ALL_AREAS.map((a) => (
												<label
													key={a}
													htmlFor={`area-${user.id}-${a}`}
													className="flex items-center gap-1 text-xs"
												>
													<Checkbox
														id={`area-${user.id}-${a}`}
														name="areas"
														value={a}
														defaultChecked={user.supervisorAreas.includes(a)}
													/>
													{a}
												</label>
											))}
											<Button type="submit" variant="outline" size="sm">
												{t("admin_users.save_areas")}
											</Button>
										</Form>
									) : (
										<span className="text-slate-400">—</span>
									)}
								</td>
								<td className="px-4 py-3 text-center">
									<span
										className={
											user.active
												? "text-green-600 font-medium"
												: "text-slate-400"
										}
									>
										{user.active ? t("admin_users.yes") : t("admin_users.no")}
									</span>
								</td>
								<td className="px-4 py-3 text-center">
									<div className="flex items-center justify-center gap-2">
										<Form method="post">
											<input type="hidden" name="intent" value="toggle" />
											<input type="hidden" name="id" value={user.id} />
											<Button type="submit" variant="outline" size="sm">
												{user.active
													? t("admin_users.deactivate")
													: t("admin_users.activate")}
											</Button>
										</Form>
										<Form method="post">
											<input
												type="hidden"
												name="intent"
												value="resetPassword"
											/>
											<input type="hidden" name="id" value={user.id} />
											<Button type="submit" variant="outline" size="sm">
												{t("admin_users.reset_password")}
											</Button>
										</Form>
									</div>
								</td>
							</tr>
						))}
						{users.length === 0 && (
							<tr>
								<td
									colSpan={6}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("admin_users.no_users")}
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
