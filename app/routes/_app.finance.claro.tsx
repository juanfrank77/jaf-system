import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import { ClaroLoadView, type ClaroQueueRow } from "~/components/claro-load-view"
import { ClaroStepRail } from "~/components/claro-step-rail"
import { ClaroClock } from "~/components/claro-submit-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Callout } from "~/components/ui/callout"
import { invoiceNumber } from "~/lib/claro-invoice"
import { claroStepOf } from "~/lib/claro-steps"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { requireRole } from "~/lib/permissions.server"
import { ingestPoFiles, kickProcessing, PoError } from "~/lib/po-inbox.server"
import { useAutoRevalidate } from "~/lib/use-auto-revalidate"
import type { Route } from "./+types/_app.finance.claro"

const QUEUE_MAX = 200

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const pos = await db.claroPo.findMany({
		where: {
			status: { not: "SUPERSEDED" },
			OR: [{ invoice: null }, { invoice: { paidAt: null } }],
		},
		orderBy: { receivedAt: "desc" },
		take: QUEUE_MAX,
		select: {
			id: true,
			poNumber: true,
			fileName: true,
			status: true,
			invoice: { select: { loadedAt: true, paidAt: true } },
		},
	})
	const queue: ClaroQueueRow[] = pos.map((p) => ({
		id: p.id,
		poNumber: p.poNumber,
		fileName: p.fileName,
		step: claroStepOf(p),
	}))
	// A read left behind by a restart is only taken up again by a drain.
	if (queue.some((r) => r.step === 1)) kickProcessing()
	// Back from Submit: the invoice just filed and its Claro clock.
	const submittedId = new URL(request.url).searchParams.get("submitted")
	const inv = submittedId
		? await db.claroInvoice.findUnique({
				where: { id: submittedId },
				include: { claroPo: { select: { termsDays: true } } },
			})
		: null
	const submitted = inv?.loadedAt
		? {
				number: invoiceNumber(inv),
				loadedAt: inv.loadedAt.toISOString(),
				dueDate: inv.dueDate?.toISOString() ?? null,
				termsDays: inv.claroPo?.termsDays ?? null,
			}
		: null
	return { queue, submitted }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") !== "process")
		throw new Response("Unknown intent", { status: 400 })
	const files = form
		.getAll("files")
		.filter((f): f is File => f instanceof File && f.size > 0)
	if (files.length === 0)
		return { errorKey: "po_inbox.errors.no_files" as const }
	for (const f of files) {
		if (!validateFile(f, "pdf").valid)
			return { errorKey: "po_inbox.errors.not_pdf" as const }
	}
	let ids: string[]
	try {
		ids = await ingestPoFiles(
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
	return redirect(`/finance/claro/${ids[0]}?step=review`)
}

export default function Claro({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const { queue, submitted } = loaderData
	useAutoRevalidate(queue.some((r) => r.step === 1))
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("claro.title")}</h1>
			<ClaroStepRail current={1} />
			{submitted && (
				<Callout
					tone="ok"
					title={t("claro.submitted", { number: submitted.number })}
				>
					<ClaroClock
						loadedAt={submitted.loadedAt}
						dueDate={submitted.dueDate}
						termsDays={submitted.termsDays}
					/>
				</Callout>
			)}
			<ClaroLoadView queue={queue} errorKey={actionData?.errorKey} />
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
