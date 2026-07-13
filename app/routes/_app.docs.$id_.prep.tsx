import { Form, redirect } from "react-router"
import { Button } from "~/components/ui/button"
import { db } from "~/lib/db.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.$id_.prep"

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "PREPPED", user.role))
		throw redirect(`/docs/${params.id}`)
	return { doc }
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})

	if (!canTransition(doc.status, "PREPPED", user.role)) {
		throw redirect(`/docs/${params.id}`)
	}

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: { status: "PREPPED", preppedAt: new Date(), preppedById: user.id },
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: { status: { before: "CREATED", after: "PREPPED" } },
			},
		}),
		...doc.assignedCrewIds.map((crewId) =>
			db.notification.create({
				data: {
					userId: crewId,
					docId: params.id,
					message: `Job ${doc.controlNumber} is prepped and ready for pickup. Please sign at warehouse.`,
				},
			}),
		),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

export default function PrepDoc({ loaderData }: Route.ComponentProps) {
	const { doc } = loaderData
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">Mark Materials Prepped</h1>
			<p className="text-sm text-slate-600">
				Confirm that materials for <strong>{(doc as any).controlNumber}</strong>{" "}
				have been staged and are ready for crew pickup.
			</p>
			<Form method="post">
				<Button type="submit" className="w-full">
					Confirm Materials Prepped
				</Button>
			</Form>
		</div>
	)
}
