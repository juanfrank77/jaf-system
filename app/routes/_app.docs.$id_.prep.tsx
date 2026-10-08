import type { ParseKeys } from "i18next"
import { Trans, useTranslation } from "react-i18next"
import { Form, redirect } from "react-router"
import { RouteErrorBoundary } from "~/components/error-boundary"
import { MaterialLineItems } from "~/components/material-line-items"
import { Badge } from "~/components/ui/badge"
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
import { pageTitle } from "~/lib/page-title"
import { canTransition } from "~/lib/permissions"
import { requireRole } from "~/lib/permissions.server"
import {
	getActiveMaterialCodes,
	serviceCodesForRole,
} from "~/lib/service-codes.server"
import { useEditableLines } from "~/lib/use-editable-lines"
import { resolveWarehouseScope } from "~/lib/warehouse-scope.server"
import { getPrepAvailable, resolveDualUom } from "~/lib/warehouse-stock.server"
import type { Prisma } from "../../generated/prisma/client"
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

export const meta: Route.MetaFunction = ({ data, matches }) => [
	{
		title: data
			? pageTitle(matches, "page_title.prep", data.doc.controlNumber)
			: pageTitle(matches),
	},
]

export async function loader({ request, params }: Route.LoaderArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const doc = await db.jafInvoice.findUniqueOrThrow({
		where: { id: params.id },
	})
	if (!canTransition(doc.status, "PREPPED", user.role))
		throw redirect(`/docs/${params.id}`)
	const serviceCodes = await getActiveMaterialCodes()

	// Live preview only, never a stored commitment: the doc's eventual pickup
	// warehouse isn't set until sign (crew may pull from a different zone
	// warehouse), so this previews availability at the acting counter user's
	// own currently-selected warehouse scope (Task 4) — never doc.warehouseId,
	// which is null at this stage for every doc.
	const { selectedId: warehouseId } = await resolveWarehouseScope(
		db,
		request,
		user,
	)
	const estimated =
		(doc.estimatedMaterials as { serviceCodeId: string; qty: number }[]) || []
	const codeById = new Map(serviceCodes.map((c) => [c.id, c]))
	const availability: Record<
		string,
		{
			available: number
			countUnit: string | null
			stockUnit: string | null
			derivedAvailable: number | null
		}
	> = {}
	if (warehouseId) {
		const uniqueIds = new Set(
			estimated.map((m) => m.serviceCodeId).filter(Boolean),
		)
		for (const codeId of uniqueIds) {
			const available = await getPrepAvailable(db, warehouseId, codeId)
			const code = codeById.get(codeId)
			const dual = resolveDualUom(available, {
				countUnit: code?.countUnit ?? null,
				stockUnit: code?.stockUnit ?? null,
				conversionFactor: code?.conversionFactor
					? Number(code.conversionFactor)
					: null,
			})
			availability[codeId] = {
				available,
				countUnit: dual.countUnit,
				stockUnit: dual.stockUnit,
				derivedAvailable: dual.derivedStockQty,
			}
		}
	}

	return {
		doc,
		serviceCodes: serviceCodesForRole(user.role, serviceCodes),
		availability,
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
					preppedMaterials:
						preppedMaterials as unknown as Prisma.InputJsonValue,
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
		])
		// flag_missing is async/non-blocking: it notifies the supervisor but
		// never forces the doc into a release-blocking state — the same doc can
		// still be re-submitted (adjust/substitute) and reach PREPPED normally.
		return { missingFlagged: true, blocksRelease: false as const }
	}

	await db.$transaction([
		db.jafInvoice.update({
			where: { id: params.id },
			data: {
				status: "PREPPED",
				preppedAt: new Date(),
				preppedById: user.id,
				preppedMaterials: preppedMaterials as unknown as Prisma.InputJsonValue,
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
	])

	throw redirect(`/docs/${params.id}`)
}

export default function PrepDoc({
	loaderData,
	actionData,
}: Route.ComponentProps) {
	const { doc, serviceCodes, availability } = loaderData
	const error = actionData as { errorKey?: ParseKeys } | undefined
	const { t } = useTranslation()
	const estimated =
		(doc.estimatedMaterials as { serviceCodeId: string; qty: number }[]) || []

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
			<p className="text-sm text-muted-foreground">
				<Trans
					i18nKey="docs_prep.confirm_message"
					values={{ controlNumber: doc.controlNumber }}
					components={{ strong: <strong /> }}
				/>
			</p>

			{(actionData as { missingFlagged?: boolean } | undefined)
				?.missingFlagged && (
				<div className="bg-status-warn-soft border border-status-warn/30 rounded-lg p-3 text-sm text-status-warn">
					{t("docs_prep.missing_flagged_notice")}
				</div>
			)}

			<div className="space-y-3">
				{lines.map((line, index) => {
					const _code = serviceCodes.find((c) => c.id === line.serviceCodeId)
					const shortBy = Math.max(0, line.estimatedQty - line.preppedQty)
					const substitutionOptions = serviceCodes.filter(
						(c) =>
							c.id !== line.serviceCodeId &&
							!lines.some((l, i) => i !== index && l.serviceCodeId === c.id),
					)

					return (
						<div key={line._key} className="border rounded-lg p-3 space-y-2">
							<div className="flex items-center gap-2">
								<MaterialLineItems
									serviceCodes={serviceCodes}
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
									className="text-muted-foreground hover:text-status-danger text-lg"
								>
									×
								</button>
							</div>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<Label className="text-xs text-muted-foreground">
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
									<Label className="text-xs text-muted-foreground">
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

							{(() => {
								const avail = availability[line.serviceCodeId]
								if (!avail) return null
								return (
									<p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
										<span>
											{t("docs_prep.available")}: {avail.available}{" "}
											{avail.countUnit ?? ""}
											{avail.derivedAvailable !== null && (
												<>
													{" "}
													= {avail.derivedAvailable} {avail.stockUnit}
												</>
											)}
										</span>
										{avail.derivedAvailable === null && (
											<Badge variant="neutral">{t("stock.unit_not_set")}</Badge>
										)}
									</p>
								)
							})()}

							{(line.missing || shortBy > 0) && (
								<div className="flex flex-wrap items-center gap-1.5">
									{line.missing && (
										<Badge variant="danger">
											{t("docs_prep.flagged_missing")}
										</Badge>
									)}
									{shortBy > 0 && (
										<Badge variant="danger">
											{t("docs_prep.short_by", { count: shortBy })}
										</Badge>
									)}
								</div>
							)}

							{substitutionOptions.length > 0 && (
								<div>
									<Label className="text-xs text-muted-foreground">
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
										updateLine(index, { missing: !!checked })
									}
								/>
								<Label htmlFor={`missing-${index}`} className="text-sm">
									{t("docs_prep.missing_flag")}
								</Label>
							</div>

							<div>
								<Label className="text-xs text-muted-foreground">
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
				<p className="text-sm text-status-warn">
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

			{error?.errorKey && (
				<p className="text-sm text-status-danger">{t(error.errorKey)}</p>
			)}
		</div>
	)
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	return <RouteErrorBoundary error={error} />
}
