import { useTranslation } from "react-i18next"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { ArmBStepRail } from "~/components/finance-step-rail"
import {
	type AdviceErrorKey,
	type AdviceTabKey,
	PaymentAdviceView,
} from "~/components/payment-advice-view"
import { validateFile } from "~/lib/file-upload.server"
import {
	AdviceError,
	acceptShort,
	adviceCounts,
	applyAdvice,
	ingestAdvice,
	linkLine,
	listAdvices,
	listUnmatched,
} from "~/lib/payment-advice.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.payment-advice"

const TABS: AdviceTabKey[] = ["upload", "applied", "unmatched"]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const counts = await adviceCounts("m19")
	const raw = new URL(request.url).searchParams.get("tab")
	const tab: AdviceTabKey = TABS.find((t) => t === raw) ?? "upload"
	return {
		counts,
		tab,
		advices:
			tab === "unmatched" ? [] : await listAdvices(tab === "applied", "m19"),
		unmatched: tab === "unmatched" ? await listUnmatched("m19") : [],
	}
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "upload") {
			const file = form.get("file")
			if (!(file instanceof File) || file.size === 0)
				return { errorKey: "payment_advice.errors.no_file" as const }
			if (!validateFile(file, "pdf").valid)
				return { errorKey: "payment_advice.errors.not_pdf" as const }
			await ingestAdvice(
				{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
				user.id,
			)
		} else if (intent === "apply") {
			await applyAdvice(String(form.get("adviceId")), user.id)
		} else if (intent === "link") {
			await linkLine(
				String(form.get("lineId")),
				String(form.get("invoice")),
				user.id,
			)
		} else if (intent === "accept_short") {
			await acceptShort(
				String(form.get("invoiceId")),
				String(form.get("reason") ?? ""),
				user.id,
			)
		} else {
			throw new Response("Unknown intent", { status: 400 })
		}
		return {}
	} catch (e) {
		if (e instanceof AdviceError)
			return { errorKey: `payment_advice.errors.${e.code}` as AdviceErrorKey }
		throw e
	}
}

export default function PaymentAdvice({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("finance_flow.arm_b.step.payment_advice")}
			</h1>
			<ArmBStepRail current="PAYMENT_ADVICE" />
			<PaymentAdviceView {...loaderData} errorKey={actionData?.errorKey} />
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
