import { useSubmit } from "react-router"

/**
 * Header switch for users assigned to more than one warehouse (e.g. Orlando →
 * Guaynabo + Arecibo). Writes the choice to the `wh` cookie and reloads so
 * every warehouse-scoped loader re-reads it. Renders nothing for single-
 * warehouse users, so it is safe to mount unconditionally.
 */
export function WarehouseSwitch({
	warehouses,
	selectedId,
}: {
	warehouses: { id: string; name: string }[]
	selectedId?: string
}) {
	const submit = useSubmit()
	if (warehouses.length <= 1) return null
	return (
		<select
			aria-label="Warehouse"
			defaultValue={selectedId}
			className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground"
			onChange={(e) => {
				// Written from JS (so no HttpOnly — the server reads it only as a
				// UI preference, never as an authorization decision: every loader
				// still resolves it against the user's own assignments).
				// SameSite=Lax blocks cross-site submission; Secure is added
				// whenever the page itself is served over HTTPS.
				const secure = window.location.protocol === "https:" ? "; Secure" : ""
				document.cookie = `wh=${encodeURIComponent(
					e.target.value,
				)}; path=/; max-age=31536000; SameSite=Lax${secure}`
				submit(null, { method: "get" })
			}}
		>
			{warehouses.map((w) => (
				<option key={w.id} value={w.id}>
					{w.name}
				</option>
			))}
		</select>
	)
}
