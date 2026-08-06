import { useTranslation } from "react-i18next"
import { data, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.catalog"

export const meta: Route.MetaFunction = () => [
	{ title: "Service Catalog — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])

	const codes = await db.serviceCode.findMany({
		orderBy: { claroCode: "asc" },
	})

	return {
		codes: codes.map((code) => ({
			...code,
			unitPrice: toNumberPrice(code.unitPrice),
		})),
	}
}

export async function action({ request }: Route.ActionArgs) {
	await requireRole(request, ["ADMIN"])

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "create") {
		const claroCode = formData.get("claroCode")
		const name = formData.get("name")
		const unitPrice = formData.get("unitPrice")
		const accountCode = formData.get("accountCode")
		const dept = formData.get("dept")

		if (
			typeof claroCode !== "string" ||
			!claroCode.trim() ||
			typeof name !== "string" ||
			!name.trim() ||
			typeof unitPrice !== "string" ||
			!unitPrice.trim()
		) {
			return data(
				{ errorKey: "admin_catalog.errors.required_fields" },
				{ status: 400 },
			)
		}

		await db.serviceCode.create({
			data: {
				claroCode: claroCode.trim(),
				name: name.trim(),
				unitPrice: Number.parseFloat(unitPrice),
				accountCode:
					typeof accountCode === "string" && accountCode.trim()
						? accountCode.trim()
						: null,
				dept: typeof dept === "string" && dept.trim() ? dept.trim() : null,
			},
		})

		return redirect("/admin/catalog")
	}

	if (intent === "toggle") {
		const id = formData.get("id")
		if (typeof id !== "string" || !id.trim()) {
			return data(
				{ errorKey: "admin_catalog.errors.id_required" },
				{ status: 400 },
			)
		}

		const existing = await db.serviceCode.findUniqueOrThrow({
			where: { id },
		})

		await db.serviceCode.update({
			where: { id },
			data: { active: !existing.active },
		})

		return redirect("/admin/catalog")
	}

	return data(
		{ errorKey: "admin_catalog.errors.unknown_intent" },
		{ status: 400 },
	)
}

export default function AdminCatalog({ loaderData }: Route.ComponentProps) {
	const { codes } = loaderData
	const { t } = useTranslation()

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">{t("admin_catalog.title")}</h1>

			{/* Add code form */}
			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">
					{t("admin_catalog.add_heading")}
				</h2>
				<form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1">
							<Label htmlFor="claroCode">
								{t("admin_catalog.claro_code_label")}
							</Label>
							<Input id="claroCode" name="claroCode" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="name">{t("admin_catalog.name_label")}</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="unitPrice">
								{t("admin_catalog.unit_price_label")}
							</Label>
							<Input
								id="unitPrice"
								name="unitPrice"
								type="number"
								step="0.01"
								min="0"
								required
							/>
						</div>
						<div className="space-y-1">
							<Label htmlFor="accountCode">
								{t("admin_catalog.account_code_label")}
							</Label>
							<Input id="accountCode" name="accountCode" />
						</div>
						<div className="space-y-1">
							<Label htmlFor="dept">{t("admin_catalog.dept_label")}</Label>
							<Input id="dept" name="dept" />
						</div>
					</div>
					<Button type="submit">{t("admin_catalog.add_submit")}</Button>
				</form>
			</section>

			{/* Service codes table */}
			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_catalog.table.claro_code")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_catalog.table.name")}
							</th>
							<th className="px-4 py-3 text-right font-medium text-slate-600">
								{t("admin_catalog.table.unit_price")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_catalog.table.account_code")}
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								{t("admin_catalog.table.dept")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_catalog.table.active")}
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								{t("admin_catalog.table.actions")}
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{codes.map((code) => (
							<tr key={code.id} className="hover:bg-slate-50">
								<td className="px-4 py-3 font-mono">{code.claroCode}</td>
								<td className="px-4 py-3">{code.name}</td>
								<td className="px-4 py-3 text-right">
									{toNumberPrice(code.unitPrice).toFixed(2)}
								</td>
								<td className="px-4 py-3 text-slate-500">
									{code.accountCode ?? "—"}
								</td>
								<td className="px-4 py-3 text-slate-500">{code.dept ?? "—"}</td>
								<td className="px-4 py-3 text-center">
									<span
										className={
											code.active
												? "text-green-600 font-medium"
												: "text-slate-400"
										}
									>
										{code.active
											? t("admin_catalog.yes")
											: t("admin_catalog.no")}
									</span>
								</td>
								<td className="px-4 py-3 text-center">
									<form method="post">
										<input type="hidden" name="intent" value="toggle" />
										<input type="hidden" name="id" value={code.id} />
										<Button type="submit" variant="outline" size="sm">
											{code.active
												? t("admin_catalog.deactivate")
												: t("admin_catalog.activate")}
										</Button>
									</form>
								</td>
							</tr>
						))}
						{codes.length === 0 && (
							<tr>
								<td
									colSpan={7}
									className="px-4 py-6 text-center text-slate-400 text-sm"
								>
									{t("admin_catalog.no_codes")}
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
