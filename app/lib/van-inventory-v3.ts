import type {
	SerialStatus,
	VanMovementType,
} from "../../generated/prisma/client"

export function deriveAccessoryStock(
	movements: { serviceCodeId: string; qty: number }[],
) {
	const out: Record<string, number> = {}
	for (const m of movements)
		out[m.serviceCodeId] = (out[m.serviceCodeId] ?? 0) + m.qty
	return out
}

export function deriveSerializedStock(
	serials: {
		serviceCodeId: string
		status: SerialStatus
		currentRef: string
	}[],
	vanId: string,
) {
	const out: Record<string, number> = {}
	for (const s of serials) {
		if (s.status === "VAN" && s.currentRef === vanId)
			out[s.serviceCodeId] = (out[s.serviceCodeId] ?? 0) + 1
	}
	return out
}

export function owedBack(
	serials: { serial: string; status: SerialStatus; currentRef: string }[],
	vanId: string,
) {
	return serials
		.filter(
			(s) => s.status === "REMOVED_PENDING_RETURN" && s.currentRef === vanId,
		)
		.map((s) => s.serial)
}

const TRANSITIONS: Record<
	VanMovementType,
	{ from: (SerialStatus | null)[]; to: SerialStatus }
> = {
	PICKUP: { from: ["WAREHOUSE", null], to: "VAN" },
	INSTALL: { from: ["VAN"], to: "INSTALLED" },
	SWAP_IN: { from: ["VAN"], to: "INSTALLED" },
	SWAP_OUT: { from: ["INSTALLED"], to: "REMOVED_PENDING_RETURN" },
	RETURN: { from: ["REMOVED_PENDING_RETURN"], to: "RETURNED" },
	ADJUST: {
		from: [
			"WAREHOUSE",
			"VAN",
			"INSTALLED",
			"REMOVED_PENDING_RETURN",
			"RETURNED",
			"SENT_FOR_REPAIR",
			null,
		],
		to: "VAN",
	},
}

export function nextSerialState(
	current: SerialStatus | null,
	event: VanMovementType,
): SerialStatus {
	const rule = TRANSITIONS[event]
	if (!rule.from.includes(current))
		throw new Error(
			`Illegal serial transition: ${current ?? "none"} –${event}→`,
		)
	return rule.to
}
