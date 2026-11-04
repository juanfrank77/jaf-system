/** Comparison key: accents folded, lowercased, whitespace collapsed. */
export function normalizeKey(v: string): string {
	return v
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

/** Existing entry with the same key, else the trimmed, whitespace-collapsed input. */
export function canonicalize(value: string, existing: string[]): string {
	const key = normalizeKey(value)
	const match = existing.find((e) => normalizeKey(e) === key)
	return match ?? value.replace(/\s+/g, " ").trim()
}
