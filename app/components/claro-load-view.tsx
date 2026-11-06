import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import type { ClaroStep } from "~/lib/claro-steps"

export type ClaroQueueRow = {
	id: string
	poNumber: string | null
	fileName: string
	step: ClaroStep
}

const STEP_QUERY = ["", "review", "review", "generate", "submit", "close"]

function useStepLabel() {
	const { t } = useTranslation()
	return (step: ClaroStep) => {
		switch (step) {
			case 1:
				return t("claro.step.load")
			case 2:
				return t("claro.step.review")
			case 3:
				return t("claro.step.generate")
			case 4:
				return t("claro.step.submit")
			case 5:
				return t("claro.step.close")
		}
	}
}

/** Step 1: one upload box for any number of PO PDFs, and the open queue. */
export function ClaroLoadView({
	queue,
	errorKey,
}: {
	queue: ClaroQueueRow[]
	errorKey?: "po_inbox.errors.not_pdf" | "po_inbox.errors.no_files"
}) {
	const { t } = useTranslation()
	const stepLabel = useStepLabel()
	const busy = useNavigation().state !== "idle"
	return (
		<div className="space-y-6">
			<Form
				method="post"
				encType="multipart/form-data"
				className="space-y-3 rounded-lg border bg-card p-4"
			>
				<input type="hidden" name="intent" value="process" />
				<p className="text-sm text-muted-foreground">{t("claro.load.intro")}</p>
				<div className="flex flex-wrap items-center gap-3">
					<input
						type="file"
						name="files"
						accept="application/pdf,.pdf"
						multiple
						required
						aria-label={t("po_inbox.choose_files")}
						className="text-sm"
					/>
					<Button type="submit" disabled={busy}>
						{busy ? t("claro.load.processing") : t("claro.load.process")}
					</Button>
				</div>
				{errorKey === "po_inbox.errors.not_pdf" && (
					<p role="alert" className="text-sm text-destructive">
						{t("po_inbox.errors.not_pdf")}
					</p>
				)}
				{errorKey === "po_inbox.errors.no_files" && (
					<p role="alert" className="text-sm text-destructive">
						{t("po_inbox.errors.no_files")}
					</p>
				)}
			</Form>

			<section className="space-y-2">
				<h2 className="text-sm font-semibold">{t("claro.load.queue")}</h2>
				{queue.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("claro.load.empty")}
					</p>
				) : (
					<ul className="divide-y rounded-lg border bg-card">
						{queue.map((row) => (
							<li
								key={row.id}
								className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
							>
								{row.step === 1 ? (
									<span className="min-w-0 truncate">
										{row.poNumber ?? row.fileName}
									</span>
								) : (
									<Link
										to={`/finance/claro/${row.id}?step=${STEP_QUERY[row.step]}`}
										className="min-w-0 truncate hover:underline"
									>
										{row.poNumber ?? row.fileName}
									</Link>
								)}
								<Badge variant="neutral">{stepLabel(row.step)}</Badge>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	)
}
