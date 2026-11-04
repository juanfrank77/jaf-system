import type { ParseKeys } from "i18next"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, useNavigation } from "react-router"
import { Button } from "~/components/ui/button"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import { Textarea } from "~/components/ui/textarea"

/**
 * "Fix a mistake" on a job that was already signed off. `reopen` (the packet
 * has not gone to Claro yet) sends the job back to Field with the sign-off
 * cleared; `request` tells the administrators what is wrong. Either way a
 * reason is required and it is logged on the job.
 */
export function FixMistakeCard({
	mode,
	errorKey,
	requested = false,
}: {
	mode: "reopen" | "request"
	errorKey?: string
	requested?: boolean
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const [open, setOpen] = useState(false)
	const intent = mode === "reopen" ? "back_to_approve" : "request_fix"
	const sending =
		navigation.state !== "idle" && navigation.formData?.get("intent") === intent
	if (requested)
		return (
			<Pill variant="ok" icon="✓">
				{t("fix_mistake.requested")}
			</Pill>
		)
	return (
		<section
			data-testid="fix-mistake"
			className="rounded-xl border border-border bg-card px-3 py-2 text-sm"
		>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="font-semibold text-accent-text underline-offset-4 hover:underline"
			>
				{t("fix_mistake.button")}
			</button>
			{open && (
				<Form method="post" className="mt-3 space-y-3">
					<input type="hidden" name="intent" value={intent} />
					<p className="text-muted-foreground">
						{t(`fix_mistake.${mode}_hint`)}
					</p>
					<div>
						<Label htmlFor="fixNote">{t("fix_mistake.reason_label")}</Label>
						<Textarea
							id="fixNote"
							name="note"
							rows={3}
							required
							className="mt-1"
						/>
					</div>
					{errorKey && (
						<p role="alert" className="text-status-danger">
							{t(errorKey as ParseKeys)}
						</p>
					)}
					<Button type="submit" disabled={sending}>
						{t(`fix_mistake.${mode}_submit`)}
					</Button>
				</Form>
			)}
		</section>
	)
}
