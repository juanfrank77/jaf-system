import type {
	SerialRegisterRow,
	SerialRegisterStats,
} from "~/components/serial-register"
import type { db } from "~/lib/db.server"
import { paginate } from "~/lib/pagination"
import type { Prisma, SerialStatus } from "../../generated/prisma/client"

type Client = Prisma.TransactionClient | typeof db

const SERIAL_REGISTER_PAGE_SIZE = 15

// Statuses whose `currentRef` is a warehouse id. Everything else is keyed by a
// van, completion or repair batch, so it is not tied to the warehouse on screen.
const WAREHOUSE_KEYED: SerialStatus[] = [
	"WAREHOUSE",
	"RETURNED",
	"AWAITING_REPAIR",
	"NEEDS_REVIEW",
]
const NEEDS_ATTENTION: SerialStatus[] = [
	"REMOVED_PENDING_RETURN",
	"RETURNED",
	"NEEDS_REVIEW",
	"AWAITING_REPAIR",
	"SENT_FOR_REPAIR",
]

/**
 * One page of the serial register: every `SerialLocation` the selected
 * warehouse is responsible for or that is out in the field, newest movement
 * first, plus headline counts over the whole (unpaged) scope.
 */
export async function getSerialRegisterPage(
	client: Client,
	warehouseId: string,
	requestedPage: string | null,
) {
	const where: Prisma.SerialLocationWhereInput = {
		OR: [
			{ status: { notIn: WAREHOUSE_KEYED } },
			{ status: { in: WAREHOUSE_KEYED }, currentRef: warehouseId },
		],
	}
	const [byStatus, total] = await Promise.all([
		client.serialLocation.groupBy({
			by: ["status"],
			where,
			_count: true,
		}),
		client.serialLocation.count({ where }),
	])
	const count = (s: SerialStatus) =>
		byStatus.find((g) => g.status === s)?._count ?? 0
	const stats: SerialRegisterStats = {
		inWarehouse: count("WAREHOUSE"),
		onVans: count("VAN"),
		installed: count("INSTALLED"),
		needsAttention: NEEDS_ATTENTION.reduce((sum, s) => sum + count(s), 0),
	}

	const pageInfo = paginate(requestedPage, total, SERIAL_REGISTER_PAGE_SIZE)
	const locations = await client.serialLocation.findMany({
		where,
		orderBy: [{ since: "desc" }, { serial: "asc" }],
		skip: pageInfo.skip,
		take: pageInfo.take,
	})

	const vanIds = [
		...new Set(
			locations
				.filter(
					(l) => l.status === "VAN" || l.status === "REMOVED_PENDING_RETURN",
				)
				.map((l) => l.currentRef),
		),
	]
	const [codes, vans, movements] = await Promise.all([
		client.serviceCode.findMany({
			where: {
				id: { in: [...new Set(locations.map((l) => l.serviceCodeId))] },
			},
			select: { id: true, claroCode: true, canonicalName: true, name: true },
		}),
		client.van.findMany({
			where: { id: { in: vanIds } },
			select: { id: true, name: true },
		}),
		client.stockMovement.findMany({
			where: { serial: { in: locations.map((l) => l.serial) } },
			orderBy: { at: "desc" },
			distinct: ["serial"],
			select: { serial: true, type: true, at: true },
		}),
	])
	const codeById = new Map(codes.map((c) => [c.id, c]))
	const vanById = new Map(vans.map((v) => [v.id, v.name]))
	const lastBySerial = new Map(movements.map((m) => [m.serial, m]))

	const rows: SerialRegisterRow[] = locations.map((l) => {
		const code = codeById.get(l.serviceCodeId)
		const last = lastBySerial.get(l.serial)
		return {
			serial: l.serial,
			serviceCodeId: l.serviceCodeId,
			claroCode: code?.claroCode ?? "",
			material: code ? (code.canonicalName ?? code.name) : "",
			status: l.status,
			condition: l.condition,
			vanName: vanById.get(l.currentRef) ?? null,
			since: l.since.toISOString(),
			lastMovement: last
				? { type: last.type, at: last.at.toISOString() }
				: null,
		}
	})
	return {
		rows,
		stats,
		total,
		page: pageInfo.page,
		pageCount: pageInfo.pageCount,
		pageSize: SERIAL_REGISTER_PAGE_SIZE,
	}
}
