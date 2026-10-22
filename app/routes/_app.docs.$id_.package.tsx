import { db } from "~/lib/db.server"
import { packageFiles } from "~/lib/package-files"
import { zipPackage } from "~/lib/package-zip.server"
import { requireRole } from "~/lib/permissions.server"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import { photoFile, photosThatLoad } from "~/lib/uploads.server"
import type { Route } from "./+types/_app.docs.$id_.package"

/**
 * Step 5 · "Download all (zip)": the package for Claro (the JAF work order
 * PDF, the Prefield PDF when the job needs it, the original photos and
 * blueprints), byte for byte as stored. The same people as the review page
 * may download it; 404 when there is nothing to put in it.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const doc = await db.jafInvoice.findUnique({
		where: { id: params.id },
		include: { brigade: { select: { area: true } } },
	})
	if (!doc) return new Response("Not found", { status: 404 })
	if (user.role === "SUPERVISOR")
		await assertDocInSupervisorScope(db, user.id, doc)
	const photos = await photosThatLoad(
		doc.id,
		await db.photo.findMany({
			where: { docId: doc.id },
			select: { localPath: true, takenAt: true, tag: true },
		}),
	)
	// The file the viewer serves for each photo row.
	const files = packageFiles(
		doc,
		photos.map((p) => ({
			localPath: photoFile(doc.id, p.localPath),
			takenAt: p.takenAt,
			tag: p.tag,
		})),
	)
	if (files.length === 0) return new Response("Not found", { status: 404 })
	const zip = await zipPackage(
		files.map((f) => ({ name: f.fileName, path: f.path })),
	)
	return new Response(new Uint8Array(zip), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-package.zip"`,
		},
	})
}
