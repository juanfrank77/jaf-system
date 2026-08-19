# JAF Phase 2 PRD Compliance Audit

**Date:** 2026-08-15
**Scope:** JAF-Phase2.md vs recent commits (~last 10)
**Status:** Findings for later review; two additional gaps closed without schema changes

## Implementation Wave Tracker — 18 Aug 2026

This section is the implementation tracking baseline for the JAF Phase 2 review feedback from 17 Aug 2026. It supplements, and does not replace, the historical findings below. No implementation item in this tracker is marked complete.

### Authoritative Contract

| Area | Constraint / decision |
|---|---|
| Production database | Production is aligned with the local migrations/schema and all migrations are applied. Do not modify existing migrations or use destructive Prisma commands against production. |
| LC naming and visibility | Standardize terminology on `LC`. `LC_REQUEST_GENERATED` is the Finance step 3 status and is Finance-only in UI/projections. |
| LC enum migration | The `LC_GENERATED` → `LC_REQUEST_GENERATED` enum rename is approved as a new forward-only migration. Test it on Neon first, then pull/apply it on the remote production server against the current schema. |
| Aviso and Claro documents | Treat the Aviso and Claro work-order PDF as different documents for now. The second document remains optional pending confirmation. |
| Amount and quantity reconciliation | An amount mismatch hard-blocks when the absolute difference exceeds the configurable `$0.01` default tolerance. A quantity mismatch requires a note and audit entry but does not block. |
| PO reconciliation | A PO mismatch warns and is logged but never blocks. Store the actual received PO amount. |
| Shared signing and overages | `/sign` is intentionally shared by Warehouse and Crew. Signed quantities lock permanently. Material overages are allowed and notify the supervisor immediately without approval. |
| Comptroller and closure | Keep the Comptroller portal feature-flagged off rather than deleting it. Lissette records actual `PaymentRecord`s. Finance closure remains derived from `receivableClosedAt`, set by explicit Close after both payment records exist. |
| Installer controls and vans | Installer approval uses the existing Supervisor/Admin permission. Van assignment history uses append-only audit events unless schema approval later changes that approach. |

### Wave 0 — Contract and Safety Baseline

| Field | Tracking baseline |
|---|---|
| Status | Completed |
| Priority | P0 — prerequisite |
| Scope | Document the approved workflow decisions, migration safety policy, status/role visibility matrix, audit-event conventions, and JSON payload conventions before implementation begins. |
| Likely files/modules | `docs/phase2-audit.md`, `docs/JAF-Phase2.md`, `app/lib/permissions.ts`, `app/lib/permissions.server.ts`, existing audit/notification helpers, `AGENTS.md` |
| Schema impact | Schema-free documentation and verification baseline. No schema or migration changes. |
| Acceptance criteria | [x] The authoritative contract above is treated as the implementation baseline. [x] Every later wave identifies whether its work is schema-changing or schema-free. [x] Audit events have consistent actor, action, entity, before/after, and JSON payload conventions. [x] Migration and production-safety rules are recorded and followed. |
| Test/verification criteria | [x] Review the tracker against the 17 Aug feedback. [x] Verify status transitions, role visibility, terminal-stage rules, and JSON payload examples before coding. [x] Confirm no applied migration is edited and no destructive Prisma command is part of the rollout procedure. |

### Wave 1 — Status Rename, Authorization, Role Scoping, Comptroller Flag

| Field | Tracking baseline |
|---|---|
| Status | Completed |
| Priority | P0 — prerequisite |
| Scope | Apply the approved forward-only enum rename; standardize LC terminology; keep `LC_REQUEST_GENERATED` limited to Finance UI/projections; enforce document-stage-gated actions; preserve the Comptroller role and portal behind a feature flag. |
| Likely files/modules | `prisma/schema.prisma`, new `prisma/migrations/*` migration, `app/lib/permissions.ts`, `app/lib/permissions.server.ts`, `app/routes.ts`, `app/components/app-shell.tsx`, Finance and Comptroller route modules |
| Schema impact | Schema-changing: one forward-only enum migration `LC_GENERATED` → `LC_REQUEST_GENERATED`. Schema-free: role scoping, feature flag, terminal-stage gates, authorization checks. |
| Acceptance criteria | [x] No user-facing `LC_GENERATED` terminology remains where the new contract applies. [x] Finance can see and act on `LC_REQUEST_GENERATED`; Supervisor, Crew, and Warehouse projections cannot. [x] Terminal `CLOSED` jobs do not offer actions such as Verify. [x] Comptroller screens/routes are hidden when the flag is off, while the role and `PaymentRecord` model remain available. [x] Unauthorized direct requests are rejected server-side. |
| Test/verification criteria | [ ] Test the new enum migration on Neon first. [ ] Verify the local schema and production migration state before remote application. [x] Run transition and authorization tests for every affected role and terminal status. [x] Verify feature-flagged Comptroller routes are unavailable in UI and direct navigation when disabled. [x] Run `pnpm typecheck` and the affected test suite. |

### Wave 2 — Pickup and Material Truth, Reconciliation, Notifications

| Field | Tracking baseline |
|---|---|---|
| Status | Completed |
| Priority | P0 |
| Scope | Preserve the shared `/sign` flow for Warehouse and Crew while making each signer explicit; permanently lock submitted signed quantities; reconcile ordered, prepped, signed, installed, and returned quantities; allow overages without approval and notify the supervisor immediately. |
| Likely files/modules | `app/routes/_app.docs.$id_.sign.tsx`, `app/routes/_app.restock.$id_.pickup.tsx`, `app/routes/_app.docs.$id_.returns.tsx`, `app/routes/_app.docs.$id_.field.tsx`, `app/lib/field-update-helpers.ts`, `app/lib/field-sync.ts`, `app/lib/van-inventory.ts`, notification helpers, related dashboard components/tests |
| Schema impact | Schema-free. Uses existing `JafInvoice`, `AuditTrail`, `Notification`, and `VanInventoryTransaction` tables. |
| Acceptance criteria | [x] The shared signing screen identifies the Warehouse or Crew signer in each pane. [x] Submitted Taken Qty values are read-only everywhere and cannot be changed by later requests. [x] Ordered-versus-installed variance is informational. [x] Installed-versus-charged line quantity mismatch requires a note and discrepancy-register/audit entry but never blocks Finance. [x] Material overage is accepted, recorded, and immediately notifies the supervisor without an approval step. [x] Return and shortage records preserve the material truth and audit history. |
| Test/verification criteria | [x] Test both signer roles and attempts to edit signed quantities after submission. [x] Test normal quantities, overages, shortages, returns, resubmission, and offline/conflict paths. [x] Verify notification creation and supervisor targeting for overages. [x] Verify quantity discrepancies are logged without blocking the Finance transition. [x] Run route, inventory, sync, and dashboard tests plus `pnpm typecheck`. |

### Wave 3 — Aviso and PO Reconciliation

| Field | Tracking baseline |
|---|---|
| Status | Completed |
| Priority | P1 |
| Scope | Keep Aviso and Claro work-order PDFs distinct; support the currently optional second document; reconcile Aviso/JAF invoice amounts with configurable absolute tolerance; record PO amounts accurately and handle PO mismatches as non-blocking warnings. |
| Likely files/modules | `app/routes/_app.docs.$id_.review.tsx`, `app/routes/_app.docs.$id.tsx`, `app/routes/_app.docs.$id_.edit.tsx`, `app/routes/_app.finance.receivables.tsx`, `app/routes/_app.finance.pbcc.$id.tsx`, `app/lib/finance-pipeline.ts`, `app/lib/system-settings.server.ts`, `app/lib/pdf/claro-notice.server.tsx`, file upload/document helpers |
| Schema impact | Schema-free. Uses existing `JafInvoice`, `PoLink`, `PaymentRecord`, `AuditTrail`, `Notification`, and `SystemSetting` tables. Tolerance stored in `SystemSetting`. |
| Acceptance criteria | [x] Aviso number and Aviso document remain distinct from the Claro work-order PDF in UI, storage, and projections. [x] The second document is optional until the external confirmation is received. [x] Amount differences greater than the configured absolute tolerance, default `$0.01`, hard-block Finance. [x] Differences within tolerance do not block and are auditable. [x] PO mismatch creates a warning and audit log entry but never blocks progression. [x] The actual received PO amount is stored, not the expected or invoice amount. |
| Test/verification criteria | [x] Test amount differences below, equal to, and above `$0.01`, including configurable tolerance changes. [x] Test missing and present optional documents. [x] Test PO amount below, equal to, and above the JAF invoice amount. [x] Verify warning/audit records and persisted actual PO amount. [x] Verify Finance cannot advance past a hard amount mismatch but can advance past a PO mismatch. |

### Wave 4 — Finance Workflow, LC Rate, PaymentRecords, Stage Gates, Internal Email Logging

| Field | Tracking baseline |
|---|---|
| Status | Implementation complete; SMTP transport configuration pending |
| Priority | P1 |
| Scope | Complete the Finance-only LC step and rate handling; ensure Finance and Comptroller record actual `PaymentRecord`s; derive closure only from `receivableClosedAt`; enforce stage-gated actions; add internal email attempt logging alongside existing in-app notifications. |
| Likely files/modules | `app/routes/_app.docs.$id_.lc.tsx`, `app/routes/_app.finance.receivables.tsx`, `app/routes/_app.comptroller.tsx`, `app/routes/_app.comptroller.$id.tsx`, `app/lib/finance-pipeline.server.ts`, `app/lib/payment-records.server.ts`, `app/lib/email.server.ts`, `app/lib/system-settings.server.ts`, `app/routes/_app.admin.settings.tsx`, `prisma/seed.ts` |
| Schema impact | Schema-free. Uses existing `JafInvoice`, `PaymentRecord`, `AuditTrail`, `Notification`, and `SystemSetting` tables. Closure is derived from `receivableClosedAt`; no migration was changed. |
| Acceptance criteria | [x] `LC_REQUEST_GENERATED` is Finance-only and represents Finance step 3. [x] The configured LC rate is used in Finance/Comptroller displays and generated PBCC and Schedule of Accounts PDFs; IVU remains separate. [x] Finance and Comptroller record actual `PaymentRecord`s, preserving compatibility scalar fields and audit history. [x] Explicit Close is role-, stage-, and repeat-gated, available only after both required payment records exist, and sets `receivableClosedAt`. [x] Finance closure is projected from `receivableClosedAt`; no stored `CLOSED` document status is introduced. [x] Verify, PBCC, PO, payment, Close, terminal, feature-flag, and Finance-only LC actions are unavailable and rejected when called directly. [x] Internal email attempts log recipients, subject, context, timestamp, outcome, and sanitized errors without making delivery the source of business truth. |
| Test/verification criteria | [x] Focused tests cover LC/PBCC settings, Finance stage/closure source, PaymentRecord writes, email outcomes/audit payloads, Admin settings, and Finance/Comptroller route guards. [x] The full Vitest suite passes and `pnpm typecheck` passes. [ ] A live SMTP delivery test and the complete browser/PDF matrix remain pending external SMTP configuration and environment-specific verification. |

**Email transport note:** No SMTP dependency is installed. `sendInternalEmail` is server-only, injectable through `setInternalEmailTransport`, best effort, and records `UNCONFIGURED` until a transport is supplied. When SMTP is approved, configure the injected transport from `INTERNAL_SMTP_HOST`, `INTERNAL_SMTP_PORT`, `INTERNAL_SMTP_USER`, `INTERNAL_SMTP_PASSWORD`, and `INTERNAL_EMAIL_FROM`; do not treat an unconfigured transport as sent.

### Wave 5 — Step Explainers, Dashboards, Installer Controls, Van History

| Field | Tracking baseline |
|---|---|
| Status | Not started |
| Priority | P2 |
| Scope | Add role-appropriate step explainers and dashboard visibility; finish installer permission/control details; record van assignment history as append-only audit events; expose actionable discrepancies and aging without widening role access. |
| Likely files/modules | `app/components/dashboard-view.tsx`, `app/components/app-shell.tsx`, department dashboard routes, `app/routes/_app.admin.restock.tsx`, `app/routes/_app.admin.vans.tsx`, `app/routes/_app.admin.crews.tsx`, `app/routes/_app.installer.*.tsx`, `app/lib/dashboard-stats.ts`, audit/history helpers |
| Schema impact | Schema-free. Van assignment history implemented as append-only audit events on the existing `Van` model (or `AuditTrail`/`VanInventoryTransaction` as appropriate). No schema change unless explicit approval is received. |
| Acceptance criteria | [ ] Each role sees only its permitted workflow steps and explains the next action without exposing Finance-only LC data. [ ] Dashboards show queue ownership, stage, aging, discrepancy, shortage, and overage signals needed by each department. [ ] Installer restock approval remains available to existing Supervisor/Admin roles without adding an installer-supervisor role. [ ] Van assignment changes produce append-only history with installer, from, and to timestamps. [ ] Shared-van behavior is implemented only after confirmation and does not overwrite assignment history. |
| Test/verification criteria | [ ] Verify dashboard projections for every role, status, and feature-flag state. [ ] Test installer approval authorization and denial for non-authorized roles. [ ] Test multiple van assignment changes and immutable historical rows/events. [ ] Verify explainers and alerts do not leak amounts, Aviso numbers, billing status, or LC data to the shared signature screen. [ ] Run browser, route, audit, and dashboard tests plus `pnpm typecheck`. |

### Schema/Migration Plan

- [x] **Approved schema migration:** create a new forward-only Prisma migration for `LC_GENERATED` → `LC_REQUEST_GENERATED`; do not edit any applied migration. Test on Neon first, then pull/apply on the remote production server against the current aligned schema.
- [ ] **Schema-free first:** Waves 0, 2, and most of Waves 1, 3, 4, and 5 should use existing tables, permissions, projections, audit events, settings, and JSON payloads wherever possible.
- [ ] **Production safety:** never use destructive Prisma commands against production. Re-check migration status and schema compatibility before applying the approved rename.
- [ ] **Escalation:** any additional Prisma schema change requires explicit schema approval and a new migration; the append-only van history remains an audit-event implementation unless that approval changes.

### Remaining Decisions / External Inputs

- [ ] Confirm whether the Claro work-order PDF is the same document as the Aviso. Until confirmed, keep them separate and keep the second document optional.
- [ ] Confirm whether vans are shared across installers. Until confirmed, preserve assignment history and do not assume a shared-van ownership model.
- [ ] Confirm the full pre-crew editing status set, including whether edits remain allowed only in `CREATED`/`PREPPED` or require additional pre-crew statuses.
- [ ] Provide SMTP configuration and delivery expectations for internal email notifications and logging.

## Wave 0 — Implementation Baseline

This section records the contract, conventions, and safety rules that all later waves must follow. It was produced by verifying the current code against the 17 Aug 2026 feedback and the authoritative contract above.

### Schema-changing vs schema-free classification

| Wave | Schema impact | Notes |
|---|---|---|
| Wave 0 | Schema-free | Documentation and verification baseline only. |
| Wave 1 | Schema-changing + schema-free | One forward-only enum migration: `LC_GENERATED` → `LC_REQUEST_GENERATED`. All other work (role scoping, feature flag, stage gates) is schema-free. |
| Wave 2 | Schema-free | Signing, quantities, returns, overages, notifications use existing tables. |
| Wave 3 | Schema-free | Aviso/PO reconciliation and tolerance use existing `JafInvoice`, `PoLink`, `PaymentRecord`, `SystemSetting`, `AuditTrail`, and `Notification` tables. |
| Wave 4 | Schema-free* | Uses existing tables; `prisma/schema.prisma` is touched only if already-approved compatibility work is required. |
| Wave 5 | Schema-free | Van assignment history implemented as append-only audit events on existing tables unless explicit schema approval changes that approach. |

### Status / role visibility matrix

`app/lib/permissions.ts` is the single source of truth for the document-status state machine. `app/lib/permissions.server.ts` re-exports the pure helpers for client and server use.

| Status | Editable | Review action | Terminal | Visible / actionable by | Primary transitions |
|---|---|---|---|---|---|
| `CREATED` | Yes | No | No | Supervisor, Admin (edit/create); Warehouse, Admin (prep) | `→ PREPPED` |
| `PREPPED` | Yes | No | No | Warehouse, Admin (re-prep); Crew, Warehouse, Admin (sign) | `→ PREPPED` (re-prep), `→ SIGNED` |
| `SIGNED` | No | No | No | Crew, Admin (field update) | `→ FIELD_UPDATED` |
| `FIELD_UPDATED` | No | Yes | No | Supervisor, Admin (approve / send back) | `→ SUPERVISOR_APPROVED`, `→ SIGNED` (send-back) |
| `SUPERVISOR_APPROVED` | No | Yes | No | Supervisor, Admin (Claro upload, send to Finance); Finance, Admin (read in pipeline) | `→ CLARO_UPLOADED`, audit-only `SENT_TO_FINANCE` |
| `CLARO_UPLOADED` | No | No | No | Finance, Admin (LC request) | `→ LC_REQUEST_GENERATED` |
| `LC_REQUEST_GENERATED` | No | No | Yes | Finance, Admin only. **Must not appear** in Supervisor, Crew, Warehouse, or Comptroller projections. | None (terminal document status) |
| `CANCELLED` | No | No | Yes | Admin full visibility; others by prior assignment only | None |

Important visibility rules:

- `LC_REQUEST_GENERATED` is the Finance step 3 status and is Finance-only in UI/projections.
- `LC_REQUEST_GENERATED` and `CANCELLED` are terminal. No action buttons (Verify, Approve, Prep, Sign, Edit, etc.) may be offered on terminal jobs, and direct route actions must reject the request.
- Finance closure is **not** a document status. It is derived from `JafInvoice.receivableClosedAt`, set by explicit Close after both payment records exist.

### Terminal-stage rules

- `TERMINAL_STATUSES` in `app/lib/permissions.ts` contains `CANCELLED` and `LC_REQUEST_GENERATED`.
- `isTerminalStatus(status)` is used in routes and UI to block actions on terminal documents.
- Terminal documents may still be viewed, downloaded, and appear in read-only history.
- No transition rule in `TRANSITIONS` targets a terminal status from another terminal status.

### Audit-event conventions

The canonical audit model is `AuditTrail` (`prisma/schema.prisma`):

```prisma
model AuditTrail {
  id        String   @id @default(cuid())
  docId     String
  userId    String
  action    String
  diffJson  Json
  timestamp DateTime @default(now())
}
```

Field semantics:

- **Actor:** `userId` — the user who performed the action. Always populated.
- **Entity:** `docId` — the `JafInvoice` id. Always populated.
- **Action:** `action` — UPPER_SNAKE_CASE business action (e.g. `STATUS_CHANGED`, `WORK_ORDER_EDITED`, `SEND_BACK`, `ADVANCE_RECEIVED`).
- **Before/after:** `diffJson` — structured JSON describing what changed.
- **Time:** `timestamp` — auto-generated; never backdated.

Recommended `diffJson` shapes:

**Status change:**

```json
{
  "status": { "before": "PREPPED", "after": "SIGNED" },
  "warehouseId": "...",
  "materialsTaken": [{ "serviceCodeId": "...", "qty": 2 }]
}
```

**Field edit (bulk):**

```json
{
  "fields": ["jobType", "estimatedMaterials", "avisoNumber"],
  "materialsChanged": true,
  "prepChangedSincePrep": true
}
```

**Send-back / return to prior stage:**

```json
{
  "from": "FIELD_UPDATED",
  "to": "SIGNED",
  "note": "Photos are unclear; re-take after photos."
}
```

**Business event without a before/after pair (e.g. payment received):**

```json
{
  "advanceAmount": 1234.56,
  "note": "PBCC funded at the configured LC/PBCC advance rate"
}
```

**Audit-only marker (e.g. sent to Finance):**

```json
{
  "sentAt": "2026-08-18T12:34:56.789Z"
}
```

Consistency rules:

1. Always include `before`/`after` when a field or status changes.
2. Use ISO-8601 strings for dates in JSON.
3. Use the same field names as the Prisma model or UI domain (`estimatedMaterials`, `materialsTaken`, `materialsUsed`, `avisoNumber`, etc.).
4. Never store sensitive data (passwords, full file system paths with credentials) in `diffJson`.
5. Prefer arrays of `{ serviceCodeId, qty }` for material line items to match existing payload conventions.

### Notification conventions

The canonical notification model is `Notification` (`prisma/schema.prisma`):

```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String
  message   String
  docId     String?
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
}
```

Usage rules:

- **Targeting:** notify active users in the role(s) that own the next step (e.g. Warehouse on new job, Finance on `SUPERVISOR_APPROVED`, Supervisor on overage).
- **Message:** short human-readable sentence including the job `controlNumber` and the action context.
- **Deep link:** include `docId` when the notification refers to a specific job.
- **Deduplication:** loaders that create aging/alert notifications should skip users/documents that already have an unread notification.
- **Read state:** notifications are marked read individually or in bulk via the existing notification actions.

### JSON payload conventions

Reused JSON shapes stored on `JafInvoice` and in audit diffs:

| Shape | Example | Where used |
|---|---|---|
| Material line item | `{ "serviceCodeId": "cmr...", "qty": 2 }` | `estimatedMaterials`, `materialsTaken`, `materialsUsed` |
| Send-back history entry | `{ "fromStatus": "FIELD_UPDATED", "toStatus": "SIGNED", "note": "...", "byUserId": "...", "createdAt": "2026-..." }` | `sendBackHistory` |
| Crew assignment history entry | `{ "userIds": ["..."], "assignedById": "...", "assignedAt": "2026-..." }` | `crewAssignmentHistory` |
| Van assignment history entry | `{ "installerId": "...", "from": "2026-...", "to": "2026-..." }` | Stored as append-only events (Wave 5) |
| Audit diff | See Audit-event conventions above | `AuditTrail.diffJson` |

### Migration and production-safety rules

1. **Do not edit applied migrations.** Editing a migration that has already been applied to production causes drift detection and forces a destructive reset.
2. **Forward-only migrations.** Every schema change is a new Prisma migration file. The approved `LC_GENERATED` → `LC_REQUEST_GENERATED` rename is no exception.
3. **Test on Neon first.** Apply the new migration against a Neon replica/clone before touching the remote production server.
4. **Production rollout uses `pnpm prisma migrate deploy`.** Never use `prisma migrate dev`, `prisma db push`, `prisma migrate reset`, or `prisma migrate resolve` against the production database.
5. **Verify alignment before applying.** Check `prisma migrate status` and schema compatibility on the remote production server before applying any new migration.
6. **Destructive commands are forbidden in production.** This includes `--force` resets, dropping tables/columns outside migrations, or any `prisma db pull` → manual edit → `db push` workflow.
7. **Schema-free first.** Prefer implementing feedback with existing tables, permissions, projections, audit events, settings, and JSON payloads. Any additional Prisma schema change requires explicit schema approval and a new migration.

## Fixed Since Last Audit

| # | Section | Issue | Resolution |
|---|---------|-------|------------|
| 8 | §1 Supervisor | Aviso # not editable at every status | Added inline Aviso # edit form on doc view page and removed status guard in review `edit_aviso` intent |
| 9 | §7 Cross-Cutting | File server lacks ACL | Added document-level access control in `files.$.tsx` with role-based `canAccessDoc` checks |
| 10 | §3B Installers | No installer notification when restock is READY | Added `notification.create` in `_app.restock.$id_.fulfill.tsx` after status set to `READY` |
| 11 | §3B Installers | Truncated notification message (literal `#...`) | Restructured installer restock action to create request first, then embed `request.id.slice(-6)` in notification text |
| 12 | §3B Installers | `evaluateRestockApproval` ignores pending requests | Action now includes pending `REQUESTED`/`PENDING_APPROVAL`/`APPROVED` request items as inflows before evaluating approval |
| 13 | §3A Brigade Crew | `FIELD_UPDATED` accepts `CREATED` as source | Removed `CREATED` from `TRANSITIONS.FIELD_UPDATED.from` in `permissions.ts`; crews must go through `SIGNED` now |
| 14 | §3A Brigade Crew | No before/after photo tagging | Added `PhotoTag` enum (`BEFORE`/`AFTER`), split photo upload inputs, stored tag on `Photo` records, added migration |
| 15 | §3A Brigade Crew | Offline conflict detection is string-based | Server now returns structured JSON `409` conflicts; client checks `response.status === 409` instead of raw response text |
| 16 | §1 Supervisor | Dashboard filters incomplete | Added job type filter dropdown to supervisor dashboard loader and `dashboard-view.tsx`; distinct job types are loaded from `JafInvoice` and filterable alongside status/crew/search |
| 17 | §1 Supervisor | No explicit "Send to Finance" step | Split supervisor review flow: Approve transitions to `SUPERVISOR_APPROVED`; new `send_to_finance` intent notifies Finance and records audit trail without changing status or requiring schema changes |

## Recent Commits Reviewed

| Commit                                                                                                        | Scope                                                                                       |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `fix: address unregisted route and unbounded invoice query in receivables`                                    | Registered missing `docs/:id/returns` route; added `take: 200` to finance receivables query |
| `chore: addition to PaymentRecord table`                                                                      | Schema update for payment tracking                                                          |
| `fix: address comptroller role issues`                                                                        | Comptroller role fixes                                                                      |
| `fix: address isues in lib folder`                                                                            | Library bug fixes                                                                           |
| `fix: issues from finance pipeline`                                                                           | Finance pipeline fixes                                                                      |
| `fix: cleanup and order prisma migrations`                                                                    | Migration hygiene                                                                           |
| `fix: preserve inactive service code stock levels when updating van`                                          | Van update merge logic                                                                      |
| `fix: stop exposing temp passwords and enforce restock approval state guard`                                  | Security + state guard                                                                      |
| `fix: validate serviceCodeId in installer/restock/fulfill/returns routes and bound inventory history queries` | Validation + query bounds                                                                   |
| `feat: implement admin features for phase 2`                                                                  | Admin users/catalog/crews/vans                                                              |
| `feat(crew): implement §3A Brigade remaining items`                                                           | Brigade crew field update, offline                                                          |
| `feat(crew): implement installer van/restock portal (JAF-Phase2 §3B)`                                         | Installer portal                                                                            |
| `fix: address critical bugs from code review`                                                                  | Warehouse re-prep flow, supervisor restock approval, race condition, notification redirect   |
| `fix: address remaining finance and comptroller bugs`                                                         | Finance notification on approve, comptroller aging, discrepancy UI                         |
| `fix: address remaining high-priority bugs from phase2 audit`                                                  | Aviso # editability at any status, file server ACL                                          |
| `fix: address supervisor dashboard and finance hand-off gaps`                                                   | Added job type filter to dashboard; added explicit Send to Finance intent in supervisor review |

## §1 Supervisor — Mostly Complete

### Implemented
- Create/edit/reassign/cancel work orders
- JAF invoice generation from service codes × unit prices
- Aviso # entry at creation, edit page, and review page
- Claro PDF upload
- Supervisor review/approval (`FIELD_UPDATED → SUPERVISOR_APPROVED`)
- Send-back to crew with note history
- Notifications for crew submission, missing materials, send-back

### Gaps
1. ~~**Aviso # not editable at every status.**~~ **Fixed.** Added inline Aviso # edit form on doc view page for supervisors/admins at any non-terminal status, and removed status guard in review `edit_aviso` intent.
2. ~~**No explicit "Send to Finance" step.**~~ **Fixed.** The supervisor review page now exposes a distinct `send_to_finance` intent that notifies Finance and records an audit trail entry, separate from approval/Claro upload.
3. **No side-by-side PDF comparison.** Review page shows data summaries and download links but does not render the JAF invoice PDF and Claro PDF side-by-side for visual verification (PRD §1.3).
4. ~~**Dashboard filters incomplete.**~~ **Fixed.** Added job type filter to the supervisor dashboard query and filter bar; status, crew, job type, and search filters are now present.

## §2 Warehouse — Partially Broken

### Implemented
- Prep with quantity adjustment/substitution
- Missing material flagging
- Mark prepped (`CREATED → PREPPED`)
- Dual signature at pickup (`PREPPED → SIGNED`)
- Returns logging
- Restock fulfillment for installers

### Critical Bug — Broken "re-confirm after edit" flow
**Fixed.** When supervisor edits materials on a `PREPPED` job, `prepChangedSincePrep = true` is set.
- `warehouseMissingDocs` query (`dashboard.tsx:102-113`) only looked for `status: "CREATED"`, so `PREPPED` jobs with changed materials never appeared in any warehouse queue.
- The warehouse could not re-prep because the prep route required `from: "CREATED"`.
- **Resolution:** Extended `warehouseMissingDocs` query to include `status: { in: ["CREATED", "PREPPED"] }`; allowed `PREPPED → PREPPED` transition in `permissions.ts`.

### Gaps
1. **No "Pending Preps" queue section** in `dashboard-view.tsx`. `CREATED` jobs only appear in the generic flat list, mixed with all other statuses. PRD §2.2 explicitly requires a dedicated "Pending Preps queue — jobs in Created, oldest first."
2. **No per-line prepped timestamp/preparer.** PRD §2.5 asks for "prep timestamp, prepped-by" per material line; only job-level `preppedAt`/`preppedById` exist.

## §3A Brigade Crew — Mostly Complete

### Implemented
- My Jobs dashboard (grouped by state)
- Field update (photos, materials, notes, time, signature, address correction with GPS)
- Offline caching/queue
- Send-back handling

### Gaps/Bugs
1. ~~**No before/after photo tagging.**~~ **Fixed.** Added `PhotoTag` enum (`BEFORE`/`AFTER`), split photo upload inputs into before/after sections, stored tag on `Photo` records, added migration `20260815110100_add_photo_tag`.
2. ~~**`FIELD_UPDATED` accepts `CREATED` as source** (`permissions.ts:35`).~~ **Fixed.** Removed `CREATED` from `TRANSITIONS.FIELD_UPDATED.from`; crews must now go through `SIGNED` before submitting field updates.
3. ~~**Offline conflict detection is string-based** (`field-sync.ts:76-84`).~~ **Fixed.** Server now returns structured JSON `409` conflicts; client checks `response.status === 409` and parses `{ conflict: "CANCELLED" | "REASSIGNED" }` instead of raw response text.

## §3B Installers — Mostly Complete

### Implemented
- Van inventory dashboard (on-hand vs standard)
- Restock requests with approval logic
- Pickup signature
- Install logging with discrepancy flagging
- Van count adjustments

### Critical Bug — Supervisor cannot approve restock
**Fixed.** PRD §3B.3 and §6.3 state supervisors can approve above-standard restock requests.
- `_app.admin.restock.tsx` was guarded by `requireRole(request, ["ADMIN"])` only. Supervisors received notifications but had no UI to act.
- **Resolution:** Expanded role guard to `requireRole(request, ["ADMIN", "SUPERVISOR"])` in both loader and action.

### Gaps/Bugs
1. **No installer offline support.** Restock requests and install logging have no offline queue. PRD §3B says installs "work offline like the brigade flow."
2. ~~**No installer notification when restock is READY.**~~ **Fixed.** Fulfill action now creates a notification for the requesting installer when status is set to `READY`.
3. ~~**Truncated notification message** (`_app.installer.restock.tsx:124`).~~ **Fixed.** Uses actual request ID `request.id.slice(-6)` instead of literal `#...`.
4. ~~**`evaluateRestockApproval` ignores pending requests.**~~ **Fixed.** Action queries pending `REQUESTED`/`PENDING_APPROVAL`/`APPROVED` requests and includes their items as inflows.

## §4 Finance — Complete with Risks

### Implemented
- All 8 pipeline stages
- Aging displays (hardcoded 180-day thresholds)
- PBCC PDF generation
- Claro PO recording
- Final Claro doc generation
- Close-entry gated on both payments

### Gaps/Bugs
1. **No manual document delivery to Karmen beyond PBCC requests.** PRD §4.4 says "any document from Lissette's desk that Karmen needs goes to Karmen's portal automatically." Currently only PBCC copies are auto-delivered.
2. ~~**Dual-write race condition.**~~ **Fixed.** Finance receivables page used `update` (singular) for payment fields; comptroller detail used `updateMany`. Concurrent writes could silently overwrite each other and create duplicate/missing `PaymentRecord` entries.
3. **PDF layouts unverified.** PRD §7.2 explicitly flags that layouts must be compared field-by-field against Lissette's samples.
4. ~~**No Finance notification on `SUPERVISOR_APPROVED`.**~~ **Fixed.** PRD §4.7 says Finance should be alerted when an approved job lands. Added Finance user notifications inside the review `approve` intent.

## §5 Comptroller — Complete with Gaps

### Implemented
- Incoming documents
- Record PBCC advance
- Record crew payment
- Record Claro final payment
- Crew payment history for reassignment edge case

### Gaps/Bugs
1. ~~**No aging display** in comptroller queues.~~ **Fixed.** PRD §5.2 says "Awaiting funds" should show aging. Added `ageDays` to awaiting-advance and awaiting-final cards.
2. ~~**Notification redirect bug** (`action.notifications.$id.read.tsx:25-27`).~~ **Fixed.** Always redirected to `/docs/${docId}` when present, ignoring the `redirectTo` parameter. Now respects `redirectTo`.
3. ~~**Discrepancy UI understated.**~~ **Fixed.** Amount mismatches are now surfaced with a discrepancy badge and notice on the comptroller advance detail page.

## §6 Admin — Mostly Complete

### Implemented
- All 7 roles
- Service catalog with prices
- Crews/brigades
- Vans with standard stock levels
- Full work-order history
- Settings (IVU, aging days)

### Gaps
1. **No unified admin dashboard with all department queues.** PRD §6.2 requires read-mode access to every department's queues. Admin currently sees only finance stats and a flat document list.
2. **`aging_alert_days` setting is unused.** Defined and editable but hardcoded 180-day values are used in finance pipeline.

## §7 Cross-Cutting — Two Known Bugs Fixed, Others Remain

### Fixed
- Service Catalog NaN pricing (`toNumberPrice`)
- Materials dropdown showing raw IDs (now shows `claroCode — name`)

### Remaining
1. ~~**File server lacks ACL** (`files.$.tsx`).~~ **Fixed.** Added document-level access control with role-based checks: ADMIN full access, SUPERVISOR by supervised docs, CREW by assigned docs, WAREHOUSE by workflow status, FINANCE/COMPTROLLER by financeable status.
2. **No push/email notifications** anywhere. PRD §1.7, §3B.6, §4.7, §5.6 all reference push/email; only in-app notifications exist.
3. **No background sync for offline queue.** Data persists in IndexedDB but won't auto-sync if the app is closed/restarted.
