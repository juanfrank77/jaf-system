import type { TFunction } from "i18next"

type PacketSentDiff = {
	mode?: string
	outcome?: string
	recipientEmail?: string
	firstSend?: boolean
	error?: string
}

const OUTCOMES = ["SENT", "FAILED", "UNCONFIGURED", "MANUAL"] as const

/** One line for a PACKET_SENT audit row: outcome · recipient · first send / error. */
export function packetSentSummary(diff: PacketSentDiff, t: TFunction): string {
	const outcome = OUTCOMES.find((o) => o === diff.outcome)
	const parts = [
		outcome ? t(`packet.outcome.${outcome}`) : "—",
		diff.recipientEmail || "—",
	]
	if (diff.firstSend) parts.push(t("admin_history.packet_first_send"))
	if (diff.error) parts.push(diff.error)
	return parts.join(" · ")
}
