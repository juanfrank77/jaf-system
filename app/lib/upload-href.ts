/**
 * The `/files/...` URL for an upload stored flat as `<UPLOAD_DIR>/<kind>/<file>`
 * (packets, JAF invoices, Aviso docs). Works on the absolute path the server
 * stored, so a renamed file (e.g. one packet file per send) still links.
 */
export function uploadHref(localPath: string): string {
	const [kind, file] = localPath.split(/[\\/]/).filter(Boolean).slice(-2)
	return `/files/${encodeURIComponent(kind)}/${encodeURIComponent(file)}`
}
