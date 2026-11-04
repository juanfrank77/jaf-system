import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"

type BrigadeOption = {
	id: string
	name: string
	area: string | null
	code: string | null
}
type AssignedBrigade = { id: string; name: string }

function label(b: BrigadeOption, current: string) {
	return `${b.name}${b.code ? ` · ${b.code}` : ""}${b.area ? ` (${b.area})` : ""}${current}`
}

/**
 * Reassign a work order. A single-crew job reassigns in one click. A shared
 * job (2+ crews) asks first, because the chosen brigade replaces all of them.
 */
export function ReassignForm({
	brigadeOptions,
	assignedBrigades,
}: {
	brigadeOptions: BrigadeOption[]
	assignedBrigades: AssignedBrigade[]
}) {
	const { t, i18n } = useTranslation()
	const [target, setTarget] = useState("")
	const [confirming, setConfirming] = useState(false)
	const shared = assignedBrigades.length > 1
	const targetBrigade = brigadeOptions.find((b) => b.id === target)
	const removed = assignedBrigades.filter((b) => b.id !== target)
	const currentMark = (b: BrigadeOption) =>
		assignedBrigades.some((a) => a.id === b.id)
			? ` ${t("docs_view.reassign_current")}`
			: ""
	const names = new Intl.ListFormat(i18n.language, {
		style: "long",
		type: "conjunction",
	}).format(removed.map((b) => b.name))

	return (
		<Form method="post" className="space-y-2">
			<div className="space-y-2">
				<p className="text-sm font-medium">{t("docs_view.reassign_heading")}</p>
				<div className="flex items-center gap-2">
					<Select
						name="brigadeId"
						required
						items={brigadeOptions.map((b) => ({
							value: b.id,
							label: label(b, currentMark(b)),
						}))}
						value={target}
						onValueChange={(v) => {
							setTarget(v ?? "")
							setConfirming(false)
						}}
					>
						<SelectTrigger className="min-w-0 flex-1 px-4 data-[size=default]:h-11">
							<SelectValue placeholder={t("docs_view.reassign_placeholder")} />
						</SelectTrigger>
						<SelectContent>
							{brigadeOptions.map((b) => (
								<SelectItem key={b.id} value={b.id}>
									{label(b, currentMark(b))}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{!(confirming && targetBrigade) && (
						<Button
							type={shared && target ? "button" : "submit"}
							name="intent"
							value="reassign"
							variant="outline"
							className="h-11 px-5"
							onClick={() => {
								if (shared && target) setConfirming(true)
							}}
						>
							{t("docs_view.reassign_submit")}
						</Button>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					{t("docs_view.reassign_hint")}
				</p>
				{confirming && targetBrigade ? (
					<div
						role="alert"
						data-testid="reassign-confirm"
						className="space-y-2 rounded-lg border border-status-warn/30 bg-status-warn-soft px-3 py-2 text-sm"
					>
						<p>
							{t("docs_view.reassign_shared_intro", {
								count: assignedBrigades.length,
							})}{" "}
							{t("docs_view.reassign_replace_warning", {
								target: targetBrigade.name,
								removed: names,
							})}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="submit"
								name="intent"
								value="reassign"
								className="h-10 px-4"
							>
								{t("docs_view.reassign_confirm_submit")}
							</Button>
							<Button
								type="button"
								variant="outline"
								className="h-10 px-4"
								onClick={() => setConfirming(false)}
							>
								{t("docs_view.reassign_cancel")}
							</Button>
						</div>
					</div>
				) : null}
			</div>
		</Form>
	)
}
