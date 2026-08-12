# JAF Ops — Phase 2 PRD: Department Pages & Workflows

**Project:** JAF Operations (JAF Communications Inc. — Claro line-work contractor, Puerto Rico)
**Phase:** 2 — "Branches": build out each department's page so every role does its real job end to end.
**Prepared by:** Kay (product owner) · **For:** Juan González (developer)
**Status flow reference:** `Created → Prepped → Signed → Field Updated → Supervisor Approved → (Finance billing & close)`

---

## 1. Supervisor

### 1.1 Purpose
The supervisor is where every job starts and where field work gets quality-checked. He creates work orders, keeps them accurate while they move, reviews what the crew did in the field, and approves the job so Finance can bill it.

### 1.2 What they see (dashboard)
- **My Work Orders** — all jobs the supervisor created/owns, filterable by status and by crew.
- **Pending Review queue** — jobs in `Field Updated` waiting for his approval, with a count badge.
- **Sent Back** — jobs he returned to the crew, so he can track that they come back fixed.
- Filters: status, crew, date range, job type. Search by Aviso # or address.

### 1.3 What they can do
| Action | Details |
|---|---|
| **Create work order** | Fields: Job Type, Job Address, Assigned Crew, Estimated Materials / Service Codes, Claro Aviso # (**optional at creation** — see 1.5). Sets status to `Created` and drops the job into Warehouse's Pending Preps. |
| **Edit work order** | Full edit (address, job type, materials, etc.) while the job is in `Created` or `Prepped` — i.e., before the crew starts. |
| **Reassign crew** | Allowed at **any** status — crews change day to day. Reassignment moves the job to the new crew's queue and notifies them. |
| **Cancel work order** | Any time before Finance closes it, with a required reason (e.g., "Claro cancelled aviso"). Cancelled jobs leave all queues but stay visible in history. |
| **Generate JAF invoice** | The system builds the JAF invoice from the job's service codes/materials × Service Catalog unit prices (this is why the NaN pricing bug must be fixed) as a PDF. The supervisor uses this invoice to create the Aviso in Claro's system (see 1.5). |
| **Add Aviso #** | Enter/update the Claro Aviso # after creating the aviso in Claro's system (see 1.5). |
| **Attach Claro Aviso PDF**          | After creating the aviso in Claro, the supervisor uploads the Claro work-order PDF to the JAF work order. This attaches the document but **does not** send it to Finance yet. |
| **Review & confirm before Finance** | Once both the JAF invoice PDF and the Claro Aviso PDF are attached, the supervisor reviews a side-by-side summary of key fields (Aviso #, job type, address, supervisor, materials/amounts) and either confirms accuracy or fixes discrepancies before forwarding. |
| **Send to Finance**                 | After supervisor confirmation, the system delivers **both files** — the JAF invoice and the Claro Aviso — to Lissette, who then verifies them against each other before requesting payment (see §4). 
| **Approve field work** | Reviews the crew's field update (photos, signatures, notes, actual materials used). Approving moves the job to `Supervisor Approved` → appears in Finance's billing queue. |
| **Send back to crew** | If something is wrong (bad photos, missing info, incomplete work): job returns to the crew's queue with a **required note** explaining what to fix. Status returns to an "in field" state; crew resubmits and it comes back to Pending Review. |

### 1.4 Workflow hand-offs
- **Out:** `Created` → Warehouse (Pending Preps). `Supervisor Approved` → Finance (Ready to Bill).
- **In:** `Field Updated` ← Crew (triggers Pending Review). Resubmissions after send-back come back to the same queue, flagged as resubmitted.

### 1.5 The Aviso flow (important — how it really works)
The Aviso # is **not** always known when the job is created. The real sequence:
1. Supervisor gathers all the job information and the system generates the **JAF invoice** (service codes × catalog unit prices).
2. With the invoice in hand, he goes into **Claro's system** and creates the **Aviso** there.
3. He enters the Aviso # into the JAF work order and attaches the Aviso document.
4. The supervisor **reviews both documents side by side** in the system (Aviso #, job type, address, materials, amounts) and confirms that the data matches.
5. Only after supervisor confirmation does the system deliver **both files — the JAF invoice and the Aviso — to Lissette (Finance)**, who checks them against each other before requesting payment (§4).

**Rule for the system:** Aviso # is optional at creation, editable by the supervisor at any point, but **required before Finance can bill** the job. The system should visibly flag approved jobs that are still missing an Aviso # or Claro PDF.

### 1.6 Data & fields
Work order: ID, Job Type, Job Address, Claro Aviso # (nullable until billing), Assigned Crew, Estimated Materials / Service Codes (from Service Catalog — names + unit prices, never raw IDs), status, created date, supervisor, cancellation reason (if any), send-back notes history.

### 1.7 Notifications
- Supervisor gets the **Pending Review queue on the dashboard** *plus* a **push/email notification** the moment a crew submits a field update.
- Crew gets notified on reassignment and on send-back.

### 1.8 Edge cases
- Send-back loop: a job can be sent back more than once; keep the full note history.
- Cancelled job that Warehouse already prepped: Warehouse gets notified to return materials to stock.
- Job approved but missing Aviso #: allowed to approve, blocked from billing, flagged.
- Supervisor attaches Claro PDF but finds mismatch: uses existing edit/send-back flows to correct before confirming and sending to Finance.

### 1.9 Acceptance criteria
- Supervisor can create, edit (pre-crew), reassign (anytime), and cancel (with reason) a work order.
- Approving a `Field Updated` job moves it to Finance's queue; sending it back returns it to the crew with the note visible to them.
- Aviso # can be added after creation; billing is blocked without it.
- Notification fires on crew submission.

---

## 2. Warehouse (Idalia)

### 2.1 Purpose
Warehouse turns a created work order into a physical kit of materials the crew can pick up, and keeps material usage per job accurate — including what comes back unused.

### 2.2 What they see (dashboard)
- **Pending Preps queue** — jobs in `Created`, oldest first, with job type, address, crew, and the estimated materials list (service/material **names**, never raw IDs — see §5 bug fix).
- **Prepped / awaiting pickup** — jobs prepped but not yet signed out by the crew.
- **Missing materials** — jobs flagged out-of-stock, waiting on the supervisor's decision.
- **Returns to log** — completed jobs with materials expected back.
- **Restock Requests** — installer restock requests (see §3B): ready to fulfill, waiting sign-off (above standard level), and prepped/awaiting installer pickup.

### 2.3 What they can do
| Action | Details |
|---|---|
| **Prep a job** | Opens the estimated materials list; stages the physical materials. |
| **Adjust quantities / substitute** | She can change quantities or substitute materials based on what's actually available or needed. The system records **estimated vs. actually prepped** per line item, with her name and timestamp. |
| **Flag missing material** | If something isn't in stock: mark the line "missing", job shows in Missing Materials, and the **supervisor is notified** to decide (wait, substitute, or proceed without). Job stays in Pending Preps until resolved. |
| **Mark Prepped** | Confirms the kit is staged → status `Prepped`. Crew is notified materials are ready. |
| **Sign-out (pickup)** | When the crew picks up, the crew member **signs on screen** to confirm the hand-off → status `Signed`. The signature and pickup timestamp are stored on the work order. |
| **Log returns** | After the job, she logs what came back unused per line item, so actual usage = prepped − returned. |
| **Fulfill restock requests** | For installers: prep the requested products (adjust/flag missing stock same as jobs), mark ready; installer signs at pickup and his van inventory updates. Above-standard requests only appear as fulfillable after supervisor/admin sign-off. |

### 2.4 Workflow hand-offs
- **In:** `Created` ← Supervisor (lands in Pending Preps, with notification).
- **Out:** `Prepped` → crew notified to pick up. Crew signature at pickup → `Signed` → job is live in the crew's field queue.
- **Cancelled job already prepped:** Warehouse gets notified to restock the staged materials.

### 2.5 Data & fields
Per material line: material/service (name + code from catalog), estimated qty, prepped qty, substituted-with (if any), missing flag, returned qty, prep timestamp, prepped-by. Pickup: crew signature image, signer name, timestamp.

### 2.6 Notifications
- Warehouse notified when a new job lands in Pending Preps, and when a prepped/cancelled job needs restocking.
- Supervisor notified on missing-material flags. Crew notified when the kit is ready.

### 2.7 Edge cases
- Supervisor edits materials after prep started → job flagged "changed since prep", Idalia re-confirms.
- Crew never picks up a prepped kit → visible in "awaiting pickup" aging list.
- Partial returns or damaged materials → return line supports notes.

### 2.8 Acceptance criteria
- A created job appears in Pending Preps automatically with readable material names.
- Idalia can adjust/substitute with the difference recorded, flag missing stock (supervisor notified), and mark prepped.
- Crew signature at pickup moves the job to `Signed` and stores the signature.
- Returns can be logged per line and actual usage is computable per job.

---

## 3. Crew — two types

JAF has **two kinds of field crews**, and they use the system differently:

- **3A. Brigades** — dispatched by the field supervisor on work orders: downed lines, service outages, laying new infrastructure for new neighborhoods. This is the work-order flow (`Created → Prepped → Signed → Field Updated → …`).
- **3B. Installers ("man in the van")** — go to customers' houses installing cable TV, wifi, phone, and other small jobs. They live out of a stocked van and come to the warehouse to **restock**, not to pick up job kits.

Each type gets its own login type and its own screens.

---

## 3A. Brigades (field crews — PWA on phone)

### 3.1 Purpose
The crew's phone is the job in the field: see what's assigned, pick up materials, do the work, document it (photos, actual materials, corrected address, time), and submit it for supervisor review — with or without cell signal.

**Login model:** one account per crew (the crew lead's phone), not per worker.

### 3.2 What they see (dashboard)
- **My Jobs** — jobs assigned to this crew, grouped by state: *Ready for pickup* (`Prepped`), *In the field* (`Signed`), *Sent back* (with the supervisor's note on top), *Submitted* (awaiting review).
- Each job card: job type, address (with map link), Aviso # if present, materials list, supervisor notes.
- A clear **offline indicator** and "pending sync" badge.

### 3.3 What they can do
| Action | Details |
|---|---|
| **Sign for pickup** | At the warehouse, crew lead signs on screen → `Signed` (see §2). |
| **Correct the address/location** | Supervisors often give a rough location. The crew can **edit the job address to the real installation location**, with an **edit record**: original value, corrected value, who, timestamp. The correction is visible to the supervisor and Finance. Optionally capture GPS coordinates from the phone. |
| **Take before/after photos** | Photos tagged before/after, stored with timestamps; work offline, upload on sync. |
| **Record actual materials used** | Confirm/adjust quantities actually installed vs. prepped (feeds the returns math in §2). |
| **Write work notes** | Free text: what was done, problems found, site conditions. |
| **Log time on site** | Start/end time (or start/stop button) per job. |
| **Sign completion** | Crew lead signs on the phone confirming the work is complete as reported. |
| **Submit field update** | Sends everything → status `Field Updated` → supervisor's Pending Review + notification. If sent back, the fix-and-resubmit uses the same flow. |

### 3.4 Offline behavior (must-have)
- Assigned jobs and their details are **available offline** (cached when the app last had signal).
- The crew can do **everything** offline — photos, address correction, materials, notes, times, signature, submit.
- Submissions queue on the phone and **sync automatically** when signal returns; the UI shows what's pending vs. synced. No data loss if the app is closed or the phone restarts.
- Conflict rule: field edits win over stale office edits made while the crew was offline, except crew reassignment/cancellation, which block a sync submit with a clear message.

### 3.5 Workflow hand-offs
- **In:** `Prepped` (notified: kit ready) ← Warehouse; send-backs ← Supervisor (notified, with note).
- **Out:** pickup signature → `Signed`; submit → `Field Updated` → Supervisor.

### 3.6 Data & fields
Field update: before photos[], after photos[], actual qty per material line, work notes, start/end time, corrected address (+ edit history: old, new, who, when; optional GPS), completion signature, submitted-at timestamp.

### 3.7 Notifications
- Crew notified: kit ready for pickup, job reassigned to/from them, job sent back with note, cancellation.

### 3.8 Edge cases
- Send-back arrives while offline → appears on next sync.
- Photos too large / many → compress client-side; sync resumes if interrupted mid-upload.
- Crew reassigned while original crew is offline with data captured → block the stale submit, notify supervisor to resolve.
- Job cancelled while crew is in the field → prominent alert on sync.

### 3.9 Acceptance criteria
- With airplane mode on, a crew can open an assigned job, correct the address, take photos, record materials/notes/time, sign, and submit; everything syncs when signal returns.
- Address corrections show the original address and full edit record to supervisor and Finance.
- Submitting moves the job to `Field Updated` and notifies the supervisor.
- Sent-back jobs show the supervisor's note and can be resubmitted.

---

## 3B. Installers ("man in the van") — NEW in Phase 2

### 3B.1 Purpose
Installers keep their van stocked and their small install jobs documented. Their portal (same PWA) does three things: request restock from the warehouse, keep a running van inventory, and log each install they complete.

**Scope boundary (per JAF's CEO — do not touch):** installer job dispatch and billing happen entirely **inside Claro's system**. Claro gives JAF's installer supervisor access to their system; jobs come in there, the supervisor assigns them there, and when the job is done, the warranty is issued and the client signs — then **Claro pays JAF directly** and Karmen pays the installer. None of that is built or replicated in JAF Ops. Our system covers **only the record-keeping around it**: what products each installer has taken, what jobs he completed, what's on his van, and what he needs each week so jobs don't get delayed.

### 3B.2 What they see (dashboard)
- **My Van** — current van inventory: each product with quantity on hand vs. its **standard stock level** ("what they should have" — the par level set per van, see Admin §6).
- **My Restock Requests** — pending / ready for pickup / fulfilled.
- **My Installs** — today's and recent install jobs.

### 3B.3 What they can do
| Action | Details |
|---|---|
| **Request restock** | Pick products + quantities from the catalog. **Rule:** requests that bring the van up to (or below) its standard stock level go **straight to the warehouse** — Idalia just fulfills. Requests **above the standard level** require **supervisor or admin sign-off** before the warehouse preps them. |
| **Sign at pickup** | Same signature pattern as job kits: installer signs on screen at the warehouse; the fulfilled quantities are added to his van inventory. |
| **Log a completed install** | A record, not a work order (the job itself lives in Claro's system): Claro job reference #, service type (cable TV / wifi / phone / other small job), date, materials used (picked from van inventory — automatically **deducted** from the van count), optional notes. Works offline like the brigade flow. |
| **Adjust van count** | Report damaged/lost stock with a note (flagged to warehouse/admin so counts stay honest). |

### 3B.4 Van inventory math
`on hand = restocked (signed pickups) − used on installs − damaged/lost`. The dashboard shows on-hand vs. standard level so both the installer and Idalia can see at a glance who needs restocking.

### 3B.5 Workflow hand-offs
- **Restock:** Installer request → (auto, or supervisor/admin sign-off if above standard level) → Warehouse **Restock Requests queue** → Idalia preps → installer signs at pickup → van inventory updated.
- **Installs:** completed installs are logged by the installer as records (visible to supervisor/admin). Dispatch, warranty, client signature, and payment stay in **Claro's system** (see 3B.1) — no billing flow for installers exists in JAF Ops. The weekly rhythm is: installer logs installs → van count drops → he requests his weekly restock → Idalia fulfills → no job delayed for lack of product.

### 3B.6 Notifications
- Warehouse notified of new restock requests; supervisor/admin notified when a request needs sign-off; installer notified when the restock is ready for pickup.

### 3B.7 Edge cases
- Out-of-stock items on a restock request → same flagging as job preps (§2).
- Install logged offline with materials the van count says it doesn't have → allow, flag the discrepancy.
- Standard stock level changed by admin while requests are pending → rule evaluated against the level at request time.

### 3B.8 Acceptance criteria
- An installer can request restock from his phone; within-standard requests reach Idalia directly, above-standard requests wait for supervisor/admin sign-off.
- Pickup signature updates the van inventory; logging an install deducts the materials used.
- Van dashboard shows on-hand vs. standard level accurately.

---

## 4. Finance (Lissette)

### 4.1 Purpose
Finance turns approved field work into money — and the money moves in two long, slow legs. Lissette needs the system to (a) verify the Aviso against the JAF invoice, (b) produce the PBCC payment request, (c) track every job through waits that can total a year, and (d) close the job when both payments are in.

### 4.2 The real money flow (source of truth for this section)
1. **Docs arrive:** Lissette receives **both files** on the work order — the JAF invoice and the Aviso the supervisor created in Claro — and checks them against each other to confirm the Aviso was done correctly.
2. **PBCC payment request:** she creates the payment request document in **PBCC's required format** (PDF) and sends it to PBCC. A **copy automatically goes to Karmen, the Comptroller**, who will issue the crew's payment for the job once the funds land.
3. **PBCC funds 80%** of the invoice amount from the Aviso.
4. **Waiting period:** up to **180 days** until Claro issues the **PO**.
5. **PO received:** Lissette creates the final document (PDF), **signs it**, and **uploads it into Claro's portal** — the job gets in Claro's payment queue.
6. **Claro pays** — this leg can take another **60–180 days**. When the final payment is in, she **closes** the job.

> Claro data entry is done **in Claro's portal by hand** — our system doesn't integrate with Claro; it must show Lissette everything she needs to copy, and store the documents.

### 4.3 What they see (dashboard)
A pipeline view of every approved job by money stage, with **aging** (days in stage) front and center:

| Stage | What it means |
|---|---|
| **To verify** | Invoice + Aviso received, not yet checked. Jobs missing an Aviso # or Aviso doc are flagged here. |
| **PBCC request pending** | Verified, payment request not yet sent. |
| **Waiting PBCC funding** | Request sent; waiting for the 80%. |
| **Waiting Claro PO** | Funded; in the up-to-180-day wait. Aging counter visible. |
| **PO received / to upload** | PO in hand; final signed PDF not yet loaded into Claro. |
| **In Claro queue** | Uploaded; waiting the 60–180-day final payment. |
| **Ready to close** | Final payment received. |
| **Closed** | Done. |

Totals per stage (count + $ amount) so Kay/Monica can see at a glance how much money is sitting in each wait.

### 4.4 What they can do
| Action | Details |
|---|---|
| **Verify Aviso vs. invoice** | Side-by-side view of the two documents; mark verified, or **send back to the supervisor** with a note if the Aviso is wrong. |
| **Generate PBCC payment request** | The system produces the request as a **PDF in PBCC's required format**, pre-filled from the job (⚠ open item: get a sample of the PBCC format — see §6). Marks the request date. |
| **Send to Karmen** | The PBCC request — and **any document from Lissette's desk that Karmen needs** — goes to Karmen's portal automatically (see §5). No more printing mountains of paper. |
| **Record Claro PO** | Enter PO number + date when Claro issues it; attach the PO. |
| **Generate final Claro document** | System produces the final PDF for her to sign and upload to Claro's portal; she records the upload date. |
| **Close entry** | Money receipt is recorded by **Karmen** (she's the one who actually receives the funds — see §5). When Karmen records the PBCC 80% and later the Claro final payment, the system **alerts Lissette**; once both are in, the **Close entry** button unlocks and Lissette closes/archives the job. |

> **Division of labor:** Lissette drives documents and Claro/PBCC submissions; **Karmen records money received and pays the crews**; the system connects the two so Lissette always knows when she can close.

### 4.5 Workflow hand-offs
- **In:** `SUPERVISOR_APPROVED` jobs (with invoice + Aviso docs confirmed by supervisor) land in "To verify", with notification.
- **Back:** Aviso problems → back to the supervisor with a note.
- **Out to Karmen:** PBCC request copy, automatically.
- **End:** Close entry after both payments.

### 4.6 Data & fields
Per job: invoice amount, Aviso # + doc, verified flag/date, PBCC request PDF + sent date, Karmen copy sent date, PBCC funded date + amount (80%), Claro PO # + date + doc, final doc PDF + upload date, final payment date + amount, closed date. All dates drive the aging displays.

### 4.7 Notifications
- Lissette notified when an approved job (with docs) lands in her queue and when a sent-back Aviso returns.
- Supervisor notified on Aviso send-backs.
- **Aging alerts:** flag jobs sitting past thresholds (e.g., PO wait > 180 days, Claro queue > 180 days) so nothing falls through a year-long crack.

### 4.8 Edge cases
- Approved job missing Aviso # or Aviso doc → visible and flagged, cannot generate PBCC request.
- Aviso amount ≠ invoice amount → verification fails, send back.
- Partial/incorrect PBCC funding → record actual amount; discrepancy flagged.
- PO never arrives → aging alert escalates to Kay/admin.

### 4.9 Acceptance criteria
- A supervisor-confirmed approved job with both docs flows through every stage with dates recorded at each step.
- The PBCC request PDF generates in the correct format and the copy reaches Karmen.
- Aging (days in stage) is visible per job and per stage, with alerts past thresholds.
- Close is blocked until both the 80% and the final payment are recorded.
- Finance can send a verified job back to the supervisor if the Aviso is wrong; the supervisor fixes it and resubmits for Finance review.

---

## 5. Comptroller (Karmen) — NEW role in Phase 2

### 5.1 Purpose
Karmen is where the money actually lands. She receives the funds (PBCC 80%, then Claro's final payment), pays the crews for jobs well done, and her entries are what tell Lissette a file can be closed. Her portal also replaces the current print-and-hand-over paper flow between Finance and the Comptroller's desk.

### 5.2 What they see (dashboard)
- **Incoming documents** — everything sent from Lissette's desk: PBCC payment requests (copies) and any other docs, viewable/downloadable, marked read/unread. **Nothing needs to be printed.**
- **Awaiting funds** — jobs whose PBCC request went out; and separately jobs waiting on Claro's final payment.
- **Crews to pay** — jobs where PBCC funds arrived but the crew hasn't been paid yet.

### 5.3 What they can do
| Action | Details |
|---|---|
| **Receive documents** | Every PBCC request (and any other doc Lissette sends her) appears in her portal automatically the moment it's generated. |
| **Record PBCC funds received** | Date + amount of the 80% when it lands. → System **alerts Lissette** (advance in). |
| **Record crew payment** | Mark the crew paid for the job (date, amount, note). |
| **Record Claro final payment received** | Date + amount when Claro's payment lands. → System **alerts Lissette**, whose Close entry unlocks. |

### 5.4 Workflow hand-offs
- **In:** PBCC request copies and documents ← Lissette (automatic).
- **Out:** funds-received entries → alert Lissette; both payments recorded → Lissette can close.

### 5.5 Data & fields
Per job: PBCC funds date + amount, crew paid date + amount + note, Claro final payment date + amount; document inbox with sent-by/date/read status.

### 5.6 Notifications
- Karmen notified when a new document lands in her inbox.
- Lissette notified on each funds-received entry.

### 5.7 Edge cases
- Amount received ≠ expected (80% of invoice) → record actual, discrepancy flagged to Lissette.
- Funds arrive for a job whose crew was reassigned mid-job → crew payment screen shows the crew history so she pays the right one.

### 5.8 Acceptance criteria
- A PBCC request generated by Lissette appears in Karmen's portal without printing or email.
- Karmen recording funds fires Lissette's alert; recording both payments unlocks Lissette's close.
- Crew payments are traceable per job.

---

## 6. Admin

### 6.1 Purpose
The full-visibility, full-control account (Kay / Monica / Alex): manage who can log in, what services cost, and which crews exist — and see everything happening in every department.

### 6.2 What they see
- Every department's dashboard/queues (Supervisor, Warehouse, Crew, Finance, Comptroller) in read mode, plus any work order at any status with its complete history (status changes, edits, address corrections, send-backs, documents, payments).

### 6.3 What they can do
| Area | Details |
|---|---|
| **Users & accounts** | Create/deactivate users, assign roles (now **seven**: supervisor, warehouse, brigade crew, installer, finance, comptroller, admin), reset passwords. |
| **Service Catalog** | Add/edit Claro service codes (e.g., 34006428 REMOCION MENSAJERO), descriptions, **unit prices**, account codes (6200/6210), department (PWOR). Prices here drive the JAF invoice math — see §7 bug fixes. |
| **Crews & personnel** | Maintain the crew list — both **brigades** (name, members, active/inactive) that supervisors assign jobs to, and **installers/vans**, including each van's **standard stock levels** (the par levels that decide when a restock request needs sign-off, §3B). |
| **Restock sign-offs** | Approve/deny installer restock requests that exceed the van's standard stock level (supervisors can also do this). |
| **Admin Settings** | Existing settings, plus notification thresholds (e.g., aging alert days) if practical. |

### 6.4 Acceptance criteria
- Admin can create a user in any of the six roles and manage catalog entries with prices that display and calculate correctly.
- Admin can open any work order and see its full history end to end.

---

## 7. Cross-cutting: bug fixes, documents, scope

### 7.1 Known bugs — must be fixed early in Phase 2 (before any CEO/IT demo)
1. **Service Catalog "Unit Price" shows "NaN"** — pricing isn't wired; this now also blocks the JAF invoice generation (§1), so it's a functional fix, not cosmetic.
2. **Materials dropdown shows raw database IDs** (e.g., `cmrjdpp260007qwlli7069vb9`) instead of service names — affects Supervisor create screen and Warehouse prep view.

### 7.2 Document formats
- **PBCC payment request** and the **final Claro document**: real samples from Lissette are **already in Juan's hands** (via Kay). The system's generated PDFs must match those samples exactly.
  - *Implementation note (2026-08-08):* the Finance section now generates both PDFs from the job data. The field order, totals, and wording are based on the PRD; the exact layout still needs to be compared field-by-field against Lissette's samples and adjusted if the columns, labels, or signature block differ.
- **JAF invoice PDF**: generated from job service codes × catalog unit prices; layout to match JAF's current invoice (Juan to confirm template with Kay).
- Claro's portal is manual data entry — no integration; the system only needs to display/store everything Lissette copies in.

### 7.3 Status flow (updated with Phase 2 detail)
`Created → Prepped → Signed (crew pickup signature) → Field Updated → Supervisor Approved → [Finance: Verify → PBCC Request → 80% Funded → Waiting PO → Uploaded to Claro → Final Paid] → Closed`
Send-backs: Supervisor→Crew (field issues) and Finance→Supervisor (Aviso issues). Cancellation possible up to close, with reason.

### 7.4 Notifications summary (all roles)
Every department is alerted when a job lands in its queue: Warehouse (new prep / new restock request), Brigade crew (kit ready / send-back / reassignment), Installer (restock ready for pickup), Supervisor (field update submitted / missing-material flag / Aviso send-back / restock sign-off needed), Finance (approved job with docs / funds recorded by Karmen), Karmen (new document). Plus aging alerts on the long Claro waits.


