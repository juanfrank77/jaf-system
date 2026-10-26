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

const DEFAULT_BANK_INVOICE_PREFIX = "M17"

/** Contract prefix on bank invoice numbers (`<prefix>-<aviso>`). */
export async function getBankInvoicePrefix(): Promise<string> {
	const setting = await db.systemSetting.findUnique({
		where: { key: "bank_invoice_prefix" },
	})
	const value = setting?.value?.trim()
	return value ? value : DEFAULT_BANK_INVOICE_PREFIX
}

export async function setBankInvoicePrefix(
	prefix: string,
	updatedById: string,
): Promise<void> {
	await db.systemSetting.upsert({
		where: { key: "bank_invoice_prefix" },
		update: { value: prefix.trim(), updatedById },
		create: { key: "bank_invoice_prefix", value: prefix.trim(), updatedById },
	})
}

const DEFAULT_INVOICE_DEPT = "012"
const DEFAULT_INVOICE_COST_CENTER = "641"

/**
 * DEPT. and CENTRO CODIGO COSTO printed on every maintenance invoice line.
 * They are the same for all maintenance work, so they are settings, not
 * per-service data; A/C is left blank on purpose.
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
