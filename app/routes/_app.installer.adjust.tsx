import { useTranslation } from "react-i18next"
import { data, Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.installer.adjust"

export const meta: Route.MetaFunction = () => [
	{ title: "Adjust Van Stock — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const [van, serviceCodes] = await Promise.all([
		db.van.findUnique({ where: { installerId: user.id } }),
		db.serviceCode.findMany({
			where: { active: true },
			orderBy: { claroCode: "asc" },
		}),
	])
	if (!van) throw redirect("/installer")
	return { van, serviceCodes }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["INSTALLER", "ADMIN"])
	const van = await db.van.findUnique({ where: { installerId: user.id } })
	if (!van) {
		return data({ errorKey: "installer_adjust.errors.no_van" }, { status: 400 })
	}

	const form = await request.formData()
	const serviceCodeId = (form.get("serviceCodeId") as string) || ""
	const qty = Number.parseInt((form.get("qty") as string) || "0", 10)
	const note = (form.get("note") as string | null)?.trim() || ""

	if (!serviceCodeId || Number.isNaN(qty) || qty <= 0) {
		return data(
			{ errorKey: "installer_adjust.errors.invalid_fields" },
			{ status: 400 },
		)
	}
	if (!note) {
		return data(
			{ errorKey: "installer_adjust.errors.note_required" },
			{ status: 400 },
		)
	}

	const warehouseUsers = await db.user.findMany({
		where: { role: { in: ["WAREHOUSE", "ADMIN"] }, active: true },
	})

	await db.$transaction([
		db.vanInventoryTransaction.create({
			data: {
				vanId: van.id,
				serviceCodeId,
				qty: -qty,
				type: "ADJUSTMENT",
				createdById: user.id,
				note,
			},
		}),
		...warehouseUsers.map((w: { id: string }) =>
			db.notification.create({
				data: {
					userId: w.id,
					message: `${van.name} reported ${qty} damaged/lost stock for ${serviceCodeId}: ${note}`,
				},
			}),
		),
	])

	throw redirect("/installer")
}

export default function AdjustStock({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes } = loaderData
	const { t } = useTranslation()
	const errorKey =
		actionData && "errorKey" in actionData
			? (actionData.errorKey as string)
			: null

	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">{t("installer_adjust.title")}</h1>

			{errorKey && <p className="text-sm text-red-600">{t(errorKey as any)}</p>}

			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="serviceCodeId">
						{t("installer_adjust.material_label")}
					</Label>
					<Select name="serviceCodeId" required>
						<SelectTrigger id="serviceCodeId" className="mt-1">
							<SelectValue
								placeholder={t("installer_adjust.material_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{serviceCodes.map(
								(c: { id: string; claroCode: string; name: string }) => (
									<SelectItem key={c.id} value={c.id}>
										{c.claroCode} — {c.name}
									</SelectItem>
								),
							)}
						</SelectContent>
					</Select>
				</div>

				<div>
					<Label htmlFor="qty">{t("installer_adjust.qty_label")}</Label>
					<Input
						id="qty"
						name="qty"
						type="number"
						min={1}
						required
						placeholder={t("installer_adjust.qty_placeholder")}
					/>
				</div>

				<div>
					<Label htmlFor="note">{t("installer_adjust.note_label")}</Label>
					<Textarea
						id="note"
						name="note"
						rows={3}
						required
						placeholder={t("installer_adjust.note_placeholder")}
					/>
				</div>

				<Button type="submit" className="w-full">
					{t("installer_adjust.submit")}
				</Button>
			</Form>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
