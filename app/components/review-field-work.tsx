import { useTranslation } from "react-i18next"
import { Badge } from "~/components/ui/badge"
import { Card, CardContent, CardHeader } from "~/components/ui/card"

export type ReviewPhoto = {
	id: string
	basename: string
	tag: "BEFORE" | "DURING" | "AFTER" | null
	takenAt: string
}

const timeFmt = new Intl.DateTimeFormat(undefined, {
	dateStyle: "short",
	timeStyle: "short",
})

export function PhotosCard({
	docId,
	photos,
}: {
	docId: string
	photos: ReviewPhoto[]
}) {
	const { t } = useTranslation()
	if (photos.length === 0) return null
	return (
		<Card>
			<CardHeader>
				{t("docs_review.job_photos", { count: photos.length })}
			</CardHeader>
			<CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{photos.map((p) => (
					<a
						key={p.id}
						href={`/files/photos/${docId}/${p.basename}`}
						target="_blank"
						rel="noreferrer"
						className="space-y-1"
					>
						<img
							src={`/files/photos/${docId}/${p.basename}`}
							alt={t("docs_review.job_site_alt")}
							className="h-28 w-full rounded-lg border border-border object-cover"
						/>
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							{p.tag ? (
								<Badge
									variant={
										p.tag === "BEFORE"
											? "info"
											: p.tag === "DURING"
												? "warn"
												: "ok"
									}
								>
									{t(`docs_review.photo_tag_${p.tag}`)}
								</Badge>
							) : (
								<span />
							)}
							<span>{timeFmt.format(new Date(p.takenAt))}</span>
						</div>
					</a>
				))}
			</CardContent>
		</Card>
	)
}
