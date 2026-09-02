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
}

interface SignaturePadInstance {
	off(): void
	toDataURL(type?: string): string
	isEmpty(): boolean
	clear(): void
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
	function SignaturePad({ width = 400, height = 150, className }, ref) {
		const canvasRef = useRef<HTMLCanvasElement>(null)
		const padRef = useRef<SignaturePadInstance | null>(null)

		useEffect(() => {
			const canvas = canvasRef.current
			if (!canvas) return
			import("signature_pad").then(({ default: SP }) => {
				padRef.current = new SP(canvas, {
					backgroundColor: "rgb(255,255,255)",
					penColor: "rgb(0,0,0)",
				}) as SignaturePadInstance
			})
			return () => padRef.current?.off()
		}, [])

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
				className={`border rounded touch-none ${className ?? ""}`}
				style={{ touchAction: "none" }}
			/>
		)
	},
)
