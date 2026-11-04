import { db } from "~/lib/db.server"
import { packageFiles } from "~/lib/package-files"
import { buildPackagePdfDetailed } from "~/lib/package-pdf.server"
import { zipPackage } from "~/lib/package-zip.server"
import { requireRole } from "~/lib/permissions.server"
import { assertDocInSupervisorScope } from "~/lib/supervisor-scope"
import { photoFile, photosThatLoad } from "~/lib/uploads.server"
import type { Route } from "./+types/_app.docs.$id_.package"

/**
 * Step 5 "Download all": the package for Claro as one PDF, or the original
 * files as a zip with `?format=zip`. Same people as the review page; 404 when
 * there is nothing to put in it, 422 when none of it can be read.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const format = new URL(request.url).searchParams.get("format")
	if (format !== null && format !== "pdf" && format !== "zip")
		return new Response("Bad request", { status: 400 })
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
	const inputs = files.map((f) => ({ name: f.fileName, path: f.path }))
	if (format !== "zip") {
		const { pdf, contentPages } = await buildPackagePdfDetailed(
			inputs,
			doc.controlNumber,
		)
		if (contentPages === 0)
			return new Response("None of the package files could be read", {
				status: 422,
			})
		return new Response(pdf as Uint8Array<ArrayBuffer>, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${doc.controlNumber}-package.pdf"`,
			},
		})
	}
	const zip = await zipPackage(inputs)
	return new Response(new Uint8Array(zip), {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-package.zip"`,
		},
	})
}
