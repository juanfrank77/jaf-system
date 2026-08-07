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

	return {
		items,
		add,
		remove,
		update,
		serialized: JSON.stringify(items),
	}
}
