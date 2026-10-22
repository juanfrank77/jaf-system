import { db } from "~/lib/db.server"
import { Prisma } from "../../generated/prisma/client"
import { WAREHOUSE_QUEUES, type WarehouseQueue } from "./warehouse-queues"

export function warehouseQueueWhere(
	queue: WarehouseQueue,
): Prisma.JafInvoiceWhereInput {
	switch (queue) {
		case "prep":
			return { status: "CREATED" }
		case "release":
			return { status: "PREPPED" }
		case "returns":
			return {
				status: { in: ["SIGNED", "FIELD_UPDATED"] },
				// A no-warehouse job never took material out, so nothing comes back.
				materialsFromWarehouse: true,
				materialsReturned: { equals: Prisma.DbNull },
			}
	}
}

export async function countWarehouseQueues(): Promise<
	Record<WarehouseQueue, number>
> {
	const [prep, release, returns] = await Promise.all(
		WAREHOUSE_QUEUES.map((q) =>
			db.jafInvoice.count({ where: warehouseQueueWhere(q) }),
		),
	)
	return { prep, release, returns }
}
