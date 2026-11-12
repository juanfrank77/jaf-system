import type { ParseKeys } from "i18next"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, Link, useNavigation } from "react-router"
import { CodeSearchSelect } from "~/components/code-search-select"
import { DownloadIconLink, FileViewerButton } from "~/components/file-viewer"
import {
	type Guide,
	GuideBox,
	GuideCounter,
	useFormGuidance,
} from "~/components/form-guidance"
import { Button, buttonVariants } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Pill } from "~/components/ui/pill"
import type { MaterialSource } from "~/lib/material-source"
import type { PackageFile } from "~/lib/package-files"
import type { PacketBlocker } from "~/lib/packet-blockers"
import type { PacketSendOutcome } from "../../generated/prisma/client"

/** Why the first send would be refused, plus "no Claro supervisor chosen". */
export type PacketStepBlocker = PacketBlocker | "claro_supervisor"

/** The Step 5 payload the review loader builds. It never carries prices. */
export type PacketStepData = {
	/** The first SENT or MANUAL send happened (`jafInvoiceGeneratedAt`). */
	sent: boolean
	sentAt: Date | string | null
	/** The job's Claro supervisor as the directory has them now. */
	claroSupervisor: { name: string; email: string } | null
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
	/** The intake answer: the package carries a Claro Prefield PDF. */
	prefieldNeeded: boolean
	/** Why the first send would be refused; empty once sent. */
	blockers: PacketStepBlocker[]
	/** The stored work order PDF (the last delivered, or the latest attempt before the first send). */
	packetHref: string | null
	/** The package for Claro, in order, each its own download. */
	files: Omit<PackageFile, "path">[]
	/** "Download all (zip)"; null when there is nothing to zip. */
	zipHref: string | null
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

const PACKET_INTENTS = ["send_packet", "mark_packet_sent"]

const BLOCKER_KEY = {
	prefield_pdf: "packet.blocker.prefield_pdf",
	stale: "packet.blocker.stale",
	blueprint: "packet.blocker.blueprint",
	claro_supervisor: "packet.blocker.claro_supervisor",
} as const satisfies Record<PacketStepBlocker, ParseKeys>

const FILE_KIND_KEY = {
	work_order_pdf: "packet.file_kind.work_order_pdf",
	prefield_pdf: "packet.file_kind.prefield_pdf",
	photo: "packet.file_kind.photo",
	blueprint: "packet.file_kind.blueprint",
} as const satisfies Record<PackageFile["key"], ParseKeys>

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
	guide,
}: {
	intent: "send_packet" | "mark_packet_sent"
	confirmText: string
	label: string
	disabled?: boolean
	variant?: "outline"
	/** Shared by Send and Mark as sent manually: one packet request at a time. */
	inFlight: RefObject<boolean>
	/** With a box still missing the button stays pressable and points to it. */
	guide?: Guide
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
				onClick={(e) => guide?.holdContinue(e)}
			>
				{busy ? t("packet.sending") : label}
			</Button>
		</Form>
	)
}

/**
 * The Claro supervisor and (when that supervisor needs one and there is none
 * yet) a blueprint, editable until the first send. There is no Prefield
 * input: the Prefield boxes are Claro's and print blank.
 */
function PacketDetailsForm({
	packet,
	blueprintNeeded,
	guide,
}: {
	packet: PacketStepData
	blueprintNeeded: boolean
	guide: Guide
}) {
	const { t } = useTranslation()
	const navigation = useNavigation()
	const [claroId, setClaroId] = useState(packet.claroSupervisorId ?? "")
	const claroPicked = packet.claroOptions.find((c) => c.id === claroId)
	const saving =
		navigation.state !== "idle" &&
		navigation.formData?.get("intent") === "save_packet_details"
	return (
		<Form
			method="post"
			encType="multipart/form-data"
			className="space-y-3"
			data-testid="packet-details-form"
		>
			<input type="hidden" name="intent" value="save_packet_details" />
			<GuideBox id="g-claro" guide={guide} className="space-y-1">
				<Label htmlFor="packet-claro">{t("packet.claro_label")}</Label>
				<input type="hidden" name="claroSupervisorId" value={claroId} />
				<CodeSearchSelect
					items={packet.claroOptions.map((c) => ({
						id: c.id,
						claroCode: c.email,
						name: c.name,
					}))}
					selected={
						claroPicked
							? {
									id: claroPicked.id,
									claroCode: claroPicked.email,
									name: claroPicked.name,
								}
							: null
					}
					codeLast
					placeholder={t("packet.claro_placeholder")}
					label={t("packet.claro_label")}
					onPick={(c) => setClaroId(c.id)}
				/>
			</GuideBox>
			{blueprintNeeded && (
				<GuideBox id="g-blueprint" guide={guide} className="space-y-1">
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
				</GuideBox>
			)}
			<p className="text-xs text-muted-foreground">
				{t("packet.details_hint")}
			</p>
			<Button type="submit" variant="outline" size="sm" disabled={saving}>
				{t("packet.details_save")}
			</Button>
		</Form>
	)
}

/**
 * The package for Claro: one download per file (the JAF work order PDF, the
 * Prefield PDF when the job needs it, the original photos and blueprints)
 * "Download all" (one PDF) and a small zip link.
 */
function PackageFileList({ packet }: { packet: PacketStepData }) {
	const { t } = useTranslation()
	return (
		<section className="space-y-2" data-testid="package-files">
			<h3 className="text-sm font-medium">{t("packet.files_title")}</h3>
			{packet.files.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					{t("packet.files_empty")}
				</p>
			) : (
				<ul className="divide-y rounded-lg border border-border">
					{packet.files.map((f) => (
						<li
							key={f.href}
							className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
						>
							<span className="min-w-0">
								<span className="block text-xs text-muted-foreground">
									{t(FILE_KIND_KEY[f.key])}
								</span>
								<span className="block truncate">{f.fileName}</span>
							</span>
							<span className="flex shrink-0 gap-2">
								<FileViewerButton href={f.href} name={f.fileName} />
								<DownloadIconLink href={f.href} name={f.fileName} />
							</span>
						</li>
					))}
				</ul>
			)}
			{packet.zipHref && (
				<a
					href={packet.zipHref}
					className={buttonVariants({
						className:
							"h-11 w-full bg-action-orange text-white hover:bg-action-orange/90",
					})}
				>
					{`⬇ ${t("packet.download_all")}`}
				</a>
			)}
			{packet.zipHref && (
				<a
					href={`${packet.zipHref}?format=zip`}
					className="block text-center text-xs text-muted-foreground underline"
				>
					{t("packet.download_zip")}
				</a>
			)}
		</section>
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
	// The Claro supervisor and the blueprint are boxes on this page: Send stays
	// pressable and points at them. Any other blocker (Prefield PDF, a stale
	// package) is fixed at an earlier step, so Send waits with its message.
	const guide = useFormGuidance([
		{
			id: "g-claro",
			label: t("packet.claro_label"),
			empty: editable && !packet.claroSupervisor,
		},
		{
			id: "g-blueprint",
			label: t("packet.blueprint_upload"),
			empty: editable && packet.blockers.includes("blueprint"),
		},
	])
	const hardBlocked = packet.blockers.some(
		(b) => b !== "blueprint" && b !== "claro_supervisor",
	)
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
								<li key={b}>{t(BLOCKER_KEY[b])}</li>
							))}
						</ul>
					</Pill>
				)}

				{editable && (
					<section className="space-y-1">
						<h3 className="text-sm font-medium">{t("packet.details_title")}</h3>
						<PacketDetailsForm
							packet={packet}
							blueprintNeeded={packet.blockers.includes("blueprint")}
							guide={guide}
						/>
					</section>
				)}

				<PackageFileList packet={packet} />

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
					{editable && <GuideCounter guide={guide} />}
					{!packet.emailEnabled && (
						<p className="text-sm font-medium">
							{packet.packetHref
								? t("packet.pdf_generated")
								: t("packet.pdf_not_generated")}
						</p>
					)}
					{interactive && !packet.emailEnabled && !packet.sent && (
						<>
							<ConfirmedSubmit
								intent="mark_packet_sent"
								label={t("packet.mark_sent")}
								confirmText={t("packet.confirm_manual", {
									email: claro?.email ?? "",
								})}
								disabled={hardBlocked || !packet.packetHref}
								inFlight={inFlight}
								guide={guide}
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
					{interactive && packet.emailEnabled && (
						<>
							<ConfirmedSubmit
								intent="send_packet"
								label={
									packet.sent
										? t("packet.resend")
										: claro
											? t("packet.send_to", { name: claro.name })
											: t("packet.send")
								}
								confirmText={t(
									packet.sent ? "packet.confirm_resend" : "packet.confirm_send",
									{ email: claro?.email ?? "" },
								)}
								disabled={hardBlocked}
								inFlight={inFlight}
								guide={guide}
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
