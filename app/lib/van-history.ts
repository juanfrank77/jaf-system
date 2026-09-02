import { db } from "./db.server"

export type VanAssignmentEvent = {
	installerId: string | null
	from: string | null
	to: string
	previousInstallerId?: string | null
	assignedAt?: string
}

export async function appendVanAssignmentHistory(
	vanId: string,
	newInstallerId: string | null,
	userId: string,
) {
	const van = await db.van.findUnique({ where: { id: vanId } })
	if (!van) return

	const previousInstallerId = van.installerId
	if (previousInstallerId === newInstallerId) return

	const assignedAt = new Date().toISOString()
	const history = (
		(van.vanAssignmentHistory as VanAssignmentEvent[] | null) || []
	).concat({
		installerId: newInstallerId,
		from: previousInstallerId,
		previousInstallerId,
		assignedAt,
		to: assignedAt,
	})

	await db.van.update({
		where: { id: vanId },
		data: {
			installerId: newInstallerId,
			vanAssignmentHistory: history,
		},
	})

	await db.auditTrail.create({
		data: {
			docId: vanId,
			userId,
			action: "VAN_ASSIGNMENT_CHANGED",
			diffJson: {
				vanId,
				previousInstallerId,
				newInstallerId,
				assignedAt,
			},
		},
	})
}
