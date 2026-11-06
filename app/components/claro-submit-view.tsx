import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { usDate } from "~/lib/claro-invoice"
import type { ClaroDetailError, ClaroPoView } from "~/lib/claro-po-view"

/** The Claro clock: filed on, and due on = filed + the PO's terms. */
export function ClaroClock({
	loadedAt,
	dueDate,
	termsDays,
}: {
	loadedAt: string
	dueDate: string | null
	termsDays: number | null
}) {
	const { t } = useTranslation()
	return (
		<dl className="grid max-w-md grid-cols-2 gap-2 text-sm">
			<div>
				<dt className="text-xs text-muted-foreground">
					{t("claro.submit.submitted_on")}
				</dt>
				<dd className="font-medium">{usDate(loadedAt)}</dd>
			</div>
			<div>
				<dt className="text-xs text-muted-foreground">
					{t("claro.submit.due_on", { days: termsDays ?? 60 })}
				</dt>
				<dd className="font-medium">{dueDate ? usDate(dueDate) : "—"}</dd>
			</div>
		</dl>
	)
}

/**
 * Step 4, Submit: once the invoice is filed in Ariba, record the day. That
 * starts the Claro clock. A filed invoice is shown read-only.
 */
export function ClaroSubmitView({
	po,
	today,
	errorKey,
}: {
	po: ClaroPoView
	today: string
	errorKey?: ClaroDetailError
}) {
	const { t } = useTranslation()
	const busy = useNavigation().state !== "idle"
	const inv = po.invoice
	if (!inv) return null
	return (
		<section
			aria-labelledby="claro-submit"
			className="max-w-3xl space-y-4 rounded-lg border bg-card p-4"
		>
			<h2 id="claro-submit" className="text-lg font-semibold">
				{t("claro.submit.title", {
					number: inv.number,
					po: po.poNumber ?? "—",
					aviso: po.avisoNumber ?? "—",
				})}
			</h2>
			{errorKey && (
				<p role="alert" className="text-sm text-status-danger">
					{t(errorKey)}
				</p>
			)}
			{inv.loadedAt ? (
				<>
					<ClaroClock
						loadedAt={inv.loadedAt}
						dueDate={inv.dueDate}
						termsDays={po.termsDays}
					/>
					<Link
						to="/finance/claro"
						className={buttonVariants({ variant: "outline" })}
					>
						{t("claro.back_to_queue")}
					</Link>
				</>
			) : (
				<Form method="post" className="space-y-3">
					<input type="hidden" name="intent" value="submit" />
					<p className="text-sm text-muted-foreground">
						{t("claro.submit.intro")}
					</p>
					<div className="space-y-1">
						<Label htmlFor="claro-loaded-on">
							{t("claro.submit.filed_on")}
						</Label>
						<Input
							id="claro-loaded-on"
							name="loadedOn"
							type="date"
							required
							defaultValue={today}
							className="w-44"
						/>
					</div>
					<Button type="submit" disabled={busy}>
						{t("claro.submit.button")}
					</Button>
				</Form>
			)}
		</section>
	)
}
