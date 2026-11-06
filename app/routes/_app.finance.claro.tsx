import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { redirect, useRevalidator } from "react-router"
import { ClaroLoadView, type ClaroQueueRow } from "~/components/claro-load-view"
import { ClaroStepRail } from "~/components/claro-step-rail"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { claroStepOf } from "~/lib/claro-steps"
import { db } from "~/lib/db.server"
import { validateFile } from "~/lib/file-upload.server"
import { requireRole } from "~/lib/permissions.server"
import { ingestPoFiles, kickProcessing, PoError } from "~/lib/po-inbox.server"
import type { Route } from "./+types/_app.finance.claro"

const READING_REFRESH_MS = 5000
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
	return { queue }
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
	const { queue } = loaderData
	const { revalidate, state } = useRevalidator()
	const stateRef = useRef(state)
	stateRef.current = state
	const reading = queue.some((r) => r.step === 1)
	useEffect(() => {
		if (!reading) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible" && stateRef.current === "idle")
				revalidate()
		}, READING_REFRESH_MS)
		return () => window.clearInterval(id)
	}, [reading, revalidate])
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("claro.title")}</h1>
			<ClaroStepRail current={1} />
			<ClaroLoadView queue={queue} errorKey={actionData?.errorKey} />
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
