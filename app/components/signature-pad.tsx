import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

export interface SignaturePadHandle {
	toDataURL(): string
	isEmpty(): boolean
	clear(): void
}

interface Props {
	width?: number
	height?: number
	className?: string
	ariaLabel?: string
	onEnd?: () => void
}

interface SignaturePadInstance {
	off(): void
	toDataURL(type?: string): string
	isEmpty(): boolean
	clear(): void
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
	function SignaturePad(
		{ width = 400, height = 150, className, ariaLabel, onEnd },
		ref,
	) {
		const canvasRef = useRef<HTMLCanvasElement>(null)
		const padRef = useRef<SignaturePadInstance | null>(null)

		useEffect(() => {
			const canvas = canvasRef.current
			if (!canvas) return
			let pad: SignaturePadInstance | null = null
			import("signature_pad").then(({ default: SP }) => {
				pad = new SP(canvas, {
					backgroundColor: "rgb(255, 255, 255)",
					penColor: "rgb(0, 0, 0)",
				}) as SignaturePadInstance
				padRef.current = pad
				if (onEnd) {
					canvas.addEventListener("pointerup", onEnd)
				}
			})
			return () => {
				pad?.off()
				if (onEnd) {
					canvas.removeEventListener("pointerup", onEnd)
				}
			}
		}, [onEnd])

		useImperativeHandle(ref, () => ({
			toDataURL: () => padRef.current?.toDataURL("image/png") ?? "",
			isEmpty: () => padRef.current?.isEmpty() ?? true,
			clear: () => padRef.current?.clear(),
		}))

		return (
			<canvas
				ref={canvasRef}
				width={width}
				height={height}
				role="img"
				aria-label={ariaLabel}
				className={`jaf-sigpad touch-none ${className ?? ""}`}
				style={{ touchAction: "none", width: "100%", maxWidth: width }}
			/>
		)
	},
)
