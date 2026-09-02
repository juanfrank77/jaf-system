import { useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { Textarea } from "~/components/ui/textarea"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { useEditableLines } from "~/lib/use-editable-lines"
import { toNumberPrice } from "~/lib/utils"

interface ReturnLine {
	_key: string
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes: string
}

let _returnCounter = 0
const nextReturnKey = () => `return-${(_returnCounter++).toString()}`

export const meta = ({
	data,
}: {
	data?: { doc: { controlNumber: string } }
}) => [
	{
		title: data
			? `${data.doc.controlNumber} — Log Returns — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: any) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!["SIGNED", "FIELD_UPDATED"].includes(doc.status))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	const taken = (doc.materialsTaken as any[]) || []
	const existingReturns = (doc.materialsReturned as ReturnLine[] | null) || null
	const materialsUsed =
		(doc.materialsUsed as { serviceCodeId: string; qty: number }[] | null) ||
		null
	return {
		doc,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		taken,
		existingReturns,
		materialsUsed,
	}
}

export async function action({ request, params }: any) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!["SIGNED", "FIELD_UPDATED"].includes(doc.status)) {
		throw redirect(`/docs/${params.id}`)
	}

	const form = await request.formData()
	// Signed quantities are immutable after pickup. Ignore any attempt to overwrite them.
	form.delete("materialsTaken")
	const materialsReturnedRaw = form.get("materialsReturned") as string
	const returnNote = (form.get("returnNote") as string | null)?.trim() || null

	let materialsReturned: ReturnLine[] = []
	try {
		materialsReturned = JSON.parse(materialsReturnedRaw)
	} catch {
		return { errorKey: "docs_returns.errors.invalid_materials" }
	}

	const taken = (doc.materialsTaken as any[]) || []
	const takenMap = Object.fromEntries(
		taken.map((t) => [t.serviceCodeId, t.qty]),
	)

	for (const line of materialsReturned) {
		if (!line.serviceCodeId) {
			return { errorKey: "docs_returns.errors.invalid_materials" }
		}
		const takenQty = takenMap[line.serviceCodeId] ?? 0
		if (line.returnedQty > takenQty) {
			return {
				errorKey: "docs_returns.errors.return_exceeds_taken",
				errorParams: { serviceCodeId: line.serviceCodeId },
			}
		}
		// Preserve the actual signed-out quantity even if the client sent a different value.
		line.takenQty = takenQty
	}

	const uniqueServiceCodeIds = Array.from(
		new Set(materialsReturned.map((i) => i.serviceCodeId).filter(Boolean)),
	)
	if (uniqueServiceCodeIds.length > 0) {
		const validServiceCodes = await db.serviceCode.findMany({
			where: { id: { in: uniqueServiceCodeIds }, active: true },
			select: { id: true },
		})
		const validServiceCodeSet = new Set(validServiceCodes.map((c) => c.id))
		const invalidServiceCodes = uniqueServiceCodeIds.filter(
			(id) => !validServiceCodeSet.has(id),
		)
		if (invalidServiceCodes.length > 0) {
			return { errorKey: "docs_returns.errors.invalid_service_codes" }
		}
	}

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: { materialsReturned: materialsReturned as any },
		}),
		db.auditTrail.create({
			data: {
				docId: params.id,
				userId: user.id,
				action: "RETURNS_LOGGED",
				diffJson: {
					materialsReturned: materialsReturned as any,
					returnNote,
					shortage: materialsReturned.some(
						(line) => line.returnedQty < line.takenQty,
					),
				} as any,
			},
		}),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

function buildInitialReturnLines(
	taken: any[],
	existingReturns: ReturnLine[] | null,
	materialsUsed: { serviceCodeId: string; qty: number }[] | null,
): ReturnLine[] {
	const usedMap = Object.fromEntries(
		(materialsUsed || []).map((u) => [u.serviceCodeId, u.qty]),
	)

	if (existingReturns && existingReturns.length > 0) {
		return existingReturns.map((line) => ({
			_key: nextReturnKey(),
			serviceCodeId: line.serviceCodeId || "",
			takenQty: line.takenQty || 0,
			returnedQty: typeof line.returnedQty === "number" ? line.returnedQty : 0,
			notes: line.notes || "",
		}))
	}

	return taken.map((m: any) => {
		const takenQty = m.qty || 0
		const usedQty = usedMap[m.serviceCodeId] ?? 0
		const returnedQty = Math.max(0, takenQty - usedQty)
		return {
			_key: nextReturnKey(),
			serviceCodeId: m.serviceCodeId || "",
			takenQty,
			returnedQty,
			notes: "",
		}
	})
}

export default function ReturnsDoc({
	loaderData,
	actionData,
}: {
	loaderData: {
		doc: any
		serviceCodes: any[]
		taken: any[]
		existingReturns: ReturnLine[] | null
		materialsUsed: { serviceCodeId: string; qty: number }[] | null
	}
	actionData?: { errorKey?: string; errorParams?: Record<string, string> }
}) {
	const { doc, serviceCodes, taken, existingReturns, materialsUsed } =
		loaderData
	const { t } = useTranslation()

	const {
		items: lines,
		add: pushLine,
		remove: removeLine,
		update: updateLine,
		serialized,
	} = useEditableLines<ReturnLine>(() =>
		buildInitialReturnLines(taken, existingReturns, materialsUsed),
	)

	const addLine = () =>
		pushLine({
			_key: nextReturnKey(),
			serviceCodeId: "",
			takenQty: 0,
			returnedQty: 0,
			notes: "",
		})

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("docs_returns.title")}</h1>
			<p className="text-sm text-slate-600">
				<Trans
					i18nKey="docs_returns.confirm_message"
					values={{ controlNumber: (doc as any).controlNumber }}
					components={{ strong: <strong /> }}
				/>
			</p>

			<div className="space-y-3">
				{lines.map((line, index) => {
					const code = serviceCodes.find(
						(c: any) => c.id === line.serviceCodeId,
					)
					const actualUsage = Math.max(
						(line.takenQty || 0) - (line.returnedQty || 0),
						0,
					)
					const usedQty = materialsUsed
						? ((materialsUsed as any[]).find(
								(u: any) => u.serviceCodeId === line.serviceCodeId,
							)?.qty ?? null)
						: null
					const expectedReturnQty =
						usedQty != null ? Math.max(0, (line.takenQty || 0) - usedQty) : null
					const differsFromCrewReport =
						expectedReturnQty != null && line.returnedQty !== expectedReturnQty

					return (
						<div key={line._key} className="border rounded-lg p-3 space-y-2">
							<div className="flex items-center gap-2">
								<MaterialLineItems
									serviceCodes={serviceCodes as any}
									initialItems={[
										{
											serviceCodeId: line.serviceCodeId,
											qty: line.takenQty,
										},
									]}
									readOnly
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
										{t("docs_returns.taken_qty")}
									</Label>
									<Input
										type="number"
										min={0}
										value={line.takenQty}
										disabled
										className="mt-1 bg-slate-50"
									/>
								</div>
								<div>
									<Label className="text-xs text-slate-500">
										{t("docs_returns.returned_qty")}
									</Label>
									<Input
										type="number"
										min={0}
										value={line.returnedQty}
										onChange={(e) =>
											updateLine(index, {
												returnedQty: parseInt(e.target.value, 10) || 0,
											})
										}
										className="mt-1"
									/>
									{expectedReturnQty != null && (
										<p className="mt-1 text-xs text-slate-500">
											{t("docs_returns.crew_reported_hint", {
												usedQty,
												expectedReturnQty,
											})}
										</p>
									)}
									{differsFromCrewReport && (
										<p className="mt-1 text-xs font-medium text-amber-600">
											{t("docs_returns.discrepancy_warning")}
										</p>
									)}
								</div>
							</div>

							<p className="text-xs text-slate-600">
								{t("docs_returns.actual_usage")}: {actualUsage} {code?.unit}
							</p>

							<div>
								<Label className="text-xs text-slate-500">
									{t("docs_returns.line_notes")}
								</Label>
								<Textarea
									value={line.notes}
									onChange={(e) => updateLine(index, { notes: e.target.value })}
									placeholder={t("docs_returns.line_notes_placeholder")}
									rows={2}
									className="mt-1"
								/>
							</div>
						</div>
					)
				})}
			</div>

			<Button type="button" variant="outline" size="sm" onClick={addLine}>
				{t("docs_returns.add_line")}
			</Button>

			<Form method="post" className="space-y-2">
				<input type="hidden" name="materialsReturned" value={serialized} />
				<div>
					<Label htmlFor="returnNote">
						{t("docs_returns.return_note_label")}
					</Label>
					<Textarea
						id="returnNote"
						name="returnNote"
						rows={2}
						placeholder={t("docs_returns.return_note_placeholder")}
						className="mt-1"
					/>
				</div>
				<Button type="submit" className="w-full">
					{t("docs_returns.submit")}
				</Button>
			</Form>

			{actionData?.errorKey && (
				<p className="text-sm text-red-600">
					{t(actionData.errorKey as any, actionData.errorParams)}
				</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: { error: unknown }) {
	return <RouteErrorBoundary error={error} />
}
