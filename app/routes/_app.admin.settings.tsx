import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { requireRole } from "~/lib/permissions.server"
import {
	getAgingAlertDays,
	getAvisoAmountTolerance,
	getIvuRate,
	setAgingAlertDays,
	setAvisoAmountTolerance,
	setIvuRate,
} from "~/lib/system-settings.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.settings"

export const meta: Route.MetaFunction = () => [
	{ title: "Admin Settings — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const [ivuRate, agingAlertDays, avisoAmountTolerance] = await Promise.all([
		getIvuRate(),
		getAgingAlertDays(),
		getAvisoAmountTolerance(),
	])
	return { ivuRate, agingAlertDays, avisoAmountTolerance }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")

	if (intent === "ivu") {
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

	if (intent === "aging") {
		const daysRaw = form.get("aging_alert_days") as string
		const days = Number.parseInt(daysRaw, 10)
		if (Number.isNaN(days) || days <= 0) {
			return {
				errorKey: "admin_settings.errors.invalid_aging_days",
			}
		}
		await setAgingAlertDays(days, user.id)
		return { successAging: true }
	}

	if (intent === "tolerance") {
		const toleranceRaw = form.get("aviso_amount_tolerance") as string
		const tolerance = Number(toleranceRaw)
		const MAX_TOLERANCE = 1_000_000
		if (
			!/^\d+(\.\d+)?$/.test(toleranceRaw) ||
			Number.isNaN(tolerance) ||
			!Number.isFinite(tolerance) ||
			tolerance < 0 ||
			tolerance > MAX_TOLERANCE
		) {
			return {
				errorKey: "admin_settings.errors.invalid_tolerance",
			}
		}
		await setAvisoAmountTolerance(tolerance, user.id)
		return { successTolerance: true }
	}

	return { errorKey: "admin_settings.errors.unknown_intent" }
}

export default function AdminSettings({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { ivuRate, agingAlertDays, avisoAmountTolerance } = loaderData
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const success =
		actionData && "success" in actionData ? actionData.success : null
	const successAging =
		actionData && "successAging" in actionData ? actionData.successAging : null
	const successTolerance =
		actionData && "successTolerance" in actionData
			? actionData.successTolerance
			: null

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
					<input type="hidden" name="intent" value="ivu" />
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
					{error && <p className="text-sm text-red-600">{t(error as any)}</p>}
					{success && (
						<p className="text-sm text-green-600">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.aging_heading")}
				</h2>
				<p className="text-xs text-slate-500">
					{t("admin_settings.aging_description", {
						current: agingAlertDays,
					})}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="aging" />
					<div>
						<Label htmlFor="aging_alert_days">
							{t("admin_settings.aging_label")}
						</Label>
						<Input
							id="aging_alert_days"
							name="aging_alert_days"
							type="number"
							step="1"
							min="1"
							defaultValue={agingAlertDays}
							required
						/>
					</div>
					{error && <p className="text-sm text-red-600">{t(error as any)}</p>}
					{successAging && (
						<p className="text-sm text-green-600">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-white border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.tolerance_heading")}
				</h2>
				<p className="text-xs text-slate-500">
					{t("admin_settings.tolerance_description", {
						current: formatMoney(avisoAmountTolerance),
					})}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="tolerance" />
					<div>
						<Label htmlFor="aviso_amount_tolerance">
							{t("admin_settings.tolerance_label")}
						</Label>
						<Input
							id="aviso_amount_tolerance"
							name="aviso_amount_tolerance"
							type="number"
							step="0.01"
							min="0"
							defaultValue={avisoAmountTolerance}
							required
						/>
					</div>
					{error && <p className="text-sm text-red-600">{t(error as any)}</p>}
					{successTolerance && (
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
