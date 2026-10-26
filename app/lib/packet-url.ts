export type PacketMode =
	| { mode: "whole" }
	| { mode: "summary" }
	| { mode: "brigades"; brigades: string[] }

/** The packet PDF's address; `inline` shows it in a frame instead of saving it. */
export function packetUrl(
	runId: string,
	choice: PacketMode,
	opts: { inline?: boolean } = {},
): string {
	const q = new URLSearchParams({ mode: choice.mode })
	if (choice.mode === "brigades") q.set("brigades", choice.brigades.join(","))
	if (opts.inline) q.set("inline", "1")
	return `/finance/payroll/${runId}/journal?${q}`
}

/** The packet's address inside the viewer frame, opened on a page at a zoom. */
export function viewerFrameUrl(runId: string, page: number, zoom: number) {
	return `${packetUrl(runId, { mode: "whole" }, { inline: true })}#page=${page}&zoom=${zoom}&navpanes=0`
}
