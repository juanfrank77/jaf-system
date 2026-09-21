import type { Prisma } from "../../generated/prisma/client"
import { db } from "./db.server"
import {
	type ParLevel,
	parseLegacyStockLevels,
	stockLevelsToLegacyJson,
} from "./van-stock"

export {
	computeParStatus,
	type ParLevel,
	type ParStatusLine,
	type ParseLegacyResult,
	parLevelsToStockLevels,
	parseLegacyStockLevels,
	stockLevelsToLegacyJson,
} from "./van-stock"

type VanStockWriteClient = Pick<
	Prisma.TransactionClient,
	"vanStockLevel" | "van"
>

function logFallback(vanId: string) {
	// biome-ignore lint/suspicious/noConsole: operational fallback signal for dual-read
	console.warn(`[van-stock] fallback_to_json vanId=${vanId}`)
}

/** Table rows when present; otherwise legacy JSON (same path as getVanParLevels). */
async function loadParLevelsForWrite(
	vanId: string,
	client: VanStockWriteClient,
): Promise<ParLevel[]> {
	const rows = await client.vanStockLevel.findMany({
		where: { vanId },
		select: { serviceCodeId: true, parLevel: true },
	})

	if (rows.length > 0) {
		return rows.map((row) => ({
			serviceCodeId: row.serviceCodeId,
			parLevel: row.parLevel,
		}))
	}

	const van = await client.van.findUnique({
		where: { id: vanId },
		select: { standardStockLevels: true },
	})
	if (!van) return []

	const { levels } = parseLegacyStockLevels(van.standardStockLevels)
	if (levels.length > 0) {
		logFallback(vanId)
	}
	return levels
}

export async function getVanParLevels(vanId: string): Promise<ParLevel[]> {
	return loadParLevelsForWrite(vanId, db)
}

export async function getVanParLevelsForVans(
	vanIds: string[],
): Promise<Map<string, ParLevel[]>> {
	const uniqueIds = [...new Set(vanIds)]
	const result = new Map<string, ParLevel[]>()
	if (uniqueIds.length === 0) return result

	const rows = await db.vanStockLevel.findMany({
		where: { vanId: { in: uniqueIds } },
		select: { vanId: true, serviceCodeId: true, parLevel: true },
	})

	for (const id of uniqueIds) {
		result.set(id, [])
	}
	for (const row of rows) {
		result.get(row.vanId)?.push({
			serviceCodeId: row.serviceCodeId,
			parLevel: row.parLevel,
		})
	}

	const needsFallback = uniqueIds.filter(
		(id) => (result.get(id)?.length ?? 0) === 0,
	)
	if (needsFallback.length === 0) return result

	const vans = await db.van.findMany({
		where: { id: { in: needsFallback } },
		select: { id: true, standardStockLevels: true },
	})

	for (const van of vans) {
		const { levels } = parseLegacyStockLevels(van.standardStockLevels)
		if (levels.length > 0) {
			logFallback(van.id)
			result.set(van.id, levels)
		}
	}

	return result
}

async function writeParLevels(
	client: VanStockWriteClient,
	vanId: string,
	merged: ParLevel[],
): Promise<void> {
	await Promise.all([
		...merged.map((level) =>
			client.vanStockLevel.upsert({
				where: {
					vanId_serviceCodeId: {
						vanId,
						serviceCodeId: level.serviceCodeId,
					},
				},
				create: {
					vanId,
					serviceCodeId: level.serviceCodeId,
					parLevel: level.parLevel,
				},
				update: { parLevel: level.parLevel },
			}),
		),
		client.van.update({
			where: { id: vanId },
			data: {
				standardStockLevels: stockLevelsToLegacyJson(merged),
			},
		}),
	])
}

export async function setVanParLevels(
	vanId: string,
	submitted: ParLevel[],
	mode: "create" | "update",
	tx?: VanStockWriteClient,
): Promise<ParLevel[]> {
	for (const level of submitted) {
		if (level.parLevel < 0) {
			throw new Error(`parLevel must be >= 0 for ${level.serviceCodeId}`)
		}
	}

	let merged: ParLevel[]

	if (mode === "create") {
		merged = submitted
	} else {
		const client = tx ?? db
		const existing = await loadParLevelsForWrite(vanId, client)
		const submittedIds = new Set(submitted.map((l) => l.serviceCodeId))
		const preserved = existing
			.filter((row) => !submittedIds.has(row.serviceCodeId))
			.map((row) => ({
				serviceCodeId: row.serviceCodeId,
				parLevel: row.parLevel,
			}))
		merged = [...preserved, ...submitted]
	}

	if (tx) {
		await writeParLevels(tx, vanId, merged)
	} else {
		await db.$transaction(async (transaction) => {
			await writeParLevels(transaction, vanId, merged)
		})
	}

	return merged
}
