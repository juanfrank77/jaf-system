import { useEffect, useRef } from "react"
import { useRevalidator } from "react-router"

/** Reload the page's data every `ms` while `active`, the tab is visible and
 * nothing else is loading: for POs still being read. */
export function useAutoRevalidate(active: boolean, ms = 5000) {
	const { revalidate, state } = useRevalidator()
	const stateRef = useRef(state)
	stateRef.current = state
	useEffect(() => {
		if (!active) return
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible" && stateRef.current === "idle")
				revalidate()
		}, ms)
		return () => window.clearInterval(id)
	}, [active, ms, revalidate])
}
