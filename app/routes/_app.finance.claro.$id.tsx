import { useTranslation } from "react-i18next"
import { redirect } from "react-router"
import { ClaroGenerateView } from "~/components/claro-generate-view"
import { ClaroReviewView } from "~/components/claro-review-view"
import { ClaroStepRail } from "~/components/claro-step-rail"
import { ClaroSubmitView } from "~/components/claro-submit-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	ClaroInvoiceError,
	generateFromPo,
	markLoaded,
} from "~/lib/claro-invoice.server"
import {
	afterTomorrow,
	loadClaroPo,
	parseDay,
	parseFixForm,
	parseOverrides,
	todayInPr,
} from "~/lib/claro-po.server"
import type { ClaroDetailError } from "~/lib/claro-po-view"
import { validateFile } from "~/lib/file-upload.server"
import { requireRole } from "~/lib/permissions.server"
import {
	discardPo,
	fixPo,
	ingestPoFiles,
	kickProcessing,
	PoError,
	recheckPo,
	rereadPo,
} from "~/lib/po-inbox.server"
import { HARD_STOPS, needsEntry } from "~/lib/po-reading"
import { getInvoiceSignature } from "~/lib/system-settings.server"
import { useAutoRevalidate } from "~/lib/use-auto-revalidate"
import type { Route } from "./+types/_app.finance.claro.$id"

type View = "review" | "generate" | "submit"
const VIEWS: View[] = ["review", "generate", "submit"]

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	// Checked again on opening: a PO checked under an older rule, or beside a
	// copy still being read, may be stuck on a verdict that no longer holds.
	await recheckPo(params.id)
	const po = await loadClaroPo(params.id)
	if (!po) throw new Response("Not Found", { status: 404 })
	const self = `/finance/claro/${po.id}`
	// A replaced copy opens the one that replaced it.
	if (po.status === "SUPERSEDED" && po.supersededById)
		throw redirect(`/finance/claro/${po.supersededById}`)
	const { step } = po
	if (step === 1) {
		// A read left behind by a restart is only taken up again by a drain.
		kickProcessing()
		return { view: "reading" as const, step, po }
	}
	const raw = new URL(request.url).searchParams.get("step")
	if (raw === "close") throw redirect("/finance/claro/close")
	const asked = VIEWS.find((v) => v === raw)
	if (asked && asked !== "review" && !po.invoice)
		throw redirect(`${self}?step=review`)
	if (!asked && step === 5) throw redirect("/finance/claro/close")
	// Step 3 has no invoice yet, so it is made from Review.
	const view: View = asked ?? (step === 4 ? "submit" : "review")
	return {
		view,
		step,
		po,
		today: todayInPr(),
		hasSignature: view === "review" ? !!(await getInvoiceSignature()) : true,
	}
}

const PO_ERRORS: Partial<Record<string, ClaroDetailError>> = {
	incomplete: "po_inbox.errors.incomplete",
	duplicate: "po_inbox.errors.duplicate",
	aviso_not_found: "po_inbox.errors.aviso_not_found",
	already_confirmed: "claro.errors.not_editable",
	not_discardable: "claro.errors.not_discardable",
}
const INVOICE_ERRORS: Partial<Record<string, ClaroDetailError>> = {
	total_mismatch: "claro.errors.total_mismatch",
	work_month_required: "claro.errors.work_month_required",
	no_signature: "claro_invoices.errors.no_signature",
	po_not_confirmable: "po_inbox.errors.incomplete",
}

const fail = (errorKey: ClaroDetailError) => ({ errorKey })

/** Not on Review yet (still being read) or no longer (replaced). */
const NOT_READY = new Set(["PENDING", "READING", "SUPERSEDED"])

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	const self = `/finance/claro/${params.id}`
	const po = await loadClaroPo(params.id)
	if (!po) throw new Response("Not Found", { status: 404 })
	if (NOT_READY.has(po.status)) return fail("claro.errors.not_ready")
	try {
		switch (intent) {
			case "fix": {
				if (po.status === "CONFIRMED") return fail("claro.errors.not_editable")
				const parsed = parseFixForm(form, po)
				if (!parsed.ok) return fail(`claro.errors.${parsed.error}`)
				if (Object.keys(parsed.fields).length > 0)
					await fixPo(po.id, user.id, parsed.fields)
				return { saved: true as const }
			}
			case "generate": {
				if (po.invoice) throw redirect(`${self}?step=generate`)
				const workMonth = String(form.get("workMonth") ?? "") || null
				try {
					await generateFromPo({
						poId: po.id,
						userId: user.id,
						workMonth,
						overrides: parseOverrides(form),
					})
				} catch (e) {
					if (e instanceof ClaroInvoiceError && e.code === "already_made")
						throw redirect(`${self}?step=generate`)
					if (e instanceof PoError && e.code === "not_confirmable") {
						// Read the checks as they stand after the refresh.
						const now = await loadClaroPo(po.id)
						if (now?.checks.some((c) => HARD_STOPS.has(c.code)))
							return fail("claro.errors.hard_stop")
						// No reason can stand in for a PO date or number either.
						if (now?.checks.some(needsEntry))
							return fail("claro.errors.needs_entry")
						// No reason can stand in for an Aviso: an invoice needs one.
						if (!now?.avisoNumber) return fail("claro.errors.aviso_missing")
						return fail("claro.errors.reason_required")
					}
					throw e
				}
				throw redirect(`${self}?step=generate`)
			}
			case "upload_complete": {
				const file = form.get("file")
				if (!(file instanceof File) || file.size === 0)
					return fail("po_inbox.errors.no_files")
				if (!validateFile(file, "pdf").valid)
					return fail("po_inbox.errors.not_pdf")
				const [id] = await ingestPoFiles(
					[
						{
							name: file.name,
							bytes: new Uint8Array(await file.arrayBuffer()),
						},
					],
					user.id,
				)
				if (id === po.id) return fail("claro.errors.same_file")
				kickProcessing()
				throw redirect(`/finance/claro/${id}?step=review`)
			}
			case "discard": {
				const original = await discardPo(po.id, user.id)
				throw redirect(`/finance/claro/${original}`)
			}
			case "reread": {
				await rereadPo(po.id)
				return { saved: true as const }
			}
			case "submit": {
				if (!po.invoice) return fail("claro.errors.no_invoice")
				const day = parseDay(String(form.get("loadedOn") ?? ""))
				if (!day) return fail("claro.errors.bad_date")
				if (afterTomorrow(day)) return fail("claro.errors.future_date")
				const { marked } = await markLoaded([po.invoice.id], user.id, day)
				if (marked === 0) return fail("claro.errors.already_submitted")
				throw redirect(`/finance/claro?submitted=${po.invoice.id}`)
			}
		}
	} catch (e) {
		if (e instanceof PoError) {
			if (e.code === "not_pdf") return fail("po_inbox.errors.not_pdf")
			return fail(PO_ERRORS[e.code] ?? "po_inbox.errors.unknown")
		}
		if (e instanceof ClaroInvoiceError)
			return fail(INVOICE_ERRORS[e.code] ?? "po_inbox.errors.unknown")
		throw e
	}
	throw new Response("Unknown intent", { status: 400 })
}

export default function ClaroPoStep({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const data = loaderData
	const errorKey =
		actionData && "errorKey" in actionData ? actionData.errorKey : undefined
	useAutoRevalidate(data.view === "reading")
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("claro.title")}</h1>
			<ClaroStepRail current={data.step} poId={data.po.id} />
			{data.view === "reading" ? (
				<p role="status" className="rounded-lg border bg-card p-4 text-sm">
					{t("claro.reading", {
						name: data.po.poNumber ?? data.po.fileName,
					})}
				</p>
			) : data.view === "review" ? (
				<ClaroReviewView
					po={data.po}
					hasSignature={data.hasSignature}
					errorKey={errorKey}
				/>
			) : data.view === "generate" ? (
				<ClaroGenerateView po={data.po} />
			) : (
				<ClaroSubmitView po={data.po} today={data.today} errorKey={errorKey} />
			)}
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
