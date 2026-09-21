import {
	Alert02Icon,
	Calendar03Icon,
	CancelCircleIcon,
	CheckmarkCircle02Icon,
	CircleDashedIcon,
	DeliveryTruck02Icon,
	PauseIcon,
	Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "~/lib/utils"

const JOB_STATUS = {
	unassigned: {
		label: "Unassigned",
		icon: CircleDashedIcon,
		text: "text-job-unassigned-text",
		bg: "bg-job-unassigned-bg",
	},
	scheduled: {
		label: "Scheduled",
		icon: Calendar03Icon,
		text: "text-job-scheduled-text",
		bg: "bg-job-scheduled-bg",
	},
	dispatched: {
		label: "Dispatched",
		icon: DeliveryTruck02Icon,
		text: "text-job-dispatched-text",
		bg: "bg-job-dispatched-bg",
	},
	progress: {
		label: "In progress",
		icon: Wrench01Icon,
		text: "text-job-progress-text",
		bg: "bg-job-progress-bg",
	},
	hold: {
		label: "On hold",
		icon: PauseIcon,
		text: "text-job-hold-text",
		bg: "bg-job-hold-bg",
	},
	completed: {
		label: "Completed",
		icon: CheckmarkCircle02Icon,
		text: "text-job-completed-text",
		bg: "bg-job-completed-bg",
	},
	overdue: {
		label: "Overdue",
		icon: Alert02Icon,
		text: "text-job-overdue-text",
		bg: "bg-job-overdue-bg",
	},
	cancelled: {
		label: "Cancelled",
		icon: CancelCircleIcon,
		text: "text-job-cancelled-text",
		bg: "bg-job-cancelled-bg",
	},
} as const

type JobStatus = keyof typeof JOB_STATUS

function JobStatusChip({
	status,
	label,
	className,
}: {
	status: JobStatus
	label?: string
	className?: string
}) {
	const config = JOB_STATUS[status]
	return (
		<span
			data-slot="job-status-chip"
			data-status={status}
			className={cn(
				"inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-semibold",
				config.bg,
				config.text,
				className,
			)}
		>
			<HugeiconsIcon
				icon={config.icon}
				strokeWidth={2}
				className="size-3.5 shrink-0"
			/>
			<span className={cn(status === "cancelled" && "line-through")}>
				{label ?? config.label}
			</span>
		</span>
	)
}

export type { JobStatus }
export { JOB_STATUS, JobStatusChip }
