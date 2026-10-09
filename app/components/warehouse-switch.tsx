import { useTranslation } from "react-i18next"
import { useSubmit } from "react-router"
import { cn } from "~/lib/utils"

/**
 * Header pills (one per warehouse) for users assigned to more than one warehouse (e.g. Orlando →
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
	const { t } = useTranslation()
	if (warehouses.length <= 1) return null
	function choose(id: string) {
		// Written from JS (so no HttpOnly — the server reads it only as a
		// UI preference, never as an authorization decision: every loader
		// still resolves it against the user's own assignments).
		// SameSite=Lax blocks cross-site submission; Secure is added
		// whenever the page itself is served over HTTPS.
		const secure = window.location.protocol === "https:" ? "; Secure" : ""
		// biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is missing in Safari and older Android WebViews
		document.cookie = `wh=${encodeURIComponent(
			id,
		)}; path=/; max-age=31536000; SameSite=Lax${secure}`
		submit(null, { method: "get" })
	}
	return (
		<fieldset
			aria-label={t("app_shell.warehouse_switch")}
			className="flex gap-0.5 rounded-full border-0 bg-muted p-0.5 m-0 min-w-0"
		>
			{warehouses.map((w) => {
				const active = w.id === selectedId
				return (
					<button
						key={w.id}
						type="button"
						aria-pressed={active}
						onClick={() => choose(w.id)}
						className={cn(
							"rounded-full px-3 py-1 text-xs font-semibold",
							active
								? "bg-card text-foreground shadow-card"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{w.name}
					</button>
				)
			})}
		</fieldset>
	)
}
