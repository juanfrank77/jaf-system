import type { ParseKeys } from "i18next"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Form, useNavigation } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Pill } from "~/components/ui/pill"
import type { PacketSendOutcome } from "../../generated/prisma/client"

type PrefieldField =
	| "avisoNumber"
	| "ordenNumber"
	| "pedido"
	| "smr"
	| "titulo"
	| "description"

export type PacketBlocker = "prefield" | "blueprint" | "claro_supervisor"

/** The Step 5 payload the review loader builds. It never carries prices. */
export type PacketStepData = {
	/** The first SENT or MANUAL send happened (`jafInvoiceGeneratedAt`). */
	sent: boolean
	sentAt: Date | string | null
	/** The job's Claro supervisor as the directory has them now. */
	claroSupervisor: {
		name: string
		email: string
		requiresPrefield: boolean
	} | null
	showPrefield: boolean
	prefield: Record<PrefieldField, string | null>
	prefieldMissing: string[]
	/** Why the first send would be refused; empty once sent. */
	blockers: PacketBlocker[]
	/** The stored packet PDF (the last delivered, or the latest attempt before the first send). */
	packetHref: string | null
	blueprints: { name: string; href: string }[]
	materials: {
		claroCode: string
		name: string
		unit: string | null
		used: number
		returned: number
		source: "WAREHOUSE" | "BRIGADE_STOCK"
	}[]
	/** Newest first. */
	history: {
		id: string
		sentAt: Date | string
		sentBy: string
		recipientEmail: string
		outcome: PacketSendOutcome
		error: string | null
	}[]
	canMarkManual: boolean
}

const PREFIELD_FIELDS: PrefieldField[] = [
	"avisoNumber",
	"ordenNumber",
	"pedido",
	"smr",
	"titulo",
	"description",
]

const OUTCOME_KEY = {
	SENT: "packet.outcome.SENT",
	FAILED: "packet.outcome.FAILED",
	UNCONFIGURED: "packet.outcome.UNCONFIGURED",
	MANUAL: "packet.outcome.MANUAL",
} as const satisfies Record<PacketSendOutcome, ParseKeys>

const when = (d: Date | string) =>
	new Date(d).toLocaleString(undefined, {
		dateStyle: "short",
		timeStyle: "short",
	})

/**
 * Posts one packet intent behind a confirm. The button disables while the
 * request is in flight, and a ref swallows a second submit fired before React
 * re-renders, so a double click never emails Claro twice.
 */
function ConfirmedSubmit({
	intent,
	confirmText,
	label,
	disabled = false,
	variant,
}: {
	intent: "send_packet" | "mark_packet_sent"
	confirmText: string
	label: string
	disabled?: boolean
	variant?: "outline"
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const inFlight = useRef(false)
	const busy =
		navigation.state !== "idle" && navigation.formData?.get("intent") === intent
	useEffect(() => {
		if (navigation.state === "idle") inFlight.current = false
	}, [navigation.state])
	return (
		<Form
			method="post"
			onSubmit={(e) => {
				if (inFlight.current || !window.confirm(confirmText)) {
					e.preventDefault()
					return
				}
				inFlight.current = true
			}}
		>
			<input type="hidden" name="intent" value={intent} />
			<Button
				type="submit"
				variant={variant}
				className="w-full"
				disabled={disabled || busy}
				data-confirm={confirmText}
			>
				{busy ? t("packet.sending") : label}
			</Button>
		</Form>
	)
}

/** Step 5 · Packet → Claro. */
export function PacketStepCard({
	packet,
	interactive,
	errorKey,
	workSummary,
	children,
}: {
	packet: PacketStepData
	interactive: boolean
	errorKey?: string
	/** The job block and the work done (no prices for a price-blind role). */
	workSummary: React.ReactNode
	/** Extra controls under the send buttons (e.g. back to Sign off). */
	children?: React.ReactNode
}) {
	const { t } = useTranslation()
	const claro = packet.claroSupervisor
	const last = packet.history[0]?.outcome ?? null
	const blocked = packet.blockers.length > 0
	const missing = packet.prefieldMissing
		.map((k) => t(`packet.prefield.${k as PrefieldField}`))
		.join(", ")
	return (
		<Card data-testid="packet-step">
			<CardHeader className="items-start">
				<div>
					<div className="text-base font-bold">{t("packet.title")}</div>
					<div
						className="mt-0.5 text-xs font-normal text-muted-foreground"
						suppressHydrationWarning
					>
						{packet.sent && packet.sentAt
							? t("packet.status_sent", { date: when(packet.sentAt) })
							: t("packet.status_not_sent")}
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<p className="text-sm">
					{claro ? (
						<>
							<span className="text-muted-foreground">
								{t("packet.recipient")}:
							</span>{" "}
							<b>{claro.name}</b> ·{" "}
							<span className="font-mono">{claro.email}</span>
						</>
					) : (
						<span className="text-status-danger">
							{t("packet.no_recipient")}
						</span>
					)}
				</p>

				{blocked && (
					<Pill variant="warn" icon="⚠">
						<b>{t("packet.blockers_title")}</b>
						<ul className="mt-1 list-disc pl-5">
							{packet.blockers.map((b) => (
								<li key={b}>
									{b === "prefield"
										? t("packet.blocker.prefield", { fields: missing })
										: b === "blueprint"
											? t("packet.blocker.blueprint")
											: t("packet.blocker.claro_supervisor")}
								</li>
							))}
						</ul>
					</Pill>
				)}

				{packet.showPrefield && (
					<section className="space-y-1">
						<h3 className="text-sm font-medium">
							{t("packet.prefield_title")}
						</h3>
						<dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
							{PREFIELD_FIELDS.map((k) => (
								<div key={k} className="flex gap-2">
									<dt className="text-muted-foreground">
										{t(`packet.prefield.${k}`)}:
									</dt>
									<dd className="font-medium">
										{packet.prefield[k] ||
											(packet.prefieldMissing.includes(k) ? (
												<span className="text-status-danger">
													{t("packet.missing")}
												</span>
											) : (
												"—"
											))}
									</dd>
								</div>
							))}
						</dl>
					</section>
				)}

				<section className="space-y-1">
					<h3 className="text-sm font-medium">{t("packet.work_summary")}</h3>
					{workSummary}
				</section>

				<section className="space-y-1">
					<h3 className="text-sm font-medium">{t("packet.materials")}</h3>
					{packet.materials.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("packet.no_materials")}
						</p>
					) : (
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="py-1.5">{t("docs_review.table.code")}</th>
									<th className="py-1.5">
										{t("docs_review.table.description")}
									</th>
									<th className="py-1.5 text-right">{t("packet.col_used")}</th>
									<th className="py-1.5 text-right">
										{t("packet.col_returned")}
									</th>
									<th className="py-1.5">{t("packet.col_source")}</th>
								</tr>
							</thead>
							<tbody className="tabular-nums">
								{packet.materials.map((m) => (
									<tr
										key={`${m.claroCode}-${m.source}`}
										className="border-b last:border-0"
									>
										<td className="py-1.5 font-mono text-xs">{m.claroCode}</td>
										<td className="py-1.5">{m.name}</td>
										<td className="py-1.5 text-right">
											{m.used} {m.unit ?? ""}
										</td>
										<td className="py-1.5 text-right">{m.returned}</td>
										<td className="py-1.5 text-xs">
											{t(`packet.source.${m.source}`)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>

				<section className="space-y-1">
					<h3 className="text-sm font-medium">{t("packet.blueprints")}</h3>
					{packet.blueprints.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("packet.no_blueprint")}
						</p>
					) : (
						<ul className="space-y-0.5 text-sm">
							{packet.blueprints.map((b) => (
								<li key={b.href}>
									<a
										href={b.href}
										target="_blank"
										rel="noreferrer"
										className="text-accent-text underline"
									>
										{b.name}
									</a>
								</li>
							))}
						</ul>
					)}
				</section>

				{last === "UNCONFIGURED" && (
					<Pill variant="warn" icon="✉">
						{t("packet.unconfigured")}
					</Pill>
				)}
				{last === "FAILED" && (
					<Pill variant="danger" icon="✕">
						{t("packet.failed")}
					</Pill>
				)}
				{errorKey && (
					<p role="alert" className="text-sm text-status-danger">
						{t(errorKey as ParseKeys)}
					</p>
				)}

				<div className="space-y-2">
					{packet.packetHref && (
						<a
							href={packet.packetHref}
							target="_blank"
							rel="noreferrer"
							className={buttonVariants({
								variant: "outline",
								className: "w-full",
							})}
						>
							{t("packet.download")}
						</a>
					)}
					{interactive && (
						<>
							<ConfirmedSubmit
								intent="send_packet"
								label={packet.sent ? t("packet.resend") : t("packet.send")}
								confirmText={t(
									packet.sent ? "packet.confirm_resend" : "packet.confirm_send",
									{ email: claro?.email ?? "" },
								)}
								disabled={!claro || blocked}
							/>
							{packet.canMarkManual && (
								<>
									<ConfirmedSubmit
										intent="mark_packet_sent"
										variant="outline"
										label={t("packet.mark_manual")}
										confirmText={t("packet.confirm_manual", {
											email: claro?.email ?? "",
										})}
									/>
									<p className="text-xs text-muted-foreground">
										{t("packet.manual_hint")}
									</p>
								</>
							)}
						</>
					)}
					{children}
				</div>

				<section className="space-y-1">
					<h3 className="text-sm font-medium">{t("packet.history_title")}</h3>
					{packet.history.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("packet.history_empty")}
						</p>
					) : (
						<table className="w-full text-sm" data-testid="packet-history">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="py-1.5">{t("packet.history.time")}</th>
									<th className="py-1.5">{t("packet.history.user")}</th>
									<th className="py-1.5">{t("packet.history.recipient")}</th>
									<th className="py-1.5">{t("packet.history.outcome")}</th>
								</tr>
							</thead>
							<tbody>
								{packet.history.map((h) => (
									<tr key={h.id} className="border-b last:border-0">
										<td className="py-1.5 text-xs" suppressHydrationWarning>
											{when(h.sentAt)}
										</td>
										<td className="py-1.5">{h.sentBy}</td>
										<td className="py-1.5 font-mono text-xs">
											{h.recipientEmail}
										</td>
										<td className="py-1.5 text-xs">
											{t(OUTCOME_KEY[h.outcome])}
											{h.error && (
												<span className="block text-muted-foreground">
													{h.error}
												</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</section>
			</CardContent>
		</Card>
	)
}
