import { db } from "./db.server"

type CrewUser = { id: string; name: string }

/**
 * Who picks the materials up: the assigned brigade's lead (a CREW user matched
 * by name), else its first member that is an active CREW user. A shared job
 * passes only its lead brigade (JafInvoice.brigadeId), so the signer is the
 * lead's alone. Null when nobody on the brigade has a CREW account.
 */
export function pickupSigner(
	brigade: { leadName: string | null; memberIds: string[] } | null,
	crewUsers: CrewUser[],
): CrewUser | null {
	if (!brigade) return null
	const lead = brigade.leadName
		? crewUsers.find((u) => u.name === brigade.leadName)
		: undefined
	if (lead) return lead
	for (const id of brigade.memberIds) {
		const member = crewUsers.find((u) => u.id === id)
		if (member) return member
	}
	return null
}

/** The pickup signer for a job's lead brigade; never throws on a missing one. */
export async function pickupSignerForDoc(
	brigadeId: string | null,
): Promise<CrewUser | null> {
	if (!brigadeId) return null
	const [brigade, crewUsers] = await Promise.all([
		db.brigade.findUnique({
			where: { id: brigadeId },
			select: { leadName: true, memberIds: true },
		}),
		db.user.findMany({
			where: { role: "CREW", active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		}),
	])
	return pickupSigner(brigade, crewUsers)
}
