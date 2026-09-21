import { Avatar } from "~/components/ui/avatar"
import { cn } from "~/lib/utils"

function AvatarStack({
	people,
	max = 4,
	className,
}: {
	people: { id: string; name: string; image?: string | null }[]
	max?: number
	className?: string
}) {
	const visible = people.slice(0, max)
	const overflow = people.length - visible.length

	return (
		<div className={cn("flex items-center -space-x-2", className)}>
			{visible.map((person) => (
				<Avatar
					key={person.id}
					name={person.name}
					src={person.image ? `/avatars/${person.id}` : null}
					className="ring-2 ring-card"
				/>
			))}
			{overflow > 0 && (
				<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground ring-2 ring-card">
					+{overflow}
				</span>
			)}
		</div>
	)
}

export { AvatarStack }
