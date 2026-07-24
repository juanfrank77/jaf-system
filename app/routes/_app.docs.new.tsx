import { Form, redirect } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { generateControlNumber } from "~/lib/control-number.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.docs.new"

export async function loader({ request }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
		orderBy: { claroCode: "asc" },
	})
	const crew = await db.user.findMany({
		where: { role: "CREW", active: true },
		orderBy: { name: "asc" },
	})
	return {
		user,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: Number(c.unitPrice),
		})),
		crew,
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["SUPERVISOR", "ADMIN"])
	const form = await request.formData()

	const jobType = (form.get("jobType") as string).trim()
	const jobAddressEstimated = (form.get("jobAddressEstimated") as string).trim()
	const assignedCrewIds = form.getAll("assignedCrewIds") as string[]
	const materialsRaw = form.get("materials") as string
	const avisoNumber = (form.get("avisoNumber") as string | null)?.trim() || null

	let estimatedMaterials: { serviceCodeId: string; qty: number }[] = []
	try {
		estimatedMaterials = JSON.parse(materialsRaw).filter(
			(i: { serviceCodeId: string; qty: number }) =>
				i.serviceCodeId && i.qty > 0,
		)
	} catch {
		return { error: "Invalid materials data" }
	}

	if (!jobType || !jobAddressEstimated || assignedCrewIds.length === 0) {
		return {
			error: "Job type, address, and at least one crew member are required",
		}
	}

	const controlNumber = await generateControlNumber()

	const warehouse = await db.user.findMany({
		where: { role: "WAREHOUSE", active: true },
	})

	await db.$transaction(async (tx) => {
		const doc = await tx.jafInvoice.create({
			data: {
				controlNumber,
				status: "CREATED",
				jobType,
				jobAddressEstimated,
				estimatedMaterials,
				assignedCrewIds,
				supervisorId: user.id,
				avisoNumber,
			},
		})
		await tx.auditTrail.create({
			data: {
				docId: doc.id,
				userId: user.id,
				action: "CREATED",
				diffJson: { status: { before: null, after: "CREATED" } },
			},
		})
		await tx.notification.createMany({
			data: warehouse.map((w) => ({
				userId: w.id,
				docId: doc.id,
				message: `New job ${controlNumber} — ${jobType} at ${jobAddressEstimated}. Please prepare materials.`,
			})),
		})
		return doc
	})

	throw redirect(`/docs/${controlNumber}`)
}

export default function NewDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { serviceCodes, crew } = loaderData
	return (
		<div className="space-y-5">
			<h1 className="text-xl font-semibold">New JAF Invoice</h1>
			<Form method="post" className="space-y-4">
				<div>
					<Label htmlFor="jobType">Job Type</Label>
					<Input
						id="jobType"
						name="jobType"
						placeholder="Mantenimiento, Instalación..."
						required
					/>
				</div>
				<div>
					<Label htmlFor="jobAddressEstimated">Job Address (estimated)</Label>
					<Input
						id="jobAddressEstimated"
						name="jobAddressEstimated"
						placeholder="Calle X, Barrio Y, Municipio"
						required
					/>
				</div>
				<div>
					<Label htmlFor="avisoNumber">Claro Aviso # (if known)</Label>
					<Input id="avisoNumber" name="avisoNumber" placeholder="10333185" />
				</div>
				<div>
					<Label>Assigned Crew</Label>
					<div className="space-y-1 mt-1">
						{crew.map((c) => (
							<label key={c.id} className="flex items-center gap-2 text-sm">
								<input type="checkbox" name="assignedCrewIds" value={c.id} />
								{c.name}
							</label>
						))}
					</div>
				</div>
				<div>
					<Label>Estimated Materials</Label>
					<div className="mt-1">
						<MaterialLineItems serviceCodes={serviceCodes as any} />
					</div>
				</div>
				{(actionData as any)?.error && (
					<p className="text-sm text-red-600">{(actionData as any).error}</p>
				)}
				<Button type="submit" className="w-full">
					Create Document
				</Button>
			</Form>
		</div>
	)
}
