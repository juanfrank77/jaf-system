import {
	BASE_SHARE_PERCENT,
	D_SHARE_PERCENT,
	percentOf,
	shareFigures,
} from "~/lib/contractor-share"
import { readCrewLines } from "~/lib/crew-field"
import { db } from "~/lib/db.server"
import { toNumberPrice } from "~/lib/utils"
import { Prisma } from "../../generated/prisma/client"

const { Decimal } = Prisma
type Decimal = Prisma.Decimal

/** Brigade share of a JAF invoice line: 65%, or 80% on machinery / truck lines
 * (D lines). The rate goes by the LINE, read from the service code on the
 * Aviso, never by brigade — there is no custom rate per brigade. Snapshotted
 * onto each contractorShareLines row at sweep time so a later catalog or rate
 * change never rewrites an already-generated run. */
export const CONTRACTOR_SHARE_PERCENT = BASE_SHARE_PERCENT / 100
export const D_LINE_SHARE_PERCENT = D_SHARE_PERCENT / 100

/** A catalog contractor factor of 0.80 marks a D line; anything else is the base rate. */
export function sharePercentForFactor(factor: unknown): number {
	const f = toNumberPrice(factor)
	return Math.abs(f - D_LINE_SHARE_PERCENT) < 1e-9
		? D_LINE_SHARE_PERCENT
		: CONTRACTOR_SHARE_PERCENT
}

export type ContractorPaymentLine = {
	serviceCodeId: string
	claroCode: string
	name: string
	qty: number
	jafPrice: number
	/** Fraction (0.65 or 0.8). Absent reads as the base rate. */
	sharePercent?: number
}

export type ContractorShareLine = ContractorPaymentLine & {
	gross: number
	sharePercent: number
	net: number
	retention: number
	adjNet: number
}

export type ContractorPayment = {
	contractorShareLines: ContractorShareLine[]
	grossPayable: number
	retentionAmount: number
	netPayable: number
}

export const RETENTION_RATE = 0.1

/**
 * Map a `JafInvoice.jafInvoiceLines` JSON value into the shape the payment
 * computation needs.
 *
 * The stored lines are `[{ serviceCodeId, claroCode, accountCode, name, unit,
 * qty, unitPrice, lineAmount }]` — the catalog price lives on `unitPrice`, not
 * on a `jafPrice` field. Reading them straight into `ContractorPaymentLine`
 * would silently yield `jafPrice: undefined` (→ 0) and a $0.00 gross for every
 * job, so this conversion is the single place the two shapes are bridged.
 *
 * Non-array / null / unparseable input yields `[]` rather than throwing, so a
 * job with no lines renders `$0.00` cleanly (Review Focus).
 */
export function toContractorPaymentLines(
	value: unknown,
	shares?: ReadonlyMap<string, number>,
): ContractorPaymentLine[] {
	if (!Array.isArray(value)) return []
	return value.map((raw) => {
		const line = (raw ?? {}) as Record<string, unknown>
		return {
			serviceCodeId: String(line.serviceCodeId ?? ""),
			claroCode: String(line.claroCode ?? ""),
			name: String(line.name ?? ""),
			qty: toNumberPrice(line.qty),
			jafPrice: toNumberPrice(line.unitPrice),
			sharePercent:
				shares?.get(String(line.serviceCodeId ?? "")) ??
				CONTRACTOR_SHARE_PERCENT,
		}
	})
}

/**
 * Compute the brigade's share of an invoice.
 *
 * Every figure is truncated to the cent from the gross at its own level (see
 * `shareFigures`): each line from its gross, the job's totals from the job's
 * gross. A job with lines at two rates (65% and the 80% D lines) totals each
 * rate on its own gross, then adds the two. So a job's total can differ from
 * the sum of its lines by a few cents; that is expected, and the same figures
 * feed the packet, the Production Journal and Carmen's request.
 */
export function computeContractorPayment(
	lines: ContractorPaymentLine[],
): ContractorPayment {
	const groups = new Map<number, Decimal>()
	let grossPayable = new Decimal(0)

	const contractorShareLines: ContractorShareLine[] = (lines ?? []).map(
		(line) => {
			// The line's gross is the amount printed on the invoice: qty × price
			// rounded to the cent. Only the share figures below are truncated.
			const gross = new Decimal(toNumberPrice(line.qty))
				.times(toNumberPrice(line.jafPrice))
				.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
			const percent = percentOf(line.sharePercent)
			const f = shareFigures(gross.toNumber(), percent)
			grossPayable = grossPayable.plus(gross)
			groups.set(percent, (groups.get(percent) ?? new Decimal(0)).plus(gross))
			return {
				...line,
				gross: gross.toNumber(),
				sharePercent: percent / 100,
				net: f.net,
				retention: f.retention,
				adjNet: f.adjNet,
			}
		},
	)
	let retentionAmount = 0
	let netPayable = 0
	for (const [percent, gross] of groups) {
		const f = shareFigures(gross.toNumber(), percent)
		retentionAmount += f.retention
		netPayable += f.adjNet
	}
	return {
		contractorShareLines,
		grossPayable: grossPayable.toNumber(),
		retentionAmount: Math.round(retentionAmount * 100) / 100,
		netPayable: Math.round(netPayable * 100) / 100,
	}
}

/**
 * The share fraction of each service code on these invoice lines, keyed by
 * service code id, read from the catalog (one query). A code absent from the
 * map takes the base rate.
 */
export async function loadLineShares(
	lineSets: ReadonlyArray<unknown>,
): Promise<Map<string, number>> {
	const ids = new Set<string>()
	for (const set of lineSets)
		for (const l of toContractorPaymentLines(set))
			if (l.serviceCodeId) ids.add(l.serviceCodeId)
	if (ids.size === 0) return new Map()
	const codes = await db.serviceCode.findMany({
		where: { id: { in: [...ids] } },
		select: { id: true, contractorFactor: true },
	})
	return new Map(
		codes.map((c) => [c.id, sharePercentForFactor(c.contractorFactor)]),
	)
}

/**
 * The code a one-brigade job's payee resolves by: the one copied at the pre-cert
 * signature, else the job's brigade's own code. The brigade is linked by id on
 * the job, so a packet released without the subcontractor code still reaches
 * its brigade; no names are matched.
 */
export function payeeCode(doc: {
	contractorAccountCode: string | null
	brigade?: { code: string | null } | null
}): string | null {
	return doc.contractorAccountCode ?? doc.brigade?.code ?? null
}

/** Enough of a job to tell who is paid for it. */
export type PayeeDoc = {
	contractorAccountCode: string | null
	brigade?: { code: string | null } | null
	crewServiceLines: unknown
}

/** The brigades that recorded work on a job with several crews, in job order. */
export function crewsWithWork(doc: Pick<PayeeDoc, "crewServiceLines">) {
	return readCrewLines(doc.crewServiceLines).filter((c) => c.lines.length > 0)
}

export type CrewPayeeInfo = { code: string | null; name: string }

/** Code and name of every brigade with work on these jobs, in ONE query. */
export async function loadCrewPayees(
	docs: ReadonlyArray<Pick<PayeeDoc, "crewServiceLines">>,
): Promise<Map<string, CrewPayeeInfo>> {
	const ids = [
		...new Set(docs.flatMap((d) => crewsWithWork(d).map((c) => c.brigadeId))),
	]
	if (ids.length === 0) return new Map()
	const rows = await db.brigade.findMany({
		where: { id: { in: ids } },
		select: { id: true, code: true, name: true },
	})
	return new Map(rows.map((b) => [b.id, { code: b.code, name: b.name }]))
}

/**
 * Who a job pays: each brigade with work on it is paid for its own lines, so a
 * job with several crews has one code per crew (null when one has no code yet,
 * which holds the whole job back). A job with one crew pays through `payeeCode`.
 */
export function payeeCodesOf(
	doc: PayeeDoc,
	crews: ReadonlyMap<string, CrewPayeeInfo>,
): (string | null)[] {
	const withWork = crewsWithWork(doc)
	if (withWork.length < 2) return [payeeCode(doc)]
	return withWork.map((c) => crews.get(c.brigadeId)?.code ?? null)
}

export async function resolveContractorAccount(
	contractorAccountCode: string | null | undefined,
): Promise<{ id: string } | null> {
	if (!contractorAccountCode) return null
	const account = await db.contractorAccount.findFirst({
		where: { code: contractorAccountCode },
		select: { id: true },
	})
	if (!account) return null
	return { id: account.id }
}

type ResolvedContractorAccount = {
	id: string
	code: string
	label: string
	brigadeCode: string | null
}

/**
 * Resolve a batch of `contractorAccountCode`s in ONE query, keyed by code.
 *
 * Both batch callers used to call `resolveContractorAccount` per row: the L1
 * loader (up to 200 rows on a page load) and `generateRun` (the widest loop in
 * the feature — the candidate set is unbounded). That is 1 + N round-trips to
 * render a table or claim a run, on a small on-prem Postgres.
 *
 * `ContractorAccount.code` is `@unique`, so the Map can never silently pick a
 * winner between two accounts; `get` returning `undefined` is exactly the
 * "unmapped" case the callers already handle.
 *
 * `active` here means "takes new work" (q&a 14.4), not "payable". The
 * assignment pickers in supervisor-scope.ts are the "no new work" half of 14.4
 * and filter on active there. This half removes the active filter so that a
 * deactivated brigade's open jobs are still swept, frozen, and closed — the
 * brigade still gets paid for work already released, while the pickers keep it
 * off any new job.
 */
export async function resolveContractorAccounts(
	codes: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, ResolvedContractorAccount>> {
	const distinct = [...new Set(codes.filter((c): c is string => !!c))]
	if (distinct.length === 0) return new Map()
	const accounts = await db.contractorAccount.findMany({
		where: { code: { in: distinct } },
		select: {
			id: true,
			code: true,
			label: true,
			brigade: { select: { code: true } },
		},
	})
	return new Map(
		accounts.map((a) => [
			a.code,
			{
				id: a.id,
				code: a.code,
				label: a.label,
				brigadeCode: a.brigade?.code ?? null,
			},
		]),
	)
}
