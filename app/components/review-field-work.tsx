import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Form } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { ServiceLinesTable } from "~/components/service-lines-table"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import type { AddressCorrection } from "~/lib/field-update-helpers"
import type { ServiceLine } from "~/lib/service-lines"

type MaterialLine = Parameters<typeof MaterialLineItems>[0]["initialItems"]
type MaterialServiceCode = Parameters<
	typeof MaterialLineItems
>[0]["serviceCodes"]

export type ReviewPhoto = {
	id: string
	basename: string
	tag: "BEFORE" | "AFTER" | null
	takenAt: string
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
	dateStyle: "short",
	timeStyle: "short",
})

/** Certified address, shown as old → new with who/when for each correction. */
export function AddressCard({
	estimated,
	corrections,
	correctorNames,
	notes,
}: {
	estimated: string
	corrections: AddressCorrection[]
	correctorNames: Record<string, string>
	notes: string | null
}) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				{corrections.length > 0
					? t("docs_review.certified_address_corrected")
					: t("docs_review.certified_address")}
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				{corrections.length === 0 ? (
					<p>{estimated}</p>
				) : (
					corrections.map((c) => (
						<div
							key={`${c.original}-${c.corrected}-${c.correctedAt}`}
							className="rounded-lg bg-muted p-3"
						>
							<span className="text-muted-foreground line-through">
								{c.original}
							</span>
							{" → "}
							<span className="font-medium">{c.corrected}</span>
							<p className="mt-1 text-xs text-muted-foreground">
								{t("docs_review.corrected_by", {
									name: correctorNames[c.correctedById] ?? "—",
									when: timeFmt.format(new Date(c.correctedAt)),
								})}
							</p>
						</div>
					))
				)}
				{notes && (
					<p className="text-muted-foreground">
						{t("docs_review.field_notes")}: “{notes}”
					</p>
				)}
			</CardContent>
		</Card>
	)
}

export function PhotosCard({
	docId,
	photos,
}: {
	docId: string
	photos: ReviewPhoto[]
}) {
	const { t } = useTranslation()
	if (photos.length === 0) return null
	return (
		<Card>
			<CardHeader>
				{t("docs_review.job_photos", { count: photos.length })}
			</CardHeader>
			<CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{photos.map((p) => (
					<a
						key={p.id}
						href={`/files/photos/${docId}/${p.basename}`}
						target="_blank"
						rel="noreferrer"
						className="space-y-1"
					>
						<img
							src={`/files/photos/${docId}/${p.basename}`}
							alt={t("docs_review.job_site_alt")}
							className="h-28 w-full rounded-lg border border-border object-cover"
						/>
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							{p.tag ? (
								<Badge variant={p.tag === "BEFORE" ? "info" : "ok"}>
									{t(`docs_review.photo_tag_${p.tag}`)}
								</Badge>
							) : (
								<span />
							)}
							<span>{timeFmt.format(new Date(p.takenAt))}</span>
						</div>
					</a>
				))}
			</CardContent>
		</Card>
	)
}

export function OrderedVsInstalledCard({
	ordered,
	installed,
	estimated,
	taken,
	used,
	serviceCodes,
}: {
	ordered: ServiceLine[]
	installed: ServiceLine[]
	estimated: MaterialLine
	taken: MaterialLine
	used: MaterialLine
	serviceCodes: MaterialServiceCode
}) {
	const { t } = useTranslation()
	return (
		<Card>
			<CardHeader>
				<span>{t("docs_review.ordered_vs_installed")}</span>
				<span className="text-xs font-normal text-muted-foreground">
					{t("docs_review.per_service_code")}
				</span>
			</CardHeader>
			<CardContent className="space-y-4">
				{ordered.length > 0 && (
					<ServiceLinesTable
						lines={ordered}
						installed={installed}
						showDifference
					/>
				)}
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{t("docs_review.materials_detail")}
					</summary>
					<div className="mt-3 grid gap-3 sm:grid-cols-3">
						{(
							[
								["estimated", estimated],
								["taken", taken],
								["used", used],
							] as const
						).map(([key, items]) => (
							<div key={key} className="rounded-lg border border-border p-3">
								<p className="mb-1 text-xs text-muted-foreground">
									{t(`docs_review.${key}`)}
								</p>
								<MaterialLineItems
									serviceCodes={serviceCodes}
									initialItems={items}
									estimatedItems={key === "taken" ? estimated : undefined}
									readOnly
								/>
							</div>
						))}
					</div>
				</details>
			</CardContent>
		</Card>
	)
}

/** Approve (when FIELD_UPDATED) and send back (note required, revealed on demand). */
export function ReviewActionsCard({
	canApprove,
	canSendBack,
}: {
	canApprove: boolean
	canSendBack: boolean
}) {
	const { t } = useTranslation()
	const [sendingBack, setSendingBack] = useState(false)
	if (!canApprove && !canSendBack) return null
	return (
		<Card>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap gap-3">
					{canApprove && (
						<Form method="post" className="flex-[2]">
							<input type="hidden" name="intent" value="approve" />
							<Button type="submit" className="w-full">
								✓ {t("docs_review.approve_field_work")}
							</Button>
						</Form>
					)}
					{canSendBack && !sendingBack && (
						<Button
							type="button"
							variant="outline"
							className="flex-1"
							onClick={() => setSendingBack(true)}
						>
							↩ {t("docs_review.send_back_heading")}
						</Button>
					)}
				</div>
				{canSendBack && sendingBack && (
					<Form method="post" className="space-y-2 border-t border-border pt-4">
						<Label htmlFor="sendBackNote">
							{t("docs_review.send_back_heading")}
						</Label>
						<Textarea
							id="sendBackNote"
							name="note"
							rows={2}
							required
							autoFocus
						/>
						<p className="text-xs text-muted-foreground">
							{t("docs_review.send_back_hint")}
						</p>
						<input type="hidden" name="intent" value="send_back" />
						<div className="flex gap-2">
							<Button type="submit" variant="outline">
								↩ {t("docs_review.send_back")}
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => setSendingBack(false)}
							>
								{t("docs_review.send_back_cancel")}
							</Button>
						</div>
					</Form>
				)}
			</CardContent>
		</Card>
	)
}
