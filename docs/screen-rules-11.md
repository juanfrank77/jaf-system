# Screen Rules: Business Constraints (11 Screens)

**From JAF Ops Design System Guide § "Screen rules"**

These are **not UI polish** — they are real business constraints the mockups enforce in JavaScript. Every one must survive the port; they keep stock, invoices, and payments honest.

---

## The Pattern: Three Validation Shapes

| Shape | When | How It Looks | Examples |
|-------|------|--------------|----------|
| **Flag and flow** | Human deviation that a later step must judge | Amber chip on row, amber input border, nothing blocked | Over-draw at pickup · installed ≠ ordered · return over expected |
| **Gate** | Evidence incomplete, action cannot be trusted yet | Button disabled with live note naming exactly what's missing | Two signatures · serial scanned · reference entered · note written · 7-item release gate |
| **Hard block** | Two systems of record disagree about money | Red chip, record cannot advance by any route | Aviso ≠ invoice · "Used" > "Took" · incomplete install not payable |

---

## Per-Screen Rules

| Screen | Rule | Where Enforced Today | Gap | Severity |
|--------|------|----------------------|-----|----------|
| **1. Warehouse · Pickup (step 3)** | | | | |
| | Over-pull allowed — row flags `+2 more than listed` (amber), never blocks | [`_app.docs.$id_.sign.tsx`](../app/routes/_app.docs.$id_.sign.tsx) variance logic | Check: does input border turn amber? Does supervisor see delta in toast? | MEDIUM |
| | Release disabled until **both** signature pads signed (not one, not checkbox) | Dual-sig gate logic | Check: can release fire with 1 sig? | **CRITICAL** |
| | On release: inputs disable, stock moves, toast **names deltas to supervisor** | Stock deduction + notification | Check: supervisor notified with item names? | HIGH |
| **2. Warehouse · Returns** | | | | |
| | **Short** (returned < expected) → red chip + note **required** + logged as discrepancy **not consumption** | [`_app.docs.$id_.returns.tsx`](../app/routes/_app.docs.$id_.returns.tsx) | Check: note enforced? Logged separately from consumption? | **CRITICAL** |
| | **Over** (returned > expected) → amber chip + flags to supervisor for invoice review | Returns reconciliation | Check: supervisor sees "crew under-reported?" flag? | HIGH |
| | **Exact** → green chip, gate item 7 goes green for supervisor | Supervisor release gate | Check: gate item 7 computed from returns reconciliation? | MEDIUM |
| **3. Crew · Field Update (step 4)** | | | | |
| | Address edit reveals **diff live** — original struck, correction green + crew + time + GPS | [`_app.docs.$id_.field.tsx`](../app/routes/_app.docs.$id_.field.tsx) | Check: does `.diff` component exist? GPS captured? | MEDIUM |
| | Photo capture inserts **timestamped photo** + caption recounts "Before 1 · After 2 · ready" | Photo upload + counter | Check: caption updates live? | LOW |
| | **"Used" can never exceed "Took"** — clamped back, toast says why | Field update validation | **GAP**: client-side clamp + backend validation needed | **CRITICAL** |
| | Send-back: **Resubmit disabled until requested photo retaken**, rest of report kept | Send-back gate | Check: only flagged photos required, not full resubmit? | HIGH |
| **4. Lissette · List to Carmen** | | | | |
| | Checkbox per account → excluded rows drop to **45% opacity** (not disappear) | [`_app.finance.queue.tsx`](../app/routes/_app.finance.queue.tsx) assumed | Check: excluded rows visible at 45%? | LOW |
| | Total + account count **recalculate live** from included rows | Run list builder | **GAP**: run-builder screen doesn't exist yet | MEDIUM |
| | Regenerate rebuilds from **funded packets only** | Run regeneration logic | **GAP**: packet entity doesn't exist (#33) | MEDIUM |
| | Send stamps time, flips to `in Carmen's inbox · 0 of 5 checked`, notifies Carmen | Send action | **GAP**: check-off state doesn't exist (#38) | HIGH |
| **5. Lissette · LC Advance** | | | | |
| | **PBCC request send is the moment arm B starts ageing** — toast says "Arm B aging starts now" | [`_app.docs.$id_.lc.tsx`](../app/routes/_app.docs.$id_.lc.tsx) / [`_app.finance.pbcc.$id.tsx`](../app/routes/_app.finance.pbcc.$id.tsx) | **GAP**: `brigadePaidAt` field doesn't exist (#40) | **CRITICAL** |
| **6. Carmen · Run Check-Off** | | | | |
| | Check-off is **one-way** — checked row cannot be unchecked | Comptroller screens (flagged) | **GAP**: Carmen screens mostly missing | **CRITICAL** |
| | ACH reference auto-fills, then **input disables** | Check-off flow | **GAP**: entire check-off flow missing | **CRITICAL** |
| | **Five surfaces move from one click**: row chip, Lissette's count, run status, inbox KPI, retention hero | Atomic transaction | **GAP**: transaction spans 5 updates; must be atomic | **CRITICAL** |
| | Final check-off: green banner appears, retention advances, new row in Paid runs, Lissette's list clears | Check-off completion | **GAP**: end-of-run flow missing | HIGH |
| **7. Carmen · Installer Pay** | | | | |
| | Pay on row opens form, prefills order, **scrolls into view** | Installer pay queue | **GAP**: Carmen installer screens missing | MEDIUM |
| | Save disabled until **payment reference entered** (no reference, no payment) | Payment reference gate | **GAP**: reference field doesn't exist (#37) | **CRITICAL** |
| | **Incomplete** request (missing serial/photo) **cannot be selected** at all | Completeness check | Check: computed from `InstallLog` + `Photo`? | **CRITICAL** |
| **8. Installer · New Completion** | | | | |
| | Address edit reveals diff (same as crew field update) | [`_app.installer.install.tsx`](../app/routes/_app.installer.install.tsx) | Check: diff rendering exists? | MEDIUM |
| | **Scan slot must be filled before Next enables** — resolves to "ALCLED1A5220 · Nokia G-240W · on Van 12 ✓" | Serial scan gate | **GAP**: serial lookup doesn't exist (#52) | HIGH |
| | Drop footage picks **bracket 250/500/750 FT**, accessory table refills with defaults, installer adjusts | Footage bracket logic | **GAP**: bracket table doesn't exist (#50) | HIGH |
| | Submit gated on **form photo + signature**, live note: "Missing: form photo, signature" | Completion gate | Check: gate note updates live? | MEDIUM |
| **9. Warehouse · Prep (step 2)** | | | | |
| | **Flag missing → notify supervisor** is first-class action (not error) — order to "to prep · waiting on supervisor" | [`_app.docs.$id_.prep.tsx`](../app/routes/_app.docs.$id_.prep.tsx) assumed | Check: flag-missing action exists? Supervisor notified? | HIGH |
| | Falling under minimum pre-fills material request | Stock-level check | **GAP**: reorder minimums don't exist (#15) | MEDIUM |
| **10. Installer · Swap** | | | | |
| | **One action, four consequences**: old serial → return, new serial → installed, callback → Carmen, warehouse + supervisor notified | Swap flow | **GAP**: swap screen doesn't exist | HIGH |
| **11. Supervisor · Release (step 8)** | | | | |
| | **7-item gate** — release disabled until all seven green, warehouse's action un-disables it live | [`_app.docs.$id_.review.tsx`](../app/routes/_app.docs.$id_.review.tsx) release gate | **GAP**: 7-item gate entity doesn't exist (#32) | **CRITICAL** |
| | **Aviso amount ≠ invoice is hard block** — job cannot reach step 8 by any route | Transition guard | **GAP**: backend guard missing in [`permissions.ts`](../app/lib/permissions.ts) | **CRITICAL** |

---

## Critical Gaps Summary (Highest Risk)

| Rule | Why Critical | Action |
|------|-------------|--------|
| **Used ≤ Took clamp** | Crew field update | Add client clamp + backend validation; keeps returns reconciliation honest |
| **Aviso hard block** | Supervisor release | Add backend transition guard; protects money control |
| **Carmen 5 surfaces atomic** | Run check-off | Must be one transaction; disagreement costs money |
| **PBCC → ageing starts** | LC advance | Must set `brigadePaidAt`; collections reporting depends on this |
| **Incomplete installer not payable** | Carmen installer queue | Computed completeness check must block selection |
| **7-item release gate** | Supervisor release | All seven must be green; one (returns) owned by warehouse |

---

## Notice: No Modal Confirmations

**"There is not one [modal confirmation dialogue] in all seven sheets. Consequence is communicated by gating beforehand and by an irreversible flip afterwards, never by asking 'are you sure?'."**

All destructive actions use the **gate → flip → chip** pattern, not modal prompts.
