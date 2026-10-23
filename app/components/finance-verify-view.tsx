import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link } from "react-router"
import { BrigadeStockTracked } from "~/components/brigade-stock-tracked"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Checkbox } from "~/components/ui/checkbox"
import { Textarea } from "~/components/ui/textarea"
import { VERIFY_CHECKS as CHECKS } from "~/lib/finance-verify-checks"
import { formatMoney } from "~/lib/utils"
import type { Route } from "../routes/+types/_app.finance.verify.$id"

type MaterialServiceCode = ComponentProps<
	typeof MaterialLineItems
>["serviceCodes"][number]

// Keyed by packet: "Accept & next" keeps this screen mounted, and the four
// checks must start unticked for every packet.
export function FinanceVerifyView(props: ViewProps) {
	return <VerifyPacket key={props.loaderData.doc.id} {...props} />
}

type ViewProps = Pick<Route.ComponentProps, "loaderData" | "actionData">

function VerifyPacket({ loaderData, actionData }: ViewProps) {
	const {
		doc,
		serviceCodes,
		stage,
		invoiceLines,
		totals,
		neighbors,
		sendBackNotes,
		returnState,
		notReleased,
		canVerify,
		canSendBack,
		packetDocs,
		avisoDiscrepancy,
		packetHref,
		legacyPricedHref,
		pricedInvoiceHref,
		brigadeStock,
		materials,
	} = loaderData
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | undefined

	const cannotVerify =
		stage !== "TO_VERIFY" || doc.status === "LC_REQUEST_GENERATED"
	const [checks, setChecks] = useState({
		invoice: false,
		aviso: false,
		photos: false,
		precert: false,
	})
	// The document open in the viewer on this page: first present PDF to start.
	const [viewing, setViewing] = useState<{
		href: string
		kind: "pdf" | "image"
		label: string
	} | null>(() => {
		const first = packetDocs.find((d) => d.href && d.key !== "photos")
		return first?.href
			? {
					href: first.href,
					kind: "pdf",
					label: t(first.label as ParseKeys, {
						number: doc.avisoNumber ?? "—",
					}),
				}
			: null
	})
	// Accept stays grey until all four are ticked and no document is missing.
	const readyToAccept =
		CHECKS.every((c) => checks[c]) && packetDocs.every((d) => d.href)

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<div>
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold">
							{t("finance_verify.title")}
						</h1>
						<StageChip arm="A" step={1} total={5} />
					</div>
					<p className="font-mono text-sm text-muted-foreground">
						{doc.controlNumber} — {doc.jobType}
					</p>
				</div>
				<nav className="flex items-center gap-3 text-sm">
					{neighbors.position > 0 && (
						<span className="text-muted-foreground">
							{t("finance_verify.position", {
								position: neighbors.position,
								total: neighbors.total,
							})}
						</span>
					)}
					{neighbors.prevId ? (
						<Link
							to={`/finance/verify/${neighbors.prevId}`}
							className="underline"
						>
							‹ {t("finance_verify.prev")}
						</Link>
					) : null}
					{neighbors.nextId ? (
						<Link
							to={`/finance/verify/${neighbors.nextId}`}
							className="underline"
						>
							{t("finance_verify.next")} ›
						</Link>
					) : null}
				</nav>
			</div>
			<FinanceStepRail current="PACKETS" />
			<Callout title={t("finance_flow.callout.packets_title")}>
				{t("finance_flow.callout.packets_body")}
			</Callout>

			<div className="bg-card border rounded-lg p-4 space-y-3">
				<h2 className="text-sm font-medium">
					{t("finance_verify.preview.heading")}
				</h2>
				{invoiceLines.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("finance_verify.preview.empty")}
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="p-2">{t("finance_verify.preview.code")}</th>
									<th className="p-2">{t("finance_verify.preview.service")}</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.qty")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.price")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.ivu")}
									</th>
									<th className="p-2 text-right">
										{t("finance_verify.preview.amount")}
									</th>
								</tr>
							</thead>
							<tbody>
								{invoiceLines.map((l) => (
									<tr key={l.serviceCodeId} className="border-b last:border-0">
										<td className="p-2 font-mono">{l.claroCode}</td>
										<td className="p-2">{l.name}</td>
										<td className="p-2 text-right font-mono">{l.qty}</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(l.unitPrice)}
										</td>
										<td className="p-2 text-right font-mono">
											{`${+(l.ivuRate * 100).toFixed(2)}%`}
										</td>
										<td className="p-2 text-right font-mono">
											{formatMoney(l.lineAmount)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				<dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 text-sm">
					<dt className="text-muted-foreground">
						{t("finance_verify.subtotal")}
					</dt>
					<dd className="text-right font-mono">
						{formatMoney(totals.subtotal)}
					</dd>
					<dt className="text-muted-foreground">{t("finance_verify.ivu_4")}</dt>
					<dd className="text-right font-mono">{formatMoney(totals.ivu4)}</dd>
					<dt className="text-muted-foreground">
						{t("finance_verify.ivu_115")}
					</dt>
					<dd className="text-right font-mono">{formatMoney(totals.ivu115)}</dd>
					<dt className="font-medium">{t("finance_verify.total")}</dt>
					<dd className="text-right font-mono font-medium">
						{formatMoney(totals.total)}
					</dd>
				</dl>
			</div>

			<div className="bg-card border rounded-lg p-4 space-y-2">
				<div className="flex items-center justify-between gap-2">
					<h2 className="text-sm font-medium">
						{t("finance_verify.packet.heading")}
					</h2>
					<a
						href={`/finance/verify/${doc.id}/packet.zip`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{t("finance_verify.packet.download_all")}
					</a>
				</div>
				<ul className="divide-y text-sm">
					{packetDocs.map((d) => (
						<li
							key={d.key}
							className="flex flex-wrap items-center justify-between gap-2 py-2"
						>
							<div>
								<p className="font-medium">
									{t(d.label as ParseKeys, {
										number: doc.avisoNumber ?? "—",
									})}
								</p>
								{d.href ? (
									<p className="text-xs text-muted-foreground">
										{t(`finance_verify.packet.${d.key}_detail` as ParseKeys, {
											file: d.detail,
											count: Number(d.detail) || 0,
										})}
									</p>
								) : (
									<Badge variant="warn">
										{t("finance_verify.packet.missing")}
									</Badge>
								)}
							</div>
							{d.files.length === 0 && d.href && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() =>
										setViewing({
											href: d.href as string,
											kind: "pdf",
											label: t(d.label as ParseKeys, {
												number: doc.avisoNumber ?? "—",
											}),
										})
									}
								>
									{t("finance_verify.packet.open")}
								</Button>
							)}
							{d.files.length > 0 && (
								<ul className="flex w-full flex-wrap gap-2">
									{d.files.map((f) => (
										<li key={f.href}>
											<button
												type="button"
												onClick={() =>
													setViewing({
														href: f.href,
														kind: "image",
														label: f.name,
													})
												}
												className="block overflow-hidden rounded-md border hover:border-primary"
												aria-label={f.name}
											>
												<img
													src={f.href}
													alt={f.name}
													loading="lazy"
													className="size-20 object-cover"
												/>
											</button>
										</li>
									))}
								</ul>
							)}
						</li>
					))}
				</ul>
			</div>

			{viewing && (
				<div className="bg-card border rounded-lg p-4 space-y-2">
					<div className="flex items-center justify-between gap-2">
						<h2 className="text-sm font-medium">{viewing.label}</h2>
						<a
							href={viewing.href}
							target="_blank"
							rel="noreferrer"
							className="text-xs text-accent-text underline"
						>
							{t("finance_verify.packet.open_new_tab")}
						</a>
					</div>
					{viewing.kind === "pdf" ? (
						<iframe
							key={viewing.href}
							src={viewing.href}
							title={viewing.label}
							className="h-[70vh] w-full rounded-md border"
						/>
					) : (
						<img
							src={viewing.href}
							alt={viewing.label}
							className="mx-auto max-h-[70vh] rounded-md"
						/>
					)}
				</div>
			)}

			{avisoDiscrepancy && (
				<Callout title={t("finance_verify.aviso_discrepancy_title")}>
					<ul className="list-disc pl-5">
						{avisoDiscrepancy.differences.map((d) => (
							<li key={d.claroCode}>
								{t("docs_review.aviso_difference", {
									workOrder: d.workOrder,
									aviso: d.aviso,
									name: d.name,
								})}
							</li>
						))}
					</ul>
					{avisoDiscrepancy.note && (
						<p className="mt-1">
							{t("docs_review.aviso_discrepancy_note", {
								note: avisoDiscrepancy.note,
							})}
						</p>
					)}
				</Callout>
			)}

			<div className="grid grid-cols-1 gap-4">
				<div className="bg-card border rounded-lg p-4 space-y-3">
					<h2 className="text-sm font-medium">
						{t("finance_verify.jaf_invoice")}
					</h2>
					{(pricedInvoiceHref || packetHref || legacyPricedHref) && (
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
							{pricedInvoiceHref && (
								<a
									href={pricedInvoiceHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.priced_invoice")}
								</a>
							)}
							{packetHref && (
								<a
									href={packetHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.claro_packet")}
								</a>
							)}
							{legacyPricedHref && (
								<a
									href={legacyPricedHref}
									target="_blank"
									rel="noreferrer"
									className="text-accent-text underline"
								>
									{t("finance_verify.priced_invoice_legacy")}
								</a>
							)}
						</div>
					)}
					<div className="text-sm space-y-1">
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.job_type")}:
							</span>{" "}
							{doc.jobType}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.address")}:
							</span>{" "}
							{doc.jobAddressActual || doc.jobAddressEstimated}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.aviso_number")}:
							</span>{" "}
							{doc.avisoNumber || "—"}
						</p>
						<p>
							<span className="text-muted-foreground">
								{t("finance_verify.supervisor")}:
							</span>{" "}
							{loaderData.doc.supervisor?.name}
						</p>
					</div>
					<MaterialLineItems
						serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
						initialItems={materials}
						readOnly
					/>
				</div>
				<BrigadeStockTracked lines={brigadeStock} />
			</div>

			{returnState.returned && returnState.createdAt && (
				<Callout
					tone="danger"
					title={t("returned_packet.finance.verify_returned")}
				>
					<span className="block whitespace-pre-line">{returnState.note}</span>
					<span className="block text-xs">
						{new Date(returnState.createdAt).toLocaleString()}
					</span>
				</Callout>
			)}
			{returnState.resentPending && returnState.resentAt && (
				<Callout tone="info" title={t("returned_packet.resent")}>
					{t("returned_packet.finance.resent_on", {
						date: new Date(returnState.resentAt).toLocaleString(),
					})}
					{returnState.note && (
						<span className="block whitespace-pre-line">
							{returnState.note}
						</span>
					)}
				</Callout>
			)}
			{notReleased && (
				<Callout tone="warn" title={t("returned_packet.finance.not_released")}>
					{t("returned_packet.finance.not_released_body")}
				</Callout>
			)}

			{sendBackNotes.length > 0 && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-4 space-y-2">
					<h3 className="text-sm font-medium text-status-warn">
						{t("finance_verify.previous_send_backs")}
					</h3>
					{sendBackNotes.map((note) => (
						<p
							key={`${note.createdAt}-${note.note}`}
							className="text-sm text-status-warn"
						>
							{new Date(note.createdAt).toLocaleString()} — {note.note}
						</p>
					))}
				</div>
			)}

			{stage === "TO_VERIFY" && doc.status !== "LC_REQUEST_GENERATED" && (
				<div className="flex flex-wrap items-start gap-4">
					{canVerify ? (
						<Form method="post" className="space-y-3">
							<input type="hidden" name="intent" value="verify" />
							<fieldset className="space-y-2">
								{CHECKS.map((c) => (
									<label
										key={c}
										htmlFor={`check_${c}`}
										className="flex items-center gap-2 text-sm"
									>
										<Checkbox
											id={`check_${c}`}
											name={`check_${c}`}
											checked={checks[c]}
											onCheckedChange={(v) =>
												setChecks((prev) => ({ ...prev, [c]: v === true }))
											}
										/>
										{t(`finance_verify.checks.${c}`)}
									</label>
								))}
							</fieldset>
							<Textarea
								name="note"
								rows={2}
								placeholder={t("finance_verify.verify_note_placeholder")}
							/>
							<Button type="submit" disabled={cannotVerify || !readyToAccept}>
								{t("finance_verify.accept_next")}
							</Button>
							{cannotVerify && (
								<p className="text-sm text-status-warn">
									{t("finance_verify.cannot_verify_hint")}
								</p>
							)}
						</Form>
					) : (
						<p className="text-sm text-muted-foreground">
							{t(
								returnState.returned
									? "returned_packet.finance.cannot_verify_returned"
									: "returned_packet.finance.cannot_act_unreleased",
							)}
						</p>
					)}
					{error?.errorKey && (
						<p className="text-sm text-status-danger">
							{t(error.errorKey as ParseKeys)}
						</p>
					)}
					{canSendBack && (
						<Form method="post" className="space-y-3">
							<input type="hidden" name="intent" value="send_back" />
							<Textarea
								name="note"
								rows={2}
								required
								placeholder={t("finance_verify.send_back_placeholder")}
							/>
							<Button type="submit" variant="outline">
								{t("finance_verify.send_back")}
							</Button>
						</Form>
					)}
				</div>
			)}
			{stage !== "TO_VERIFY" && (
				<p className="text-sm text-muted-foreground">
					{t("finance_verify.errors.invalid_stage")}
				</p>
			)}
		</div>
	)
}
