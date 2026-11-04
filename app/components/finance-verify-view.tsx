import { Pdf01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ParseKeys } from "i18next"
import type { ComponentProps } from "react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { BrigadeStockTracked } from "~/components/brigade-stock-tracked"
import {
	CorrectionHistory,
	CorrectToAvisoForm,
} from "~/components/correct-to-aviso"
import { FinanceStepRail, StageChip } from "~/components/finance-step-rail"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
import { Button, buttonVariants } from "~/components/ui/button"
import { Callout } from "~/components/ui/callout"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { FINANCE_STEPS } from "~/lib/finance-steps"
import { VERIFY_CHECKS as CHECKS } from "~/lib/finance-verify-checks"
import { formatShortDate } from "~/lib/payroll-request-view"
import { formatMoney, formatUnitPrice } from "~/lib/utils"
import { workDatesOf } from "~/lib/work-dates"
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
		correction,
	} = loaderData
	const [correcting, setCorrecting] = useState(false)
	const navigation = useNavigation()
	const corrected = (actionData as { correctedAt?: number } | undefined)
		?.correctedAt
	// A saved correction closes the form; the new lines are on the page.
	useEffect(() => {
		if (corrected) setCorrecting(false)
	}, [corrected])
	const { t } = useTranslation()
	const error = actionData as { errorKey?: string } | undefined
	const asDate = (v: string | Date | null) => (v ? new Date(v) : null)
	const workDates = workDatesOf({
		createdAt: new Date(doc.createdAt),
		completedAt: asDate(doc.completedAt),
		fieldSubmittedAt: asDate(doc.fieldSubmittedAt),
	})

	const cannotVerify =
		stage !== "TO_VERIFY" || doc.status === "LC_REQUEST_GENERATED"
	const [noteOpen, setNoteOpen] = useState(false)
	const [sendBackOpen, setSendBackOpen] = useState(false)
	const [checks, setChecks] = useState({
		invoice: false,
		aviso: false,
		photos: false,
		precert: false,
	})
	// The document open in the viewer, opening on the Aviso. `page` and `zoom`
	// ride on the PDF URL fragment, which the browser's own viewer honours.
	const docLabel = (d: (typeof packetDocs)[number]) =>
		t(d.label as ParseKeys, { number: doc.avisoNumber ?? "—" })
	const [viewing, setViewing] = useState<{
		href: string
		kind: "pdf" | "image"
		label: string
		tab: string
	} | null>(() => {
		// The Aviso is what Lissette checks the lines against: open on it.
		const first =
			packetDocs.find((d) => d.key === "aviso" && d.href) ??
			packetDocs.find((d) => d.href && d.key !== "photos")
		return first?.href
			? {
					href: first.href,
					kind: "pdf",
					label: docLabel(first),
					tab: first.key,
				}
			: null
	})
	const [page, setPage] = useState(1)
	const [zoom, setZoom] = useState(100)
	const [ticked, setTicked] = useState<Set<string>>(new Set())
	const [leftPct, setLeftPct] = useState(45)
	const splitRef = useRef<HTMLDivElement>(null)
	const openDoc = (v: NonNullable<typeof viewing>) => {
		setViewing(v)
		setPage(1)
	}
	const openFile = (f: { href: string; name: string }, tab: string) =>
		openDoc({
			href: f.href,
			kind: /\.pdf$/i.test(f.name) ? "pdf" : "image",
			label: f.name,
			tab,
		})
	// Services and materials share a page of the Claro Aviso: send the viewer
	// back to the Aviso and to that page.
	const jumpToAviso = (toPage: number) => {
		const aviso = packetDocs.find((d) => d.key === "aviso" && d.href)
		if (aviso?.href)
			setViewing({
				href: aviso.href,
				kind: "pdf",
				label: docLabel(aviso),
				tab: "aviso",
			})
		setPage(toPage)
	}
	const toggleTick = (key: string) =>
		setTicked((prev) => {
			const next = new Set(prev)
			if (!next.delete(key)) next.add(key)
			return next
		})
	const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
		const r = splitRef.current?.getBoundingClientRect()
		if (!r) return
		setLeftPct(
			Math.min(70, Math.max(30, ((e.clientX - r.left) / r.width) * 100)),
		)
	}
	const viewerSrc =
		viewing?.kind === "pdf"
			? `${viewing.href}#page=${page}&zoom=${zoom}`
			: viewing?.href
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
						<StageChip arm="A" step={1} total={FINANCE_STEPS.length} />
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

			<div
				ref={splitRef}
				className="grid grid-cols-1 items-start gap-4 min-[1100px]:[grid-template-columns:var(--cols)]"
				style={
					{
						"--cols": `${leftPct}fr 8px ${100 - leftPct}fr`,
					} as React.CSSProperties
				}
			>
				<div className="min-w-0 space-y-4">
					{correcting && (
						<CorrectToAvisoForm
							lines={invoiceLines}
							materials={materials}
							serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
							onCancel={() => setCorrecting(false)}
							submitting={navigation.state === "submitting"}
						/>
					)}
					{correction && <CorrectionHistory correction={correction} />}
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
											<th className="w-8 p-2" />
											<th className="p-2">
												{t("finance_verify.preview.code")}
											</th>
											<th className="p-2">
												{t("finance_verify.preview.service")}
											</th>
											<th className="p-2 text-right">
												{t("finance_verify.preview.qty")}
											</th>
											<th className="p-2 text-right">
												{t("finance_verify.preview.price")}
											</th>
											<th className="p-2 text-right">
												{t("finance_verify.preview.amount")}
											</th>
										</tr>
									</thead>
									<tbody>
										{invoiceLines.map((l) => (
											<tr
												key={l.serviceCodeId}
												className={`cursor-pointer border-b last:border-0 hover:bg-muted/50 ${ticked.has(`s:${l.serviceCodeId}`) ? "opacity-60" : ""}`}
												onClick={() => jumpToAviso(2)}
											>
												<td
													className="p-2"
													onClick={(e) => e.stopPropagation()}
													onKeyDown={(e) => e.stopPropagation()}
												>
													<Checkbox
														checked={ticked.has(`s:${l.serviceCodeId}`)}
														onCheckedChange={() =>
															toggleTick(`s:${l.serviceCodeId}`)
														}
														aria-label={l.claroCode}
													/>
												</td>
												<td className="p-2 font-mono">{l.claroCode}</td>
												<td className="p-2">{l.name}</td>
												<td className="p-2 text-right font-mono">{l.qty}</td>
												<td className="p-2 text-right font-mono">
													{formatUnitPrice(l.unitPrice)}
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
						</dl>
					</div>

					<div className="bg-card border rounded-lg p-4 space-y-2">
						<h2 className="text-sm font-medium">
							{t("finance_verify.materials_heading")}
						</h2>
						{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: a pointer shortcut; the Jump-to buttons in the viewer do the same by keyboard */}
						<div className="cursor-pointer" onClick={() => jumpToAviso(2)}>
							<MaterialLineItems
								serviceCodes={serviceCodes as unknown as MaterialServiceCode[]}
								initialItems={materials}
								readOnly
							/>
						</div>
					</div>

					<div className="bg-card border rounded-lg p-4 space-y-2">
						<div className="flex items-center justify-between gap-2">
							<h2 className="text-sm font-medium">
								{t("finance_verify.packet.heading")}
							</h2>
							<a
								href={`/finance/verify/${doc.id}/packet.zip`}
								className={buttonVariants({
									variant: "outline",
									size: "sm",
									className:
										"border-status-warn/40 bg-status-warn-soft text-status-warn hover:bg-status-warn-soft/70",
								})}
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
												{t(
													`finance_verify.packet.${d.key}_detail` as ParseKeys,
													{
														file: d.detail,
														count: Number(d.detail) || 0,
													},
												)}
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
												openDoc({
													href: d.href as string,
													kind: "pdf",
													label: docLabel(d),
													tab: d.key,
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
														onClick={() => openFile(f, "photos")}
														className="block overflow-hidden rounded-md border hover:border-primary"
														aria-label={f.name}
													>
														{/\.pdf$/i.test(f.name) ? (
															<span className="flex size-20 flex-col items-center justify-center gap-1 bg-muted p-1 text-muted-foreground">
																<HugeiconsIcon
																	icon={Pdf01Icon}
																	className="size-7"
																	aria-hidden="true"
																/>
																<span className="w-full truncate text-center text-[10px]">
																	{f.name}
																</span>
															</span>
														) : (
															<img
																src={f.href}
																alt={f.name}
																loading="lazy"
																className="size-20 object-cover"
															/>
														)}
													</button>
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ul>
					</div>

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
										{t("finance_verify.work_dates")}:
									</span>{" "}
									{`${formatShortDate(workDates.from)} – ${formatShortDate(workDates.to)}`}
								</p>
								<p>
									<span className="text-muted-foreground">
										{t("finance_verify.supervisor")}:
									</span>{" "}
									{loaderData.doc.supervisor?.name}
								</p>
							</div>
						</div>
						<BrigadeStockTracked lines={brigadeStock} />
					</div>

					{returnState.returned && returnState.createdAt && (
						<Callout
							tone="danger"
							title={t("returned_packet.finance.verify_returned")}
						>
							<span className="block whitespace-pre-line">
								{returnState.note}
							</span>
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
						<Callout
							tone="warn"
							title={t("returned_packet.finance.not_released")}
						>
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
						<div className="sticky bottom-0 z-10 -mx-1 border-t bg-card p-2 shadow-card">
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
								{canVerify ? (
									<>
										<Form
											method="post"
											className="flex flex-wrap items-center gap-x-4 gap-y-2"
										>
											<input type="hidden" name="intent" value="verify" />
											{CHECKS.map((c) => (
												<label
													key={c}
													htmlFor={`check_${c}`}
													className="flex items-center gap-1.5 text-sm"
												>
													<Checkbox
														id={`check_${c}`}
														name={`check_${c}`}
														checked={checks[c]}
														onCheckedChange={(v) =>
															setChecks((prev) => ({
																...prev,
																[c]: v === true,
															}))
														}
													/>
													{t(`finance_verify.checks.${c}`)}
												</label>
											))}
											{noteOpen && (
												<Input
													name="note"
													className="h-8 w-56"
													placeholder={t(
														"finance_verify.verify_note_placeholder",
													)}
												/>
											)}
											<Button
												type="submit"
												size="sm"
												disabled={cannotVerify || !readyToAccept}
											>
												{t("finance_verify.accept_next")}
											</Button>
										</Form>
										<button
											type="button"
											className="text-sm text-muted-foreground underline"
											onClick={() => setNoteOpen((v) => !v)}
										>
											{t("finance_verify.add_note")}
										</button>
									</>
								) : (
									<p className="text-sm text-muted-foreground">
										{t(
											returnState.returned
												? "returned_packet.finance.cannot_verify_returned"
												: "returned_packet.finance.cannot_act_unreleased",
										)}
									</p>
								)}
								{canVerify && !correcting && (
									<Button
										type="button"
										size="sm"
										onClick={() => setCorrecting(true)}
									>
										{t("finance_verify.correct.button")}
									</Button>
								)}
								{canSendBack &&
									(sendBackOpen ? (
										<Form method="post" className="flex items-center gap-2">
											<input type="hidden" name="intent" value="send_back" />
											<Input
												name="note"
												required
												className="h-8 w-64"
												placeholder={t("finance_verify.send_back_placeholder")}
											/>
											<Button
												type="submit"
												size="sm"
												variant="outline"
												className="border-2 border-status-warn bg-status-warn-soft font-medium text-status-warn hover:bg-status-warn-soft/70"
											>
												{t("finance_verify.send_back")}
											</Button>
										</Form>
									) : (
										<Button
											type="button"
											size="sm"
											variant="outline"
											className="border-2 border-status-warn bg-status-warn-soft font-medium text-status-warn hover:bg-status-warn-soft/70"
											onClick={() => setSendBackOpen(true)}
										>
											{t("finance_verify.send_back")}
										</Button>
									))}
							</div>
							{cannotVerify && (
								<p className="mt-1 text-sm text-status-warn">
									{t("finance_verify.cannot_verify_hint")}
								</p>
							)}
							{error?.errorKey && (
								<p className="mt-1 text-sm text-status-danger">
									{t(error.errorKey as ParseKeys)}
								</p>
							)}
						</div>
					)}
				</div>
				{/* biome-ignore lint/a11y/useSemanticElements: a draggable, focusable splitter; <hr> cannot take focus or a value */}
				<div
					role="separator"
					tabIndex={0}
					aria-valuenow={Math.round(leftPct)}
					aria-valuemin={30}
					aria-valuemax={70}
					onKeyDown={(e) => {
						if (e.key === "ArrowLeft") setLeftPct((p) => Math.max(30, p - 5))
						if (e.key === "ArrowRight") setLeftPct((p) => Math.min(70, p + 5))
					}}
					aria-orientation="vertical"
					aria-label={t("finance_verify.viewer.divider")}
					onPointerDown={startDrag}
					onPointerMove={onDrag}
					className="hidden h-full min-h-40 cursor-col-resize rounded bg-border hover:bg-primary min-[1100px]:block"
				/>
				<div className="min-w-0 min-[1100px]:sticky min-[1100px]:top-2">
					<div className="space-y-2 rounded-lg border bg-card p-3">
						<div className="flex flex-wrap items-center gap-1" role="tablist">
							{packetDocs.map((d) => {
								const first = d.files[0]
								const target = first?.href ?? d.href
								return (
									<Button
										key={d.key}
										type="button"
										role="tab"
										aria-selected={viewing?.tab === d.key}
										variant={viewing?.tab === d.key ? "default" : "outline"}
										size="sm"
										disabled={!target}
										onClick={() =>
											first
												? openFile(first, d.key)
												: openDoc({
														href: d.href as string,
														kind: "pdf",
														label: docLabel(d),
														tab: d.key,
													})
										}
									>
										{t(`finance_verify.viewer.tab_${d.key}` as ParseKeys)}
									</Button>
								)
							})}
						</div>
						{viewing ? (
							<>
								<div className="flex flex-wrap items-center gap-2 text-xs">
									<span className="font-medium">{viewing.label}</span>
									{viewing.tab === "aviso" && (
										<>
											<span className="text-muted-foreground">
												{t("finance_verify.viewer.jump_to")}
											</span>
											<Button
												type="button"
												variant="outline"
												size="xs"
												onClick={() => jumpToAviso(2)}
											>
												{t("finance_verify.viewer.services")}
											</Button>
											<Button
												type="button"
												variant="outline"
												size="xs"
												onClick={() => jumpToAviso(2)}
											>
												{t("finance_verify.viewer.materials")}
											</Button>
										</>
									)}
									{viewing.kind === "pdf" && (
										<span className="ml-auto flex items-center gap-1">
											<Button
												type="button"
												variant="outline"
												size="xs"
												aria-label={t("finance_verify.viewer.zoom_out")}
												onClick={() => setZoom((z) => Math.max(50, z - 25))}
											>
												−
											</Button>
											<span className="w-10 text-center font-mono">
												{zoom}%
											</span>
											<Button
												type="button"
												variant="outline"
												size="xs"
												aria-label={t("finance_verify.viewer.zoom_in")}
												onClick={() => setZoom((z) => Math.min(300, z + 25))}
											>
												+
											</Button>
											<Button
												type="button"
												variant="outline"
												size="xs"
												aria-label={t("finance_verify.viewer.prev_page")}
												disabled={page <= 1}
												onClick={() => setPage((p) => Math.max(1, p - 1))}
											>
												‹
											</Button>
											<span className="font-mono">
												{t("finance_verify.viewer.page", { page })}
											</span>
											<Button
												type="button"
												variant="outline"
												size="xs"
												aria-label={t("finance_verify.viewer.next_page")}
												onClick={() => setPage((p) => p + 1)}
											>
												›
											</Button>
										</span>
									)}
									<a
										href={viewing.href}
										target="_blank"
										rel="noreferrer"
										className={`${viewing.kind === "pdf" ? "" : "ml-auto "}text-accent-text underline`}
									>
										{t("finance_verify.packet.open_new_tab")}
									</a>
								</div>
								{/* The document stays white in dark mode: it is a paper form. */}
								{viewing.kind === "pdf" ? (
									<iframe
										key={viewerSrc}
										src={viewerSrc}
										title={viewing.label}
										className="h-[75vh] w-full rounded-md border bg-white min-[1100px]:h-[calc(100vh-9rem)]"
									/>
								) : (
									<div className="flex h-[75vh] items-center justify-center rounded-md border bg-white min-[1100px]:h-[calc(100vh-9rem)]">
										<img
											src={viewing.href}
											alt={viewing.label}
											className="max-h-full max-w-full object-contain"
										/>
									</div>
								)}
							</>
						) : (
							<p className="p-6 text-center text-sm text-muted-foreground">
								{t("finance_verify.viewer.empty")}
							</p>
						)}
					</div>
				</div>
			</div>
			{stage !== "TO_VERIFY" && (
				<p className="text-sm text-muted-foreground">
					{t("finance_verify.errors.invalid_stage")}
				</p>
			)}
		</div>
	)
}
