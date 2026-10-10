import type { ServiceCode } from "../../generated/prisma/client"
import { PENDING_CODE_PREFIX } from "./catalog-import"
import { db } from "./db.server"
import { toNumberPrice } from "./utils"

/**
 * Placeholder rows (`NEEDS_CODE_*`) stand in for materials whose SAP code the
 * client has not supplied. They are seeded inactive, but an admin toggle or a
 * stale DB can leave one active — and then it would be selectable as job
 * material and bill $0.00. Every picker/search query excludes them regardless.
 * The admin catalog and limit-table lookups (by id) are unaffected.
 */
const NOT_PENDING_CODE = {
	NOT: { claroCode: { startsWith: PENDING_CODE_PREFIX } },
}

type Cache = { data: ServiceCode[]; ts: number }
const TTL = 60_000
let allCache: Cache | null = null
let materialCache: Cache | null = null

export async function getActiveServiceCodes(): Promise<ServiceCode[]> {
	const now = Date.now()
	if (allCache && now - allCache.ts < TTL) return allCache.data
	const codes = await db.serviceCode.findMany({
		where: { active: true, ...NOT_PENDING_CODE },
	})
	allCache = { data: codes, ts: now }
	return codes
}

/** Material dropdowns (prep, pickup, field, van stock) read only MATERIAL rows. */
export async function getActiveMaterialCodes(): Promise<ServiceCode[]> {
	const now = Date.now()
	if (materialCache && now - materialCache.ts < TTL) return materialCache.data
	const codes = await db.serviceCode.findMany({
		where: { active: true, kind: "MATERIAL", ...NOT_PENDING_CODE },
		orderBy: { claroCode: "asc" },
	})
	materialCache = { data: codes, ts: now }
	return codes
}

export async function getSerializedCodes(): Promise<ServiceCode[]> {
	return db.serviceCode.findMany({
		where: { active: true, serialized: true, ...NOT_PENDING_CODE },
	})
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
			...NOT_PENDING_CODE,
			OR: [
				{ claroCode: { startsWith: term } },
				{ name: { contains: term, mode: "insensitive" } },
			],
		},
		orderBy: { claroCode: "asc" },
		take: limit,
	})
}

/**
 * Roles that never see money. CREW, WAREHOUSE and INSTALLER screens carry no prices
 * (mockup rule), so the catalog sent to their browsers must not contain any.
 * Stripping in the UI alone still ships the numbers in the page payload.
 */
const PRICE_BLIND_ROLES: readonly string[] = ["CREW", "WAREHOUSE", "INSTALLER"]

export function isPriceBlind(role: string): boolean {
	return PRICE_BLIND_ROLES.includes(role)
}

/**
 * Every ServiceCode column that is a price or a margin input. Keep this in
 * sync with the model: a new price-like column must be added here.
 */
const PRICE_FIELDS = [
	"unitPrice",
	"claroBasePrice",
	"upliftFactor",
	"contractorPrice",
	"contractorFactor",
] as const

export type ClientServiceCode = Omit<ServiceCode, "unitPrice"> & {
	unitPrice?: number
}

/**
 * Catalog rows as sent to the browser. Price-blind roles get the row with
 * every price field removed (`unitPrice` is absent, not zero, so a missing
 * price can never be mistaken for a free item); everyone else gets the row
 * with `unitPrice` as a number, as before.
 */
export function serviceCodesForRole(
	role: string,
	codes: ServiceCode[],
): ClientServiceCode[] {
	if (!isPriceBlind(role)) {
		return codes.map((c) => ({ ...c, unitPrice: toNumberPrice(c.unitPrice) }))
	}
	return codes.map((c) => {
		const safe: Record<string, unknown> = { ...c }
		for (const f of PRICE_FIELDS) delete safe[f]
		return safe as ClientServiceCode
	})
}
