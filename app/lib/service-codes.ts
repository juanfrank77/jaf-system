/** Resolves a scanned serial to its SKU by matching the serialized codes' prefix. */
export function resolveSerial<T extends { serialPrefix: string | null }>(
	serial: string,
	serializedCodes: T[],
): T | null {
	return (
		serializedCodes.find(
			(c) => c.serialPrefix && serial.startsWith(c.serialPrefix),
		) ?? null
	)
}
