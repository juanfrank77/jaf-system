import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Input } from "~/components/ui/input"
import { cn } from "~/lib/utils"

export type CrewPickerBrigade = {
	id: string
	name: string
	area: string | null
	code: string | null
	leadName: string | null
	/** Only `own` brigades are chips; the rest come from search. */
	state: "own" | "inactive" | "with_other"
	active: boolean
	/** The supervisor it usually works with, when that is not the viewer. */
	supervisorName: string | null
	/** ISO date of its last job, null when it has none. */
	lastWorkedAt: string | null
}

function normalize(s: string) {
	return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim()
}

/** Name: accent/case-insensitive substring. Code: prefix. */
export function matchesBrigadeQuery(
	b: { name: string; code: string | null },
	q: string,
): boolean {
	const n = normalize(q)
	if (!n) return true
	return normalize(b.name).includes(n) || (b.code ?? "").startsWith(q.trim())
}

/** Always-visible (not a tooltip) so Carmen and Lissette see it too. */
export function LeadPaymentNote({
	leadName,
	className,
}: {
	leadName: string
	className?: string
}) {
	const { t } = useTranslation()
	return (
		<div
			role="note"
			data-testid="lead-payment-note"
			className={cn(
				"rounded-lg border border-status-warn/30 bg-status-warn-soft px-3 py-2 text-sm",
				className,
			)}
		>
			<p className="font-semibold text-status-warn">
				{t("crew_picker.payment_note_title")}
			</p>
			<p className="mt-0.5 text-foreground">
				{t("crew_picker.payment_note_body", { lead: leadName })}
			</p>
		</div>
	)
}

function formatDay(iso: string, lng: string) {
	return new Date(iso).toLocaleDateString(lng, {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
	})
}

/**
 * Pick the brigade(s) for a work order, one mode only. The viewer's own
 * brigades are one-tap chips; the search reaches every brigade, active or not,
 * with its Active / Inactive tag, who it usually works with and when it last
 * worked. Picking an inactive one is a single "Activate and add" tap (the
 * server activates and logs it on save). Selected crews sit on top with a
 * count and an ×. The first brigade picked is the lead (stored as `brigadeId`,
 * and paid), so the hidden inputs are emitted in that order.
 */
export function CrewPicker({
	brigades,
	initialSelected = [],
	name = "brigadeId",
}: {
	brigades: CrewPickerBrigade[]
	initialSelected?: string[]
	name?: string
}) {
	const { t, i18n } = useTranslation()
	const [selected, setSelected] = useState<string[]>(initialSelected)
	const [query, setQuery] = useState("")
	const byId = new Map(brigades.map((b) => [b.id, b]))
	const chosen = selected.flatMap((id) => byId.get(id) ?? [])
	const chips = brigades.filter(
		(b) => b.state === "own" && !selected.includes(b.id),
	)
	const results = query.trim()
		? brigades.filter(
				(b) => !selected.includes(b.id) && matchesBrigadeQuery(b, query),
			)
		: []

	function add(id: string) {
		setSelected((cur) => (cur.includes(id) ? cur : [...cur, id]))
		setQuery("")
	}

	function remove(id: string) {
		setSelected((cur) => cur.filter((x) => x !== id))
	}

	function makeLead(id: string) {
		setSelected((cur) => [id, ...cur.filter((x) => x !== id)])
	}

	return (
		<div className="space-y-3">
			{selected.map((id) => (
				<input key={id} type="hidden" name={name} value={id} />
			))}
			<div className="space-y-2">
				<p
					className="text-xs font-medium text-muted-foreground"
					aria-live="polite"
				>
					{chosen.length === 0
						? t("crew_picker.hint")
						: t("crew_picker.assigned_count", { count: chosen.length })}
				</p>
				{chosen.length > 0 && (
					<ul className="flex flex-wrap gap-2">
						{chosen.map((b, i) => (
							<li
								key={b.id}
								className="flex items-center gap-2 rounded-lg border border-primary bg-primary/5 px-3 py-1.5 text-sm"
							>
								<span className="font-semibold">{b.name}</span>
								{b.code && (
									<span className="text-xs text-muted-foreground">
										{b.code}
									</span>
								)}
								{b.state === "with_other" && b.supervisorName && (
									<span className="text-xs text-muted-foreground">
										{t("crew_picker.usually_with", { name: b.supervisorName })}
									</span>
								)}
								{i === 0 && chosen.length > 1 && (
									<span className="rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
										{t("crew_picker.lead")}
									</span>
								)}
								{i > 0 && (
									<button
										type="button"
										onClick={() => makeLead(b.id)}
										className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
									>
										{t("crew_picker.make_lead")}
									</button>
								)}
								<button
									type="button"
									onClick={() => remove(b.id)}
									aria-label={t("crew_picker.remove", { name: b.name })}
									className="rounded-md px-1 text-base leading-none text-muted-foreground hover:bg-muted"
								>
									×
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
			{chips.length > 0 && (
				<ul className="flex flex-wrap gap-2">
					{chips.map((b) => (
						<li key={b.id}>
							<button
								type="button"
								onClick={() => add(b.id)}
								className="rounded-full border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted/40"
							>
								<span className="font-semibold">{b.name}</span>
								{b.code && (
									<span className="ml-1.5 text-xs text-muted-foreground">
										{b.code}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
			<Input
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder={t("crew_picker.search_placeholder")}
				aria-label={t("crew_picker.search_label")}
				className="w-full"
			/>
			{query.trim() && results.length === 0 && (
				<p className="text-sm text-muted-foreground">
					{t("crew_picker.no_results")}
				</p>
			)}
			{results.length > 0 && (
				<ul className="divide-y rounded-lg border border-border bg-card">
					{results.map((b) => (
						<li
							key={b.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
						>
							<span className="min-w-0 flex-1">
								<span className="block font-semibold">
									{b.name}
									{b.code && (
										<span className="ml-1.5 text-xs font-normal text-muted-foreground">
											{b.code}
										</span>
									)}
								</span>
								<span className="block text-xs text-muted-foreground">
									{[
										b.state === "with_other" && b.supervisorName
											? t("crew_picker.usually_with", {
													name: b.supervisorName,
												})
											: null,
										b.lastWorkedAt
											? t("crew_picker.last_worked", {
													date: formatDay(b.lastWorkedAt, i18n.language),
												})
											: t("crew_picker.never_worked"),
									]
										.filter(Boolean)
										.join(" · ")}
								</span>
							</span>
							<span
								className={cn(
									"rounded-md border px-1.5 py-0.5 text-xs font-medium",
									b.active
										? "border-status-ok/30 text-status-ok"
										: "border-border bg-muted",
								)}
							>
								{b.active ? t("crew_picker.active") : t("crew_picker.inactive")}
							</span>
							<button
								type="button"
								onClick={() => add(b.id)}
								className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:bg-muted"
							>
								{b.active
									? t("crew_picker.add")
									: t("crew_picker.activate_add")}
							</button>
						</li>
					))}
				</ul>
			)}
			{selected.length > 1 && (
				<LeadPaymentNote leadName={chosen[0]?.name ?? ""} />
			)}
		</div>
	)
}
