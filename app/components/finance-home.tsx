import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { Stat } from "~/components/ui/stat"
import {
	type FinanceHome,
	type FinanceHomeTile,
	PBCC_BATCH_CAPACITY,
} from "~/lib/finance-home"
import { FINANCE_STEP_LABEL_KEY } from "~/lib/finance-steps"
import { formatMoney } from "~/lib/utils"

// Every box is Lissette's next move and a button to that exact section. A box at
// 0 stays in its place, in grey ("all clear"), so the grid never jumps around;
// a box whose screen is not built yet shows "—" instead of a false all-clear.
function HomeTile({ tile }: { tile: FinanceHomeTile }) {
	const { t } = useTranslation()
	const label = t(`finance_home.tile.${tile.key}`)

	if (tile.count === null) {
		return (
			<Stat
				label={label}
				value="—"
				sub={t("finance_home.not_live")}
				className="opacity-60"
			/>
		)
	}

	const value =
		tile.key === "pbcc_batch"
			? t("finance_home.sub.batch", {
					count: tile.count,
					max: PBCC_BATCH_CAPACITY,
				})
			: tile.count
	const sub =
		tile.count === 0
			? t("finance_home.all_clear")
			: tile.key === "pbcc_batch"
				? formatMoney(tile.amount ?? 0)
				: tile.oldestDays != null
					? t(
							tile.key === "waiting_carmen"
								? "finance_home.sub.sent"
								: "finance_home.sub.oldest",
							{ count: tile.oldestDays },
						)
					: undefined

	return (
		<Stat
			label={label}
			value={value}
			sub={
				tile.overdue
					? `${sub ?? ""} · ${t("finance_home.sub.overdue", { count: tile.overdue })}`
					: sub
			}
			href={tile.href ?? undefined}
			tone={tile.overdue ? "flag" : tile.count === 0 ? "neutral" : "info"}
			className={tile.count === 0 ? "opacity-70" : undefined}
		/>
	)
}

export function FinanceHomeView({ home }: { home: FinanceHome }) {
	const { t } = useTranslation()
	return (
		<div className="space-y-6">
			<h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground">
					{t("finance_home.arm_a")}
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{home.armA.map((tile) => (
						<HomeTile key={tile.key} tile={tile} />
					))}
				</div>
			</section>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground">
					{t("finance_home.arm_b")}
				</h2>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{home.armB.map((tile) => (
						<HomeTile key={tile.key} tile={tile} />
					))}
				</div>
			</section>

			{home.blockedCount > 0 && (
				<Link
					to="/finance/payroll"
					className="block rounded-lg border border-status-warn/30 bg-status-warn-soft p-3 text-sm"
				>
					{t("finance_home.blocked", { count: home.blockedCount })}
				</Link>
			)}

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">
					{t("finance_home.next_up.title")}
				</h2>
				{home.nextUp.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("finance_home.next_up.empty")}
					</p>
				) : (
					<ul className="space-y-2">
						{home.nextUp.map((item) => (
							<li key={item.id}>
								<Link
									to={item.href}
									className="flex items-center justify-between gap-2 rounded-lg border border-transparent p-2.5 text-sm transition-colors hover:border-border hover:bg-muted/40"
								>
									<span className="font-mono font-medium">
										{item.controlNumber}
										{item.avisoNumber ? ` · ${item.avisoNumber}` : ""}
									</span>
									<span
										className={
											item.note === "overdue" || item.note === "draft"
												? "text-status-danger"
												: "text-muted-foreground"
										}
									>
										{item.note && `${t(`finance_home.note.${item.note}`)} · `}
										{t(FINANCE_STEP_LABEL_KEY[item.step])} ·{" "}
										{t("finance_home.next_up.days", {
											count: item.waitingDays,
										})}
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	)
}
