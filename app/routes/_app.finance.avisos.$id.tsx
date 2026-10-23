import { AvisoRecordView } from "~/components/aviso-record-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	avisoDocuments,
	avisoHistory,
	loadAviso,
} from "~/lib/aviso-ledger.server"
import { requireRole } from "~/lib/permissions.server"
import { uploadHref } from "~/lib/upload-href"
import type { Route } from "./+types/_app.finance.avisos.$id"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const aviso = await loadAviso(params.id)
	if (!aviso) throw new Response("Not Found", { status: 404 })
	const docs = await avisoDocuments(params.id)
	return {
		aviso,
		history: await avisoHistory(params.id),
		documents: docs.flatMap((d) => {
			if ("href" in d) return [{ label: d.label, href: d.href }]
			return d.path ? [{ label: d.label, href: uploadHref(d.path) }] : []
		}),
	}
}

export default function AvisoRecord({ loaderData }: Route.ComponentProps) {
	return <AvisoRecordView {...loaderData} />
}

export { RouteErrorBoundary as ErrorBoundary }
