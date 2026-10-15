import type { ComponentProps } from "react"
import type { DashboardView } from "~/components/dashboard-view"

export type DashboardViewProps = ComponentProps<typeof DashboardView>

export type CrewOnlyKeys =
	| "crewPreppedDocs"
	| "crewInFieldDocs"
	| "crewSentBackDocs"
	| "crewSubmittedDocs"

export type WarehouseOnlyKeys =
	| "warehouseToPrepDocs"
	| "warehouseCounts"
	| "warehouseTriageCount"

export type BaseDashboardProps = Omit<
	DashboardViewProps,
	CrewOnlyKeys | WarehouseOnlyKeys
>
