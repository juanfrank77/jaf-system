import { BrowserMultiFormatReader } from "@zxing/browser"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "./ui/button"

export async function decodeWithNative(
	video: HTMLVideoElement,
): Promise<string | null> {
	const D = (
		globalThis as unknown as {
			BarcodeDetector?: new (
				o?: unknown,
			) => {
				detect: (s: unknown) => Promise<{ rawValue: string }[]>
			}
		}
	).BarcodeDetector
	if (!D) return null
	const detector = new D({ formats: ["code_128", "code_39", "qr_code"] })
	const codes = await detector.detect(video).catch(() => [])
	return codes[0]?.rawValue ?? null
}

export function BarcodeScanner({
	onDecode,
	onGiveUp,
	maxAttempts = 2,
}: {
	onDecode: (text: string, frameDataUrl: string) => void
	onGiveUp: () => void
	maxAttempts?: number
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const [attempts, setAttempts] = useState(0)
	const { t } = useTranslation()

	useEffect(() => {
		const reader = new BrowserMultiFormatReader()
		let stop = false
		let controls: { stop: () => void } | undefined
		;(async () => {
			const video = videoRef.current
			if (!video) return
			const frame = () => {
				const canvas = document.createElement("canvas")
				canvas.width = video.videoWidth
				canvas.height = video.videoHeight
				canvas.getContext("2d")?.drawImage(video, 0, 0)
				return canvas.toDataURL("image/jpeg", 0.8)
			}
			try {
				const native = await decodeWithNative(video)
				if (native && !stop) {
					onDecode(native, frame())
					return
				}
				controls = await reader.decodeFromVideoDevice(
					undefined,
					video,
					(result) => {
						if (result && !stop) {
							stop = true
							onDecode(result.getText(), frame())
						}
					},
				)
			} catch {
				// No camera device, permission denied, or an unsupported browser.
				// The manual "Can't scan" button below still lets the flow continue.
			}
		})()
		return () => {
			stop = true
			controls?.stop()
		}
	}, [onDecode])

	return (
		<div className="space-y-2">
			{/* biome-ignore lint/a11y/useMediaCaption: live camera scan surface */}
			<video
				ref={videoRef}
				className="w-full rounded-lg bg-black"
				playsInline
			/>
			<Button
				type="button"
				variant="outline"
				size="lg"
				className="h-11 w-full text-base"
				onClick={() => {
					const next = attempts + 1
					setAttempts(next)
					if (next >= maxAttempts) onGiveUp()
				}}
			>
				{t("installer.scan.cant_scan")}
			</Button>
		</div>
	)
}
