type PrefieldKey = "ordenNumber" | "pedido" | "smr" | "titulo"

type PrefieldDoc = Record<PrefieldKey, string | null>

const KEYS: PrefieldKey[] = ["ordenNumber", "pedido", "smr", "titulo"]

export function prefieldMissing(doc: PrefieldDoc): PrefieldKey[] {
	return KEYS.filter((k) => !doc[k]?.trim())
}

export function packetBlockers(
	doc: PrefieldDoc & { blueprintPaths: string[] },
	claro: { requiresPrefield: boolean; requiresBlueprint: boolean },
): ("prefield" | "blueprint")[] {
	const out: ("prefield" | "blueprint")[] = []
	if (claro.requiresPrefield && prefieldMissing(doc).length > 0)
		out.push("prefield")
	if (claro.requiresBlueprint && doc.blueprintPaths.length === 0)
		out.push("blueprint")
	return out
}
