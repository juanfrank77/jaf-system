import { type AvisoSummary, daysBetween } from "~/lib/aviso-summary"

/** The four reports Monica asks for. All read the same `AvisoSummary` list. */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const avg = (xs: number[]) =>
	xs.length === 0
		? null
		: Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10
const monthOf = (iso: string) => iso.slice(0, 7)

/** Arm A clock: days from sold to PBCC -> brigade paid, per Aviso and per month paid. */
export function armAClock(rows: AvisoSummary[]) {
	const items = rows
		.filter((r) => r.armA.days !== null)
		.map((r) => ({
			avisoNumber: r.avisoNumber,
			soldAt: r.armA.sold.at as string,
			paidAt: r.armA.brigadePaid.at as string,
			batchNumber: r.armA.batchNumber,
			days: r.armA.days as number,
		}))
	const byMonth = new Map<string, number[]>()
	for (const i of items) {
		const m = monthOf(i.paidAt)
		byMonth.set(m, [...(byMonth.get(m) ?? []), i.days])
	}
	return {
		items,
		average: avg(items.map((i) => i.days)),
		months: [...byMonth.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([month, ds]) => ({
				month,
				count: ds.length,
				average: avg(ds) as number,
			})),
	}
}

/** Waiting for PO: job completed -> first PO, and -> fully PO'd (POs >= billed). */
export function waitingForPo(rows: AvisoSummary[]) {
	return rows
		.filter((r) => r.jobCompleted.at)
		.map((r) => {
			const completed = new Date(r.jobCompleted.at as string)
			const dated = r.pos
				.filter((p) => p.poDate.at)
				.sort((a, b) =>
					(a.poDate.at as string).localeCompare(b.poDate.at as string),
				)
			let running = 0
			let fullyAt: string | null = null
			for (const p of dated) {
				running = r2(running + p.poAmount)
				if (fullyAt === null && running >= r.money.billed) fullyAt = p.poDate.at
			}
			const first = dated[0]?.poDate.at ?? null
			return {
				avisoNumber: r.avisoNumber,
				zone: r.zone,
				supervisor: r.supervisor,
				completedAt: r.jobCompleted.at as string,
				firstPoAt: first,
				daysToFirstPo: first ? daysBetween(completed, new Date(first)) : null,
				fullyPoAt: fullyAt,
				daysToFullyPo: fullyAt
					? daysBetween(completed, new Date(fullyAt))
					: null,
				stillToPo: r.money.stillToPo,
			}
		})
}

/** Claro aging: loaded in Ariba -> paid (or today), against the PO's terms. */
export function claroAging(rows: AvisoSummary[]) {
	const items = rows.flatMap((r) =>
		r.pos
			.filter((p) => p.loaded.at && p.invoiceNumber)
			.map((p) => ({
				avisoNumber: r.avisoNumber,
				invoiceNumber: p.invoiceNumber as string,
				loadedAt: p.loaded.at as string,
				paidAt: p.paid.at,
				days: p.days as number,
				termsDays: p.termsDays,
				daysLate: Math.max(0, (p.days as number) - p.termsDays),
				amount: p.invoiceTotal ?? 0,
				pastDue: p.pastDue,
				open: !p.paid.at,
			})),
	)
	const late = items.filter((i) => i.daysLate > 0)
	return {
		items,
		pastDueCount: items.filter((i) => i.pastDue).length,
		pastDueAmount: r2(
			items.filter((i) => i.pastDue).reduce((s, i) => s + i.amount, 0),
		),
		averageDays: avg(items.map((i) => i.days)),
		lateAmount: r2(late.reduce((s, i) => s + i.amount, 0)),
	}
}

/** Open money: billed not PO'd, PO'd not invoiced, in Ariba not paid. */
export function openMoney(rows: AvisoSummary[]) {
	let billedNotPod = 0
	let podNotInvoiced = 0
	let ariba = 0
	for (const r of rows) {
		billedNotPod += r.money.stillToPo
		for (const p of r.pos) {
			if (!p.invoiceNumber) podNotInvoiced += p.poAmount
			else if (p.loaded.at && !p.paid.at) ariba += p.invoiceTotal ?? 0
		}
	}
	return {
		billedNotPod: r2(billedNotPod),
		podNotInvoiced: r2(podNotInvoiced),
		inAribaNotPaid: r2(ariba),
	}
}
