import { AvisoRecordView } from "~/components/aviso-record-view"
import { RouteErrorBoundary } from "~/components/error-boundary"
import {
	avisoDocuments,
	avisoHistory,
	loadAviso,
} from "~/lib/aviso-ledger.server"
import { db } from "~/lib/db.server"
import { rowAmounts } from "~/lib/pbcc-batch.server"
import { requireRole } from "~/lib/permissions.server"
import { round2 } from "~/lib/service-lines"
import { uploadHref } from "~/lib/upload-href"
import type { Route } from "./+types/_app.finance.avisos.$id"

export async function loader({ request, params }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const aviso = await loadAviso(params.id)
	if (!aviso) throw new Response("Not Found", { status: 404 })
	const [docs, pbcc] = await Promise.all([
		avisoDocuments(params.id),
		db.jafInvoice.findUnique({
			where: { id: params.id },
			select: {
				jafInvoiceLines: true,
				jafInvoiceLineTotal: true,
				bankSchedule: {
					select: {
						number: true,
						advanceRate: true,
						wireAmount: true,
						wireReceivedAt: true,
					},
				},
			},
		}),
	])
	const batch = pbcc?.bankSchedule
	const sold = pbcc ? rowAmounts(pbcc).subtotal : 0
	const advance = batch ? round2(sold * Number(batch.advanceRate)) : 0
	return {
		aviso,
		pbccMoney: batch
			? {
					batchNumber: batch.number,
					sold,
					advance,
					held: round2(sold - advance),
					batchReceived:
						batch.wireAmount === null ? null : Number(batch.wireAmount),
					batchReceivedOn: batch.wireReceivedAt
						? batch.wireReceivedAt.toISOString().slice(0, 10)
						: null,
				}
			: null,
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
