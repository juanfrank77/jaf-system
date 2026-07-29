import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { requireRole } from "~/lib/permissions.server"
import { getIvuRate, setIvuRate } from "~/lib/system-settings.server"
import type { Route } from "./+types/_app.admin.settings"

export const meta: Route.MetaFunction = () => [
	{ title: "Admin Settings — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const ivuRate = await getIvuRate()
	return { ivuRate }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const rateRaw = form.get("ivu_rate") as string
	const rate = parseFloat(rateRaw)
	if (Number.isNaN(rate) || rate <= 0 || rate >= 1) {
		return {
			errorKey: "admin_settings.errors.invalid_rate",
		}
	}
	await setIvuRate(rate, user.id)
	return { success: true }
}

export default function AdminSettings({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { ivuRate } = loaderData
	const { t } = useTranslation()
	return (
		<div className="space-y-6 max-w-sm">
			<h1 className="text-xl font-semibold">{t("admin_settings.title")}</h1>

			<div className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.ivu_heading")}
				</h2>
				<p className="text-xs text-slate-500">
					{t("admin_settings.ivu_description", {
						current: (ivuRate * 100).toFixed(1),
					})}
				</p>
				<Form method="post" className="space-y-3">
					<div>
						<Label htmlFor="ivu_rate">{t("admin_settings.ivu_label")}</Label>
						<Input
							id="ivu_rate"
							name="ivu_rate"
							type="number"
							step="0.001"
							min="0"
							max="0.999"
							defaultValue={ivuRate}
							required
						/>
					</div>
					{(actionData as any)?.errorKey && (
						<p className="text-sm text-red-600">
							{t((actionData as any).errorKey)}
						</p>
					)}
					{(actionData as any)?.success && (
						<p className="text-sm text-green-600">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
