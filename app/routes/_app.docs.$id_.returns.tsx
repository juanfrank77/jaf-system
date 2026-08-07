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
import { toNumberPrice } from "~/lib/utils"

interface ReturnLine {
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes: string
}

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
	return {
		doc,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		taken,
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
	const materialsReturnedRaw = form.get("materialsReturned") as string

	let materialsReturned: ReturnLine[] = []
	try {
		materialsReturned = JSON.parse(materialsReturnedRaw)
	} catch {
		return { errorKey: "docs_returns.errors.invalid_materials" }
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
				diffJson: { materialsReturned } as any,
			},
		}),
	] as any)

	throw redirect(`/docs/${params.id}`)
}

export default function ReturnsDoc({
	loaderData,
	actionData,
}: {
	loaderData: { doc: any; serviceCodes: any[]; taken: any[] }
	actionData?: { errorKey?: string }
}) {
	const { doc, serviceCodes, taken } = loaderData
	const { t } = useTranslation()

	const [lines, setLines] = useState<ReturnLine[]>(() =>
		taken.map((m: any) => ({
			serviceCodeId: m.serviceCodeId || "",
			takenQty: m.qty || 0,
			returnedQty: 0,
			notes: "",
		})),
	)

	const addLine = () =>
		setLines([
			...lines,
			{ serviceCodeId: "", takenQty: 0, returnedQty: 0, notes: "" },
		])
	const removeLine = (index: number) =>
		setLines(lines.filter((_, i) => i !== index))
	const updateLine = (index: number, patch: Partial<ReturnLine>) =>
		setLines(
			lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
		)

	const serialized = JSON.stringify(lines)

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

					return (
						<div key={index} className="border rounded-lg p-3 space-y-2">
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
										onChange={(e) =>
											updateLine(index, {
												takenQty: parseInt(e.target.value, 10) || 0,
											})
										}
										className="mt-1"
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
				<Button type="submit" className="w-full">
					{t("docs_returns.submit")}
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

export function ErrorBoundary({ error }: { error: unknown }) {
	return <RouteErrorBoundary error={error} />
}
