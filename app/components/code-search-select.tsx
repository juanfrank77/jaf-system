import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"

const MAX_ROWS = 50

export type CodeSearchItem = {
	id: string
	claroCode: string
	name: string
	unit?: string | null
}

/**
 * A type-to-search stand-in for a long `<select>` over catalog rows: type a
 * code or part of the name and the matches appear, tap one to pick it. Focus
 * lists everything (scrollable). It clears itself after a pick, so it works
 * as an "add" box; pass `selected` to keep the choice shown instead.
 */
export function CodeSearchSelect<T extends CodeSearchItem>({
	items,
	onPick,
	placeholder,
	label,
	selected,
	codeLast,
	inputClassName,
	onClear,
	autoFocus,
}: {
	items: T[]
	onPick: (item: T) => void
	placeholder: string
	/** Accessible name; defaults to the placeholder. */
	label?: string
	/** When set, the box shows this item instead of clearing after a pick. */
	selected?: T | null
	/** Name first, code (or an email) after it: for people, not catalog rows. */
	codeLast?: boolean
	/** Sizing for phone layouts (the touch rows use a taller box). */
	inputClassName?: string
	/** Shows a Clear button next to a kept choice, for optional fields. */
	onClear?: () => void
	autoFocus?: boolean
}) {
	const { t } = useTranslation()
	const [query, setQuery] = useState("")
	const [open, setOpen] = useState(false)

	const term = query.trim().toLowerCase()
	const matches = term
		? items.filter(
				(m) =>
					m.claroCode.toLowerCase().includes(term) ||
					m.name.toLowerCase().includes(term),
			)
		: items
	// A long catalog must never render in full: the old drop-downs froze the
	// browser on a big list. Show the first rows and ask for a narrower term.
	const visible = matches.slice(0, MAX_ROWS)
	const shown =
		selected && !open
			? codeLast
				? `${selected.name} · ${selected.claroCode}`
				: `${selected.claroCode} · ${selected.name}`
			: query

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<Input
					type="search"
					className={inputClassName}
					value={shown}
					autoFocus={autoFocus}
					onChange={(e) => {
						setQuery(e.target.value)
						setOpen(true)
					}}
					onFocus={() => setOpen(true)}
					onClick={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setOpen(false)
						// Inside a form, Enter must not submit; it picks a lone match.
						if (e.key === "Enter") {
							e.preventDefault()
							if (matches.length === 1) {
								onPick(matches[0])
								setQuery("")
								setOpen(false)
							}
						}
					}}
					placeholder={placeholder}
					aria-label={label ?? placeholder}
				/>
				{selected && onClear && (
					<Button type="button" variant="ghost" size="sm" onClick={onClear}>
						{t("code_search.clear")}
					</Button>
				)}
			</div>
			{open && (
				// biome-ignore lint/a11y/noStaticElementInteractions: keeps focus in the search field while the list (or its scrollbar) is pressed, so the blur handler doesn't close it before the click lands
				<div
					onMouseDown={(e) => e.preventDefault()}
					className="max-h-64 overflow-y-auto rounded-lg border bg-card text-sm"
				>
					{matches.length === 0 ? (
						<p className="p-2 text-muted-foreground">
							{t("material_picker.no_results")}
						</p>
					) : (
						<ul>
							{visible.map((m) => (
								<li key={m.id}>
									<button
										type="button"
										onClick={() => {
											onPick(m)
											setQuery("")
											setOpen(false)
										}}
										className="flex w-full items-center gap-3 px-2 py-1.5 text-left hover:bg-muted"
									>
										<span
											className={`font-mono text-xs text-muted-foreground ${codeLast ? "order-2" : ""}`}
										>
											{m.claroCode}
										</span>
										<span className="flex-1">{m.name}</span>
										{m.unit && (
											<span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
												{m.unit}
											</span>
										)}
									</button>
								</li>
							))}
						</ul>
					)}
					{matches.length > MAX_ROWS && (
						<p className="border-t p-2 text-xs text-muted-foreground">
							{t("code_search.more", {
								shown: MAX_ROWS,
								total: matches.length,
							})}
						</p>
					)}
				</div>
			)}
		</div>
	)
}
