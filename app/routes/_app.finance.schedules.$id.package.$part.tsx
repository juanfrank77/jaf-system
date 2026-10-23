import { db } from "~/lib/db.server"
import { checkBatch } from "~/lib/pbcc-batch.server"
import { buildPackagePart } from "~/lib/pbcc-package.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.schedules.$id.package.$part"

/**
 * One part of a closed batch's package for the PBCC email, as a zip. Nothing
 * downloads until the batch check is green; a sent batch's package stays
 * available, as it can no longer change.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const batch = await db.bankSchedule.findUnique({
		where: { id: params.id },
		select: { closedAt: true, sentAt: true },
	})
	if (!batch?.closedAt) return new Response("Not found", { status: 404 })
	if (!batch.sentAt && !(await checkBatch(params.id)).passed)
		return new Response("The batch check is not green", { status: 409 })
	const part = await buildPackagePart(params.id, Number(params.part))
	if (!part) return new Response("Not found", { status: 404 })
	return new Response(new Uint8Array(part.zip), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${part.filename}"`,
		},
	})
}
