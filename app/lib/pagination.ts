// Page math shared by the server-paged warehouse lists (`?page=N`) and the
// client-paged Stock table. A page past the end clamps to the last one, so a
// stale link never renders an empty table.
export function paginate(
	requested: number | string | null | undefined,
	total: number,
	pageSize: number,
) {
	const pageCount = Math.max(1, Math.ceil(total / pageSize))
	const asNumber = Number(requested)
	const wanted = Number.isInteger(asNumber) && asNumber >= 1 ? asNumber : 1
	const page = Math.min(wanted, pageCount)
	return { page, pageCount, skip: (page - 1) * pageSize, take: pageSize }
}
