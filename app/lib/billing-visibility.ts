// Crew and installers see the job, never what it bills or pays. The fields are
// blanked in the loader so they are not sent to those roles at all.
const FIELD_ROLES = new Set(["CREW", "INSTALLER"])

export const canSeeBilling = (role: string): boolean => !FIELD_ROLES.has(role)

const BILLING_FIELDS = [
	"avisoNumber",
	"avisoDocPath",
	"avisoLines",
	"avisoLineTotal",
	"avisoMatchedAt",
	"claroPdfPath",
	"claroNotes",
	"claroUploadedAt",
	"lcRequestPdfPath",
	"lcGeneratedAt",
	"financeVerifiedAt",
	"financeSendBackNotes",
	"pbccRequestPdfPath",
	"pbccRequestSentAt",
	"karmenCopySentAt",
	"finalClaroDocPath",
	"finalClaroUploadedAt",
	"advanceReceivedAt",
	"advanceAmount",
	"finalPaymentReceivedAt",
	"finalPaymentAmount",
	"receivableClosedAt",
	"jafInvoicePdfPath",
	"jafInvoiceGeneratedAt",
	"jafInvoiceLines",
	"jafInvoiceLineTotal",
	"contractorAccountCode",
	"contractorAccountId",
	"contractorShareLines",
	"releasedToFinanceAt",
	"payablesClosedAt",
	"grossPayable",
	"retentionAmount",
	"netPayable",
	"payrollRunId",
] as const

/** Same shape, billing fields set to null, for roles that must not see them. */
export function hideBilling<T extends object>(doc: T, role: string): T {
	if (canSeeBilling(role)) return doc
	return {
		...doc,
		...Object.fromEntries(BILLING_FIELDS.map((f) => [f, null])),
	} as T
}
