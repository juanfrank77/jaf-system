import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { cn } from "~/lib/utils"

/**
 * Guidance for the long forms (the supervisors are 60+ and have never done
 * data entry): the box to fill next glows and scrolls into view, a counter
 * names what is missing with a button to each, and Continue is never faded:
 * pressed with a gap it stays on the page, scrolls to the first missing box
 * and marks it with a red outline and "Fill this in".
 */
export type GuideField = {
	/** DOM id of the box (or of its wrapper) to scroll to and focus. */
	id: string
	/** What the counter calls it ("Before photos"). */
	label: string
	empty: boolean
	/** False for boxes that glow and guide but never block Continue. */
	blocking?: boolean
}

export type Guide = ReturnType<typeof useFormGuidance>

const SCROLL: ScrollIntoViewOptions = { block: "center", behavior: "smooth" }

export function scrollToBox(id: string | undefined, focus = true) {
	const el = id ? document.getElementById(id) : null
	if (!el) return
	el.scrollIntoView(SCROLL)
	if (!focus) return
	const box = el.matches("input, textarea, select, button")
		? el
		: el.querySelector<HTMLElement>("input, textarea, select, button")
	box?.focus({ preventScroll: true })
}

export function useFormGuidance(
	fields: GuideField[],
	/** `glow: false` keeps the hold-Continue marking but never lights the next box
	 * (a page with several separate forms would light one in each). */
	{ glow = true }: { glow?: boolean } = {},
) {
	const missing = fields.filter((f) => f.empty && f.blocking !== false)
	const next = fields.find((f) => f.empty)
	const [flagged, setFlagged] = useState<string | null>(null)

	// Once the flagged box is filled the red mark goes; a still-empty one stays.
	const flaggedField = fields.find((f) => f.id === flagged)
	const flaggedId = flaggedField?.empty ? flaggedField.id : undefined

	// When a box gets filled the light moves on, and the page follows it. Not
	// on the first render (the page just opened), and never while typing in
	// the box that is still being filled: it moves once that box has content.
	const lastNext = useRef<string | undefined>(glow ? next?.id : undefined)
	useEffect(() => {
		if (!glow) return
		if (lastNext.current !== undefined && next?.id !== lastNext.current)
			scrollToBox(next?.id, false)
		lastNext.current = next?.id
	}, [next?.id, glow])

	const jumpTo = useCallback((id: string | undefined) => {
		scrollToBox(id)
		if (id) setFlagged(id)
	}, [])

	/** Put on Continue's onClick: returns true when it was held back. */
	const holdContinue = useCallback(
		(e: { preventDefault: () => void }) => {
			const first = missing[0]
			if (!first) return false
			e.preventDefault()
			jumpTo(first.id)
			return true
		},
		[missing, jumpTo],
	)

	return {
		fields,
		missing,
		nextId: next?.id,
		flaggedId,
		jumpTo,
		holdContinue,
		stateOf: (id: string): "flagged" | "next" | undefined =>
			id === flaggedId
				? "flagged"
				: glow && id === next?.id
					? "next"
					: undefined,
	}
}

/** Wraps one box: the glow when it is next, the red outline and message when flagged. */
export function GuideBox({
	id,
	guide,
	className,
	children,
}: {
	id: string
	guide: Guide
	className?: string
	children: ReactNode
}) {
	const { t } = useTranslation()
	const state = guide.stateOf(id)
	return (
		<div
			id={id}
			data-guide={state}
			className={cn(
				className,
				state === "next" && "guide-next",
				state === "flagged" && "guide-flagged",
			)}
		>
			{children}
			{state === "flagged" && (
				<p role="alert" className="guide-message">
					{t("guidance.fill_this_in")}
				</p>
			)}
		</div>
	)
}

/** "2 boxes left", big, with each missing name a button that scrolls to it. */
export function GuideCounter({ guide }: { guide: Guide }) {
	const { t } = useTranslation()
	if (guide.missing.length === 0) return null
	return (
		<div data-testid="guide-counter" className="space-y-1">
			<p className="text-base font-semibold text-foreground md:text-lg">
				{t("guidance.boxes_left", { count: guide.missing.length })}
			</p>
			<ul className="flex flex-wrap gap-2">
				{guide.missing.map((m) => (
					<li key={m.id}>
						<button
							type="button"
							onClick={() => guide.jumpTo(m.id)}
							className="min-h-11 rounded-full border-2 border-status-warn bg-status-warn-soft px-4 text-sm font-medium text-foreground hover:bg-status-warn/20"
						>
							{m.label}
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}

/** A native box the adapter reads from the form, or one the page already knows about. */
export type NativeGuideSpec = {
	id: string
	label: string
	/** Read the form's inputs with this name; empty when none has text. */
	name?: string
	/** For state-held controls (pickers, radios): the page says. Wins over `name`. */
	empty?: boolean
	blocking?: boolean
}

/**
 * The same guidance for a plain `<form>` of uncontrolled inputs: it reads the
 * values from the form itself and re-reads on every change (typing, picking,
 * and the hidden inputs a picker adds), so the page keeps no copy of them.
 * Before it mounts every native box counts as empty, which is what the server
 * rendered.
 */
export function useNativeGuidance(
	formRef: RefObject<HTMLFormElement | null>,
	specs: NativeGuideSpec[],
) {
	const [, bump] = useState(0)
	const [ready, setReady] = useState(false)
	useEffect(() => {
		const form = formRef.current
		if (!form) return
		setReady(true)
		const rerun = () => bump((n) => n + 1)
		form.addEventListener("input", rerun)
		form.addEventListener("change", rerun)
		const watcher = new MutationObserver(rerun)
		watcher.observe(form, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["value"],
		})
		return () => {
			form.removeEventListener("input", rerun)
			form.removeEventListener("change", rerun)
			watcher.disconnect()
		}
	}, [formRef])

	const nativeEmpty = (name: string) => {
		const form = formRef.current
		if (!ready || !form) return true
		return Array.from(
			form.querySelectorAll<HTMLInputElement>(`[name="${name}"]`),
		).every((el) => el.value.trim() === "")
	}
	return useFormGuidance(
		specs.map((spec) => ({
			id: spec.id,
			label: spec.label,
			blocking: spec.blocking,
			empty: spec.empty ?? (spec.name ? nativeEmpty(spec.name) : true),
		})),
	)
}
