import type { ParseKeys } from "i18next"
import { useEffect, useState } from "react"
import { Trans, useTranslation } from "react-i18next"
import { Form } from "react-router"
import { MaterialLineItems } from "~/components/material-line-items"
import { Button } from "~/components/ui/button"
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
import { expectedBackFor, type MaterialLine } from "~/lib/returns-lines"
import { useEditableLines } from "~/lib/use-editable-lines"

export type ReturnsFormServiceCode = {
	id: string
	claroCode: string
	name: string
	unit: string | null
	unitPrice?: number
}

interface ReturnLine {
	_key: string
	serviceCodeId: string
	takenQty: number
	usedQty: number
	expectedBack: number
	receivedQty: number
}

type SerialReturnReason = "DAMAGED" | "LOST" | "MISCOUNT" | "UNDER_REPORTED"

interface SerialReturnLine {
	_key: string
	serial: string
	reason: SerialReturnReason | ""
}

let _returnCounter = 0
const nextReturnKey = () => `return-${(_returnCounter++).toString()}`
let _serialLineCounter = 0
const nextSerialLineKey = () =>
	`return-serial-${(_serialLineCounter++).toString()}`

const SERIAL_REASONS: SerialReturnReason[] = [
	"DAMAGED",
	"LOST",
	"MISCOUNT",
	"UNDER_REPORTED",
]

/**
 * Expected-back lines for the form. `savedReturns` (the doc's already-recorded
 * `materialsReturned`) wins over the computed default where present, so
 * revisiting the page after a save shows what was actually saved rather than a
 * fresh full-expected form that a second click would resubmit.
 */
function buildInitialReturnLines(
	taken: MaterialLine[],
	materialsUsed: { serviceCodeId: string; qty: number }[] | null,
	savedReturns?: SavedReturnLine[],
): ReturnLine[] {
	const usedMap = Object.fromEntries(
		(materialsUsed || []).map((u) => [u.serviceCodeId, u.qty]),
	)
	const savedMap = new Map(
		(savedReturns ?? []).map((r) => [r.serviceCodeId, r.returnedQty]),
	)

	return taken.map((m) => {
		const takenQty = m.qty || 0
		const usedQty = usedMap[m.serviceCodeId] ?? 0
		const expectedBack = expectedBackFor(takenQty, usedQty)
		const saved = savedMap.get(m.serviceCodeId)
		return {
			_key: nextReturnKey(),
			serviceCodeId: m.serviceCodeId || "",
			takenQty,
			usedQty,
			expectedBack,
			receivedQty: saved ?? expectedBack,
		}
	})
}

export interface SavedReturnLine {
	serviceCodeId: string
	takenQty: number
	returnedQty: number
	notes: string
}

export interface ReturnsFormData {
	doc: { controlNumber: string }
	serviceCodes: ReturnsFormServiceCode[]
	taken: MaterialLine[]
	materialsUsed: { serviceCodeId: string; qty: number }[] | null
	warehouses: { id: string; name: string }[]
	pickupWarehouseId: string | null
	savedReturns?: SavedReturnLine[]
	alreadyRecorded?: boolean
}

export interface ReturnsFormActionData {
	errorKey?: string
	errorParams?: Record<string, string>
	ok?: boolean
	deduped?: boolean
}

/**
 * All of `_app.docs.$id_.returns.tsx`'s interactive UI, split out into a
 * component with no server-only imports so it (and the "does a second
 * submit after success reuse stale data" regression) can be exercised by a
 * browser test — the route module itself pulls in `db.server` at import
 * time, which a browser/chromium test bundle can't load.
 */
export function ReturnsForm({
	loaderData,
	actionData,
}: {
	loaderData: ReturnsFormData
	actionData?: ReturnsFormActionData
}) {
	const {
		doc,
		serviceCodes,
		taken,
		materialsUsed,
		warehouses,
		pickupWarehouseId,
		savedReturns,
		alreadyRecorded,
	} = loaderData
	const { t } = useTranslation()

	const {
		items: lines,
		add: pushLine,
		remove: removeLine,
		update: updateLine,
		reset: resetLines,
	} = useEditableLines<ReturnLine>(() =>
		buildInitialReturnLines(taken, materialsUsed, savedReturns),
	)

	const {
		items: serialLines,
		add: pushSerialLine,
		remove: removeSerialLine,
		update: updateSerialLine,
		reset: resetSerialLines,
	} = useEditableLines<SerialReturnLine>(() => [])

	const [returnWarehouseId, setReturnWarehouseId] = useState(
		pickupWarehouseId ?? warehouses[0]?.id ?? "",
	)
	const [discrepancyNote, setDiscrepancyNote] = useState("")
	const [idempotencyKey, setIdempotencyKey] = useState(() =>
		crypto.randomUUID(),
	)

	// A successful confirm must leave no stale, already-submitted data behind:
	// the lines/serialLines/note state lives outside the keyed <Form> subtree
	// (so remounting the Form via the new idempotencyKey does NOT clear them),
	// so a second "Save Returns" click without this reset would resubmit the
	// exact same payload under a fresh, non-deduped key and double-credit the
	// ledger. Resetting back to the loader's computed defaults means a second
	// click (with no further edits) submits a full, non-short return instead.
	// biome-ignore lint/correctness/useExhaustiveDependencies: taken/materialsUsed come from loaderData and only need re-reading at the moment of a successful reset, not on every render
	useEffect(() => {
		if (actionData?.ok) {
			setIdempotencyKey(crypto.randomUUID())
			resetLines(buildInitialReturnLines(taken, materialsUsed, savedReturns))
			resetSerialLines([])
			setDiscrepancyNote("")
		}
	}, [actionData])

	const addLine = () =>
		pushLine({
			_key: nextReturnKey(),
			serviceCodeId: "",
			takenQty: 0,
			usedQty: 0,
			expectedBack: 0,
			receivedQty: 0,
		})

	const addSerialLine = () =>
		pushSerialLine({ _key: nextSerialLineKey(), serial: "", reason: "" })

	const anyShort = lines.some((l) => l.receivedQty < l.expectedBack)
	const isCrossWarehouse =
		!!pickupWarehouseId && returnWarehouseId !== pickupWarehouseId

	const linesPayload = JSON.stringify(
		lines
			.filter((l) => l.serviceCodeId)
			.map((l) => ({
				serviceCodeId: l.serviceCodeId,
				received: l.receivedQty,
			})),
	)
	const serialLinesPayload = JSON.stringify(
		serialLines
			.filter((s) => s.serial && s.reason)
			.map((s) => ({ serial: s.serial, reason: s.reason })),
	)

	return (
		<div className="space-y-4">
			<h1 className="text-xl font-semibold">{t("docs_returns.title")}</h1>
			{alreadyRecorded && (
				<p
					data-testid="returns-already-recorded"
					className="rounded-md border border-status-warn/30 bg-status-warn-soft p-2 text-sm font-medium text-status-warn"
				>
					{t("docs_returns.already_recorded_notice")}
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				<Trans
					i18nKey="docs_returns.confirm_message"
					values={{ controlNumber: doc.controlNumber }}
					components={{ strong: <strong /> }}
				/>
			</p>

			<div className="space-y-1">
				<Label>{t("docs_returns.warehouse_label")}</Label>
				<Select
					value={returnWarehouseId}
					onValueChange={(v) => setReturnWarehouseId(v ?? "")}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{warehouses.map((w) => (
							<SelectItem key={w.id} value={w.id}>
								{w.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{isCrossWarehouse && (
					<p className="text-xs font-medium text-status-warn">
						{t("docs_returns.warehouse_policy_unconfirmed")}
					</p>
				)}
			</div>

			<div className="space-y-3">
				{lines.map((line, index) => {
					const code = serviceCodes.find((c) => c.id === line.serviceCodeId)
					const differsFromExpected = line.receivedQty !== line.expectedBack

					return (
						<div key={line._key} className="border rounded-lg p-3 space-y-2">
							<div className="flex items-center gap-2">
								<MaterialLineItems
									serviceCodes={serviceCodes}
									initialItems={[
										{
											serviceCodeId: line.serviceCodeId,
											qty: line.takenQty,
										},
									]}
									readOnly
									showPrice={false}
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
										{t("docs_returns.taken_qty")}
									</Label>
									<Input
										type="number"
										min={0}
										value={line.takenQty}
										disabled
										className="mt-1 bg-muted"
									/>
								</div>
								<div>
									<Label
										htmlFor={`received-qty-${line._key}`}
										className="text-xs text-muted-foreground"
									>
										{t("docs_returns.returned_qty")}
									</Label>
									<Input
										id={`received-qty-${line._key}`}
										type="number"
										min={0}
										value={line.receivedQty}
										onChange={(e) =>
											updateLine(index, {
												receivedQty: parseInt(e.target.value, 10) || 0,
											})
										}
										className="mt-1"
									/>
									<p className="mt-1 text-xs text-muted-foreground">
										{t("docs_returns.crew_reported_hint", {
											usedQty: line.usedQty,
											expectedReturnQty: line.expectedBack,
										})}
									</p>
									{differsFromExpected && (
										<p className="mt-1 text-xs font-medium text-status-warn">
											{t("docs_returns.discrepancy_warning")}
										</p>
									)}
								</div>
							</div>

							<p className="text-xs text-muted-foreground">
								{t("docs_returns.actual_usage")}: {line.usedQty} {code?.unit}
							</p>
						</div>
					)
				})}
			</div>

			<Button type="button" variant="outline" size="sm" onClick={addLine}>
				{t("docs_returns.add_line")}
			</Button>

			<div className="space-y-3">
				<h2 className="text-sm font-semibold">
					{t("docs_returns.serial_lines_heading")}
				</h2>
				{serialLines.map((line, index) => (
					<div
						key={line._key}
						className="flex flex-col gap-2 border rounded-lg p-3 sm:flex-row sm:items-end"
					>
						<div className="flex-1">
							<Label className="text-xs text-muted-foreground">
								{t("docs_returns.serial_label")}
							</Label>
							<Input
								value={line.serial}
								placeholder={t("docs_returns.serial_placeholder")}
								onChange={(e) =>
									updateSerialLine(index, { serial: e.target.value })
								}
								className="mt-1"
							/>
						</div>
						<div className="flex-1">
							<Label className="text-xs text-muted-foreground">
								{t("docs_returns.serial_reason_label")}
							</Label>
							<Select
								value={line.reason}
								onValueChange={(v) =>
									updateSerialLine(index, {
										reason: (v as SerialReturnReason) ?? "",
									})
								}
							>
								<SelectTrigger className="mt-1">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SERIAL_REASONS.map((reason) => (
										<SelectItem key={reason} value={reason}>
											{t(`docs_returns.serial_reason.${reason}`)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<button
							type="button"
							onClick={() => removeSerialLine(index)}
							className="text-muted-foreground hover:text-status-danger text-lg"
						>
							×
						</button>
					</div>
				))}
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={addSerialLine}
				>
					{t("docs_returns.add_serial_line")}
				</Button>
			</div>

			<Form method="post" className="space-y-2" key={idempotencyKey}>
				<input type="hidden" name="idempotencyKey" value={idempotencyKey} />
				<input
					type="hidden"
					name="returnWarehouseId"
					value={returnWarehouseId}
				/>
				<input type="hidden" name="lines" value={linesPayload} />
				<input type="hidden" name="serialLines" value={serialLinesPayload} />
				<div>
					<Label htmlFor="discrepancyNote">
						{t("docs_returns.return_note_label")}
						{anyShort ? " *" : ""}
					</Label>
					<Textarea
						id="discrepancyNote"
						name="discrepancyNote"
						rows={2}
						value={discrepancyNote}
						onChange={(e) => setDiscrepancyNote(e.target.value)}
						placeholder={t("docs_returns.return_note_placeholder")}
						className="mt-1"
					/>
					{anyShort && (
						<p className="mt-1 text-xs text-status-warn">
							{t("docs_returns.note_required_hint")}
						</p>
					)}
				</div>
				<Button type="submit" className="w-full" disabled={alreadyRecorded}>
					{t("docs_returns.submit")}
				</Button>
			</Form>

			{actionData?.errorKey && (
				<p className="text-sm text-status-danger">
					{t(actionData.errorKey as ParseKeys, actionData.errorParams)}
				</p>
			)}
			{actionData?.ok && (
				<p className="text-sm text-status-ok">{t("docs_returns.success")}</p>
			)}
		</div>
	)
}
