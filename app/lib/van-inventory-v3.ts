import type {
	SerialStatus,
	StockMovementType,
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

// Partial: only Installer-issued movement types have a serial-state
// transition rule here. The warehouse-only movement types added in the
// warehouse foundation schema (RECEIVE, RELEASE, STARTING_BALANCE,
// DISPOSITION, SENT_FOR_REPAIR, REPAIR_INTAKE) are handled by warehouse
// logic elsewhere and never reach this function.
const TRANSITIONS: Partial<
	Record<StockMovementType, { from: (SerialStatus | null)[]; to: SerialStatus }>
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
	event: StockMovementType,
): SerialStatus {
	const rule = TRANSITIONS[event]
	if (!rule?.from.includes(current))
		throw new Error(
			`Illegal serial transition: ${current ?? "none"} –${event}→`,
		)
	return rule.to
}
