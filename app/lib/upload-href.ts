/**
 * The `/files/...` URL for an upload stored flat as `<UPLOAD_DIR>/<kind>/<file>`
 * (packets, JAF invoices, Aviso docs). Works on the absolute path the server
 * stored, so a renamed file (e.g. one packet file per send) still links.
 */
export function uploadHref(localPath: string): string {
	const [kind, file] = localPath.split(/[\\/]/).filter(Boolean).slice(-2)
	return `/files/${encodeURIComponent(kind)}/${encodeURIComponent(file)}`
}

/**
 * Whether a stored `jafInvoicePdfPath` is an OLD priced JAF invoice (the
 * retired generate_jaf_invoice step wrote them to `jaf-invoices/`), not the
 * price-free Claro packet (`packets/`). Never shown to a price-blind role.
 */
export function isLegacyPricedInvoice(localPath: unknown): boolean {
	if (typeof localPath !== "string") return false
	const parts = localPath.split(/[\\/]/).filter(Boolean)
	return parts.at(-2) === "jaf-invoices"
}

/**
 * Finance/Admin links for the stored `jafInvoicePdfPath`: the price-free
 * packet, or (for a job from before the packet) the legacy priced invoice.
 */
export function storedPdfLinks(localPath: string | null): {
	packetHref: string | null
	legacyPricedHref: string | null
} {
	if (!localPath) return { packetHref: null, legacyPricedHref: null }
	return isLegacyPricedInvoice(localPath)
		? { packetHref: null, legacyPricedHref: uploadHref(localPath) }
		: { packetHref: uploadHref(localPath), legacyPricedHref: null }
}
