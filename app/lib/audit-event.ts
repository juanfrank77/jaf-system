export const AUDIT_ACTION_TITLE_KEYS = {
	CREATED: "admin_history.action.CREATED",
	STATUS_CHANGED: "admin_history.action.STATUS_CHANGED",
	SEND_BACK: "admin_history.action.SEND_BACK",
	WORK_ORDER_EDITED: "admin_history.action.WORK_ORDER_EDITED",
	AVISO_NUMBER_SET: "admin_history.action.AVISO_NUMBER_SET",
	CREW_REASSIGNED: "admin_history.action.CREW_REASSIGNED",
	DOC_CANCELLED: "admin_history.action.DOC_CANCELLED",
	JAF_INVOICE_GENERATED: "admin_history.action.JAF_INVOICE_GENERATED",
	MISSING_RESOLVED: "admin_history.action.MISSING_RESOLVED",
	RECEIVABLE_CLOSED: "admin_history.action.RECEIVABLE_CLOSED",
	QUANTITY_DISCREPANCY: "admin_history.action.QUANTITY_DISCREPANCY",
	PRECERT_GENERATED: "admin_history.action.PRECERT_GENERATED",
	PRECERT_QTY_EDITED: "admin_history.action.PRECERT_QTY_EDITED",
	PRECERT_SIGNED: "admin_history.action.PRECERT_SIGNED",
	RELEASED_TO_FINANCE: "admin_history.action.RELEASED_TO_FINANCE",
	AVISO_CAPTURED: "admin_history.action.AVISO_CAPTURED",
	FINANCE_VERIFIED: "admin_history.action.FINANCE_VERIFIED",
	FINANCE_SEND_BACK: "admin_history.action.FINANCE_SEND_BACK",
	PO_RECORDED: "admin_history.action.PO_RECORDED",
	FINAL_CLARO_DOC_GENERATED: "admin_history.action.FINAL_CLARO_DOC_GENERATED",
	PBCC_REQUEST_GENERATED: "admin_history.action.PBCC_REQUEST_GENERATED",
	MATERIAL_OVERAGE: "admin_history.action.MATERIAL_OVERAGE",
	RETURNS_LOGGED: "admin_history.action.RETURNS_LOGGED",
	PREP_SAVED: "admin_history.action.PREP_SAVED",
	RESTOCK_APPROVED: "admin_history.action.RESTOCK_APPROVED",
	RESTOCK_DENIED: "admin_history.action.RESTOCK_DENIED",
	VAN_ASSIGNMENT_CHANGED: "admin_history.action.VAN_ASSIGNMENT_CHANGED",
	CREW_PAYMENT_RECORDED: "admin_history.action.CREW_PAYMENT_RECORDED",
	ADVANCE_RECEIVED: "admin_history.action.ADVANCE_RECEIVED",
	FINAL_PAYMENT_RECEIVED: "admin_history.action.FINAL_PAYMENT_RECEIVED",
	INTERNAL_EMAIL_ATTEMPT: "admin_history.action.INTERNAL_EMAIL_ATTEMPT",
} as const

export type AuditActionTitleKey =
	(typeof AUDIT_ACTION_TITLE_KEYS)[keyof typeof AUDIT_ACTION_TITLE_KEYS]

export type AuditEventContext = {
	t: (key: string, options?: Record<string, unknown>) => string
	statusLabel: (status: string | null | undefined) => string
	nameOf: (id: string) => string
	formatMoney: (amount: unknown) => string
}

export type AuditEventDescription = {
	titleKey: AuditActionTitleKey | "admin_history.action.unknown"
	titleValues?: Record<string, string>
	detail?: string
	items?: string[]
}

export function humanizeAction(action: string): string {
	return action
		.split("_")
		.filter(Boolean)
		.map((part) => part.charAt(0) + part.slice(1).toLowerCase())
		.join(" ")
}

export function auditActionTitleKey(
	action: string,
): AuditActionTitleKey | "admin_history.action.unknown" {
	return (
		AUDIT_ACTION_TITLE_KEYS[action as keyof typeof AUDIT_ACTION_TITLE_KEYS] ??
		"admin_history.action.unknown"
	)
}

export function describeAuditEvent(
	action: string,
	diffJson: unknown,
	ctx: AuditEventContext,
): AuditEventDescription {
	const diff = asObject(diffJson)
	const titleKey = auditActionTitleKey(action)
	const description: AuditEventDescription = {
		titleKey,
		...(titleKey === "admin_history.action.unknown"
			? { titleValues: { action: humanizeAction(action) } }
			: {}),
	}

	switch (action) {
		case "CREATED": {
			const items = serviceLineItems(diff.serviceLines, ctx.t)
			return items.length > 0 ? { ...description, items } : description
		}
		case "STATUS_CHANGED": {
			const status = asObject(diff.status)
			return {
				...description,
				detail: ctx.t("admin_history.detail.status_changed", {
					before: ctx.statusLabel(asString(status.before)),
					after: ctx.statusLabel(asString(status.after)),
				}),
			}
		}
		case "SEND_BACK":
		case "FINANCE_SEND_BACK":
			return withOptionalNote(
				description,
				asString(diff.note) ?? asString(diff.reason),
				ctx,
				diff.from || diff.to
					? ctx.t("admin_history.detail.send_back", {
							from: ctx.statusLabel(
								asString(diff.from) ?? asString(diff.fromStatus),
							),
							to: ctx.statusLabel(asString(diff.to) ?? asString(diff.toStatus)),
						})
					: undefined,
			)
		case "WORK_ORDER_EDITED":
			return {
				...description,
				detail: diff.materialsChanged
					? ctx.t("admin_history.detail.work_order_edited_materials")
					: ctx.t("admin_history.detail.work_order_edited"),
			}
		case "AVISO_NUMBER_SET":
		case "AVISO_CAPTURED":
			return {
				...description,
				detail: ctx.t("admin_history.detail.aviso_number", {
					avisoNumber: asString(diff.avisoNumber) || "—",
				}),
			}
		case "CREW_REASSIGNED":
			return {
				...description,
				detail: ctx.t("admin_history.detail.crew_reassigned", {
					names: nameList(diff.to, ctx.nameOf),
				}),
			}
		case "DOC_CANCELLED":
			return withOptionalNote(
				description,
				asString(diff.reason) ?? asString(diff.note),
				ctx,
			)
		case "JAF_INVOICE_GENERATED":
			return {
				...description,
				detail:
					diff.lineTotal != null
						? ctx.t("admin_history.detail.amount", {
								amount: ctx.formatMoney(diff.lineTotal),
							})
						: undefined,
			}
		case "MISSING_RESOLVED":
			return withOptionalNote(description, asString(diff.note), ctx)
		case "QUANTITY_DISCREPANCY":
			return {
				...description,
				detail: ctx.t("admin_history.detail.discrepancy_count", {
					count: arrayLength(diff.discrepancies),
				}),
				...(asString(diff.note)
					? { items: [asString(diff.note) as string] }
					: {}),
			}
		case "PRECERT_GENERATED":
			return {
				...description,
				detail:
					diff.version != null
						? ctx.t("admin_history.detail.version", {
								version: String(diff.version),
							})
						: undefined,
			}
		case "PRECERT_QTY_EDITED":
			return withOptionalNote(
				description,
				asString(diff.reason),
				ctx,
				diff.certifiedQty != null
					? ctx.t("admin_history.detail.certified_qty", {
							qty: String(diff.certifiedQty),
						})
					: undefined,
			)
		case "PRECERT_SIGNED":
			return {
				...description,
				detail: asString(diff.role)
					? ctx.t("admin_history.detail.signed_as", {
							role: asString(diff.role),
						})
					: undefined,
			}
		case "PO_RECORDED":
			return {
				...description,
				detail: asString(diff.poNumber)
					? ctx.t("admin_history.detail.po_number", {
							poNumber: asString(diff.poNumber),
						})
					: undefined,
			}
		case "MATERIAL_OVERAGE":
			return {
				...description,
				detail: ctx.t("admin_history.detail.overage_count", {
					count: arrayLength(diff.overages),
				}),
			}
		case "RETURNS_LOGGED":
			return {
				...description,
				detail: diff.shortage
					? ctx.t("admin_history.detail.returns_shortage")
					: ctx.t("admin_history.detail.returns_logged"),
			}
		case "PREP_SAVED":
			return {
				...description,
				detail: diff.missing
					? ctx.t("admin_history.detail.prep_missing")
					: ctx.t("admin_history.detail.prep_saved"),
			}
		case "CREW_PAYMENT_RECORDED":
		case "ADVANCE_RECEIVED":
		case "FINAL_PAYMENT_RECEIVED":
			return withOptionalNote(
				description,
				asString(diff.note),
				ctx,
				diff.amount != null
					? ctx.t("admin_history.detail.amount", {
							amount: ctx.formatMoney(diff.amount),
						})
					: undefined,
			)
		case "INTERNAL_EMAIL_ATTEMPT":
			return {
				...description,
				detail: ctx.t("admin_history.detail.email_attempt", {
					outcome: asString(diff.outcome) || "—",
					subject: asString(diff.subject) || "—",
				}),
			}
		default:
			return description
	}
}

function withOptionalNote(
	description: AuditEventDescription,
	note: string | undefined,
	ctx: AuditEventContext,
	base?: string,
): AuditEventDescription {
	const parts = [
		base,
		note ? ctx.t("admin_history.detail.note", { note }) : undefined,
	]
		.filter(Boolean)
		.join(" ")
	return parts ? { ...description, detail: parts } : description
}

function serviceLineItems(value: unknown, t: AuditEventContext["t"]): string[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((raw) => {
		if (!raw || typeof raw !== "object") return []
		const line = raw as Record<string, unknown>
		const name =
			asString(line.name) || t("admin_history.detail.unnamed_service")
		const qty = Number(line.qty)
		const code = asString(line.claroCode)
		if (!Number.isFinite(qty)) return []
		return [
			code
				? t("admin_history.detail.service_line", { code, name, qty })
				: t("admin_history.detail.service_line_no_code", { name, qty }),
		]
	})
}

function nameList(value: unknown, nameOf: (id: string) => string): string {
	if (!Array.isArray(value) || value.length === 0) return "—"
	return value
		.map((id) => (typeof id === "string" && id ? nameOf(id) : String(id)))
		.join(", ")
}

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function asObject(value: unknown): Record<string, unknown> {
	if (typeof value === "string") {
		try {
			return asObject(JSON.parse(value))
		} catch {
			return {}
		}
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return {}
}
