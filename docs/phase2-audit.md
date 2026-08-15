# JAF Phase 2 PRD Compliance Audit

**Date:** 2026-08-15  
**Scope:** JAF-Phase2.md vs recent commits (~last 10)  
**Status:** Findings for later review

## Fixed Since Last Audit

| # | Section | Issue | Resolution |
|---|---------|-------|------------|
| 1 | §2 Warehouse | Broken "re-confirm after edit" flow | Extended `warehouseMissingDocs` query to include `PREPPED` status; allowed `PREPPED → PREPPED` transition in `permissions.ts` |
| 2 | §3B Installers | Supervisor cannot approve restock | Expanded `_app.admin.restock.tsx` role guard from `ADMIN` to `ADMIN, SUPERVISOR` |
| 3 | §4 Finance | Dual-write race condition | Replaced comptroller `updateMany` with `update` + upfront guards for advance/final payments |
| 4 | §4 Finance | No Finance notification on `SUPERVISOR_APPROVED` | Added Finance user notifications inside review `approve` intent |
| 5 | §5 Comptroller | Notification redirect bug | `action.notifications.$id.read.tsx` now respects `redirectTo` instead of forcing `/docs/${docId}` |
| 6 | §5 Comptroller | No aging display in comptroller queues | Added `ageDays` to awaiting-advance and awaiting-final cards |
| 7 | §5 Comptroller | Discrepancy UI understated | Added discrepancy badge and notice on comptroller advance detail when amount differs from expected 80% |

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
1. **Aviso # not editable at every status.** Restricted to creation, edit page (`CREATED`/`PREPPED`), and review page (`SUPERVISOR_APPROVED`). No edit path for `FIELD_UPDATED`, `SIGNED`, or `CLARO_UPLOADED`. PRD §1.5: *"editable by the supervisor at any point."*
2. **No explicit "Send to Finance" step.** The PRD lists this as a distinct action after supervisor confirmation. Current flow collapses it into the Claro PDF upload action.
3. **No side-by-side PDF comparison.** Review page shows data summaries and download links but does not render the JAF invoice PDF and Claro PDF side-by-side for visual verification (PRD §1.3).
4. **Dashboard filters incomplete.** PRD §1.2 requires status, crew, date range, and job type filters. Only status, crew, and search (Aviso #/address) are implemented.

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
1. **No before/after photo tagging.** PRD §3.3 explicitly requires tagged before/after photos; current UI is a generic multi-file upload.
2. **`FIELD_UPDATED` accepts `CREATED` as source** (`permissions.ts:35`). This "van bypass path" allows crews to skip pickup signature entirely.
3. **Offline conflict detection is string-based** (`field-sync.ts:76-84`). Checks raw response text for `"reassign"` or `"cancelled"` — fragile.

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
2. **No installer notification when restock is READY.** Fulfill action sets status to `READY` but creates no notification. PRD §3B.6 requires it.
3. **Truncated notification message** (`_app.installer.restock.tsx:124`): Uses literal `#...` instead of actual request ID.
4. **`evaluateRestockApproval` ignores pending requests.** A second request doesn't account for pending outflows.

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
1. **File server lacks ACL** (`files.$.tsx`): Any authenticated user can access any upload by guessing the path. No document-level access control.
2. **No push/email notifications** anywhere. PRD §1.7, §3B.6, §4.7, §5.6 all reference push/email; only in-app notifications exist.
3. **No background sync for offline queue.** Data persists in IndexedDB but won't auto-sync if the app is closed/restarted.

