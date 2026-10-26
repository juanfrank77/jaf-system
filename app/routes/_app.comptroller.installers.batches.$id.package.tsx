import { buildEwitPackage, EwitError } from "~/lib/ewit.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.comptroller.installers.batches.$id.package"

/** The Excel and every EWIT PDF, named by row, as one zip. Only once the batch check is green. */
export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	try {
		const { zip, name } = await buildEwitPackage(params.id)
		return new Response(new Uint8Array(zip), {
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${name}"`,
			},
		})
	} catch (e) {
		if (e instanceof EwitError)
			throw new Response(e.code, { status: e.code === "not_found" ? 404 : 409 })
		throw e
	}
}
