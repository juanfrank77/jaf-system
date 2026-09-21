import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { clampUsedToTook } from "~/lib/field-update-helpers"
import { toNumberPrice } from "~/lib/utils"

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
	unitPrice: number
}

interface Props {
	serviceCodes: ServiceCode[]
	initialItems?: LineItem[]
	readOnly?: boolean
	name?: string
	onChange?: (items: LineItem[]) => void
	/** Per-code ceiling (Used ≤ Took). */
	qtyMaxByServiceCodeId?: Record<string, number>
	onQtyClamped?: (
		serviceCodeId: string,
		attempted: number,
		clampedTo: number,
	) => void
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
	onChange,
	qtyMaxByServiceCodeId,
	onQtyClamped,
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
	const available = serviceCodes.filter((c) => !used.has(c.id))

	const serialized: LineItem[] = items.map(({ serviceCodeId, qty }) => ({
		serviceCodeId,
		qty,
	}))

	// biome-ignore lint/correctness/useExhaustiveDependencies: onChange is an optional reporting callback, not a reactive dependency
	useEffect(() => {
		onChange?.(serialized)
	}, [items])

	return (
		<div className="space-y-2">
			<input type="hidden" name={name} value={JSON.stringify(serialized)} />
			{items.map((item) => {
				const code = serviceCodes.find((c) => c.id === item.serviceCodeId)
				const dropdownItems = buildDropdownItems(available, code)
				if (readOnly) {
					return (
						<div
							key={item._key}
							className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-1.5 text-sm last:border-0"
						>
							<span className="font-mono text-xs text-muted-foreground">
								{code?.claroCode}
							</span>
							<span className="min-w-0 flex-1">{code?.name ?? "—"}</span>
							<span className="w-16 shrink-0 text-right">
								{item.qty} {code?.unit}
							</span>
							<span className="w-20 shrink-0 text-right">
								${(toNumberPrice(code?.unitPrice) * item.qty).toFixed(2)}
							</span>
						</div>
					)
				}
				return (
					<div key={item._key} className="flex flex-wrap items-center gap-2">
						<Select
							value={item.serviceCodeId || undefined}
							onValueChange={(v) =>
								updateItem(item._key, { serviceCodeId: v ?? "" })
							}
						>
							<SelectTrigger className="min-w-0 flex-1">
								<SelectValue
									placeholder={t("material_line_items.select_placeholder")}
								/>
							</SelectTrigger>
							<SelectContent>
								{dropdownItems.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Input
							type="number"
							min={1}
							value={item.qty}
							onChange={(e) => {
								const attempted = Number.parseInt(e.target.value, 10) || 0
								const max = qtyMaxByServiceCodeId?.[item.serviceCodeId]
								if (typeof max === "number") {
									const { qty, clamped } = clampUsedToTook(attempted, max)
									updateItem(item._key, { qty })
									if (clamped)
										onQtyClamped?.(item.serviceCodeId, attempted, qty)
									return
								}
								updateItem(item._key, { qty: attempted || 1 })
							}}
							className="w-20 shrink-0"
						/>
						<button
							type="button"
							onClick={() => removeItem(item._key)}
							className="shrink-0 text-slate-400 hover:text-red-600 text-lg"
						>
							×
						</button>
					</div>
				)
			})}
			{!readOnly && (
				<Button type="button" variant="outline" size="sm" onClick={addItem}>
					{t("material_line_items.add_service_code")}
				</Button>
			)}
		</div>
	)
}
