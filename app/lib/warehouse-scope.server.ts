import { db } from "~/lib/db.server"
import type { Prisma } from "../../generated/prisma/client"

type DB = Prisma.TransactionClient | typeof db

function readCookie(header: string | null, name: string): string | undefined {
	const raw = header
		?.split(";")
		.map((c) => c.trim().split("="))
		.find(([k]) => k === name)?.[1]
	// The switch writes the value URL-encoded; decode defensively (a malformed
	// value is treated as absent, not thrown — it is only a UI preference and
	// is validated against the user's assignments below either way).
	if (raw === undefined) return undefined
	try {
		return decodeURIComponent(raw)
	} catch {
		return undefined
	}
}

/**
 * The set of warehouses a user may act in and which one is currently selected.
 * Visible = the user's assignments (ADMIN sees all active); the selection comes
 * from the `wh` cookie when it is in the visible set, else the first. Spec B's
 * multi-warehouse switch (Task 4) and every warehouse-scoped query read this.
 */
export async function resolveWarehouseScope(
	client: DB,
	request: Request,
	user: { id: string; role: string },
) {
	const warehouses =
		user.role === "ADMIN"
			? await client.warehouse.findMany({
					where: { active: true },
					select: { id: true, name: true },
				})
			: (
					await client.warehouseAssignment.findMany({
						where: { userId: user.id },
						// Deterministic order matters: with no `wh` cookie the default
						// selection is `warehouses[0]`, and that default is now the
						// warehouse a triage disposition / repair-batch WRITE is
						// attributed to. Unordered, Postgres could return either
						// assignment first and the same user could write under a
						// different warehouse run to run. "Oldest assignment wins" is
						// the rule the deleted `getActiveWarehouseId` used.
						orderBy: { createdAt: "asc" },
						include: { warehouse: { select: { id: true, name: true } } },
					})
				).map((a) => a.warehouse)
	const cookieId = readCookie(request.headers.get("cookie"), "wh")
	const selectedId =
		warehouses.find((w) => w.id === cookieId)?.id ?? warehouses[0]?.id
	return { warehouses, selectedId }
}

/**
 * Is this user assigned to this warehouse at all (lead or counter)?
 *
 * The counter-level actions (receive) take `warehouseId` from the POST body,
 * so they must verify assignment membership — `requireWarehouseLead` would be
 * the wrong gate there (spec §5 puts receiving at Counter level). ADMIN is
 * handled by callers (ADMIN = all warehouses, §4.6).
 */
export async function isWarehouseMember(userId: string, warehouseId: string) {
	const a = await db.warehouseAssignment.findUnique({
		where: { userId_warehouseId: { userId, warehouseId } },
		select: { id: true },
	})
	return a !== null
}

// NOTE: `getActiveWarehouseId` (first assignment by createdAt, throws with no
// assignment) used to live here and was used by Spec A's triage / repairs /
// needs-review / dashboard. It ignored the `wh` cookie, so the header switch
// was silently a no-op on those screens — a lead could switch to warehouse B
// and still have a disposition written under warehouse A — and its bare throw
// became an unhandled 500 for an ADMIN (who has no WarehouseAssignment row).
// Every caller now uses `resolveWarehouseScope` above; do not reintroduce a
// second scoping helper.
