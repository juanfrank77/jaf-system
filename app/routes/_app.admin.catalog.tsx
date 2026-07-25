import { data, redirect } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
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
			unitPrice: Number(code.unitPrice),
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
				{ error: "claroCode, name, and unitPrice are required." },
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
			return data({ error: "id is required." }, { status: 400 })
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

	return data({ error: "Unknown intent." }, { status: 400 })
}

export default function AdminCatalog({ loaderData }: Route.ComponentProps) {
	const { codes } = loaderData

	return (
		<div className="space-y-8">
			<h1 className="text-xl font-semibold">Service Catalog</h1>

			{/* Add code form */}
			<section className="bg-white border rounded-lg p-6 space-y-4">
				<h2 className="text-base font-medium">Add Service Code</h2>
				<form method="post" className="space-y-4">
					<input type="hidden" name="intent" value="create" />
					<div className="grid grid-cols-2 gap-4">
						<div className="space-y-1">
							<Label htmlFor="claroCode">Claro Code *</Label>
							<Input id="claroCode" name="claroCode" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="name">Name *</Label>
							<Input id="name" name="name" required />
						</div>
						<div className="space-y-1">
							<Label htmlFor="unitPrice">Unit Price *</Label>
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
							<Label htmlFor="accountCode">Account Code</Label>
							<Input id="accountCode" name="accountCode" />
						</div>
						<div className="space-y-1">
							<Label htmlFor="dept">Dept</Label>
							<Input id="dept" name="dept" />
						</div>
					</div>
					<Button type="submit">Add Service Code</Button>
				</form>
			</section>

			{/* Service codes table */}
			<section className="bg-white border rounded-lg overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-slate-50 border-b">
						<tr>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								Claro Code
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								Name
							</th>
							<th className="px-4 py-3 text-right font-medium text-slate-600">
								Unit Price
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								Account Code
							</th>
							<th className="px-4 py-3 text-left font-medium text-slate-600">
								Dept
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								Active
							</th>
							<th className="px-4 py-3 text-center font-medium text-slate-600">
								Actions
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{codes.map((code) => (
							<tr key={code.id} className="hover:bg-slate-50">
								<td className="px-4 py-3 font-mono">{code.claroCode}</td>
								<td className="px-4 py-3">{code.name}</td>
								<td className="px-4 py-3 text-right">
									{Number(code.unitPrice).toFixed(2)}
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
										{code.active ? "Yes" : "No"}
									</span>
								</td>
								<td className="px-4 py-3 text-center">
									<form method="post">
										<input type="hidden" name="intent" value="toggle" />
										<input type="hidden" name="id" value={code.id} />
										<Button type="submit" variant="outline" size="sm">
											{code.active ? "Deactivate" : "Activate"}
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
									No service codes yet.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</section>
		</div>
	)
}
