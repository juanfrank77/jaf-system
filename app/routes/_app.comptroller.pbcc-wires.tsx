import { useTranslation } from "react-i18next"
import { Form, useNavigation } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { requireRole } from "~/lib/permissions.server"
import { listWireBatches, recordWire, WireError } from "~/lib/pbcc-wire.server"
import type { Route } from "./+types/_app.comptroller.pbcc-wires"

export const meta: Route.MetaFunction = () => [
	{ title: "PBCC wires — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	return { batches: await listWireBatches() }
}

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	const scheduleId = String(form.get("scheduleId") ?? "")
	try {
		const result = await recordWire({
			scheduleId,
			receivedOn: String(form.get("receivedOn") ?? ""),
			amount: Number(String(form.get("amount") ?? "").replace(/,/g, "")),
			userId: user.id,
		})
		return { scheduleId, ...result }
	} catch (e) {
		if (e instanceof WireError)
			return { scheduleId, errorKey: `pbcc_wires.errors.${e.code}` as const }
		throw e
	}
}

const money = (n: number) =>
	n.toLocaleString("en-US", { style: "currency", currency: "USD" })

export default function PbccWires({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { t } = useTranslation()
	const nav = useNavigation()
	const saving = nav.state !== "idle"
	return (
		<div className="space-y-4 p-6">
			<h1 className="text-2xl font-bold">{t("pbcc_wires.title")}</h1>
			<p className="text-sm text-muted-foreground">{t("pbcc_wires.intro")}</p>
			<Card>
				<CardContent className="overflow-x-auto p-0">
					{loaderData.batches.length === 0 ? (
						<p className="p-4 text-sm text-muted-foreground">
							{t("pbcc_wires.empty")}
						</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-muted-foreground">
									<th className="p-2">{t("pbcc_wires.col.batch")}</th>
									<th className="p-2 text-right">{t("pbcc_wires.col.sold")}</th>
									<th className="p-2 text-right">
										{t("pbcc_wires.col.advance")}
									</th>
									<th className="p-2 text-right">
										{t("pbcc_wires.col.expected")}
									</th>
									<th className="p-2">{t("pbcc_wires.col.received")}</th>
									<th className="p-2 text-right">{t("pbcc_wires.col.held")}</th>
								</tr>
							</thead>
							<tbody>
								{loaderData.batches.map((b) => {
									const mine =
										actionData?.scheduleId === b.id ? actionData : undefined
									const error =
										mine && "errorKey" in mine ? mine.errorKey : undefined
									return (
										<tr key={b.id} className="border-b align-top last:border-0">
											<td className="p-2 font-medium">
												{t("pbcc_wires.batch_label", { number: b.number })}
												<div className="text-xs font-normal text-muted-foreground">
													{b.sentAt.toLocaleDateString()}
												</div>
											</td>
											<td className="p-2 text-right">{money(b.total)}</td>
											<td className="p-2 text-right">{money(b.advance)}</td>
											<td className="p-2 text-right">{money(b.expected)}</td>
											<td className="p-2">
												<Form method="post" className="flex flex-wrap gap-2">
													<input type="hidden" name="scheduleId" value={b.id} />
													<Input
														type="date"
														name="receivedOn"
														required
														defaultValue={b.wireReceivedOn ?? ""}
														aria-label={t("pbcc_wires.date")}
														className="w-40"
													/>
													<Input
														type="text"
														inputMode="decimal"
														name="amount"
														required
														defaultValue={b.wireAmount ?? ""}
														placeholder={t("pbcc_wires.amount")}
														aria-label={t("pbcc_wires.amount")}
														className="w-32"
													/>
													<Button type="submit" size="sm" disabled={saving}>
														{t("pbcc_wires.save")}
													</Button>
												</Form>
												{error ? (
													<p
														role="alert"
														className="mt-1 text-xs text-destructive"
													>
														{t(error)}
													</p>
												) : null}
												{b.difference !== null && b.difference !== 0 ? (
													<p
														role="status"
														className="mt-1 text-xs text-status-warn"
													>
														{t("pbcc_wires.difference", {
															amount: money(Math.abs(b.difference)),
															direction:
																b.difference < 0
																	? t("pbcc_wires.short")
																	: t("pbcc_wires.over"),
														})}
													</p>
												) : null}
												{b.difference === 0 ? (
													<p className="mt-1 text-xs text-muted-foreground">
														{t("pbcc_wires.matches")}
													</p>
												) : null}
											</td>
											<td className="p-2 text-right">{money(b.held)}</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
