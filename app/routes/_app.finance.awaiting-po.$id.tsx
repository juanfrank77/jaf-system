import { redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	type PoConfirmError,
	PoConfirmView,
} from "~/components/po-confirm-view"
import { requireRole } from "~/lib/permissions.server"
import { confirmPo, fixPo, PoError, rereadPo } from "~/lib/po-inbox.server"
import { loadPoDetail } from "~/lib/po-inbox-view.server"
import type { Route } from "./+types/_app.finance.awaiting-po.$id"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const po = await loadPoDetail(params.id)
	if (!po) throw new Response("Not Found", { status: 404 })
	return { po }
}

const ERROR_KEY: Record<string, PoConfirmError> = {
	not_confirmable: "po_inbox.errors.not_confirmable",
	incomplete: "po_inbox.errors.incomplete",
	duplicate: "po_inbox.errors.duplicate",
	aviso_not_found: "po_inbox.errors.aviso_not_found",
	already_confirmed: "po_inbox.errors.already_confirmed",
}

const text = (form: FormData, k: string) => {
	const v = form.get(k)
	return typeof v === "string" ? v.trim() : undefined
}
const amount = (form: FormData, k: string) => {
	const v = text(form, k)
	if (v === undefined || v === "") return undefined
	const n = Number(v)
	return Number.isFinite(n) ? n : undefined
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent")
	try {
		if (intent === "fix") {
			const aviso = text(form, "avisoNumber")
			await fixPo(params.id, user.id, {
				poNumber: text(form, "poNumber"),
				poDate: text(form, "poDate"),
				termsDays: amount(form, "termsDays"),
				subtotal: amount(form, "subtotal"),
				ivu4: amount(form, "ivu4"),
				ivu115: amount(form, "ivu115"),
				total: amount(form, "total"),
				// Only a changed, non-empty Aviso is looked up.
				avisoNumber: aviso ? aviso : undefined,
			})
			return {}
		}
		if (intent === "confirm_one") {
			await confirmPo(params.id, user.id)
			throw redirect("/finance/awaiting-po")
		}
		if (intent === "reread") {
			await rereadPo(params.id)
			return {}
		}
	} catch (e) {
		if (e instanceof PoError)
			return {
				errorKey: ERROR_KEY[e.code] ?? ("po_inbox.errors.unknown" as const),
			}
		throw e
	}
	throw new Response("Unknown intent", { status: 400 })
}

export default function AwaitingPoDetail({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	return <PoConfirmView po={loaderData.po} errorKey={actionData?.errorKey} />
}

export { RouteErrorBoundary as ErrorBoundary }
