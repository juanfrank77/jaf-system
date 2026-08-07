import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { canTransition, requireRole } from "~/lib/permissions.server"
import { useEditableLines } from "~/lib/use-editable-lines"
import { toNumberPrice } from "~/lib/utils"
import type { Route } from "./+types/_app.docs.$id_.prep"

interface PrepLine {
	_key: string
	serviceCodeId: string
	estimatedQty: number
	preppedQty: number
	substitutedWith: string | null
	missing: boolean
	notes: string
}

let _prepCounter = 0
const nextPrepKey = () => `prep-${(_prepCounter++).toString()}`

export const meta: Route.MetaFunction = ({ data }) => [
	{
		title: data
			? `${data.doc.controlNumber} — Prep Materials — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "PREPPED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	return {
		doc,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
	}
}

export async function action({ request, params }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "PREPPED", user.role)) {
		throw redirect(`/docs/${params.id}`)
	}

	const form = await request.formData()
	const preppedMaterialsRaw = form.get("preppedMaterials") as string

	let preppedMaterials: PrepLine[] = []
	try {
		preppedMaterials = JSON.parse(preppedMaterialsRaw)
	} catch {
		return { errorKey: "docs_prep.errors.invalid_materials" }
	}

	const hasAnyMissing = preppedMaterials.some((line) => line.missing)

	if (hasAnyMissing) {
		const supervisorId = doc.supervisorId
		await db.$transaction([
			db.jafInvoice.update({
				where: { id: params.id },
				data: {
					preppedMaterials: preppedMaterials as any,
					prepChangedSincePrep: true,
				},
			}),
			db.auditTrail.create({
				data: {
					docId: params.id,
					userId: user.id,
					action: "PREP_SAVED",
					diffJson: { missing: hasAnyMissing },
				},
			}),
			db.notification.create({
				data: {
					userId: supervisorId,
					docId: params.id,
					message: `Job ${doc.controlNumber} has missing materials flagged during prep. Please review.`,
				},
			}),
		] as any)
		return { missingFlagged: true }
	}

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "PREPPED",
				preppedAt: new Date(),
				preppedById: user.id,
				preppedMaterials: preppedMaterials as any,
				prepChangedSincePrep: false,
			},
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "STATUS_CHANGED",
				diffJson: { status: { before: "CREATED", after: "PREPPED" } },
			},
		}),
		...doc.assignedCrewIds.map((crewId) =>
			db.notification.create({
				data: {
					userId: crewId,
					docId: params.id,
					message: `Job ${doc.controlNumber} is prepped and ready for pickup. Please sign at warehouse.`,
				},
			}),
		),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

export default function PrepDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes } = loaderData
	const { t } = useTranslation()
	const estimated = (doc.estimatedMaterials as any[]) || []

	const {
		items: lines,
		add: pushLine,
		remove: removeLine,
		update: updateLine,
		serialized,
	} = useEditableLines<PrepLine>(() =>
		estimated.map((m) => ({
			_key: nextPrepKey(),
			serviceCodeId: m.serviceCodeId || "",
			estimatedQty: m.qty || 1,
			preppedQty: m.qty || 1,
			substitutedWith: null,
			missing: false,
			notes: "",
		})),
	)

	const addLine = () =>
		pushLine({
			_key: nextPrepKey(),
			serviceCodeId: "",
			estimatedQty: 1,
			preppedQty: 1,
			substitutedWith: null,
			missing: false,
			notes: "",
		})

	const missingCount = lines.filter((l) => l.missing).length

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("docs_prep.title")}</h1>
			<p className="text-sm text-slate-600">
				<Trans
					i18nKey="docs_prep.confirm_message"
					values={{ controlNumber: (doc as any).controlNumber }}
					components={{ strong: <strong /> }}
				/>
			</p>

			{(actionData as any)?.missingFlagged && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
					{t("docs_prep.missing_flagged_notice")}
				</div>
			)}

			<div className="space-y-3">
				{lines.map((line, index) => {
					const _code = serviceCodes.find((c) => c.id === line.serviceCodeId)
					const substitutionOptions = serviceCodes.filter(
						(c) =>
							c.id !== line.serviceCodeId &&
							!lines.some((l, i) => i !== index && l.serviceCodeId === c.id),
					)

					return (
						<div key={line._key} className="border rounded-lg p-3 space-y-2">
							<div className="flex items-center gap-2">
								<MaterialLineItems
									serviceCodes={serviceCodes as any}
									initialItems={[
										{
											serviceCodeId: line.serviceCodeId,
											qty: line.preppedQty,
										},
									]}
									readOnly={false}
									name={`prepped-${index}`}
								/>
								<button
									type="button"
									onClick={() => removeLine(index)}
									className="text-slate-400 hover:text-red-600 text-lg"
								>
									×
								</button>
							</div>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<Label className="text-xs text-slate-500">
										{t("docs_prep.estimated_qty")}
									</Label>
									<Input
										type="number"
										min={1}
										value={line.estimatedQty}
										onChange={(e) =>
											updateLine(index, {
												estimatedQty: parseInt(e.target.value, 10) || 1,
											})
										}
										className="mt-1"
									/>
								</div>
								<div>
									<Label className="text-xs text-slate-500">
										{t("docs_prep.prepped_qty")}
									</Label>
									<Input
										type="number"
										min={1}
										value={line.preppedQty}
										onChange={(e) =>
											updateLine(index, {
												preppedQty: parseInt(e.target.value, 10) || 1,
											})
										}
										className="mt-1"
									/>
								</div>
							</div>

							{line.missing && substitutionOptions.length > 0 && (
								<div>
									<Label className="text-xs text-slate-500">
										{t("docs_prep.substitute_with")}
									</Label>
									<Select
										value={line.substitutedWith ?? ""}
										onValueChange={(v) =>
											updateLine(index, {
												substitutedWith: v ?? null,
											})
										}
									>
										<SelectTrigger className="mt-1">
											<SelectValue
												placeholder={t("docs_prep.substitute_placeholder")}
											/>
										</SelectTrigger>
										<SelectContent>
											{substitutionOptions.map((c) => (
												<SelectItem key={c.id} value={c.id}>
													{c.claroCode} — {c.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}

							<div className="flex items-center gap-2">
								<Checkbox
									id={`missing-${index}`}
									checked={line.missing}
									onCheckedChange={(checked: boolean) =>
										updateLine(index, {
											missing: !!checked,
											substitutedWith: checked ? null : line.substitutedWith,
										})
									}
								/>
								<Label htmlFor={`missing-${index}`} className="text-sm">
									{t("docs_prep.missing_flag")}
								</Label>
							</div>

							<div>
								<Label className="text-xs text-slate-500">
									{t("docs_prep.line_notes")}
								</Label>
								<Textarea
									value={line.notes}
									onChange={(e) => updateLine(index, { notes: e.target.value })}
									placeholder={t("docs_prep.line_notes_placeholder")}
									rows={2}
									className="mt-1"
								/>
							</div>
						</div>
					)
				})}
			</div>

			<Button type="button" variant="outline" size="sm" onClick={addLine}>
				{t("docs_prep.add_line")}
			</Button>

			{missingCount > 0 && (
				<p className="text-sm text-amber-700">
					{t("docs_prep.missing_count", { count: missingCount })}
				</p>
			)}

			<Form method="post" className="space-y-2">
				<input type="hidden" name="preppedMaterials" value={serialized} />
				<Button type="submit" className="w-full" disabled={lines.length === 0}>
					{missingCount > 0
						? t("docs_prep.submit_with_missing")
						: t("docs_prep.submit")}
				</Button>
			</Form>

			{(actionData as any)?.errorKey && (
				<p className="text-sm text-red-600">
					{t((actionData as any).errorKey)}
				</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
