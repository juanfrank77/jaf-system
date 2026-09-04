import { db } from "~/lib/db.server"
import { generateAuditPackagePdf } from "~/lib/pdf/audit-package.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id_.audit-package"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["SUPERVISOR", "FINANCE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
		include: {
			photos: true,
			auditTrail: { include: { user: true }, orderBy: { timestamp: "asc" } },
			warehouse: true,
		},
	})
	const serviceCodes = await db.serviceCode.findMany()
	const codeMap = Object.fromEntries(
		serviceCodes.map((c) => [
			c.id,
			{ claroCode: c.claroCode, name: c.name, unit: c.unit },
		]),
	)

	const pdfBytes = await generateAuditPackagePdf(
		{
			controlNumber: doc.controlNumber,
			jobType: doc.jobType,
			jobAddressEstimated: doc.jobAddressEstimated,
			jobAddressActual: doc.jobAddressActual,
			avisoNumber: doc.avisoNumber,
			createdAt: doc.createdAt,
			signedAt: doc.signedAt,
			supervisorApprovedAt: doc.supervisorApprovedAt,
			lcGeneratedAt: doc.lcGeneratedAt,
			releaseSignature: doc.releaseSignature,
			crewSignature: doc.crewSignature,
			warehouseName: doc.warehouse?.name ?? null,
			materialsTaken:
				(doc.materialsTaken as { serviceCodeId: string; qty: number }[]) ?? [],
			materialsUsed:
				(doc.materialsUsed as { serviceCodeId: string; qty: number }[]) ?? [],
			auditTrail: doc.auditTrail as unknown as {
				action: string
				timestamp: Date
				user: { name: string }
			}[],
			photos: doc.photos,
		},
		codeMap,
	)

	return new Response(new Uint8Array(pdfBytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${doc.controlNumber}-audit.pdf"`,
		},
	})
}
