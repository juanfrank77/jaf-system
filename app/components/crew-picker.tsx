import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

export type CrewPickerBrigade = {
	id: string
	name: string
	area: string | null
	code: string | null
	leadName: string | null
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

function titleCase(s: string) {
	return s.charAt(0) + s.slice(1).toLowerCase()
}

/**
 * Pick the brigade(s) for a work order. One crew is the default: clicking a
 * card selects only that crew. Sharing the job is a deliberate step ("Share
 * this job with other crews"), which switches to multi-select. In multi-select
 * the first brigade picked is the lead (stored as `brigadeId`, and paid), so
 * the hidden inputs are emitted in that order.
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
	const { t } = useTranslation()
	const [selected, setSelected] = useState<string[]>(initialSelected)
	// A job that is already shared opens in sharing mode.
	const [shared, setShared] = useState(initialSelected.length > 1)

	function makeLead(id: string) {
		setSelected((cur) => [id, ...cur.filter((x) => x !== id)])
	}

	function toggle(id: string) {
		setSelected((cur) =>
			cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
		)
	}

	return (
		<div className="space-y-2">
			{selected.map((id) => (
				<input key={id} type="hidden" name={name} value={id} />
			))}
			<div className="flex flex-wrap items-center gap-2">
				{shared ? (
					<>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() =>
								setSelected([
									...selected,
									...brigades
										.map((b) => b.id)
										.filter((id) => !selected.includes(id)),
								])
							}
						>
							{t("crew_picker.select_all")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setShared(false)
								setSelected((cur) => cur.slice(0, 1))
							}}
						>
							{t("crew_picker.single")}
						</Button>
						<span className="text-xs text-muted-foreground" aria-live="polite">
							{t("crew_picker.selected_count", { count: selected.length })}
						</span>
					</>
				) : (
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => setShared(true)}
					>
						{t("crew_picker.share")}
					</Button>
				)}
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				{brigades.map((b) => {
					const on = selected.includes(b.id)
					const lead = shared && selected.length > 1 && selected[0] === b.id
					return (
						<label
							key={b.id}
							className={cn(
								"flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-muted/40",
								on ? "border-primary bg-primary/5" : "border-border",
							)}
						>
							<input
								type={shared ? "checkbox" : "radio"}
								checked={on}
								onChange={() => (shared ? toggle(b.id) : setSelected([b.id]))}
								className="size-4 shrink-0 accent-primary"
							/>
							<span className="min-w-0 flex-1">
								<span className="block font-semibold">{b.name}</span>
								<span className="block text-xs text-muted-foreground">
									{[b.area ? titleCase(b.area) : null, b.code, b.leadName]
										.filter(Boolean)
										.join(" · ")}
								</span>
							</span>
							{lead && (
								<span className="rounded-md bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
									{t("crew_picker.lead")}
								</span>
							)}
							{shared && on && selected.length > 1 && !lead && (
								<button
									type="button"
									onClick={() => makeLead(b.id)}
									className="rounded-md border border-border bg-card px-1.5 py-0.5 text-xs font-medium hover:bg-muted"
								>
									{t("crew_picker.make_lead")}
								</button>
							)}
						</label>
					)
				})}
			</div>
			{selected.length > 1 && (
				<LeadPaymentNote
					leadName={brigades.find((b) => b.id === selected[0])?.name ?? ""}
				/>
			)}
		</div>
	)
}
