import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.finance.receivables"

export const meta: Route.MetaFunction = () => [
	{ title: "Receivables — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["FINANCE", "ADMIN"])
	const invoices = await db.jafInvoice.findMany({
		where: {
			status: { in: ["LC_GENERATED", "CLARO_UPLOADED", "SUPERVISOR_APPROVED"] },
		},
		include: { supervisor: true, poLinks: true },
		orderBy: { lcGeneratedAt: "desc" },
	})
	const now = Date.now()
	const rows = invoices.map((inv) => {
		const anchor =
			inv.lcGeneratedAt ?? inv.supervisorApprovedAt ?? inv.createdAt
		const ageDays = Math.floor((now - new Date(anchor).getTime()) / 86400000)
		return {
			id: inv.id,
			controlNumber: inv.controlNumber,
			avisoNumber: inv.avisoNumber,
			supervisorName: inv.supervisor?.name ?? "—",
			ageDays,
			status: inv.status,
			advanceReceivedAt: inv.advanceReceivedAt,
			advanceAmount: inv.advanceAmount ? Number(inv.advanceAmount) : null,
			finalPaymentReceivedAt: inv.finalPaymentReceivedAt,
			finalPaymentAmount: inv.finalPaymentAmount
				? Number(inv.finalPaymentAmount)
				: null,
			receivableClosedAt: inv.receivableClosedAt,
		}
	})
	return { rows }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["FINANCE", "ADMIN"])
	const form = await request.formData()
	const intent = form.get("intent") as string
	const docId = form.get("docId") as string

	if (intent === "record_advance") {
		const amount = parseFloat(form.get("advanceAmount") as string)
		if (isNaN(amount))
			return { errorKey: "finance_receivables.errors.invalid_amount" }
		await db.jafInvoice.update({
			where: { id: docId },
			data: { advanceReceivedAt: new Date(), advanceAmount: amount },
		})
		await db.auditTrail.create({
			data: {
				docId,
				userId: user.id,
				action: "ADVANCE_RECEIVED",
				diffJson: { advanceAmount: amount },
			},
		})
	}

	if (intent === "record_final") {
		const amount = parseFloat(form.get("finalAmount") as string)
		if (isNaN(amount))
			return { errorKey: "finance_receivables.errors.invalid_amount" }
		await db.jafInvoice.update({
			where: { id: docId },
			data: { finalPaymentReceivedAt: new Date(), finalPaymentAmount: amount },
		})
		await db.auditTrail.create({
			data: {
				docId,
				userId: user.id,
				action: "FINAL_PAYMENT_RECEIVED",
				diffJson: { finalPaymentAmount: amount },
			},
		})
	}

	if (intent === "close") {
		await db.jafInvoice.update({
			where: { id: docId },
			data: { receivableClosedAt: new Date(), receivableClosedById: user.id },
		})
		await db.auditTrail.create({
			data: {
				docId,
				userId: user.id,
				action: "RECEIVABLE_CLOSED",
				diffJson: {},
			},
		})
	}

	return null
}

const AGE_COLOR = (days: number) =>
	days > 90
		? "text-red-600 font-semibold"
		: days > 60
			? "text-orange-600"
			: days > 30
				? "text-yellow-700"
				: "text-slate-700"

export default function ReceivablesDashboard({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { rows } = loaderData
	const { t } = useTranslation()
	const open = rows.filter((r) => !r.receivableClosedAt)
	const closed = rows.filter((r) => r.receivableClosedAt)

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">
					{t("finance_receivables.title")}
				</h1>
				<p className="text-sm text-slate-500">
					{t("finance_receivables.open_count", { count: open.length })}
				</p>
			</div>

			{(actionData as { errorKey?: any } | null)?.errorKey && (
				<p className="text-sm text-red-600">
					{t((actionData as { errorKey: any }).errorKey)}
				</p>
			)}

			<div className="space-y-3">
				{open.map((row) => (
					<div
						key={row.id}
						className="bg-white border rounded-lg p-4 space-y-3"
					>
						<div className="flex items-center justify-between">
							<div>
								<span className="font-mono font-medium text-sm">
									{row.controlNumber}
								</span>
								{row.avisoNumber && (
									<span className="text-xs text-slate-500 ml-2">
										{t("finance_receivables.aviso", {
											number: row.avisoNumber,
										})}
									</span>
								)}
								<p className="text-xs text-slate-500">{row.supervisorName}</p>
							</div>
							<span className={`text-sm ${AGE_COLOR(row.ageDays)}`}>
								{t("finance_receivables.age_days", { count: row.ageDays })}
							</span>
						</div>

						<div className="grid grid-cols-3 gap-3 text-xs">
							{/* Advance */}
							<div className="bg-slate-50 rounded p-2">
								<p className="text-slate-500 mb-1">
									{t("finance_receivables.advance_label")}
								</p>
								{row.advanceReceivedAt ? (
									<p className="text-green-700 font-medium">
										${row.advanceAmount?.toFixed(2)} —{" "}
										{new Date(row.advanceReceivedAt).toLocaleDateString()}
									</p>
								) : (
									<Form method="post" className="flex gap-1 mt-1">
										<input type="hidden" name="intent" value="record_advance" />
										<input type="hidden" name="docId" value={row.id} />
										<Input
											name="advanceAmount"
											type="number"
											step="0.01"
											placeholder={t("finance_receivables.amount_placeholder")}
											className="h-7 text-xs w-24"
										/>
										<Button
											type="submit"
											size="sm"
											variant="outline"
											className="h-7 text-xs"
										>
											{t("finance_receivables.record")}
										</Button>
									</Form>
								)}
							</div>

							{/* Final payment */}
							<div className="bg-slate-50 rounded p-2">
								<p className="text-slate-500 mb-1">
									{t("finance_receivables.final_payment_label")}
								</p>
								{row.finalPaymentReceivedAt ? (
									<p className="text-green-700 font-medium">
										${row.finalPaymentAmount?.toFixed(2)} —{" "}
										{new Date(row.finalPaymentReceivedAt).toLocaleDateString()}
									</p>
								) : (
									<Form method="post" className="flex gap-1 mt-1">
										<input type="hidden" name="intent" value="record_final" />
										<input type="hidden" name="docId" value={row.id} />
										<Input
											name="finalAmount"
											type="number"
											step="0.01"
											placeholder={t("finance_receivables.amount_placeholder")}
											className="h-7 text-xs w-24"
										/>
										<Button
											type="submit"
											size="sm"
											variant="outline"
											className="h-7 text-xs"
										>
											{t("finance_receivables.record")}
										</Button>
									</Form>
								)}
							</div>

							{/* Close */}
							<div className="bg-slate-50 rounded p-2 flex flex-col justify-between">
								<p className="text-slate-500 mb-1">
									{t("finance_receivables.close_entry_label")}
								</p>
								{row.advanceReceivedAt && row.finalPaymentReceivedAt ? (
									<Form method="post">
										<input type="hidden" name="intent" value="close" />
										<input type="hidden" name="docId" value={row.id} />
										<Button
											type="submit"
											size="sm"
											className="h-7 text-xs w-full"
										>
											{t("finance_receivables.close")}
										</Button>
									</Form>
								) : (
									<p className="text-xs text-slate-400">
										{t("finance_receivables.record_both_first")}
									</p>
								)}
							</div>
						</div>
					</div>
				))}
			</div>

			{closed.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-slate-500">
						{t("finance_receivables.closed_summary", {
							count: closed.length,
						})}
					</summary>
					<div className="mt-2 space-y-1">
						{closed.map((row) => (
							<div
								key={row.id}
								className="flex items-center justify-between text-xs text-slate-400 py-1 border-b"
							>
								<span className="font-mono">{row.controlNumber}</span>
								<span>
									{t("finance_receivables.closed_on", {
										date: row.receivableClosedAt
											? new Date(row.receivableClosedAt).toLocaleDateString()
											: "",
									})}
								</span>
							</div>
						))}
					</div>
				</details>
			)}
		</div>
	)
}
