import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { parsePbccEmails } from "~/lib/bank-schedule"
import { requireRole } from "~/lib/permissions.server"
import {
	getAgingAlertDays,
	getAvisoAmountTolerance,
	getBankContractNumber,
	getInvoiceCodes,
	getInvoiceSignature,
	getIvuRate,
	getJobNumberFirst,
	getLcPbccAdvanceRate,
	getPayDayWeekday,
	getPbccEmail,
	setAgingAlertDays,
	setAvisoAmountTolerance,
	setBankContractNumber,
	setInvoiceCodes,
	setInvoiceSignature,
	setIvuRate,
	setJobNumberFirst,
	setLcPbccAdvanceRate,
	setPayDayWeekday,
	setPbccEmail,
} from "~/lib/system-settings.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.admin.settings"

export const meta: Route.MetaFunction = () => [
	{ title: "Admin Settings — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["ADMIN"])
	const [
		ivuRate,
		agingAlertDays,
		avisoAmountTolerance,
		lcPbccAdvanceRate,
		bankContractNumber,
		payDayWeekday,
		invoiceCodes,
		jobNumberFirst,
		pbccEmail,
		invoiceSignature,
	] = await Promise.all([
		getIvuRate(),
		getAgingAlertDays(),
		getAvisoAmountTolerance(),
		getLcPbccAdvanceRate(),
		getBankContractNumber(),
		getPayDayWeekday(),
		getInvoiceCodes(),
		getJobNumberFirst(),
		getPbccEmail(),
		getInvoiceSignature(),
	])
	return {
		ivuRate,
		agingAlertDays,
		avisoAmountTolerance,
		lcPbccAdvanceRate,
		bankContractNumber,
		pbccEmail,
		payDayWeekday,
		invoiceCodes,
		jobNumberFirst,
		invoiceSignature,
	}
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

	if (intent === "bank_prefix") {
		const contract = String(form.get("bank_contract_number") ?? "").trim()
		if (!/^[A-Za-z0-9-]{0,20}$/.test(contract)) {
			return { errorKey: "admin_settings.errors.invalid_bank_prefix" }
		}
		const pbccEmails = parsePbccEmails(String(form.get("pbcc_email") ?? ""))
		if (!pbccEmails)
			return { errorKey: "admin_settings.errors.invalid_pbcc_email" }
		await setBankContractNumber(contract, user.id)
		await setPbccEmail(pbccEmails.join(", "), user.id)
		return { successBankPrefix: true }
	}

	if (intent === "signature") {
		const file = form.get("signature")
		if (!(file instanceof File) || file.size === 0)
			return { errorKey: "admin_settings.errors.signature_not_image" }
		try {
			await setInvoiceSignature(
				new Uint8Array(await file.arrayBuffer()),
				user.id,
			)
		} catch (e) {
			return {
				errorKey:
					e instanceof Error && e.message === "signature_too_big"
						? "admin_settings.errors.signature_too_big"
						: "admin_settings.errors.signature_not_image",
			}
		}
		return { successSignature: true }
	}

	if (intent === "invoice_codes") {
		const dept = String(form.get("bank_invoice_dept") ?? "").trim()
		const costCenter = String(form.get("bank_invoice_cost_center") ?? "").trim()
		const first = Number.parseInt(String(form.get("job_number_first")), 10)
		if (
			!/^[A-Za-z0-9-]{1,10}$/.test(dept) ||
			!/^[A-Za-z0-9-]{1,10}$/.test(costCenter) ||
			!Number.isInteger(first) ||
			first < 1
		) {
			return { errorKey: "admin_settings.errors.invalid_invoice_codes" }
		}
		await setInvoiceCodes({ dept, costCenter }, user.id)
		await setJobNumberFirst(first, user.id)
		return { successInvoiceCodes: true }
	}

	if (intent === "pay_day") {
		const day = Number.parseInt(String(form.get("pay_day_weekday")), 10)
		if (!Number.isInteger(day) || day < 0 || day > 6) {
			return { errorKey: "admin_settings.errors.invalid_pay_day" }
		}
		await setPayDayWeekday(day, user.id)
		return { successPayDay: true }
	}

	return { errorKey: "admin_settings.errors.unknown_intent" }
}

export default function AdminSettings({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const {
		ivuRate,
		agingAlertDays,
		avisoAmountTolerance,
		lcPbccAdvanceRate,
		bankContractNumber,
		pbccEmail,
		payDayWeekday,
		invoiceCodes,
		jobNumberFirst,
		invoiceSignature,
	} = loaderData
	const { t } = useTranslation()
	const error =
		actionData && "errorKey" in actionData ? actionData.errorKey : null
	const success =
		actionData && "success" in actionData ? actionData.success : null
	const successLcPbccAdvance =
		actionData && "successLcPbccAdvance" in actionData
			? actionData.successLcPbccAdvance
			: null
	const successAging =
		actionData && "successAging" in actionData ? actionData.successAging : null
	const successBankPrefix =
		actionData && "successBankPrefix" in actionData
			? actionData.successBankPrefix
			: null
	const successInvoiceCodes =
		actionData && "successInvoiceCodes" in actionData
			? actionData.successInvoiceCodes
			: null
	const successPayDay =
		actionData && "successPayDay" in actionData
			? actionData.successPayDay
			: null
	const successTolerance =
		actionData && "successTolerance" in actionData
			? actionData.successTolerance
			: null

	return (
		<div className="space-y-6 max-w-sm">
			<h1 className="text-xl font-semibold">{t("admin_settings.title")}</h1>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.ivu_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
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
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{success && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.lc_pbcc_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("admin_settings.lc_pbcc_description", {
						current: (lcPbccAdvanceRate * 100).toFixed(1),
					})}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="lc_pbcc_advance" />
					<div>
						<Label htmlFor="lc_pbcc_advance_rate">
							{t("admin_settings.lc_pbcc_label")}
						</Label>
						<Input
							id="lc_pbcc_advance_rate"
							name="lc_pbcc_advance_rate"
							type="number"
							step="0.01"
							min="0.01"
							max="1"
							defaultValue={lcPbccAdvanceRate}
							required
						/>
					</div>
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successLcPbccAdvance && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.aging_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
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
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successAging && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.tolerance_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
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
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successTolerance && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.pay_day_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("admin_settings.pay_day_description")}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="pay_day" />
					<div>
						<Label htmlFor="pay_day_weekday">
							{t("admin_settings.pay_day_label")}
						</Label>
						<select
							id="pay_day_weekday"
							name="pay_day_weekday"
							defaultValue={payDayWeekday}
							className="h-9 w-full rounded-md border bg-background px-2 text-sm"
						>
							{[0, 1, 2, 3, 4, 5, 6].map((d) => (
								<option key={d} value={d}>
									{t(`admin_settings.weekday.${d}` as never)}
								</option>
							))}
						</select>
					</div>
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successPayDay && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.bank_prefix_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("admin_settings.bank_prefix_description")}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="bank_prefix" />
					<div>
						<Label htmlFor="bank_contract_number">
							{t("admin_settings.bank_contract_label")}
						</Label>
						<Input
							id="bank_contract_number"
							name="bank_contract_number"
							type="text"
							maxLength={20}
							defaultValue={bankContractNumber}
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							{t("admin_settings.bank_contract_description")}
						</p>
					</div>
					<div>
						<Label htmlFor="pbcc_email">
							{t("admin_settings.pbcc_email_label")}
						</Label>
						<Input
							id="pbcc_email"
							name="pbcc_email"
							type="text"
							defaultValue={pbccEmail ?? ""}
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							{t("admin_settings.pbcc_email_description")}
						</p>
					</div>
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successBankPrefix && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.signature_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("admin_settings.signature_description")}
				</p>
				{invoiceSignature ? (
					<img
						src={invoiceSignature}
						alt={t("admin_settings.signature_heading")}
						className="h-16 rounded border bg-white p-1"
					/>
				) : (
					<p className="text-sm text-status-danger">
						{t("admin_settings.signature_missing")}
					</p>
				)}
				<Form method="post" encType="multipart/form-data" className="space-y-3">
					<input type="hidden" name="intent" value="signature" />
					<div>
						<Label htmlFor="signature">
							{t("admin_settings.signature_label")}
						</Label>
						<Input
							id="signature"
							name="signature"
							type="file"
							accept="image/png,image/jpeg"
							required
						/>
					</div>
					{actionData && "successSignature" in actionData && (
						<p className="text-sm text-status-ok">
							{t("admin_settings.saved")}
						</p>
					)}
					<Button type="submit" size="sm">
						{t("admin_settings.save")}
					</Button>
				</Form>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="font-medium text-sm">
					{t("admin_settings.invoice_codes_heading")}
				</h2>
				<p className="text-xs text-muted-foreground">
					{t("admin_settings.invoice_codes_description")}
				</p>
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="invoice_codes" />
					<div>
						<Label htmlFor="bank_invoice_dept">
							{t("admin_settings.invoice_dept_label")}
						</Label>
						<Input
							id="bank_invoice_dept"
							name="bank_invoice_dept"
							defaultValue={invoiceCodes.dept}
							maxLength={10}
							required
						/>
					</div>
					<div>
						<Label htmlFor="bank_invoice_cost_center">
							{t("admin_settings.invoice_cost_center_label")}
						</Label>
						<Input
							id="bank_invoice_cost_center"
							name="bank_invoice_cost_center"
							defaultValue={invoiceCodes.costCenter}
							maxLength={10}
							required
						/>
					</div>
					<div>
						<Label htmlFor="job_number_first">
							{t("admin_settings.job_number_first_label")}
						</Label>
						<Input
							id="job_number_first"
							name="job_number_first"
							type="number"
							min={1}
							step={1}
							defaultValue={jobNumberFirst}
							required
						/>
						<p className="mt-1 text-xs text-muted-foreground">
							{t("admin_settings.job_number_first_hint")}
						</p>
					</div>
					{error && (
						<p className="text-sm text-status-danger">{t(error as never)}</p>
					)}
					{successInvoiceCodes && (
						<p className="text-sm text-status-ok">
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
