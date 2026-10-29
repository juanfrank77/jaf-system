import {
	CLARO_ELIGIBLE,
	claroStage,
	isClaroOverdue,
} from "~/lib/claro-installer.server"
import {
	type ComptrollerHome,
	type ComptrollerHomeTile,
	summarizeAges,
	weekStrip,
} from "~/lib/comptroller-home"
import { loadComptrollerRuns } from "~/lib/comptroller-runs.server"
import { db } from "~/lib/db.server"
import { loadInstallerPayList, loadWarrantyDocs } from "~/lib/ewit.server"
import { ageDays } from "~/lib/finance-stage-rows.server"

const toCents = (v: { toString(): string } | null | undefined) =>
	v == null ? 0 : Math.round(Number(v) * 100)
const dollars = (cents: number) => cents / 100
const DAY = 86_400_000
const PR_OFFSET_HOURS = 4 // Puerto Rico is UTC-4 all year

/** Midnight (PR) at the start of this week's Monday, as a UTC instant. */
function mondayStart(now: Date): Date {
	const date = now.toLocaleDateString("en-CA", {
		timeZone: "America/Puerto_Rico",
	})
	const midnight = new Date(`${date}T0${PR_OFFSET_HOURS}:00:00Z`)
	const weekday = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Puerto_Rico",
		weekday: "short",
	}).format(now)
	const since = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
		weekday,
	)
	return new Date(midnight.getTime() - since * DAY)
}

/** Midnight (PR) on 1 January of the current Puerto Rico year. */
function yearStart(now: Date): Date {
	const year = now
		.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })
		.slice(0, 4)
	return new Date(`${year}-01-01T0${PR_OFFSET_HOURS}:00:00Z`)
}

function minDate(dates: (Date | null)[]): Date | null {
	const real = dates.filter((d): d is Date => d != null)
	return real.length
		? new Date(Math.min(...real.map((d) => d.getTime())))
		: null
}

/** Everything on Carmen's Home: the week strip and a box per list she works from. */
export async function loadComptrollerHome(now: Date): Promise<ComptrollerHome> {
	const [
		runs,
		waitingDocs,
		notBatched,
		batchesSentThisWeek,
		toTick,
		eligible,
		retention,
	] = await Promise.all([
		loadComptrollerRuns(),
		loadWarrantyDocs(now),
		// Invoices made but whose batch has not gone to PBCC.
		db.ewitInvoice.count({
			where: {
				voidedAt: null,
				OR: [{ batchId: null }, { batch: { is: { sentAt: null } } }],
			},
		}),
		db.ewitBatch.count({ where: { sentAt: { gte: mondayStart(now) } } }),
		loadInstallerPayList(),
		// One read feeds every Claro box. Invoices paid in full (or short but
		// accepted) are in no box, so they are not loaded.
		db.ewitInvoice.findMany({
			where: {
				...CLARO_ELIGIBLE,
				OR: [
					{ claroPaidAt: null },
					{
						shortAcceptedAt: null,
						OR: [
							{ claroPaidNet: null },
							{ claroPaidNet: { lt: db.ewitInvoice.fields.claroTotal } },
						],
					},
				],
			},
			select: {
				poNumber: true,
				aribaSentAt: true,
				claroPaidAt: true,
				claroPaidNet: true,
				claroTotal: true,
				shortAcceptedAt: true,
				total: true,
				batch: { select: { sentAt: true } },
			},
		}),
		// The 10% already worked out per job when the payroll request was made.
		db.jafInvoice.aggregate({
			where: {
				retentionAmount: { gt: 0 },
				payrollRun: { reversedAt: null, sentAt: { gte: yearStart(now) } },
			},
			_sum: { retentionAmount: true },
			_count: true,
		}),
	])

	const toPay = runs.toPay
	const payrollTile: ComptrollerHomeTile = {
		key: "payroll_to_pay",
		count: toPay.length,
		href: "/comptroller/to-pay",
		amount: dollars(
			toPay.reduce((s, r) => s + Math.round(r.toPayTotal * 100), 0),
		),
		oldestDays: toPay.length
			? ageDays(minDate(toPay.map((r) => r.generatedAt)), now)
			: null,
	}

	const installerTile: ComptrollerHomeTile = {
		key: "installer_week",
		count: waitingDocs.length,
		href: "/comptroller/installers",
		parts: [
			{
				key: "waiting_ewit",
				count: waitingDocs.length,
				href: "/comptroller/installers",
			},
			{
				key: "not_batched",
				count: notBatched,
				href: "/comptroller/installers/batches",
			},
			{
				key: "batch_sent_this_week",
				count: batchesSentThisWeek > 0 ? 1 : 0,
				href: "/comptroller/installers/batches",
			},
			{
				key: "installers_to_tick",
				count: toTick.length,
				href: "/comptroller/installers/pay",
			},
		],
	}

	let noPoCents = 0
	const noPo: (Date | null)[] = []
	let ariba = { count: 0, cents: 0 }
	const sentAriba: (Date | null)[] = []
	let short = { count: 0, cents: 0 }
	let missing = 0
	for (const inv of eligible) {
		const stage = claroStage(inv)
		if (stage === "no_po") {
			noPoCents += toCents(inv.total)
			noPo.push(inv.batch?.sentAt ?? null)
		} else if (stage === "ready_for_ariba" || stage === "sent") {
			ariba = {
				count: ariba.count + 1,
				cents: ariba.cents + toCents(inv.claroTotal),
			}
			if (stage === "sent") {
				sentAriba.push(inv.aribaSentAt)
				if (isClaroOverdue(inv.aribaSentAt, now)) missing += 1
			}
		} else if (stage === "short") {
			short = {
				count: short.count + 1,
				cents:
					short.cents + toCents(inv.claroTotal) - toCents(inv.claroPaidNet),
			}
		}
	}
	const noPoCount = noPo.length
	const oldestAriba = minDate(sentAriba)

	const exposure = eligible.filter((e) => e.claroPaidAt == null)
	const exposureAges = summarizeAges(
		exposure.map((e) => e.batch?.sentAt ?? null),
		now,
	)

	return {
		week: weekStrip(now),
		tiles: [
			payrollTile,
			installerTile,
			{
				key: "ja_waiting_po",
				count: noPoCount,
				href: "/comptroller/installers/claro/invoices?stage=no_po",
				amount: dollars(noPoCents),
				oldestDays: noPoCount ? ageDays(minDate(noPo), now) : null,
			},
			{
				key: "ready_or_sent_not_paid",
				count: ariba.count,
				href: "/comptroller/installers/claro/invoices?stage=ariba_open",
				amount: dollars(ariba.cents),
				oldestAribaAt: oldestAriba?.toISOString() ?? null,
			},
			{
				key: "short_or_missing",
				count: short.count + missing,
				href: "/comptroller/installers/claro/invoices?stage=short",
				amount: dollars(short.cents),
				missing,
			},
			{
				key: "pbcc_exposure",
				count: exposure.length,
				href: "/comptroller/installers/claro/invoices?stage=exposure",
				amount: dollars(exposure.reduce((s, e) => s + toCents(e.total), 0)),
				oldestDays: exposureAges.oldest,
				averageDays: exposureAges.average,
			},
			{
				key: "retention_year",
				count: retention._count,
				href: "/comptroller/log",
				amount: dollars(toCents(retention._sum.retentionAmount)),
			},
		],
	}
}
