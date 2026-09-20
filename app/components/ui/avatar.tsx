import { cn, initials } from "~/lib/utils"

function Avatar({
	name,
	src,
	className,
}: {
	name: string
	src?: string | null
	className?: string
}) {
	if (src) {
		return (
			<img
				src={src}
				alt=""
				className={cn("size-8 shrink-0 rounded-full object-cover", className)}
			/>
		)
	}
	return (
		<span
			className={cn(
				"flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground",
				className,
			)}
		>
			{initials(name)}
		</span>
	)
}

export { Avatar }
