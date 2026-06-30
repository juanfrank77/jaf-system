import { Link } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { buttonVariants } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id"

export async function loader({ request, params }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	const serviceCodes = await db.serviceCode.findMany()
	const supervisor = await db.user.findUnique({
		where: { id: doc.supervisorId },
	})
	const assignedCrew = await db.user.findMany({
		where: { id: { in: doc.assignedCrewIds } },
	})
	const auditTrail = await db.auditTrail.findMany({
		where: { docId: doc.id },
		include: { user: true },
		orderBy: { timestamp: "asc" },
	})
	return { doc, user, serviceCodes, supervisor, assignedCrew, auditTrail }
}

function nextActionHref(
	doc: any,
	userRole: string,
	userId: string,
): string | null {
	if (doc.status === "CREATED" && userRole === "WAREHOUSE")
		return `/docs/${doc.id}/prep`
	if (
		doc.status === "PREPPED" &&
		(userRole === "WAREHOUSE" ||
			userRole === "CREW" ||
			doc.assignedCrewIds?.includes(userId))
	)
		return `/docs/${doc.id}/sign`
	if (doc.status === "SIGNED" && doc.assignedCrewIds?.includes(userId))
		return `/docs/${doc.id}/field`
	if (
		doc.status === "FIELD_UPDATED" &&
		(userRole === "SUPERVISOR" || userRole === "ADMIN")
	)
		return `/docs/${doc.id}/review`
	if (doc.status === "CLARO_UPLOADED" && userRole === "FINANCE")
		return `/docs/${doc.id}/lc`
	return null
}

function nextActionLabel(status: string): string {
	if (status === "CREATED") return "Mark as Prepped"
	if (status === "PREPPED") return "Capture Crew Signature"
	if (status === "SIGNED") return "Update from Field"
	if (status === "FIELD_UPDATED") return "Review & Approve"
	if (status === "CLARO_UPLOADED") return "Generate LC Request"
	return "Next Action"
}

export default function DocView({ loaderData }: Route.ComponentProps) {
	const { doc, user, serviceCodes, supervisor, assignedCrew, auditTrail } =
		loaderData
	const nextHref = nextActionHref(doc, user.role, user.id)
	const estimated = (doc.estimatedMaterials as any[]) || []
	const taken = (doc.materialsTaken as any[]) || []
	const used = (doc.materialsUsed as any[]) || []

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-mono font-bold text-lg">{doc.controlNumber}</h1>
					<p className="text-sm text-slate-500">{doc.jobType}</p>
				</div>
				<span className="text-xs bg-slate-100 px-3 py-1 rounded-full font-medium">
					{doc.status.replace(/_/g, " ")}
				</span>
			</div>

			<section className="bg-white border rounded-lg p-4 space-y-2 text-sm">
				<p>
					<span className="text-slate-500">Address:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				{doc.avisoNumber && (
					<p>
						<span className="text-slate-500">Aviso #:</span> {doc.avisoNumber}
					</p>
				)}
				<p>
					<span className="text-slate-500">Supervisor:</span> {supervisor?.name}
				</p>
				<p>
					<span className="text-slate-500">Crew:</span>{" "}
					{assignedCrew.map((c) => c.name).join(", ")}
				</p>
				<p>
					<span className="text-slate-500">Created:</span>{" "}
					{new Date(doc.createdAt).toLocaleString()}
				</p>
			</section>

			{estimated.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						Estimated Materials
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={estimated}
						readOnly
					/>
				</section>
			)}

			{taken.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						Materials Taken (Signed)
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={taken}
						readOnly
					/>
					{doc.crewSignature && (
						<img
							src={doc.crewSignature}
							alt="Crew signature"
							className="mt-3 border rounded max-h-16"
						/>
					)}
				</section>
			)}

			{used.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						Materials Used (Field)
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={used}
						readOnly
					/>
					{doc.fieldNotes && (
						<p className="text-sm text-slate-600 mt-2">{doc.fieldNotes}</p>
					)}
				</section>
			)}

			{nextHref && (
				<Link to={nextHref} className={buttonVariants({ className: "w-full" })}>
					{nextActionLabel(doc.status)}
				</Link>
			)}

			{(user.role === "SUPERVISOR" ||
				user.role === "FINANCE" ||
				user.role === "ADMIN") && (
				<a
					href={`/docs/${(doc as any).id}/audit-package`}
					className="block text-center text-sm text-slate-500 hover:text-slate-700 underline mt-2"
					target="_blank"
					rel="noreferrer"
				>
					Download Audit Package
				</a>
			)}

			{auditTrail.length > 0 && (
				<section className="text-xs text-slate-400 space-y-1 pt-2 border-t">
					<p className="font-medium text-slate-500">Audit Trail</p>
					{auditTrail.map((a) => (
						<p key={a.id}>
							{new Date(a.timestamp).toLocaleString()} — {a.user.name}:{" "}
							{a.action}
						</p>
					))}
				</section>
			)}
		</div>
	)
}
