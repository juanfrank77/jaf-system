import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
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
				<p className="text-sm text-muted-foreground">
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
					<Card key={row.id}>
						<CardContent className="space-y-4 p-4">
							<div className="flex items-center justify-between">
								<div>
									<span className="font-mono text-sm font-medium">
										{row.controlNumber}
									</span>
									{row.avisoNumber && (
										<span className="ml-2 text-sm text-foreground">
											{t("finance_receivables.aviso", {
												number: row.avisoNumber,
											})}
										</span>
									)}
									<p className="text-sm text-foreground">
										{row.supervisorName}
									</p>
								</div>
								<span className={`text-sm ${AGE_COLOR(row.ageDays)}`}>
									{t("finance_receivables.age_days", { count: row.ageDays })}
								</span>
							</div>

							<div className="grid grid-cols-3 gap-3 text-sm">
								{/* Advance */}
								<div className="space-y-2">
									<p className="text-sm font-medium text-foreground">
										{t("finance_receivables.advance_label")}
									</p>
									{row.advanceReceivedAt ? (
										<p className="font-medium text-green-700">
											${row.advanceAmount?.toFixed(2)} —{" "}
											{new Date(row.advanceReceivedAt).toLocaleDateString()}
										</p>
									) : (
										<Form method="post" className="flex gap-2">
											<input
												type="hidden"
												name="intent"
												value="record_advance"
											/>
											<input type="hidden" name="docId" value={row.id} />
											<Input
												name="advanceAmount"
												type="number"
												step="0.01"
												placeholder={t(
													"finance_receivables.amount_placeholder",
												)}
												className="h-9 w-28 text-sm"
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-9 text-sm"
											>
												{t("finance_receivables.record")}
											</Button>
										</Form>
									)}
								</div>

								{/* Final payment */}
								<div className="space-y-2">
									<p className="text-sm font-medium text-foreground">
										{t("finance_receivables.final_payment_label")}
									</p>
									{row.finalPaymentReceivedAt ? (
										<p className="font-medium text-green-700">
											${row.finalPaymentAmount?.toFixed(2)} —{" "}
											{new Date(
												row.finalPaymentReceivedAt,
											).toLocaleDateString()}
										</p>
									) : (
										<Form method="post" className="flex gap-2">
											<input type="hidden" name="intent" value="record_final" />
											<input type="hidden" name="docId" value={row.id} />
											<Input
												name="finalAmount"
												type="number"
												step="0.01"
												placeholder={t(
													"finance_receivables.amount_placeholder",
												)}
												className="h-9 w-28 text-sm"
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="h-9 text-sm"
											>
												{t("finance_receivables.record")}
											</Button>
										</Form>
									)}
								</div>

								{/* Close */}
								<div className="flex flex-col justify-between gap-2">
									<p className="text-sm font-medium text-foreground">
										{t("finance_receivables.close_entry_label")}
									</p>
									{row.advanceReceivedAt && row.finalPaymentReceivedAt ? (
										<Form method="post">
											<input type="hidden" name="intent" value="close" />
											<input type="hidden" name="docId" value={row.id} />
											<Button
												type="submit"
												size="sm"
												className="h-9 w-full text-sm"
											>
												{t("finance_receivables.close")}
											</Button>
										</Form>
									) : (
										<p className="text-sm text-muted-foreground">
											{t("finance_receivables.record_both_first")}
										</p>
									)}
								</div>
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			{closed.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-foreground">
						{t("finance_receivables.closed_summary", {
							count: closed.length,
						})}
					</summary>
					<div className="mt-2 space-y-1">
						{closed.map((row) => (
							<div
								key={row.id}
								className="flex items-center justify-between py-1 text-sm text-foreground border-b"
							>
								<span className="font-mono">{row.controlNumber}</span>
								<span>
									{t("finance_receivables.closed_on", {
										date: row.receivableClosedAt
											? new Date(row.receivableClosedAt).toLocaleDateString()
											: "",
										interpolation: { escapeValue: false },
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
