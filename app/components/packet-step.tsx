import type { ParseKeys } from "i18next"
import { type RefObject, useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import type { MaterialSource } from "~/lib/material-source"
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
	/** The job's Claro supervisor id (null if none was chosen at intake). */
	claroSupervisorId: string | null
	/**
	 * What the Claro supervisor select offers until the first send: the active
	 * entries plus the job's own one, even if deactivated. Empty once sent.
	 */
	claroOptions: {
		id: string
		name: string
		email: string
		requiresPrefield: boolean
		requiresBlueprint: boolean
	}[]
	showPrefield: boolean
	prefield: Record<PrefieldField, string | null>
	prefieldMissing: string[]
	/** Why the first send would be refused; empty once sent. */
	blockers: PacketBlocker[]
	/** The stored packet PDF (the last delivered, or the latest attempt before the first send). */
	packetHref: string | null
	blueprints: { name: string; href: string }[]
	materials: {
		serviceCodeId: string
		claroCode: string
		name: string
		unit: string | null
		used: number
		returned: number
		source: MaterialSource
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
	/**
	 * PACKET_EMAIL_ENABLED. Off: step 5 only records that the supervisor sent
	 * the stored PDF themselves.
	 */
	emailEnabled: boolean
}

/** The Prefield inputs the packet step edits until the first send. */
const PREFIELD_INPUTS = [
	"ordenNumber",
	"pedido",
	"smr",
	"titulo",
] as const satisfies PrefieldField[]

const PACKET_INTENTS = ["send_packet", "mark_packet_sent"]

const PREFIELD_FIELDS: PrefieldField[] = [
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
	inFlight,
}: {
	intent: "send_packet" | "mark_packet_sent"
	confirmText: string
	label: string
	disabled?: boolean
	variant?: "outline"
	/** Shared by Send and Mark as sent manually: one packet request at a time. */
	inFlight: RefObject<boolean>
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const pending = navigation.formData?.get("intent")
	const anyBusy =
		navigation.state !== "idle" &&
		typeof pending === "string" &&
		PACKET_INTENTS.includes(pending)
	const busy = anyBusy && pending === intent
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
				disabled={disabled || anyBusy}
				data-confirm={confirmText}
			>
				{busy ? t("packet.sending") : label}
			</Button>
		</Form>
	)
}

/**
 * The Prefield fields, the Claro supervisor and (when that supervisor needs
 * one and there is none yet) a blueprint, editable until the first send.
 */
function PrefieldForm({
	packet,
	blueprintNeeded,
}: {
	packet: PacketStepData
	blueprintNeeded: boolean
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const saving =
		navigation.state !== "idle" &&
		navigation.formData?.get("intent") === "save_prefield"
	return (
		<Form
			method="post"
			encType="multipart/form-data"
			className="space-y-3"
			data-testid="prefield-form"
		>
			<input type="hidden" name="intent" value="save_prefield" />
			<div className="space-y-1">
				<Label htmlFor="packet-claro">{t("packet.claro_label")}</Label>
				<select
					id="packet-claro"
					name="claroSupervisorId"
					defaultValue={packet.claroSupervisorId ?? ""}
					className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
				>
					{!packet.claroSupervisorId && (
						<option value="">{t("packet.claro_placeholder")}</option>
					)}
					{packet.claroOptions.map((c) => (
						<option key={c.id} value={c.id}>
							{c.name} · {c.email}
						</option>
					))}
				</select>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				{PREFIELD_INPUTS.map((k) => (
					<div key={k} className="space-y-1">
						<Label htmlFor={`packet-${k}`}>{t(`packet.prefield.${k}`)}</Label>
						<Input
							id={`packet-${k}`}
							name={k}
							defaultValue={packet.prefield[k] ?? ""}
							aria-invalid={packet.prefieldMissing.includes(k) || undefined}
						/>
					</div>
				))}
			</div>
			{blueprintNeeded && (
				<div className="space-y-1">
					<Label htmlFor="packet-blueprint">
						{t("packet.blueprint_upload")}
					</Label>
					<Input
						id="packet-blueprint"
						name="blueprint"
						type="file"
						accept="image/jpeg,image/png,application/pdf"
						multiple
						className="h-auto py-1.5 text-xs"
					/>
				</div>
			)}
			<p className="text-xs text-muted-foreground">
				{t("packet.prefield_hint")}
			</p>
			<Button type="submit" variant="outline" size="sm" disabled={saving}>
				{t("packet.prefield_save")}
			</Button>
		</Form>
	)
}

/** Step 5 · Packet → Claro. */
export function PacketStepCard({
	packet,
	interactive,
	errorKey,
	children,
}: {
	packet: PacketStepData
	interactive: boolean
	errorKey?: string
	/** Extra controls under the send buttons (e.g. back to Sign off). */
	children?: React.ReactNode
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const inFlight = useRef(false)
	useEffect(() => {
		if (navigation.state === "idle") inFlight.current = false
	}, [navigation.state])
	const claro = packet.claroSupervisor
	const editable = interactive && !packet.sent
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

				{editable && (
					<section className="space-y-1">
						<h3 className="text-sm font-medium">
							{t("packet.prefield_title")}
						</h3>
						<PrefieldForm
							packet={packet}
							blueprintNeeded={packet.blockers.includes("blueprint")}
						/>
					</section>
				)}

				{!editable && packet.showPrefield && (
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
					{!packet.emailEnabled && (
						<p className="text-sm font-medium">
							{packet.packetHref
								? t("packet.pdf_generated")
								: t("packet.pdf_not_generated")}
						</p>
					)}
					{interactive && !packet.emailEnabled && (
						<>
							<Button type="button" className="w-full" disabled>
								{t("packet.send_coming_later")}
							</Button>
							{!packet.sent && (
								<>
									<ConfirmedSubmit
										intent="mark_packet_sent"
										label={t("packet.mark_sent")}
										confirmText={t("packet.confirm_manual", {
											email: claro?.email ?? "",
										})}
										disabled={!claro || blocked || !packet.packetHref}
										inFlight={inFlight}
									/>
									<p className="text-xs text-muted-foreground">
										{t("packet.manual_only_hint")}
									</p>
									<Link
										to="?step=APPROVE"
										className={buttonVariants({
											variant: "ghost",
											className: "w-full",
										})}
									>
										← {t("packet.back")}
									</Link>
								</>
							)}
						</>
					)}
					{interactive && packet.emailEnabled && (
						<>
							<ConfirmedSubmit
								intent="send_packet"
								label={packet.sent ? t("packet.resend") : t("packet.send")}
								confirmText={t(
									packet.sent ? "packet.confirm_resend" : "packet.confirm_send",
									{ email: claro?.email ?? "" },
								)}
								disabled={!claro || blocked}
								inFlight={inFlight}
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
										inFlight={inFlight}
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
