import { db } from "./db.server"

type ServiceCode = {
	id: string
	claroCode: string
	name: string
	description: string | null
	unit: string
	unitPrice: unknown
	accountCode: string | null
	subAct: string | null
	dept: string | null
	profitCenter: string | null
	act: string | null
	costCenterCode: string | null
	active: boolean
}

let cache: { data: ServiceCode[]; ts: number } | null = null
const TTL = 60_000

export async function getActiveServiceCodes(): Promise<ServiceCode[]> {
	const now = Date.now()
	if (cache && now - cache.ts < TTL) {
		return cache.data
	}
	const codes = await db.serviceCode.findMany({ where: { active: true } })
	cache = { data: codes, ts: now }
	return codes
}
