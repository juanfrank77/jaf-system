import type { ParseKeys, TFunction } from "i18next"

// Notification rows persist a fully-formed English `message` (written by the
// server actions, whose wording we do not change here). To localize the bell
// without touching those writers, the known warehouse-flow messages are
// recognised by shape at render time and mapped to locale keys; anything
// unrecognised (other flows, legacy rows) falls through unchanged.
const PATTERNS: { re: RegExp; key: string; params: string[] }[] = [
	{
		re: /^Restock (.+) needs over-par sign-off\.$/,
		key: "restock_over_par",
		params: ["id"],
	},
	{
		re: /^Job (.+) has missing materials flagged during prep\. Please review\.$/,
		key: "prep_missing",
		params: ["job"],
	},
	{
		re: /^Job (.+) is prepped and ready for pickup\. Please sign at warehouse\.$/,
		key: "prep_ready",
		params: ["job"],
	},
	{
		re: /^Job (.+) is ready for pickup\.$/,
		key: "prep_ready_supervisor",
		params: ["job"],
	},
	{
		// Finance's send_back (S4): her note is kept word for word.
		re: /^Finance returned job (\S+) for Aviso correction: ([\s\S]+)$/,
		key: "finance_returned",
		params: ["job", "note"],
	},
	{
		re: /^Job (.+) was signed with material overage\. Review the quantities\.$/,
		key: "sign_overage",
		params: ["job"],
	},
	{
		re: /^Serial (.+) is held for review before repair disposition\.$/,
		key: "repair_held",
		params: ["serial"],
	},
	{
		re: /^Repair batch (.+) sent \((\d+) units\)\.$/,
		key: "repair_sent",
		params: ["batch", "count"],
	},
	{
		re: /^Repair batch (.+) voided\.$/,
		key: "repair_voided",
		params: ["batch"],
	},
	{
		re: /^Repaired intake (.+): declared (\d+), stocked (\d+)\.$/,
		key: "repair_intake",
		params: ["intake", "declared", "stocked"],
	},
]

export function localizeNotification(message: string, t: TFunction): string {
	for (const { re, key, params } of PATTERNS) {
		const m = re.exec(message)
		if (!m) continue
		const values = Object.fromEntries(params.map((p, i) => [p, m[i + 1]]))
		return t(`app_shell.notifications.messages.${key}` as ParseKeys, {
			...values,
			// React already escapes text nodes; i18next's HTML-escaping would
			// show control numbers like "A/1" as "A&#x2F;1".
			interpolation: { escapeValue: false },
		})
	}
	return message
}
