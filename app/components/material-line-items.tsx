import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { QtyStepper } from "~/components/ui/qty-stepper"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { toNumberPrice } from "~/lib/utils"

function debounce<T extends (items: LineItem[]) => void>(
	fn: T,
	delay: number,
): T {
	let timeoutId: ReturnType<typeof setTimeout>
	return ((...args: unknown[]) => {
		clearTimeout(timeoutId)
		timeoutId = setTimeout(() => fn(...(args as [LineItem[]])), delay)
	}) as T
}

interface LineItem {
	serviceCodeId: string
	qty: number
}

interface InternalItem extends LineItem {
	_key: string
}

interface ServiceCode {
	id: string
	claroCode: string
	name: string
	unit: string | null
	/** Absent for price-blind roles (crew, warehouse): then no price is shown. */
	unitPrice?: number
}

interface Props {
	serviceCodes: ServiceCode[]
	initialItems?: LineItem[]
	readOnly?: boolean
	name?: string
	estimatedItems?: LineItem[] | undefined
	/** Print `unit price x qty` per line in read-only mode. Defaults to true;
	 * the column is also skipped for any line whose catalog row has no price. */
	showPrice?: boolean
	/** Phone layout for editable rows: full-width picker, 44 px stepper and
	 * remove button, 16 px text. */
	touch?: boolean
	/** Caption for `estimatedItems` in editable mode. Defaults to "Listed". */
	listedLabel?: string
	/** Editable mode only: print the amber "+N more than listed" and blue
	 * "added at counter" tags. Off where "more" is not the normal case. */
	tags?: boolean
	/** Editable mode, with `estimatedItems`: a line cannot go above its listed
	 * quantity and only listed codes can be picked. */
	capToListed?: boolean
	/** Called with the current lines whenever they change (editable mode). */
	onItemsChange?: (items: LineItem[]) => void
}

let _counter = 0
const nextKey = () => `item-${(_counter++).toString()}`

function buildDropdownItems(
	available: ServiceCode[],
	code: ServiceCode | undefined,
) {
	const availableItems = available.map((c) => ({
		value: c.id,
		label: `${c.claroCode} — ${c.name}`,
	}))
	if (code && !available.find((c) => c.id === code.id)) {
		availableItems.push({
			value: code.id,
			label: `${code.claroCode} — ${code.name}`,
		})
	}
	return availableItems
}

export function MaterialLineItems({
	serviceCodes,
	initialItems = [],
	readOnly = false,
	name = "materials",
	estimatedItems,
	showPrice = true,
	touch = false,
	listedLabel,
	tags = true,
	capToListed = false,
	onItemsChange,
}: Props) {
	const { t } = useTranslation()
	const [items, setItems] = useState<InternalItem[]>(() =>
		initialItems.map((item) => ({ ...item, _key: nextKey() })),
	)

	const addItem = () =>
		setItems([...items, { serviceCodeId: "", qty: 1, _key: nextKey() }])
	const removeItem = (key: string) =>
		setItems(items.filter((item) => item._key !== key))
	const updateItem = (key: string, patch: Partial<LineItem>) =>
		setItems(
			items.map((item) => (item._key === key ? { ...item, ...patch } : item)),
		)

	const used = new Set(items.map((i) => i.serviceCodeId).filter(Boolean))
	const available = serviceCodes.filter(
		(c) =>
			!used.has(c.id) &&
			(!capToListed ||
				!estimatedItems ||
				estimatedItems.some((e) => e.serviceCodeId === c.id)),
	)

	const serialized: LineItem[] = items.map(({ serviceCodeId, qty }) => ({
		serviceCodeId,
		qty,
	}))

	const onItemsChangeRef = useRef(onItemsChange)
	onItemsChangeRef.current = onItemsChange
	const debouncedOnItemsChange = useRef(
		debounce((items: LineItem[]) => {
			onItemsChangeRef.current?.(items)
		}, 200),
	)
	useEffect(() => {
		debouncedOnItemsChange.current(
			items.map(({ serviceCodeId, qty }) => ({ serviceCodeId, qty })),
		)
	}, [items])

	// Build estimated map for over-draw detection (only if estimatedItems provided)
	const estimatedMap = estimatedItems
		? new Map(estimatedItems.map((e) => [e.serviceCodeId, e.qty]))
		: undefined

	return (
		<div className="space-y-2">
			<input type="hidden" name={name} value={JSON.stringify(serialized)} />
			{items.map((item) => {
				const code = serviceCodes.find((c) => c.id === item.serviceCodeId)
				const dropdownItems = buildDropdownItems(available, code)
				if (readOnly) {
					// Only compute over-draw/counter-added tags if estimatedItems was provided
					const estimatedQty = estimatedMap?.get(item.serviceCodeId) ?? 0
					const isOverdrawn =
						estimatedMap && item.qty > estimatedQty && estimatedQty > 0
					const isCounterAdded =
						estimatedMap && !estimatedMap.has(item.serviceCodeId)
					const overage = item.qty - estimatedQty

					return (
						<div
							key={item._key}
							className="flex items-center gap-3 text-sm py-1 border-b last:border-0"
						>
							<span className="font-mono text-xs text-muted-foreground">
								{code?.claroCode}
							</span>
							<span className="flex-1">{code?.name ?? "—"}</span>
							<span className="w-16 text-right">
								{item.qty} {code?.unit}
							</span>
							{showPrice && code?.unitPrice !== undefined && (
								<span className="w-20 text-right">
									${(toNumberPrice(code.unitPrice) * item.qty).toFixed(2)}
								</span>
							)}
							{isOverdrawn && (
								<span className="text-xs bg-status-warn-soft text-status-warn px-2 py-1 rounded whitespace-nowrap">
									+{overage} {t("material_line_items.more_than_estimated")}
								</span>
							)}
							{isCounterAdded && (
								<span className="text-xs bg-status-info-soft text-status-info px-2 py-1 rounded whitespace-nowrap">
									{t("material_line_items.added_at_counter")}
								</span>
							)}
						</div>
					)
				}
				const listedQty = estimatedMap?.get(item.serviceCodeId)
				const overListed =
					listedQty !== undefined && listedQty > 0 && item.qty > listedQty
				const addedAtCounter =
					estimatedMap !== undefined &&
					item.serviceCodeId !== "" &&
					listedQty === undefined
				const picker = (
					<Select
						items={dropdownItems}
						value={item.serviceCodeId}
						onValueChange={(v) =>
							updateItem(item._key, { serviceCodeId: v ?? "" })
						}
					>
						<SelectTrigger
							className={touch ? "h-11 min-w-0 flex-1 text-base" : "flex-1"}
						>
							<SelectValue
								placeholder={t("material_line_items.select_placeholder")}
							/>
						</SelectTrigger>
						<SelectContent>
							{dropdownItems.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)
				const removeButton = (
					<button
						type="button"
						onClick={() => removeItem(item._key)}
						aria-label={t("material_line_items.remove")}
						className={`flex shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:border-status-danger hover:bg-status-danger-soft hover:text-status-danger ${touch ? "size-11" : "size-9"}`}
					>
						<HugeiconsIcon
							icon={Cancel01Icon}
							strokeWidth={2}
							className="size-4"
						/>
					</button>
				)
				if (touch) {
					return (
						<div
							key={item._key}
							className="space-y-2 rounded-lg border border-border bg-card p-2"
						>
							<div className="flex items-center gap-2">
								{picker}
								{removeButton}
							</div>
							<div className="flex items-center justify-between gap-2">
								<div className="min-w-0 text-xs text-muted-foreground">
									{estimatedMap && (
										<p>
											{listedLabel ?? t("material_line_items.listed")}:{" "}
											<b className="text-foreground">
												{listedQty !== undefined
													? `${listedQty}${code?.unit ? ` ${code.unit}` : ""}`
													: "—"}
											</b>
										</p>
									)}
									{tags && overListed && listedQty !== undefined && (
										<span className="mt-1 inline-block rounded bg-status-warn-soft px-2 py-0.5 font-medium text-status-warn">
											+{item.qty - listedQty}{" "}
											{t("material_line_items.more_than_estimated")}
										</span>
									)}
									{tags && addedAtCounter && (
										<span className="mt-1 inline-block rounded bg-status-info-soft px-2 py-0.5 font-medium text-status-info">
											{t("material_line_items.added_at_counter")}
										</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									<QtyStepper
										value={item.qty}
										min={1}
										max={capToListed ? listedQty : undefined}
										onChange={(qty) => updateItem(item._key, { qty })}
										label={
											code?.name ?? t("material_line_items.select_placeholder")
										}
										invalid={overListed}
									/>
									{code?.unit && (
										<span className="w-9 text-xs font-medium text-muted-foreground">
											{code.unit}
										</span>
									)}
								</div>
							</div>
						</div>
					)
				}
				return (
					<div key={item._key} className="flex items-center gap-2">
						{picker}
						<Input
							type="number"
							min={1}
							value={item.qty}
							onChange={(e) =>
								updateItem(item._key, {
									qty: parseInt(e.target.value, 10) || 1,
								})
							}
							className="w-20"
						/>
						{code?.unit && (
							<span className="text-xs text-muted-foreground">{code.unit}</span>
						)}
						{removeButton}
					</div>
				)
			})}
			{!readOnly && (
				<Button
					type="button"
					variant="outline"
					size={touch ? "lg" : "sm"}
					className={touch ? "h-11 w-full text-base" : undefined}
					onClick={addItem}
				>
					{t("material_line_items.add_material")}
				</Button>
			)}
		</div>
	)
}
