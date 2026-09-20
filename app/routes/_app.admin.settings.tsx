import type { ParseKeys, TFunction } from "i18next"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useFetcher } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { PageHeader } from "~/components/ui/page-header"
import { useToastManager } from "~/components/ui/toast"
import { requireRole } from "~/lib/permissions.server"
import {
	getAgingAlertDays,
	getAvisoAmountTolerance,
	getIvuRate,
	getLcPbccAdvanceRate,
	setAgingAlertDays,
	setAvisoAmountTolerance,
	setIvuRate,
	setLcPbccAdvanceRate,
} from "~/lib/system-settings.server"
import { cn } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.settings"

export const meta: Route.MetaFunction = () => [
	{ title: "Admin Settings — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const [ivuRate, agingAlertDays, avisoAmountTolerance, lcPbccAdvanceRate] =
		await Promise.all([
			getIvuRate(),
			getAgingAlertDays(),
			getAvisoAmountTolerance(),
			getLcPbccAdvanceRate(),
		])
	return { ivuRate, agingAlertDays, avisoAmountTolerance, lcPbccAdvanceRate }
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

	if (intent === "lc_pbcc_advance") {
		const rateRaw = form.get("lc_pbcc_advance_rate") as string
		const rate = Number(rateRaw)
		if (
			!/^\d+(\.\d+)?$/.test(rateRaw) ||
			!Number.isFinite(rate) ||
			rate <= 0 ||
			rate > 1
		) {
			return { errorKey: "admin_settings.errors.invalid_lc_pbcc_rate" }
		}
		await setLcPbccAdvanceRate(rate, user.id)
		return { successLcPbccAdvance: true }
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

function decimalToPercentDisplay(decimal: number): string {
	return String(Number((decimal * 100).toFixed(4)))
}

function percentDisplayToDecimalString(percentStr: string): string {
	const n = Number(percentStr)
	if (!Number.isFinite(n)) return percentStr
	return String(Number((n / 100).toFixed(6)))
}

function useSettingField(initial: string) {
	const [baseline, setBaseline] = useState(initial)
	const [value, setValue] = useState(initial)
	return {
		value,
		setValue,
		dirty: value !== baseline,
		commit: () => setBaseline(value),
		discard: () => setValue(baseline),
	}
}

type SettingField = ReturnType<typeof useSettingField>
type SubmitResult = { ok: boolean; errorKey?: string }

function useSubmitAndWait() {
	const fetcher = useFetcher<
		{ errorKey?: string } | { success?: boolean } | null
	>()
	const resolverRef = useRef<((result: SubmitResult) => void) | null>(null)

	useEffect(() => {
		if (fetcher.state === "idle" && resolverRef.current) {
			const resolve = resolverRef.current
			resolverRef.current = null
			const errorKey =
				fetcher.data && "errorKey" in fetcher.data
					? fetcher.data.errorKey
					: undefined
			resolve({ ok: !errorKey, errorKey })
		}
	}, [fetcher.state, fetcher.data])

	return (formData: FormData) =>
		new Promise<SubmitResult>((resolve) => {
			resolverRef.current = resolve
			fetcher.submit(formData, { method: "post" })
		})
}

function SettingRow({
	label,
	description,
	htmlFor,
	last,
	children,
}: {
	label: string
	description: string
	htmlFor: string
	last?: boolean
	children: React.ReactNode
}) {
	return (
		<div
			className={cn(
				"flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6",
				!last && "border-b border-border",
			)}
		>
			<div className="sm:max-w-md">
				<Label htmlFor={htmlFor}>{label}</Label>
				<p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
			</div>
			<div className="sm:w-44 sm:shrink-0">{children}</div>
		</div>
	)
}

function SettingsSection({
	title,
	rows,
	fields,
	submitters,
	t,
}: {
	title: string
	rows: React.ReactNode
	fields: SettingField[]
	submitters: (() => Promise<SubmitResult>)[]
	t: TFunction
}) {
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const dirty = fields.some((field) => field.dirty)
	const toastManager = useToastManager()

	async function handleSave() {
		setSaving(true)
		setError(null)
		const results = await Promise.all(submitters.map((submit) => submit()))
		setSaving(false)
		const failed = results.find((result) => !result.ok)
		if (failed) {
			setError(failed.errorKey ?? null)
			return
		}
		for (const field of fields) field.commit()
		toastManager.add({ title: t("admin_settings.saved_toast") })
	}

	function handleDiscard() {
		setError(null)
		for (const field of fields) field.discard()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent className="pt-0">{rows}</CardContent>
			{dirty && (
				<div className="sticky bottom-4 z-10 mx-6 mb-6 flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-md sm:flex-row sm:items-center sm:justify-between">
					<span className="text-sm text-muted-foreground">
						{error
							? t(error as ParseKeys)
							: t("admin_settings.unsaved_changes")}
					</span>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={handleDiscard}
							disabled={saving}
						>
							{t("admin_settings.discard")}
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={handleSave}
							loading={saving}
						>
							{t("admin_settings.save_changes")}
						</Button>
					</div>
				</div>
			)}
		</Card>
	)
}

export default function AdminSettings({ loaderData }: Route.ComponentProps) {
	const { ivuRate, agingAlertDays, avisoAmountTolerance, lcPbccAdvanceRate } =
		loaderData
	const { t } = useTranslation()

	const ivuField = useSettingField(decimalToPercentDisplay(ivuRate))
	const lcPbccField = useSettingField(
		decimalToPercentDisplay(lcPbccAdvanceRate),
	)
	const agingField = useSettingField(String(agingAlertDays))
	const toleranceField = useSettingField(String(avisoAmountTolerance))

	const submitIvu = useSubmitAndWait()
	const submitLcPbcc = useSubmitAndWait()
	const submitAging = useSubmitAndWait()
	const submitTolerance = useSubmitAndWait()

	return (
		<div className="mx-auto max-w-[880px]">
			<PageHeader
				title={t("admin_settings.title")}
				subtitle={t("admin_settings.subtitle")}
			/>

			<div className="space-y-6">
				<SettingsSection
					title={t("admin_settings.groups.tax_financing")}
					t={t}
					fields={[ivuField, lcPbccField]}
					submitters={[
						() => {
							const fd = new FormData()
							fd.set("intent", "ivu")
							fd.set("ivu_rate", percentDisplayToDecimalString(ivuField.value))
							return submitIvu(fd)
						},
						() => {
							const fd = new FormData()
							fd.set("intent", "lc_pbcc_advance")
							fd.set(
								"lc_pbcc_advance_rate",
								percentDisplayToDecimalString(lcPbccField.value),
							)
							return submitLcPbcc(fd)
						},
					]}
					rows={
						<>
							<SettingRow
								htmlFor="ivu_rate"
								label={t("admin_settings.ivu_label")}
								description={t("admin_settings.ivu_description")}
							>
								<Input
									id="ivu_rate"
									type="number"
									step="0.1"
									min="0"
									max="99.9"
									trailing="%"
									value={ivuField.value}
									onChange={(event) => ivuField.setValue(event.target.value)}
								/>
							</SettingRow>
							<SettingRow
								htmlFor="lc_pbcc_advance_rate"
								label={t("admin_settings.lc_pbcc_label")}
								description={t("admin_settings.lc_pbcc_description")}
								last
							>
								<Input
									id="lc_pbcc_advance_rate"
									type="number"
									step="1"
									min="1"
									max="100"
									trailing="%"
									value={lcPbccField.value}
									onChange={(event) => lcPbccField.setValue(event.target.value)}
								/>
							</SettingRow>
						</>
					}
				/>

				<SettingsSection
					title={t("admin_settings.groups.alerts")}
					t={t}
					fields={[agingField]}
					submitters={[
						() => {
							const fd = new FormData()
							fd.set("intent", "aging")
							fd.set("aging_alert_days", agingField.value)
							return submitAging(fd)
						},
					]}
					rows={
						<SettingRow
							htmlFor="aging_alert_days"
							label={t("admin_settings.aging_label")}
							description={t("admin_settings.aging_description")}
							last
						>
							<Input
								id="aging_alert_days"
								type="number"
								step="1"
								min="1"
								trailing={t("admin_settings.days_adornment")}
								value={agingField.value}
								onChange={(event) => agingField.setValue(event.target.value)}
							/>
						</SettingRow>
					}
				/>

				<SettingsSection
					title={t("admin_settings.groups.verification")}
					t={t}
					fields={[toleranceField]}
					submitters={[
						() => {
							const fd = new FormData()
							fd.set("intent", "tolerance")
							fd.set("aviso_amount_tolerance", toleranceField.value)
							return submitTolerance(fd)
						},
					]}
					rows={
						<SettingRow
							htmlFor="aviso_amount_tolerance"
							label={t("admin_settings.tolerance_label")}
							description={t("admin_settings.tolerance_description")}
							last
						>
							<Input
								id="aviso_amount_tolerance"
								type="number"
								step="0.01"
								min="0"
								leading="$"
								value={toleranceField.value}
								onChange={(event) =>
									toleranceField.setValue(event.target.value)
								}
							/>
						</SettingRow>
					}
				/>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
