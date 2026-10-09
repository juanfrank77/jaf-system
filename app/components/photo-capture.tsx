import { Camera01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useEffect, useId, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export interface CapturedPhoto {
	id: string
	file: File
	/** When the shot was taken (the file's own timestamp when the camera set one). */
	takenAt: number
}

/**
 * One-shot camera capture for a group of photos (Before / After). Each shot is
 * appended to the group and shown as a thumbnail with its time and a remove
 * button. The parent owns the files and puts them in the form data on submit:
 * a bare `<input type="file" multiple capture>` replaces the previous pick on
 * Android and opens the library on iOS.
 */
export function PhotoCapture({
	photos,
	onChange,
	tag,
}: {
	photos: CapturedPhoto[]
	onChange: (photos: CapturedPhoto[]) => void
	/** Short uppercase label printed on each thumbnail, e.g. "BEFORE". */
	tag: string
}) {
	const { t } = useTranslation()
	const inputId = useId()
	const [urls, setUrls] = useState<Record<string, string>>({})
	const created = useRef<Record<string, string>>({})

	// Object URLs for the thumbnails; revoked when a photo goes away.
	useEffect(() => {
		const next: Record<string, string> = {}
		let changed = false
		for (const p of photos) {
			const existing = created.current[p.id]
			if (existing) {
				next[p.id] = existing
			} else {
				next[p.id] = URL.createObjectURL(p.file)
				changed = true
			}
		}
		for (const [id, url] of Object.entries(created.current)) {
			if (!next[id]) {
				URL.revokeObjectURL(url)
				changed = true
			}
		}
		created.current = next
		if (changed) setUrls(next)
	}, [photos])
	useEffect(
		() => () => {
			for (const url of Object.values(created.current)) URL.revokeObjectURL(url)
		},
		[],
	)

	function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
		const files = Array.from(e.target.files ?? [])
		e.target.value = ""
		if (files.length === 0) return
		const now = Date.now()
		onChange([
			...photos,
			...files.map((file) => ({
				id: crypto.randomUUID(),
				file,
				takenAt: file.lastModified > 0 ? file.lastModified : now,
			})),
		])
	}

	return (
		<div data-slot="photo-capture" className="flex flex-wrap gap-2">
			{photos.map((p) => (
				<div
					key={p.id}
					className="relative size-24 overflow-hidden rounded-lg border border-border bg-muted"
				>
					{urls[p.id] && (
						<img src={urls[p.id]} alt="" className="size-full object-cover" />
					)}
					<div className="absolute inset-x-0 bottom-0 bg-foreground/70 px-1.5 py-0.5 text-[10px] leading-tight text-background">
						<b className="block font-semibold">{tag}</b>
						{new Date(p.takenAt).toLocaleTimeString([], {
							hour: "numeric",
							minute: "2-digit",
						})}
					</div>
					<button
						type="button"
						aria-label={t("photo_capture.remove")}
						onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
						className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-foreground/70 text-background"
					>
						<HugeiconsIcon
							icon={Cancel01Icon}
							strokeWidth={2}
							className="size-4"
						/>
					</button>
				</div>
			))}
			<label
				htmlFor={inputId}
				className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-card text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
			>
				<HugeiconsIcon icon={Camera01Icon} strokeWidth={2} className="size-6" />
				{t("photo_capture.take")}
			</label>
			{/* No `name`: the parent adds the files to the request itself. */}
			<input
				id={inputId}
				type="file"
				accept="image/*"
				capture="environment"
				className="sr-only"
				onChange={handlePick}
			/>
		</div>
	)
}
