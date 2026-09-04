import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
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
							className="flex items-center gap-3 text-sm py-1 border-b last:border-0"
						>
							<span className="font-mono text-xs text-slate-500">
								{code?.claroCode}
							</span>
							<span className="flex-1">{code?.name ?? "—"}</span>
							<span className="w-16 text-right">
								{item.qty} {code?.unit}
							</span>
							<span className="w-20 text-right">
								${(toNumberPrice(code?.unitPrice) * item.qty).toFixed(2)}
							</span>
						</div>
					)
				}
				return (
					<div key={item._key} className="flex items-center gap-2">
						<Select
							items={dropdownItems}
							value={item.serviceCodeId}
							onValueChange={(v) =>
								updateItem(item._key, { serviceCodeId: v ?? "" })
							}
						>
							<SelectTrigger className="flex-1">
								<SelectValue
									placeholder={t("material_line_items.select_placeholder")}
								/>
							</SelectTrigger>
							<SelectContent />
						</Select>
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
						<button
							type="button"
							onClick={() => removeItem(item._key)}
							className="text-slate-400 hover:text-red-600 text-lg"
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
