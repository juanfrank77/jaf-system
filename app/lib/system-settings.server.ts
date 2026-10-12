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
