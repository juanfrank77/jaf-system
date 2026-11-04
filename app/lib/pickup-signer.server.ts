import { assignedBrigadeIds } from "./crew-assignment"
import { db } from "./db.server"

type CrewUser = { id: string; name: string }

type SignerBrigade = {
	id: string
	name: string
	code: string | null
	leadName: string | null
	memberIds: string[]
}

export type PickupSignerGroup = {
	brigadeId: string
	brigadeName: string
	brigadeCode: string | null
	signers: { key: string; name: string; userId: string | null }[]
}

const normaliseName = (name: string | null) => (name ?? "").trim().toLowerCase()

/**
 * Who can sign for the materials, per brigade on the job. Crew have no login:
 * the list only supplies a name to sign with. Each brigade lists its lead first
 * (a CREW user matched by name, trimmed and ignoring case, else the lead's name
 * alone) and then its members with a CREW account. A brigade recording nobody
 * falls back to its own name, which is a person's on the payroll list.
 */
export function pickupSignerGroups(
	brigades: SignerBrigade[],
	crewUsers: CrewUser[],
): PickupSignerGroup[] {
	return brigades.map((brigade) => {
		const leadName = normaliseName(brigade.leadName)
		const lead = leadName
			? crewUsers.find((u) => normaliseName(u.name) === leadName)
			: undefined
		const members = brigade.memberIds.flatMap((id) => {
			const member = crewUsers.find((u) => u.id === id)
			return member && member.id !== lead?.id ? [member] : []
		})
		const accounts = [...(lead ? [lead] : []), ...members].map((u) => ({
			key: `${brigade.id}:${u.id}`,
			name: u.name.trim(),
			userId: u.id as string | null,
		}))
		const named =
			brigade.leadName?.trim() && !lead ? brigade.leadName.trim() : null
		const byName = named ?? (accounts.length ? null : brigade.name.trim())
		return {
			brigadeId: brigade.id,
			brigadeName: brigade.name,
			brigadeCode: brigade.code,
			signers: [
				...(byName
					? [{ key: `${brigade.id}:name`, name: byName, userId: null }]
					: []),
				...accounts,
			],
		}
	})
}

/** The signer a posted key stands for, or null when they are not on this job. */
export function findPickupSigner(groups: PickupSignerGroup[], key: string) {
	for (const group of groups) {
		const signer = group.signers.find((s) => s.key === key)
		if (signer)
			return {
				name: signer.name,
				userId: signer.userId,
				brigadeId: group.brigadeId,
			}
	}
	return null
}

/** The signer list for a job: every brigade assigned to it; never throws on none. */
export async function pickupSignersForDoc(doc: {
	brigadeId: string | null
	crewAssignmentHistory: unknown
}): Promise<PickupSignerGroup[]> {
	const brigadeIds = assignedBrigadeIds(doc)
	if (brigadeIds.length === 0) return []
	const [brigades, crewUsers] = await Promise.all([
		db.brigade.findMany({
			where: { id: { in: brigadeIds } },
			select: {
				id: true,
				name: true,
				code: true,
				leadName: true,
				memberIds: true,
			},
		}),
		db.user.findMany({
			where: { role: "CREW", active: true },
			select: { id: true, name: true },
			orderBy: { name: "asc" },
		}),
	])
	const inJobOrder = brigadeIds.flatMap((id) => {
		const brigade = brigades.find((b) => b.id === id)
		return brigade ? [brigade] : []
	})
	return pickupSignerGroups(inJobOrder, crewUsers)
}
