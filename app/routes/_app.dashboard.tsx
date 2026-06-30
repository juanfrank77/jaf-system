import { Link } from "react-router"
import { db } from "~/lib/db.server"
import { requireSession } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.dashboard"

export async function loader({ request }: Route.LoaderArgs) {
	const session = await requireSession(request)
	const user = await db.user.findUniqueOrThrow({
		where: { id: session.user.id },
	})

	const docs = await db.jafInvoice.findMany({
		where:
			user.role === "SUPERVISOR"
				? { supervisorId: user.id }
				: user.role === "CREW"
					? { assignedCrewIds: { has: user.id } }
					: {}, // WAREHOUSE, FINANCE, ADMIN see all
		orderBy: { createdAt: "desc" },
		take: 20,
	})

	return { user, docs }
}

const STATUS_COLORS: Record<string, string> = {
	CREATED: "bg-yellow-100 text-yellow-800",
	PREPPED: "bg-blue-100 text-blue-800",
	SIGNED: "bg-purple-100 text-purple-800",
	FIELD_UPDATED: "bg-orange-100 text-orange-800",
	SUPERVISOR_APPROVED: "bg-teal-100 text-teal-800",
	CLARO_UPLOADED: "bg-indigo-100 text-indigo-800",
	LC_GENERATED: "bg-green-100 text-green-800",
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
	const { user, docs } = loaderData
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">Dashboard</h1>
				{(user.role === "SUPERVISOR" || user.role === "ADMIN") && (
					<Link
						to="/docs/new"
						className="text-sm font-medium text-blue-600 hover:text-blue-800"
					>
						+ New Document
					</Link>
				)}
			</div>
			{docs.length === 0 && (
				<p className="text-slate-500 text-sm">No documents yet.</p>
			)}
			<div className="space-y-2">
				{docs.map((doc) => (
					<Link
						key={doc.id}
						to={`/docs/${doc.id}`}
						className="block bg-white border rounded-lg p-4 hover:border-slate-400 transition-colors"
					>
						<div className="flex items-center justify-between">
							<span className="font-mono text-sm font-medium">
								{doc.controlNumber}
							</span>
							<span
								className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status] ?? ""}`}
							>
								{doc.status.replace(/_/g, " ")}
							</span>
						</div>
						<p className="text-sm text-slate-600 mt-1">
							{doc.jobType} — {doc.jobAddressEstimated}
						</p>
						<p className="text-xs text-slate-400 mt-1">
							{new Date(doc.createdAt).toLocaleDateString()}
						</p>
					</Link>
				))}
			</div>
		</div>
	)
}
