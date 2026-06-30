import { db } from "./db.server"

export async function generateControlNumber(dateStr?: string): Promise<string> {
	const d = dateStr
		? new Date(
				parseInt(dateStr.slice(0, 4)),
				parseInt(dateStr.slice(5, 7)) - 1,
				parseInt(dateStr.slice(8, 10)),
			)
		: new Date()
	const yy = String(d.getFullYear()).slice(2)
	const mm = String(d.getMonth() + 1).padStart(2, "0")
	const dd = String(d.getDate()).padStart(2, "0")
	const prefix = `MAINT-${yy}${mm}${dd}`

	const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
	const endOfDay = new Date(startOfDay.getTime() + 86400000)

	const count = await db.jafInvoice.count({
		where: { createdAt: { gte: startOfDay, lt: endOfDay } },
	})

	const seq = String(count + 1).padStart(3, "0")
	return `${prefix}-${seq}`
}
