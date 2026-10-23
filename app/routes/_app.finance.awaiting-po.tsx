import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useRevalidator } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ArmBStepRail } from "~/components/finance-step-rail"
import { PoInboxView } from "~/components/po-inbox-view"
import { validateFile } from "~/lib/file-upload.server"
import { requireRole } from "~/lib/permissions.server"
import {
	confirmAllGreen,
	confirmPo,
	ingestPoFiles,
	kickProcessing,
	PoError,
	poInboxCounts,
} from "~/lib/po-inbox.server"
import { parsePoTab } from "~/lib/po-inbox-view"
import { listPoRows } from "~/lib/po-inbox-view.server"
import type { Route } from "./+types/_app.finance.awaiting-po"

const READING_REFRESH_MS = 5000

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const counts = await poInboxCounts()
	const requested = parsePoTab(new URL(request.url).searchParams.get("tab"))
	// Default to what needs doing first: green to confirm, else the rest.
	const tab =
		requested ??
		(counts.ready > 0
			? "ready"
			: counts.needsLook > 0
				? "needs_look"
				: counts.blocked > 0
					? "blocked"
					: counts.unmatched > 0
						? "unmatched"
						: "ready")
	return { counts, tab, rows: await listPoRows(tab) }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	if (intent === "upload") {
		const files = form
			.getAll("files")
			.filter((f): f is File => f instanceof File && f.size > 0)
		if (files.length === 0)
			return { errorKey: "po_inbox.errors.no_files" as const }
		for (const f of files) {
			if (!validateFile(f, "pdf").valid)
				return { errorKey: "po_inbox.errors.not_pdf" as const }
		}
		try {
			await ingestPoFiles(
				await Promise.all(
					files.map(async (f) => ({
						name: f.name,
						bytes: new Uint8Array(await f.arrayBuffer()),
					})),
				),
				user.id,
			)
		} catch (e) {
			if (e instanceof PoError && e.code === "not_pdf")
				return { errorKey: "po_inbox.errors.not_pdf" as const }
			throw e
		}
		kickProcessing()
		return {}
	}
	if (intent === "confirm_all_green") return confirmAllGreen(user.id)
	if (intent === "confirm_one") {
		try {
			await confirmPo(String(form.get("id")), user.id)
		} catch (e) {
			if (!(e instanceof PoError)) throw e
		}
		return {}
	}
	throw new Response("Unknown intent", { status: 400 })
}

export default function AwaitingPo({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const { counts, tab, rows } = loaderData
	const { revalidate, state } = useRevalidator()
	const reading = counts.reading > 0
	useEffect(() => {
		if (!reading) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible" && state === "idle")
				revalidate()
		}, READING_REFRESH_MS)
		return () => window.clearInterval(id)
	}, [reading, revalidate, state])
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_flow.arm_b.step.awaiting_po")}
				</h1>
			</div>
			<ArmBStepRail current="AWAITING_PO" />
			<PoInboxView counts={counts} tab={tab} rows={rows} result={actionData} />
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
