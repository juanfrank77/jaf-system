import { FilterIcon, RemoveIcon, SearchIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"

export type CrewOption = { id: string; name: string }

export type JobTypeOption = string

type StatusLabelKey =
	| "dashboard.filter.status_all"
	| "docs_status.created"
	| "docs_status.prepped"
	| "docs_status.signed"
	| "docs_status.field_updated"
	| "docs_status.supervisor_approved"
	| "docs_status.claro_uploaded"
	| "docs_status.lc_request_generated"
	| "docs_status.cancelled"

const STATUS_OPTIONS: { value: string; labelKey: StatusLabelKey }[] = [
	{ value: "", labelKey: "dashboard.filter.status_all" },
	{ value: "CREATED", labelKey: "docs_status.created" },
	{ value: "PREPPED", labelKey: "docs_status.prepped" },
	{ value: "SIGNED", labelKey: "docs_status.signed" },
	{ value: "FIELD_UPDATED", labelKey: "docs_status.field_updated" },
	{ value: "SUPERVISOR_APPROVED", labelKey: "docs_status.supervisor_approved" },
	{ value: "CLARO_UPLOADED", labelKey: "docs_status.claro_uploaded" },
	{
		value: "LC_REQUEST_GENERATED",
		labelKey: "docs_status.lc_request_generated",
	},
	{ value: "CANCELLED", labelKey: "docs_status.cancelled" },
]

type FilterState = {
	selectedStatus?: string | null
	selectedCrew?: string | null
	selectedJobType?: string | null
	searchFilter?: string
}

export function hasActiveFilters({
	selectedStatus,
	selectedCrew,
	selectedJobType,
	searchFilter,
}: FilterState) {
	return (
		!!selectedStatus || !!selectedCrew || !!selectedJobType || !!searchFilter
	)
}

export function ClearFiltersButton() {
	const { t } = useTranslation()
	const location = useLocation()
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={() => {
				window.location.href = location.pathname
			}}
			className="text-xs"
		>
			<HugeiconsIcon
				icon={RemoveIcon}
				strokeWidth={2}
				className="size-3 mr-1"
			/>
			{t("dashboard.filter.clear_all")}
		</Button>
	)
}

export function DashboardFilters({
	crewOptions = [],
	jobTypeOptions = [],
	selectedStatus = null,
	selectedCrew = null,
	selectedJobType = null,
	searchFilter = "",
}: FilterState & {
	crewOptions?: CrewOption[]
	jobTypeOptions?: JobTypeOption[]
}) {
	const { t } = useTranslation()
	const location = useLocation()
	return (
		<div className="bg-card border rounded-lg p-3 space-y-3">
			<div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
				<HugeiconsIcon icon={FilterIcon} strokeWidth={2} className="size-4" />
				{t("dashboard.filter.heading")}
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-4 items-end">
				<Select
					items={STATUS_OPTIONS.map((o) => ({
						value: o.value,
						label: t(o.labelKey),
					}))}
					value={selectedStatus || ""}
					onValueChange={(v) => {
						const params = new URLSearchParams(location.search)
						if (v) params.set("status", v)
						else params.delete("status")
						const query = params.toString()
						window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
					}}
				>
					<SelectTrigger className="w-full">
						<SelectValue
							placeholder={t("dashboard.filter.status_placeholder")}
						/>
					</SelectTrigger>
					<SelectContent>
						{STATUS_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{t(opt.labelKey)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					items={crewOptions.map((c) => ({ value: c.id, label: c.name }))}
					value={selectedCrew || ""}
					onValueChange={(v) => {
						const params = new URLSearchParams(location.search)
						if (v) params.set("crew", v)
						else params.delete("crew")
						const query = params.toString()
						window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
					}}
					disabled={crewOptions.length === 0}
				>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("dashboard.filter.crew_placeholder")} />
					</SelectTrigger>
					<SelectContent>
						{crewOptions.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{c.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					items={(jobTypeOptions || []).map((jt) => ({ value: jt, label: jt }))}
					value={selectedJobType || ""}
					onValueChange={(v) => {
						const params = new URLSearchParams(location.search)
						if (v) params.set("jobType", v)
						else params.delete("jobType")
						const query = params.toString()
						window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
					}}
					disabled={!(jobTypeOptions && jobTypeOptions.length > 0)}
				>
					<SelectTrigger className="w-full">
						<SelectValue
							placeholder={t("dashboard.filter.job_type_placeholder")}
						/>
					</SelectTrigger>
					<SelectContent>
						{(jobTypeOptions || []).map((jt) => (
							<SelectItem key={jt} value={jt}>
								{jt}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<form
					method="get"
					className="relative"
					onSubmit={(e) => {
						e.preventDefault()
						const formData = new FormData(e.currentTarget)
						const search = (formData.get("search") as string).trim()
						const params = new URLSearchParams(location.search)
						if (search) params.set("search", search)
						else params.delete("search")
						const query = params.toString()
						window.location.href = `${location.pathname}${query ? `?${query}` : ""}`
					}}
				>
					<HugeiconsIcon
						icon={SearchIcon}
						strokeWidth={2}
						className="absolute left-2.5 top-2.5 size-4 text-muted-foreground"
					/>
					<Input
						name="search"
						type="search"
						placeholder={t("dashboard.filter.search_placeholder")}
						defaultValue={searchFilter}
						className="pl-9"
					/>
				</form>
			</div>
		</div>
	)
}
