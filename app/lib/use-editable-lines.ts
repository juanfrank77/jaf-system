import { useState } from "react"

export function useEditableLines<T>(initializer: () => T[]) {
	const [items, setItems] = useState<T[]>(initializer)

	const add = (empty: T) => setItems([...items, empty])
	const remove = (index: number) =>
		setItems(items.filter((_, i) => i !== index))
	const update = (index: number, patch: Partial<T>) =>
		setItems(
			items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
		)
	// Replace the whole list wholesale — e.g. a caller resetting the form back
	// to its computed defaults after a successful submit, so stale edited
	// values can't linger and be resubmitted under a fresh key.
	const reset = (next: T[]) => setItems(next)

	return {
		items,
		add,
		remove,
		update,
		reset,
		serialized: JSON.stringify(items),
	}
}
