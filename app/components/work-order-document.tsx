import type { ParseKeys } from "i18next"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Form, useNavigation } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { sourceLabelKey } from "~/lib/material-source"
import {
	formatDocDate,
	WORK_ORDER_ISSUER,
	type WorkOrderBlock,
	type WorkOrderDocument,
	type WorkOrderSignature,
} from "~/lib/work-order-document"

/** One block of the document, tagged with its B5 name. */
function Block({
	name,
	label,
	children,
}: {
	name: WorkOrderBlock
	label: string
	children: ReactNode
}) {
	return (
		<section data-block={name} className="space-y-1">
			<h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</h3>
			<div className="text-sm">{children}</div>
		</section>
	)
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i

function SignatureBox({
	label,
	sig,
}: {
	label: string
	sig: WorkOrderSignature
}) {
	const { t } = useTranslation()
	return (
		<div className="min-w-[10rem] flex-1 space-y-1 rounded-lg border border-border bg-card p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			{sig === "pending" ? (
				<p className="font-medium text-status-warn">
					{t("work_order_doc.pending")}
				</p>
			) : (
				<>
					<img src={sig.image} alt="" className="h-12 rounded border bg-card" />
					<p className="text-sm font-medium">{sig.name || "—"}</p>
				</>
			)}
		</div>
	)
}

/**
 * Step 4 · the JAF work order document, blocks 1–13 in the fixed B5 order,
 * on the same yellow-tinted document look as the reference. The PDF renders
 * the same `WorkOrderDocument`. No prices: the type carries none.
 */
export function WorkOrderDocumentCard({
	document: doc,
	issuedOn,
}: {
	document: WorkOrderDocument
	issuedOn: string | Date
}) {
	const { t } = useTranslation()
	const k = (key: string) => t(`work_order_doc.${key}` as ParseKeys)
	const prefield = doc.prefield
	return (
		<article className="space-y-4 rounded-lg border border-status-warn/40 bg-status-warn-soft/40 p-4 shadow-sm">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-status-warn/40 pb-3">
				<div>
					<h2 className="text-lg font-semibold">{k("title")}</h2>
					<p className="font-mono text-sm">{doc.workOrderNumber}</p>
				</div>
				<dl className="grid grid-cols-[auto_auto] gap-x-3 text-sm">
					<dt className="text-muted-foreground">{k("issuer")}</dt>
					<dd className="font-semibold">{WORK_ORDER_ISSUER}</dd>
					<dt className="text-muted-foreground">{k("date")}</dt>
					<dd suppressHydrationWarning>{formatDocDate(issuedOn)}</dd>
				</dl>
			</header>

			<div className="grid gap-4 sm:grid-cols-2">
				<Block name="workOrderNumber" label={k("number")}>
					<span className="font-mono">{doc.workOrderNumber}</span>
				</Block>
				<Block name="claroSupervisor" label={k("claro_supervisor")}>
					{doc.claroSupervisor ?? "—"}
				</Block>
				<Block name="jafSupervisor" label={k("jaf_supervisor")}>
					{doc.jafSupervisor}
				</Block>
				<Block name="crews" label={k("crews")}>
					{doc.crews.length === 0 ? (
						"—"
					) : (
						<ul>
							{doc.crews.map((c, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: display only
								<li key={i}>
									{c.contractNumber
										? `${c.name} · ${c.contractNumber}`
										: c.name}
								</li>
							))}
						</ul>
					)}
				</Block>
			</div>

			<Block name="address" label={k("address")}>
				<p className="whitespace-normal break-words">{doc.address}</p>
			</Block>
			<Block name="description" label={k("description")}>
				{doc.description ?? "—"}
			</Block>

			<Block name="services" label={k("services")}>
				{doc.services.length === 0 ? (
					<p className="text-muted-foreground">{k("no_services")}</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="py-1.5">{k("col_code")}</th>
								<th className="py-1.5">{k("col_description")}</th>
								<th className="py-1.5 text-right">{k("col_qty")}</th>
							</tr>
						</thead>
						<tbody className="tabular-nums">
							{doc.services.map((l, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: a code can repeat
								<tr key={i} className="border-b last:border-0">
									<td className="py-1.5 font-mono text-xs font-semibold">
										{l.code}
									</td>
									<td className="py-1.5">{l.description}</td>
									<td className="py-1.5 text-right">{l.qty}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Block>

			<Block name="materials" label={k("materials")}>
				{doc.materials.length === 0 ? (
					<p className="text-muted-foreground">{k("no_materials")}</p>
				) : (
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-xs text-muted-foreground">
								<th className="py-1.5">{k("col_material")}</th>
								<th className="py-1.5 text-right">{k("col_used")}</th>
								<th className="py-1.5 pl-3">{k("col_source")}</th>
							</tr>
						</thead>
						<tbody className="tabular-nums">
							{doc.materials.map((m, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: display only
								<tr key={i} className="border-b last:border-0">
									<td className="py-1.5">{m.name}</td>
									<td className="py-1.5 text-right">
										{m.used} {m.unit ?? ""}
									</td>
									<td className="py-1.5 pl-3">{t(sourceLabelKey(m.source))}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</Block>

			<Block name="photos" label={k("photos")}>
				<div className="space-y-2">
					{(["before", "during", "after"] as const).map((g) => (
						<div key={g}>
							<p className="text-xs text-muted-foreground">
								{k(`photo_${g}`)} ({doc.photos[g].length})
							</p>
							{doc.photos[g].length > 0 && (
								<div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
									{doc.photos[g].map((src) => (
										<a key={src} href={src} target="_blank" rel="noreferrer">
											<img
												src={src}
												alt={k(`photo_${g}`)}
												className="h-20 w-full rounded border border-border object-cover"
											/>
										</a>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</Block>

			<Block name="blueprint" label={k("blueprint")}>
				{doc.blueprint === "not_required" ? (
					<p>{k("not_required")}</p>
				) : doc.blueprint.length === 0 ? (
					<p className="text-status-danger">{k("missing")}</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{doc.blueprint.map((href) => (
							<a key={href} href={href} target="_blank" rel="noreferrer">
								{IMAGE_FILE.test(href) ? (
									<img
										src={href}
										alt={k("blueprint")}
										className="h-32 rounded border border-border object-contain"
									/>
								) : (
									<span className="underline">
										{decodeURIComponent(href.split("/").pop() ?? href)}
									</span>
								)}
							</a>
						))}
					</div>
				)}
			</Block>

			<Block name="prefield" label={k("prefield")}>
				{prefield === "not_required" ? (
					<p>{k("prefield_not_required")}</p>
				) : (
					<dl className="grid grid-cols-2 gap-x-4 gap-y-1">
						{(["ordenNumber", "pedido", "smr", "titulo"] as const).map((f) => (
							<div key={f} className="flex gap-2">
								<dt className="text-muted-foreground">
									{t(`packet.prefield.${f}`)}:
								</dt>
								<dd className="font-medium">{prefield[f] ?? "—"}</dd>
							</div>
						))}
					</dl>
				)}
			</Block>

			<Block name="fieldReport" label={k("field_report")}>
				<p className="whitespace-pre-wrap">{doc.fieldReport ?? "—"}</p>
			</Block>

			<Block name="signatures" label={k("signatures")}>
				<div className="flex flex-wrap gap-2">
					<SignatureBox
						label={k("sig_supervisor")}
						sig={doc.signatures.supervisor}
					/>
					<SignatureBox
						label={k("sig_warehouse")}
						sig={doc.signatures.warehouse}
					/>
					<SignatureBox label={k("sig_crew")} sig={doc.signatures.crew} />
				</div>
			</Block>
		</article>
	)
}

/**
 * Block 14 · Generate PDF: disabled until the supervisor has signed; a
 * missing warehouse or crew signature never blocks it. Regenerating replaces
 * the stored PDF until the first send to Claro.
 */
export function GenerateWorkOrderPdf({
	enabled,
	pdfHref,
}: {
	enabled: boolean
	pdfHref: string | null
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const busy =
		navigation.state !== "idle" &&
		navigation.formData?.get("intent") === "generate_work_order_pdf"
	return (
		<div className="space-y-2">
			<Form method="post">
				<input type="hidden" name="intent" value="generate_work_order_pdf" />
				<Button type="submit" className="w-full" disabled={!enabled || busy}>
					{busy ? t("work_order_doc.generating") : t("work_order_doc.generate")}
				</Button>
			</Form>
			{!enabled && !pdfHref && (
				<p className="text-xs text-muted-foreground">
					{t("work_order_doc.generate_hint")}
				</p>
			)}
			{pdfHref && (
				<a
					href={pdfHref}
					target="_blank"
					rel="noreferrer"
					className={buttonVariants({
						variant: "outline",
						className: "w-full",
					})}
				>
					{t("work_order_doc.generated")} · {t("work_order_doc.download")}
				</a>
			)}
		</div>
	)
}
