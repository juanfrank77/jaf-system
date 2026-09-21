import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import {
	Box,
	DesignSystem,
	FlowStrip,
	Gate,
	Greet,
	Note,
	Tag,
} from "./primitives"

export function DsPage({
	backTo,
	backLabel,
	title,
	subtitle,
	step,
	you,
	note,
	children,
}: {
	backTo?: string
	backLabel?: ReactNode
	title: ReactNode
	subtitle?: ReactNode
	step?: number
	you?: number[]
	note?: ReactNode
	children: ReactNode
}) {
	return (
		<DesignSystem>
			{backTo ? (
				<Link to={backTo} className="jaf-back">
					← {backLabel}
				</Link>
			) : null}
			<Greet title={title} subtitle={subtitle} />
			{step ? <FlowStrip current={step} you={you} /> : null}
			{note}
			{children}
		</DesignSystem>
	)
}

export function WarehousePrepChrome({
	controlNumber,
	docId,
	missingCount,
	children,
}: {
	controlNumber: string
	docId: string
	missingCount: number
	children: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<DsPage
			backTo={`/docs/${docId}`}
			backLabel={t("docs_view.back_to_work_order")}
			title={t("docs_prep.title")}
			subtitle={controlNumber}
			step={2}
			you={[2]}
			note={
				missingCount > 0 ? (
					<Note>{t("ds.warehouse.flag_missing", { count: missingCount })}</Note>
				) : (
					<Note tone="ok">{t("ds.warehouse.prep_ok")}</Note>
				)
			}
		>
			<Box span={12}>{children}</Box>
		</DsPage>
	)
}

export function WarehousePickupChrome({
	controlNumber,
	docId,
	hasOverage,
	sigs,
	children,
}: {
	controlNumber: string
	docId: string
	hasOverage: boolean
	sigs: { warehouse: boolean; crew: boolean }
	children: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<DsPage
			backTo={`/docs/${docId}`}
			backLabel={t("docs_view.back_to_work_order")}
			title={t("docs_sign.title")}
			subtitle={controlNumber}
			step={3}
			you={[3]}
			note={hasOverage ? <Note>{t("ds.warehouse.over_pull")}</Note> : undefined}
		>
			<Box span={12}>
				{hasOverage ? (
					<p>
						<Tag tone="warn">{t("ds.warehouse.over_pull_chip")}</Tag>
					</p>
				) : null}
				<Gate
					items={[
						{
							id: "wh",
							ok: sigs.warehouse,
							label: t("ds.warehouse.gate_wh_sig"),
						},
						{
							id: "crew",
							ok: sigs.crew,
							label: t("ds.warehouse.gate_crew_sig"),
						},
					]}
				/>
				{children}
			</Box>
		</DsPage>
	)
}

export function WarehouseReturnsChrome({
	controlNumber,
	docId,
	outcomes,
	children,
}: {
	controlNumber: string
	docId: string
	outcomes: { short: number; over: number; exact: number }
	children: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<DsPage
			backTo={`/docs/${docId}`}
			backLabel={t("docs_view.back_to_work_order")}
			title={t("docs_returns.title")}
			subtitle={controlNumber}
			step={3}
			you={[2, 3]}
		>
			<div
				className="jaf-kpis jaf-k4"
				style={{ gridTemplateColumns: "repeat(3,1fr)" }}
			>
				<div className="jaf-kpi">
					<div>
						<div className="jaf-l">{t("ds.warehouse.short")}</div>
						<div className="jaf-v jaf-neg">{outcomes.short}</div>
					</div>
				</div>
				<div className="jaf-kpi">
					<div>
						<div className="jaf-l">{t("ds.warehouse.over")}</div>
						<div className="jaf-v jaf-warn">{outcomes.over}</div>
					</div>
				</div>
				<div className="jaf-kpi">
					<div>
						<div className="jaf-l">{t("ds.warehouse.exact")}</div>
						<div className="jaf-v jaf-good">{outcomes.exact}</div>
					</div>
				</div>
			</div>
			<Box span={12}>{children}</Box>
		</DsPage>
	)
}

export function CrewFieldChrome({
	controlNumber,
	docId,
	estimatedAddress,
	actualAddress,
	sendBackNote,
	photosOk,
	sigOk,
	children,
}: {
	controlNumber: string
	docId: string
	estimatedAddress: string
	actualAddress: string | null
	sendBackNote: string | null
	photosOk: boolean
	sigOk: boolean
	children: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<DsPage
			backTo={`/docs/${docId}`}
			backLabel={t("docs_view.back_to_work_order")}
			title={t("docs_field.title")}
			subtitle={controlNumber}
			step={4}
			you={[4]}
			note={
				sendBackNote ? (
					<Note tone="crit">
						{t("ds.crew.send_back", { note: sendBackNote })}
					</Note>
				) : undefined
			}
		>
			{actualAddress && actualAddress !== estimatedAddress ? (
				<div className="jaf-diff">
					<span className="jaf-old">{estimatedAddress}</span>{" "}
					<span className="jaf-new">{actualAddress}</span>
				</div>
			) : (
				<p className="jaf-sm">{estimatedAddress}</p>
			)}
			<Gate
				items={[
					{
						id: "photos",
						ok: photosOk ? true : "warn",
						label: t("ds.crew.gate_photos"),
					},
					{
						id: "sig",
						ok: sigOk ? true : "warn",
						label: t("ds.crew.gate_sig"),
					},
				]}
			/>
			<Box span={12}>{children}</Box>
		</DsPage>
	)
}

export function SupervisorReviewChrome({
	controlNumber,
	step,
	gateItems,
	claroNote,
	children,
}: {
	controlNumber: string
	step: number
	gateItems: { id: string; ok: boolean; label: string }[]
	claroNote?: string
	children: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<DsPage
			title={t("docs_review.title")}
			subtitle={controlNumber}
			step={step}
			you={[5, 6, 7, 8]}
		>
			<Box span={12}>
				<h2>{t("ds.supervisor.release_gate")}</h2>
				<Gate items={gateItems} />
				{claroNote ? <p className="jaf-note jaf-sm">{claroNote}</p> : null}
			</Box>
			{children}
		</DsPage>
	)
}
