import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Stat } from "~/components/ui/stat"
import type {
	ComptrollerHome,
	ComptrollerHomeTile,
	WeekStripDay,
} from "~/lib/comptroller-home"
import { formatMoney } from "~/lib/utils"

function WeekStrip({ week }: { week: WeekStripDay[] }) {
	const { t } = useTranslation()
	return (
		<section className="space-y-2">
			<h2 className="text-sm font-semibold text-muted-foreground">
				{t("comptroller_home.week.title")}
			</h2>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{week.map((d) => (
					<div
						key={d.day}
						className={`rounded-lg border p-3 text-sm ${
							d.today ? "border-primary bg-primary/5" : "border-border bg-card"
						}`}
						aria-current={d.today ? "date" : undefined}
					>
						<div className="font-semibold">
							{t(`comptroller_home.week.day.${d.day}`)}
						</div>
						<ul className="mt-1 space-y-0.5 text-muted-foreground">
							{d.items.map((item) => (
								<li key={item}>{t(`comptroller_home.week.items.${item}`)}</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</section>
	)
}

function subFor(tile: ComptrollerHomeTile, t: TFunction) {
	const bits: string[] = []
	if (tile.key === "installer_week" && tile.parts) {
		for (const p of tile.parts)
			bits.push(
				p.key === "batch_sent_this_week"
					? t(`comptroller_home.part.${p.key}.${p.count ? "yes" : "no"}`)
					: t(`comptroller_home.part.${p.key}`, { count: p.count }),
			)
		return bits.join(" · ")
	}
	if (tile.amount != null && tile.key !== "payroll_to_pay")
		bits.push(
			tile.key === "short_or_missing"
				? t("comptroller_home.sub.short", { amount: formatMoney(tile.amount) })
				: formatMoney(tile.amount),
		)
	if (tile.key === "payroll_to_pay" && tile.amount != null)
		bits.push(formatMoney(tile.amount))
	if (tile.missing)
		bits.push(t("comptroller_home.sub.missing", { count: tile.missing }))
	if (tile.oldestDays != null)
		bits.push(t("comptroller_home.sub.oldest", { count: tile.oldestDays }))
	if (tile.averageDays != null)
		bits.push(t("comptroller_home.sub.average", { count: tile.averageDays }))
	if (tile.oldestAribaAt)
		bits.push(
			t("comptroller_home.sub.ariba", {
				date: new Date(tile.oldestAribaAt).toLocaleDateString("en-CA", {
					timeZone: "America/Puerto_Rico",
				}),
			}),
		)
	return bits.join(" · ")
}

// Every box is a link to the list behind it. A box at 0 stays in place, in
// grey; a box whose data is not live shows "—" rather than a false all-clear.
function HomeTile({ tile }: { tile: ComptrollerHomeTile }) {
	const { t } = useTranslation()
	const label = t(`comptroller_home.tile.${tile.key}`)
	if (tile.count === null) {
		return (
			<Stat
				label={label}
				value="—"
				sub={t("comptroller_home.not_live")}
				href={tile.href}
				className="opacity-60"
			/>
		)
	}
	// The retention box leads with money; the rest lead with how many.
	const value =
		tile.key === "retention_year" ? formatMoney(tile.amount ?? 0) : tile.count
	const clear = tile.count === 0 && tile.key !== "installer_week"
	return (
		<Stat
			label={label}
			value={value}
			sub={clear ? t("comptroller_home.all_clear") : subFor(tile, t)}
			href={tile.href}
			tone={
				clear
					? "neutral"
					: tile.key === "short_or_missing" || tile.key === "pbcc_exposure"
						? "warn"
						: "info"
			}
			className={clear ? "opacity-70" : undefined}
		/>
	)
}

export function ComptrollerHomeView({
	home,
	name,
	today,
}: {
	home: ComptrollerHome
	name: string
	today: string
}) {
	const { t } = useTranslation()
	const brigades = home.tiles.filter(
		(x) => x.key === "payroll_to_pay" || x.key === "retention_year",
	)
	const claro = home.tiles.filter((x) => !brigades.includes(x))
	return (
		<div className="space-y-6 p-6">
			<header>
				<h1 className="text-2xl font-bold">{t("comptroller_home.title")}</h1>
				<p className="text-sm text-muted-foreground">
					{t("comptroller_home.greeting", { name })} · {today}
				</p>
			</header>
			<WeekStrip week={home.week} />
			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground">
					{t("comptroller_home.brigades")}
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{brigades.map((tile) => (
						<HomeTile key={tile.key} tile={tile} />
					))}
				</div>
			</section>
			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground">
					{t("comptroller_home.installers")}
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{claro.map((tile) => (
						<HomeTile key={tile.key} tile={tile} />
					))}
				</div>
			</section>
			<Link
				to="/comptroller/to-pay"
				className="block text-sm text-primary underline"
			>
				{t("comptroller_home.all_requests")}
			</Link>
		</div>
	)
}
