import { BANK_INVOICE_PREFIX, contractLabel } from "~/lib/bank-schedule"
import { DEFAULT_PAY_DAY } from "~/lib/pay-day"
import { db } from "./db.server"

const DEFAULT_LC_PBCC_ADVANCE_RATE = 0.8

export async function getIvuRate(): Promise<number> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "ivu_rate" },
	})
	return parseFloat(setting?.value ?? "0.115")
}

export async function setIvuRate(
	rate: number,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "ivu_rate" },
		update: { value: String(rate), updatedById },
		create: { key: "ivu_rate", value: String(rate), updatedById },
	})
}

export async function getAgingAlertDays(): Promise<number> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "aging_alert_days" },
	})
	const parsed = Number.parseInt(setting?.value ?? "30", 10)
	return Number.isNaN(parsed) || parsed <= 0 ? 30 : parsed
}

export async function setAgingAlertDays(
	days: number,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "aging_alert_days" },
		update: { value: String(days), updatedById },
		create: { key: "aging_alert_days", value: String(days), updatedById },
	})
}

export async function getAvisoAmountTolerance(): Promise<number> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "aviso_amount_tolerance" },
	})
	const parsed = Number(setting?.value ?? "0.01")
	const MAX_TOLERANCE = 1_000_000
	if (
		Number.isNaN(parsed) ||
		!Number.isFinite(parsed) ||
		parsed < 0 ||
		parsed > MAX_TOLERANCE
	)
		return 0.01
	return parsed
}

export async function setAvisoAmountTolerance(
	tolerance: number,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "aviso_amount_tolerance" },
		update: { value: String(tolerance), updatedById },
		create: {
			key: "aviso_amount_tolerance",
			value: String(tolerance),
			updatedById,
		},
	})
}

export async function getLcPbccAdvanceRate(): Promise<number> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "lc_pbcc_advance_rate" },
	})
	const parsed = Number(setting?.value ?? DEFAULT_LC_PBCC_ADVANCE_RATE)
	if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1)
		return DEFAULT_LC_PBCC_ADVANCE_RATE
	return parsed
}

export async function setLcPbccAdvanceRate(
	rate: number,
	updatedById: string,
): Promise<void> {
	if (!Number.isFinite(rate) || rate <= 0 || rate > 1)
		throw new Error("LC/PBCC advance rate must be greater than 0 and at most 1")
	await db.systemSetting.upsert({
		where: { key: "lc_pbcc_advance_rate" },
		update: { value: String(rate), updatedById },
		create: { key: "lc_pbcc_advance_rate", value: String(rate), updatedById },
	})
}

/**
 * JAF's contract number with PBCC, printed as "Contrato Núm." on every bank
 * invoice. Unset until Lissette provides it; the invoice then carries the
 * placeholder ("17-xxx"), which is the one thing to fix before go-live.
 */
export async function getBankContractNumber(): Promise<string> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "bank_contract_number" },
	})
	const value = setting?.value?.trim()
	return value ? value : contractLabel(BANK_INVOICE_PREFIX)
}

/** An empty value clears the setting, back to the placeholder. */
export async function setBankContractNumber(
	contract: string,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "bank_contract_number" },
		update: { value: contract.trim(), updatedById },
		create: {
			key: "bank_contract_number",
			value: contract.trim(),
			updatedById,
		},
	})
}

const DEFAULT_INVOICE_DEPT = "012"
const DEFAULT_INVOICE_COST_CENTER = "641"

/**
 * DEPT. and CENTRO CODIGO COSTO printed on every maintenance invoice line.
 * They are the same for all maintenance work, so they are settings, not
 * per-service data.
 */
export async function getInvoiceCodes(): Promise<{
	dept: string
	costCenter: string
}> {
	const rows = await db.systemSetting.findMany({
		where: { key: { in: ["bank_invoice_dept", "bank_invoice_cost_center"] } },
	})
	const get = (key: string, fallback: string) =>
		rows.find((r) => r.key === key)?.value?.trim() || fallback
	return {
		dept: get("bank_invoice_dept", DEFAULT_INVOICE_DEPT),
		costCenter: get("bank_invoice_cost_center", DEFAULT_INVOICE_COST_CENTER),
	}
}

export async function setInvoiceCodes(
	codes: { dept: string; costCenter: string },
	updatedById: string,
): Promise<void> {
	for (const [key, value] of [
		["bank_invoice_dept", codes.dept.trim()],
		["bank_invoice_cost_center", codes.costCenter.trim()],
	] as const) {
		await db.systemSetting.upsert({
			where: { key },
			update: { value, updatedById },
			create: { key, value, updatedById },
		})
	}
}

/** The job number the series starts at until the first one is assigned. */
export async function getJobNumberFirst(): Promise<number> {
	const s = await db.systemSetting.findUnique({
		where: { key: "job_number_first" },
	})
	const n = s ? Number(s.value) : NaN
	return Number.isInteger(n) && n > 0 ? n : 1
}

export async function setJobNumberFirst(
	first: number,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "job_number_first" },
		update: { value: String(first), updatedById },
		create: { key: "job_number_first", value: String(first), updatedById },
	})
}

/** Weekday brigades are paid, 0 = Sunday .. 6 = Saturday. Thursday unless set. */
export async function getPayDayWeekday(): Promise<number> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "pay_day_weekday" },
	})
	const parsed = Number.parseInt(setting?.value ?? "", 10)
	return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
		? parsed
		: DEFAULT_PAY_DAY
}

export async function setPayDayWeekday(
	weekday: number,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "pay_day_weekday" },
		update: { value: String(weekday), updatedById },
		create: { key: "pay_day_weekday", value: String(weekday), updatedById },
	})
}

/** Where "Send to PBCC" goes, one address or several, comma separated. Unset until JAF gives them. */
export async function getPbccEmail(): Promise<string | null> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "pbcc_email" },
	})
	return setting?.value?.trim() || null
}

export async function setPbccEmail(email: string, updatedById: string) {
	await db.systemSetting.upsert({
		where: { key: "pbcc_email" },
		update: { value: email.trim(), updatedById },
		create: { key: "pbcc_email", value: email.trim(), updatedById },
	})
}

const MAX_SIGNATURE_BYTES = 1024 * 1024

function signatureMime(b: Uint8Array): string | null {
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
		return "image/png"
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
	return null
}

/**
 * Lissette's signature, stamped on a Claro invoice when it is made. It lives here
 * rather than in the uploads, so no file route can ever serve it; the invoice
 * service and the Admin settings page are its only readers.
 */
export async function getInvoiceSignature(): Promise<string | null> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "invoice_signature" },
	})
	return setting?.value || null
}

export async function setInvoiceSignature(
	bytes: Uint8Array,
	updatedById: string,
): Promise<void> {
	const mime = signatureMime(bytes)
	if (!mime) throw new Error("signature_not_image")
	if (bytes.length > MAX_SIGNATURE_BYTES) throw new Error("signature_too_big")
	const value = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
	await db.systemSetting.upsert({
		where: { key: "invoice_signature" },
		update: { value, updatedById },
		create: { key: "invoice_signature", value, updatedById },
	})
}
