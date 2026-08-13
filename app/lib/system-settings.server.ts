import { db } from "./db.server"

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
