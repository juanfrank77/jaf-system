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
				document.cookie = `wh=${e.target.value}; path=/`
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
