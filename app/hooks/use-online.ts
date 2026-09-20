import { useEffect, useState } from "react"

export function useOnline(): boolean {
	// Always start at `true` on both server and the first client render, so
	// hydration never has to reconcile a server/client mismatch here. Node
	// 21+ exposes a global `navigator` without `.onLine`, which made the old
	// `typeof navigator !== "undefined" ? navigator.onLine : true` check
	// evaluate to `undefined` during SSR and mismatch the real browser value
	// on every single page load.
	const [online, setOnline] = useState(true)

	useEffect(() => {
		setOnline(navigator.onLine)
		const handleOnline = () => setOnline(true)
		const handleOffline = () => setOnline(false)
		window.addEventListener("online", handleOnline)
		window.addEventListener("offline", handleOffline)
		return () => {
			window.removeEventListener("online", handleOnline)
			window.removeEventListener("offline", handleOffline)
		}
	}, [])

	return online
}
