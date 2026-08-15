import { useTranslation } from "react-i18next"
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
import { requireRole } from "~/lib/permissions.server"
import { useEditableLines } from "~/lib/use-editable-lines"
import { toNumberPrice } from "~/lib/utils"

interface FulfillLine {
	_key: string
	serviceCodeId: string
	requestedQty: number
	preparedQty: number
	missing: boolean
	substitutedWith: string | null
	notes: string
}

let _fulfillCounter = 0
const nextFulfillKey = () => `fulfill-${(_fulfillCounter++).toString()}`

export const meta = ({ data }: { data?: { request: { id: string } } }) => [
	{
		title: data
			? `Restock #${data.request.id.slice(-6)} — Fulfill — JAF Ops`
			: "JAF Ops",
	},
]

export async function loader({ request, params }: any) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const restockRequest = await db.vanRestockRequest.findUniqueOrThrow({
		where: { id: params.id },
		include: { requestedBy: true, warehouse: true },
	})
	if (!["REQUESTED", "APPROVED"].includes(restockRequest.status)) {
		throw redirect(`/dashboard`)
	}
	const serviceCodes = await db.serviceCode.findMany({
		where: { active: true },
	})
	const items = (restockRequest.items as any[]) || []
	return {
		request: restockRequest,
		serviceCodes: serviceCodes.map((c) => ({
			...c,
			unitPrice: toNumberPrice(c.unitPrice),
		})),
		items,
	}
}

export async function action({ request, params }: any) {
	await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const restockRequest = await db.vanRestockRequest.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!["REQUESTED", "APPROVED"].includes(restockRequest.status)) {
		throw redirect(`/dashboard`)
	}

	const form = await request.formData()
	const fulfillItemsRaw = form.get("fulfillItems") as string

	let fulfillItems: FulfillLine[] = []
	try {
		fulfillItems = JSON.parse(fulfillItemsRaw)
	} catch {
		return { errorKey: "restock_fulfill.errors.invalid_items" }
	}

	const uniqueServiceCodeIds = Array.from(
		new Set(fulfillItems.map((i) => i.serviceCodeId).filter(Boolean)),
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
			return { errorKey: "restock_fulfill.errors.invalid_service_codes" }
		}
	}

	const hasAnyMissing = fulfillItems.some((line) => line.missing)

	if (hasAnyMissing) {
		await db.vanRestockRequest.update({
			where: { id: params.id },
			data: {
				items: fulfillItems as any,
			},
		})
		return { missingFlagged: true }
	}

	await db.vanRestockRequest.update({
		where: { id: params.id },
		data: {
			status: "READY",
			items: fulfillItems as any,
		},
	})

	throw redirect(`/dashboard`)
}

export default function FulfillRestock({ loaderData, actionData }: any) {
	const { request: restockRequest, serviceCodes, items } = loaderData
	const { t } = useTranslation()

	const {
		items: lines,
		add: pushLine,
		remove: removeLine,
		update: updateLine,
		serialized,
	} = useEditableLines<FulfillLine>(() =>
		items.map((m: any) => ({
			_key: nextFulfillKey(),
			serviceCodeId: m.serviceCodeId || "",
			requestedQty: m.qty || 1,
			preparedQty: m.qty || 1,
			missing: false,
			substitutedWith: null,
			notes: "",
		})),
	)

	const addLine = () =>
		pushLine({
			_key: nextFulfillKey(),
			serviceCodeId: "",
			requestedQty: 1,
			preparedQty: 1,
			missing: false,
			substitutedWith: null,
			notes: "",
		})

	const missingCount = lines.filter((l) => l.missing).length

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">
				{t("restock_fulfill.title", { id: restockRequest.id.slice(-6) })}
			</h1>
			<p className="text-sm text-slate-600">
				{restockRequest.requestedBy?.name ?? "Installer"} —{" "}
				{restockRequest.warehouse?.name ?? "Warehouse"}
			</p>

			{(actionData as any)?.missingFlagged && (
				<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
					{t("restock_fulfill.missing_flagged_notice")}
				</div>
			)}

			<div className="space-y-3">
				{lines.map((line, index) => {
					const substitutionOptions = serviceCodes.filter(
						(c: any) =>
							c.id !== line.serviceCodeId &&
							!lines.some(
								(l: any, i: number) => i !== index && l.serviceCodeId === c.id,
							),
					)

					return (
						<div key={line._key} className="border rounded-lg p-3 space-y-2">
							<div className="flex items-center gap-2">
								<MaterialLineItems
									serviceCodes={serviceCodes as any}
									initialItems={[
										{
											serviceCodeId: line.serviceCodeId,
											qty: line.preparedQty,
										},
									]}
									readOnly={false}
									name={`fulfill-${index}`}
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
										{t("restock_fulfill.requested_qty")}
									</Label>
									<Input
										type="number"
										min={1}
										value={line.requestedQty}
										onChange={(e) =>
											updateLine(index, {
												requestedQty: parseInt(e.target.value, 10) || 1,
											})
										}
										className="mt-1"
									/>
								</div>
								<div>
									<Label className="text-xs text-slate-500">
										{t("restock_fulfill.prepared_qty")}
									</Label>
									<Input
										type="number"
										min={1}
										value={line.preparedQty}
										onChange={(e) =>
											updateLine(index, {
												preparedQty: parseInt(e.target.value, 10) || 1,
											})
										}
										className="mt-1"
									/>
								</div>
							</div>

							{line.missing && substitutionOptions.length > 0 && (
								<div>
									<Label className="text-xs text-slate-500">
										{t("restock_fulfill.substitute_with")}
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
												placeholder={t(
													"restock_fulfill.substitute_placeholder",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{substitutionOptions.map((c: any) => (
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
									{t("restock_fulfill.missing_flag")}
								</Label>
							</div>

							<div>
								<Label className="text-xs text-slate-500">
									{t("restock_fulfill.line_notes")}
								</Label>
								<Textarea
									value={line.notes}
									onChange={(e) => updateLine(index, { notes: e.target.value })}
									placeholder={t("restock_fulfill.line_notes_placeholder")}
									rows={2}
									className="mt-1"
								/>
							</div>
						</div>
					)
				})}
			</div>

			<Button type="button" variant="outline" size="sm" onClick={addLine}>
				{t("restock_fulfill.add_line")}
			</Button>

			{missingCount > 0 && (
				<p className="text-sm text-amber-700">
					{t("restock_fulfill.missing_count", { count: missingCount })}
				</p>
			)}

			<Form method="post" className="space-y-2">
				<input type="hidden" name="fulfillItems" value={serialized} />
				<input
					type="hidden"
					name="hasMissing"
					value={missingCount > 0 ? "true" : "false"}
				/>
				<Button type="submit" className="w-full" disabled={lines.length === 0}>
					{missingCount > 0
						? t("restock_fulfill.submit_with_missing")
						: t("restock_fulfill.submit")}
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
