import type { ServiceCode } from "../../generated/prisma/client"
import { db } from "./db.server"

type Cache = { data: ServiceCode[]; ts: number }
const TTL = 60_000
let allCache: Cache | null = null
let materialCache: Cache | null = null

export async function getActiveServiceCodes(): Promise<ServiceCode[]> {
	const now = Date.now()
	if (allCache && now - allCache.ts < TTL) return allCache.data
	const codes = await db.serviceCode.findMany({ where: { active: true } })
	allCache = { data: codes, ts: now }
	return codes
}

/** Material dropdowns (prep, pickup, field, van stock) read only MATERIAL rows. */
export async function getActiveMaterialCodes(): Promise<ServiceCode[]> {
	const now = Date.now()
	if (materialCache && now - materialCache.ts < TTL) return materialCache.data
	const codes = await db.serviceCode.findMany({
		where: { active: true, kind: "MATERIAL" },
		orderBy: { claroCode: "asc" },
	})
	materialCache = { data: codes, ts: now }
	return codes
}

export async function getSerializedCodes(): Promise<ServiceCode[]> {
	return db.serviceCode.findMany({ where: { active: true, serialized: true } })
}

/** Resolves a scanned serial to its SKU by matching the serialized codes' prefix. */
export function resolveSerial<T extends { serialPrefix: string | null }>(
	serial: string,
	serializedCodes: T[],
): T | null {
	return (
		serializedCodes.find(
			(c) => c.serialPrefix && serial.startsWith(c.serialPrefix),
		) ?? null
	)
}

/** Picker search over the SERVICE catalog. Never auto-selects; the caller shows every hit. */
export async function searchServiceCodes(
	q: string,
	limit = 25,
): Promise<ServiceCode[]> {
	const term = q.trim()
	if (!term) return []
	return db.serviceCode.findMany({
		where: {
			active: true,
			kind: "SERVICE",
			OR: [
				{ claroCode: { startsWith: term } },
				{ name: { contains: term, mode: "insensitive" } },
			],
		},
		orderBy: { claroCode: "asc" },
		take: limit,
	})
}
