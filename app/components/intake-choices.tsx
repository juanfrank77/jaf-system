import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import type { MaterialsChoice, PrefieldChoice } from "~/lib/intake-answers"

// The two intake questions, shared by the new and edit work-order forms.
// Native radios so the answers post with the form like every other field.

function RadioOption({
	name,
	value,
	checked,
	onChange,
	label,
}: {
	name: string
	value: string
	checked: boolean
	onChange: () => void
	label: string
}) {
	const id = `${name}-${value}`
	return (
		<label
			htmlFor={id}
			className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50"
		>
			<input
				type="radio"
				id={id}
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				required
				className="sr-only"
			/>
			{label}
		</label>
	)
}

/** Materials from the warehouse? On "no" the reason box replaces `children`
 * (the materials list). */
export function MaterialsSourceChoice({
	value,
	onChange,
	defaultReason,
	children,
}: {
	value: MaterialsChoice | ""
	onChange: (v: MaterialsChoice) => void
	defaultReason?: string | null
	children?: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<>
			<fieldset className="space-y-2">
				<legend className="text-sm font-semibold">
					{t("intake_choices.materials_question")}
				</legend>
				<div className="flex gap-2">
					<RadioOption
						name="materialsFromWarehouse"
						value="yes"
						checked={value === "yes"}
						onChange={() => onChange("yes")}
						label={t("intake_choices.materials_yes")}
					/>
					<RadioOption
						name="materialsFromWarehouse"
						value="no"
						checked={value === "no"}
						onChange={() => onChange("no")}
						label={t("intake_choices.materials_no")}
					/>
				</div>
			</fieldset>
			{value === "no" ? (
				<div>
					<Label htmlFor="materialsReason">
						{t("intake_choices.materials_reason_label")}
					</Label>
					<Textarea
						id="materialsReason"
						name="materialsReason"
						rows={2}
						required
						defaultValue={defaultReason ?? ""}
						placeholder={t("intake_choices.materials_reason_placeholder")}
						className="mt-1"
					/>
				</div>
			) : (
				children
			)}
		</>
	)
}

/** Prefield needed / not needed. */
export function PrefieldNeededChoice({
	value,
	onChange,
}: {
	value: PrefieldChoice | ""
	onChange: (v: PrefieldChoice) => void
}) {
	const { t } = useTranslation()
	return (
		<fieldset className="space-y-2">
			<legend className="text-sm font-semibold">
				{t("intake_choices.prefield_question")}
			</legend>
			<div className="flex gap-2">
				<RadioOption
					name="prefieldNeeded"
					value="needed"
					checked={value === "needed"}
					onChange={() => onChange("needed")}
					label={t("intake_choices.prefield_needed")}
				/>
				<RadioOption
					name="prefieldNeeded"
					value="not_needed"
					checked={value === "not_needed"}
					onChange={() => onChange("not_needed")}
					label={t("intake_choices.prefield_not_needed")}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				{t("intake_choices.prefield_hint")}
			</p>
		</fieldset>
	)
}
