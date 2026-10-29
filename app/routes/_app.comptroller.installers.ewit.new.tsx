import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	data,
	Form,
	Link,
	redirect,
	useFetcher,
	useNavigation,
} from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { InstallerStepper } from "~/components/installer-stepper"
import { receiptUrl } from "~/components/receipt-banner"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { db } from "~/lib/db.server"
import {
	createEwitInvoice,
	EwitError,
	loadWarrantyDocs,
	readEwitPdf,
} from "~/lib/ewit.server"
import { EWIT_INVOICE_LIMIT } from "~/lib/ewit-limits"
import type { EwitRead } from "~/lib/ewit-parse"
import { formatShortDate } from "~/lib/payroll-request-view"
import { parsePaidDate, puertoRicoToday } from "~/lib/payroll-run.server"
import { requireRole } from "~/lib/permissions.server"
import { formatMoney } from "~/lib/utils"
import type { Route } from "./+types/_app.comptroller.installers.ewit.new"

export const meta: Route.MetaFunction = () => [
	{ title: "New EWIT invoice — JAF Ops" },
]

export async function loader({ request }: Route.LoaderArgs) {
	await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const docs = await loadWarrantyDocs()
	return {
		today: puertoRicoToday(),
		docs: docs.map((d) => ({
			id: d.id,
			orderNo: d.orderNo,
			installerName: d.installerName,
			installedAt: d.installedAt.toISOString(),
			hasPhoto: Boolean(d.photoPath),
		})),
	}
}

const mmddyyyy = (iso: string) => {
	const [y, m, d] = iso.split("-")
	return `${m}/${d}/${y}`
}

const ERROR_KEYS = {
	missing_number: "installers.errors.missing_number",
	duplicate_number: "installers.errors.duplicate_number",
	bad_total: "installers.errors.bad_total",
	over_limit: "installers.errors.over_limit",
	no_file: "installers.errors.no_file",
	no_orders: "installers.errors.no_orders",
	order_on_invoice: "installers.errors.order_on_invoice",
} as const

export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["COMPTROLLER", "ADMIN"])
	const form = await request.formData()
	if (form.get("intent") === "read") {
		const f = form.get("file")
		return data({ read: f instanceof File ? await readEwitPdf(f) : null })
	}
	const parsed = parsePaidDate(String(form.get("invoiceDate") ?? ""))
	if (!("date" in parsed))
		return data({ errorKey: "installers.errors.invalid_date" as const }, 400)
	const file = form.get("file")
	try {
		const res = await createEwitInvoice({
			number: String(form.get("number") ?? ""),
			invoiceDate: parsed.date,
			total: Number(String(form.get("total") ?? "").replace(/[$,\s]/g, "")),
			file: file instanceof File ? file : null,
			completionIds: form.getAll("completionId").map(String),
			typedOrderNos: String(form.get("typed") ?? "").split(/[\s,;]+/),
			userId: user.id,
		})
		const orders = await db.installCompletion.count({
			where: { ewitInvoiceId: res.id },
		})
		return redirect(
			receiptUrl("/comptroller/installers/ewit", "ewit_saved", {
				a: String(form.get("number") ?? "").trim(),
				b: orders + res.unmatched.length,
			}),
		)
	} catch (e) {
		if (e instanceof EwitError && e.code in ERROR_KEYS)
			return data(
				{
					errorKey: ERROR_KEYS[e.code as keyof typeof ERROR_KEYS],
					orders: e.detail.join(", "),
				},
				400,
			)
		throw e
	}
}

export default function NewEwitInvoice({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { docs, today } = loaderData
	const { t } = useTranslation()
	const submitting = useNavigation().state !== "idle"
	const [picked, setPicked] = useState<string[]>([])
	const [typed, setTyped] = useState("")
	const [total, setTotal] = useState("")
	const [number, setNumber] = useState("")
	const [invoiceDate, setInvoiceDate] = useState(() => mmddyyyy(today))
	const reader = useFetcher<{ read: EwitRead | null }>()
	const read = reader.data?.read ?? null
	const [preview, setPreview] = useState<string | null>(null)
	// Whatever the attached PDF says fills the fields; Carmen can still correct them.
	useEffect(() => {
		if (!read) return
		if (read.number) setNumber(read.number)
		if (read.invoiceDate) setInvoiceDate(mmddyyyy(read.invoiceDate))
		if (read.total != null) setTotal(read.total.toFixed(2))
	}, [read])
	const readNothing =
		read !== null && !read.number && !read.invoiceDate && read.total == null
	const readMismatch =
		read?.total != null &&
		read.linesTotal != null &&
		Math.abs(read.total - read.linesTotal) > 0.005
	const amount = Number(total.replace(/[$,\s]/g, ""))
	const overLimit = Number.isFinite(amount) && amount > EWIT_INVOICE_LIMIT
	const typedNos = typed.split(/[\s,;]+/).filter(Boolean)
	const known = new Set(docs.map((d) => d.orderNo))
	const unmatched = typedNos.filter((o) => !known.has(o))
	return (
		<div className="space-y-4 p-6">
			<InstallerStepper current="ewit" />
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold">{t("installers.ewit_new.title")}</h1>
				<Link
					to="/comptroller/installers/ewit"
					className={buttonVariants({ variant: "ghost" })}
				>
					{t("installers.ewit_new.cancel")}
				</Link>
			</div>
			{actionData && "errorKey" in actionData && (
				<p className="text-sm text-status-danger">
					{t(actionData.errorKey as never, {
						orders: "orders" in actionData ? actionData.orders : "",
					})}
				</p>
			)}
			<div className="grid gap-4 lg:grid-cols-2">
				<Form method="post" encType="multipart/form-data" className="space-y-4">
					<Card>
						<CardContent className="space-y-3 p-4">
							<div>
								<Label htmlFor="number">
									{t("installers.ewit_new.number")}
								</Label>
								<Input
									id="number"
									name="number"
									value={number}
									onChange={(e) => setNumber(e.target.value)}
									required
								/>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<Label htmlFor="invoiceDate">
										{t("installers.ewit_new.date")}
									</Label>
									<Input
										id="invoiceDate"
										name="invoiceDate"
										value={invoiceDate}
										onChange={(e) => setInvoiceDate(e.target.value)}
										placeholder="MM/DD/YYYY"
										required
									/>
								</div>
								<div>
									<Label htmlFor="total">
										{t("installers.ewit_new.total")}
									</Label>
									<Input
										id="total"
										name="total"
										inputMode="decimal"
										value={total}
										onChange={(e) => setTotal(e.target.value)}
										required
									/>
								</div>
							</div>
							<div>
								<Label htmlFor="file">{t("installers.ewit_new.pdf")}</Label>
								<Input
									id="file"
									name="file"
									type="file"
									accept="application/pdf"
									required
									onChange={(e) => {
										const f = e.target.files?.[0]
										if (f) {
											const body = new FormData()
											body.set("intent", "read")
											body.set("file", f)
											reader.submit(body, {
												method: "post",
												encType: "multipart/form-data",
											})
										}
										setPreview((old) => {
											if (old) URL.revokeObjectURL(old)
											return f ? URL.createObjectURL(f) : null
										})
									}}
								/>
								{reader.state !== "idle" ? (
									<p className="text-xs text-muted-foreground">
										{t("installers.ewit_new.reading")}
									</p>
								) : readNothing ? (
									<p className="text-xs text-status-warn">
										{t("installers.ewit_new.read_none")}
									</p>
								) : read ? (
									<p
										className={
											readMismatch
												? "text-xs text-status-warn"
												: "text-xs text-muted-foreground"
										}
									>
										{readMismatch
											? t("installers.ewit_new.read_mismatch", {
													lines: formatMoney(read.linesTotal ?? 0),
												})
											: t("installers.ewit_new.read_ok")}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="space-y-2 p-4">
							<h2 className="text-sm font-semibold">
								{t("installers.ewit_new.orders_heading")}
							</h2>
							{docs.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("installers.ewit_new.none_waiting")}
								</p>
							) : (
								<ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
									{docs.map((d) => (
										<li key={d.id}>
											<label className="flex items-center gap-2">
												<input
													type="checkbox"
													name="completionId"
													value={d.id}
													checked={picked.includes(d.id)}
													onChange={(e) =>
														setPicked((p) =>
															e.target.checked
																? [...p, d.id]
																: p.filter((x) => x !== d.id),
														)
													}
												/>
												<span className="font-mono">{d.orderNo}</span> ·{" "}
												{d.installerName} · {formatShortDate(d.installedAt)}
											</label>
										</li>
									))}
								</ul>
							)}
							<div>
								<Label htmlFor="typed">
									{t("installers.ewit_new.type_order")}
								</Label>
								<textarea
									id="typed"
									name="typed"
									rows={2}
									value={typed}
									onChange={(e) => setTyped(e.target.value)}
									className="w-full rounded border bg-background px-2 py-1 text-sm"
								/>
								<p className="text-xs text-muted-foreground">
									{t("installers.ewit_new.type_hint")}
								</p>
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="space-y-1 p-4 text-sm">
							<h2 className="font-semibold">
								{t("installers.ewit_new.checks")}
							</h2>
							<p className={overLimit ? "text-status-danger" : undefined}>
								{overLimit ? "✗" : "✓"}{" "}
								{t("installers.ewit_new.check_total", {
									limit: formatMoney(EWIT_INVOICE_LIMIT),
								})}
							</p>
							<p className="text-muted-foreground">
								✓ {t("installers.ewit_new.check_number")}
							</p>
							<p className="text-muted-foreground">
								✓ {t("installers.ewit_new.check_orders")}
							</p>
							{unmatched.length > 0 ? (
								<p className="text-status-warn">
									! {t("installers.ewit_new.flag_unmatched")} (
									{unmatched.join(", ")})
								</p>
							) : null}
							<p className="text-muted-foreground">
								{t("installers.ewit_new.ticked", {
									count: picked.length + typedNos.length,
								})}
							</p>
						</CardContent>
					</Card>
					<Button type="submit" disabled={submitting || overLimit}>
						{t("installers.ewit_new.save")}
					</Button>
				</Form>
				<div className="min-h-96 rounded-lg border bg-muted">
					{preview ? (
						<iframe
							title={t("installers.ewit_new.pdf_preview")}
							src={preview}
							className="h-full min-h-96 w-full"
						/>
					) : (
						<p className="p-4 text-sm text-muted-foreground">
							{t("installers.ewit_new.pdf_preview")}
						</p>
					)}
				</div>
			</div>
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
