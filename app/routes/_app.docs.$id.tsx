import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { buttonVariants } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id"

export const meta: Route.MetaFunction = ({ data }) => [
	{ title: data ? `${data.doc.controlNumber} — JAF Ops` : "JAF Ops" },
]

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
	return {
		doc,
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: Number(c.unitPrice),
		})),
		supervisor,
		assignedCrew,
		auditTrail,
	}
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

type NextActionLabelKey =
	| "docs_view.next_action.mark_prepped"
	| "docs_view.next_action.capture_signature"
	| "docs_view.next_action.update_from_field"
	| "docs_view.next_action.review_approve"
	| "docs_view.next_action.generate_lc"
	| "docs_view.next_action.default"

function nextActionLabelKey(status: string): NextActionLabelKey {
	if (status === "CREATED") return "docs_view.next_action.mark_prepped"
	if (status === "PREPPED") return "docs_view.next_action.capture_signature"
	if (status === "SIGNED") return "docs_view.next_action.update_from_field"
	if (status === "FIELD_UPDATED") return "docs_view.next_action.review_approve"
	if (status === "CLARO_UPLOADED") return "docs_view.next_action.generate_lc"
	return "docs_view.next_action.default"
}

export default function DocView({ loaderData }: Route.ComponentProps) {
	const { doc, user, serviceCodes, supervisor, assignedCrew, auditTrail } =
		loaderData
	const { t } = useTranslation()
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
					<span className="text-slate-500">{t("docs_view.address")}:</span>{" "}
					{doc.jobAddressActual || doc.jobAddressEstimated}
				</p>
				{doc.avisoNumber && (
					<p>
						<span className="text-slate-500">
							{t("docs_view.aviso_number")}:
						</span>{" "}
						{doc.avisoNumber}
					</p>
				)}
				<p>
					<span className="text-slate-500">{t("docs_view.supervisor")}:</span>{" "}
					{supervisor?.name}
				</p>
				<p>
					<span className="text-slate-500">{t("docs_view.crew")}:</span>{" "}
					{assignedCrew.map((c) => c.name).join(", ")}
				</p>
				<p>
					<span className="text-slate-500">{t("docs_view.created")}:</span>{" "}
					{new Date(doc.createdAt).toLocaleString()}
				</p>
			</section>

			{estimated.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.estimated_materials")}
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
						{t("docs_view.materials_taken")}
					</h2>
					<MaterialLineItems
						serviceCodes={serviceCodes as any}
						initialItems={taken}
						readOnly
					/>
					{doc.crewSignature && (
						<img
							src={doc.crewSignature}
							alt={t("docs_view.crew_signature_alt")}
							className="mt-3 border rounded max-h-16"
						/>
					)}
				</section>
			)}

			{used.length > 0 && (
				<section className="bg-white border rounded-lg p-4">
					<h2 className="text-sm font-medium mb-2 text-slate-600">
						{t("docs_view.materials_used")}
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
					{t(nextActionLabelKey(doc.status))}
				</Link>
			)}

			{(user.role === "SUPERVISOR" ||
				user.role === "FINANCE" ||
				user.role === "ADMIN") && (
				<a
					href={`/docs/${(doc as any).id}/audit-package`}
					className={buttonVariants({
						variant: "outline",
						className: "mt-2 bg-primary text-primary-foreground",
					})}
					target="_blank"
					rel="noreferrer"
				>
					{t("docs_view.download_audit_package")}
				</a>
			)}

			{auditTrail.length > 0 && (
				<section className="space-y-2 pt-3 border-t">
					<p className="text-sm font-semibold text-foreground">
						{t("docs_view.audit_trail")}
					</p>
					{auditTrail.map((a) => (
						<p className="text-sm text-muted-foreground" key={a.id}>
							{new Date(a.timestamp).toLocaleString()} — {a.user.name}:{" "}
							{a.action}
						</p>
					))}
				</section>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
