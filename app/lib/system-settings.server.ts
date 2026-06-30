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
