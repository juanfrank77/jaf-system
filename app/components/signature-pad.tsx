import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

export interface SignaturePadHandle {
	toDataURL(): string
	isEmpty(): boolean
	clear(): void
}

interface Props {
	/** Initial bitmap width only (SSR and the frame before measuring). The pad
	 * always stretches to its container, so it fits a 390 px phone. */
	width?: number
	height?: number
	className?: string
	/** Fires after every stroke and after `clear()`, with the new empty state. */
	onChange?: (isEmpty: boolean) => void
}

type PointGroup = unknown

interface SignaturePadInstance {
	off(): void
	toDataURL(type?: string): string
	isEmpty(): boolean
	clear(): void
	toData(): PointGroup[]
	fromData(groups: PointGroup[]): void
	addEventListener(type: "endStroke", listener: () => void): void
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
	function SignaturePad(
		{ width = 400, height = 150, className, onChange },
		ref,
	) {
		const canvasRef = useRef<HTMLCanvasElement>(null)
		const padRef = useRef<SignaturePadInstance | null>(null)
		const onChangeRef = useRef(onChange)
		onChangeRef.current = onChange

		useEffect(() => {
			const canvas = canvasRef.current
			if (!canvas) return
			let cancelled = false
			let observer: ResizeObserver | undefined

			// Match the bitmap to the laid-out size and the device pixel ratio so
			// strokes are sharp on 2-3x phone screens and the pad never overflows.
			// Existing strokes are redrawn: a resize or rotation must not wipe them.
			const syncSize = () => {
				const pad = padRef.current
				const ratio = Math.max(window.devicePixelRatio || 1, 1)
				const w = Math.round(canvas.offsetWidth * ratio)
				const h = Math.round(canvas.offsetHeight * ratio)
				if (!pad || !w || !h) return
				if (canvas.width === w && canvas.height === h) return
				const strokes = pad.toData()
				canvas.width = w
				canvas.height = h
				canvas.getContext("2d")?.scale(ratio, ratio)
				pad.clear()
				if (strokes.length > 0) pad.fromData(strokes)
			}

			import("signature_pad").then(({ default: SP }) => {
				if (cancelled) return
				const pad = new SP(canvas, {
					backgroundColor: "rgb(255,255,255)",
					penColor: "rgb(0,0,0)",
				}) as unknown as SignaturePadInstance
				pad.addEventListener("endStroke", () =>
					onChangeRef.current?.(pad.isEmpty()),
				)
				padRef.current = pad
				syncSize()
				if (typeof ResizeObserver !== "undefined") {
					observer = new ResizeObserver(syncSize)
					observer.observe(canvas)
				}
			})
			return () => {
				cancelled = true
				observer?.disconnect()
				padRef.current?.off()
			}
		}, [])

		useImperativeHandle(ref, () => ({
			toDataURL: () => padRef.current?.toDataURL("image/png") ?? "",
			isEmpty: () => padRef.current?.isEmpty() ?? true,
			clear: () => {
				padRef.current?.clear()
				onChangeRef.current?.(true)
			},
		}))

		return (
			<canvas
				ref={canvasRef}
				width={width}
				height={height}
				className={`block w-full max-w-full border rounded touch-none ${className ?? ""}`}
				style={{ touchAction: "none", height }}
			/>
		)
	},
)
