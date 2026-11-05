---

## 5. Definition of Done (every service, Phases 7–13)

A service moves from `coming_soon` to `live` only when all of these hold:
1. **Registry entry** with accurate `dependsOn`, `startsIn`, `category`, metadata.
2. **Route gating:** `protect`, `tenantContext`, `subscriptionGate(key)` with a key that **exists in the registry** (lint-tested). One failure code: **`FEATURE_NOT_IN_PLAN`**. Workers call `getEntitlements()`.
3. **Quota hooks:** anything that creates students, staff or admin-class users goes through `withQuota` (per unit of work; creation and restore only, never transfers).
4. **Tests** per §5.1.
5. **Catalog and UI badge:** status `live` and `/services` reflects it.

### 5.1 Standard contract-test set (every phase)
1. Tier access allowed, and blocked with `FEATURE_NOT_IN_PLAN` on the tier below.
2. Read-only and suspended behaviour per service (definitions in §8.0.3).
3. Cross-tenant ID returns 404.
4. Quota enforcement where applicable.
5. Worker idempotency (running twice delivers once).
6. Registry count test with the updated totals.

### 5.2 Cross-cutting rules
Audit existing models first; follow the §8.0 foundations (settings registry, `JobRunLog` claims and `xact` locks, outbox handler registry with dead-letter safety, storage classes); every new model has `college_id` and nullable `campus_id`; no hard-coded fees, thresholds or times.

---

## 6. Open Decisions

### 6.1 Phase 6 and 6.2 Phase 7
OD-01 to OD-10 are unchanged from the sealed phases. OD-04's `isCanteenCashier` is replaced by the `canteen:cashier` permission once N10 ships.

### 6.3 Phases 8–13

| # | Decision | Status | Resolution or Recommendation |
|:---|:---|:---|:---|
| OD-11 | Parent login (#83) | **RESOLVED** | Roll number + 8-char guardian PIN (bcrypt, account lockout, IP throttle, generic errors, audited admin reset). Active session/student disambiguator. Guardians never count toward quotas. |
| OD-12 | Online payment gateway (#82) | **DEFERRED** | `coming_soon`; adapter interface only. Fee proofs reuse `PaymentProof` and count toward tenant storage quota. |
| OD-13 | N06 rate-limit window | **RESOLVED** | Calendar month (`YYYY-MM`), DB-atomic counter, hard 429. |
| OD-14 | AI credit ratio | **ACTIVE NOW** | Measure #99 to #102 token costs now via `TokenCostSample`. |
| OD-15 | Campus model | **RESOLVED** | Campuses inside one tenant, `campus_id` on Section/Class only (§10.1). |
| OD-16 | N07 optional vs enforced | **RESOLVED** | Optional by default; `require2FAForAdmins` enforces via an enroll-only session after a grace period. Mandatory for Super Admin accounts. |
| OD-17 | N08 offline scope | **RESOLVED** | Read-only caches only (timetable and assigned section rosters). |
| OD-18 | N02 sample files per BISE board | **RESOLVED: Non-blocking for P8** | Does not block Phase 8; blocks N02 only. Build N02 around data-driven JSON board column profiles so adding a board requires config, not code. |
| OD-19 | N06 v1 scope | **RESOLVED** | Read-only: students, attendance, fees, classes, sections. |
| OD-20 | Bulk-import chunk failure | **RESOLVED** | Commit valid rows, generate error CSV of failed rows, undo via `importJobId` and recycle bin. |
| OD-21 | Row caps (Export & Import) | **RESOLVED** | **Export caps:** 1,000 (Starter), 10,000 (Standard), 100,000 (Premium), 1,000,000 technical streaming ceiling (Enterprise). Attendance exported in monthly matrix form (1 row per student) to prevent raw daily explosion.<br/>**Import caps:** 1,000 (Starter), 5,000 (Standard), 10,000 (Premium), 25,000 (Enterprise) rows per job. Marks imports capped by file size or subject matrix. |
| OD-22 | ZKTeco Biometric Ingress | **RESOLVED** | **Path B (HTTPS bridge agent with per-device bearer secret)** is the safer default; Path A (native `/iclock/*`) supported on a dedicated ingress host for sites with configurable ADMS host/port. |
| OD-23 | Backup archive ceiling | **RESOLVED** | 250–300 MB per volume, 1 GB total for self-contained archives; above that, deliver via re-issuable signed links. Streamed directly to R2 multipart upload, never buffered in memory. |
| OD-24 | N16 Legal hold terminology | **RESOLVED** | Approved as "Legal Hold (Delete Protection)". Not evidence-grade record freeze; edits remain allowed and audited. Held files continue counting toward storage quota. |

---

## 7. Audit Findings: Reality vs. Prior Assumptions

All Phase 1–7 findings from the previous version remain valid. New findings:

| Finding | Prior assumption | Reality | Impact |
|:---|:---|:---|:---|
| Group model | New `AcademicGroup` | `Group(college_id, class_id, name, seats?, feeNote?)` exists | 8A adds seat-allocation and fee-schedule tables only; `Group.seats` deprecated |
| Payment proofs | New `FeePaymentProof` | `PaymentProof` (#75) exists | #82 reuses it |
| Leave models | `LeaveApplication` is staff leave | It is **student** leave; the audit found no `StaffLeave` model | #80 needs the real staff leave model; N24 extends `LeaveApplication` |
| Attendance model name | `DailyAttendance` | Actual model is `Attendance` | Phase 8 attendance services query `Attendance` with composite unique on `(college_id, session_id, student_id, date)` |
| Guardian data | needs new identity | `guardianName/Phone/Relation/Cnic` already on `Student` | `GuardianSession` stores only PIN hash and lockout state |
| Campus model | `CampusGroup` across tenants | No `Campus` or `campus_id` anywhere | Option B (§10.1) |
| `UPGRADE_REQUIRED` | used by N10 | gates use `FEATURE_NOT_IN_PLAN` | one code everywhere |
| Storage categories | exempt categories are safe | 7A reconciliation excludes only `receipts/`; `reserve-upload` accepts client-chosen categories | Retrofit in §8.0.6: client-uploadable separate from server-exempt |
| Advisory locks | `pg_try_advisory_lock` is fine | Session-level locks are unsafe behind Neon's pooler | `xact` locks or `JobRunLog` claims; 6C worker retrofit |
| `OutboxEvent` | queue for any async work | 3 attempts, notification semantics, `eventType` field | Heavy jobs use claimed tables; dead-letter queue added for failed dispatches |
| N05 | `pg_dump` | Shared multi-tenant database | Tenant-scoped row export |
| `CollegeEntitlementAudit` | safe to export | holds internal notes and Super Admin IPs | N17 exports a sanitized subset |
| §1 backup row | "Premium: 1 request/quarter" | N05 is Enterprise-only | Pricing copy corrected |
| Document corruption | n/a | Earlier scripts corrupted backslashes, `$`, tabs and some Unicode in 6C/7C/7D | 7C and 7D rewritten; remaining sealed text normalized |

## 8. Revision Log (v4 — Complete Master Blueprint)
v4 resolves all review items across Phases 8–13:
1. **Biometric Path B & Simulator (8E):** Path B only (`POST /api/biometric/devices/:deviceId/punches` with per-device bearer secret, device id in URL, `pushSecretHash`), plus `simulateBiometricPunches.js` dev harness. Feature #79 stays `coming_soon` in registry until physical devices exist. Native `/iclock/*` routes deferred.
2. **Storage Category Security (§8.0.6):** Whitelists client-uploadable categories vs server-exempt categories (`EXPORTS`, `BACKUPS`, `REPORTS`, `RECEIPTS`, `IMPORT_SOURCE`); excludes all exempt categories from quota reconciliation; fee proofs count toward tenant quota.
3. **Bulk Import Architecture (8C):** Pre-checks quota at commit start; enforces `withQuota` per chunk; chunk failure yields `PARTIAL` without rolling back committed chunks; `importJobId` added to Student and User; background claimed worker with heartbeat + reaper; invite-based staff passwords.
4. **Group Seats & Quotas (8A):** Deprecates `Group.seats`; enforces session-aware `GroupSeatAllocation` under advisory lock; restricts `withQuota` strictly to student creation and restore.
5. **Parent Portal & Messaging (8F & 8G):** Introduces `GuardianNotification` model; typed recipients in `MessagingAdapter`; 8-character PIN with account lockout and DB-backed IP throttle; active student/session roll number disambiguation; separate `/parent/` service worker scope; messaging layer built before parent portal.
6. **Staff Attendance Denominator (8D/8J):** End-of-day job creates `ABSENT` rows for unmarked active staff (excluding leaves/off-days) to prevent percentage inflation; `DEFERRED_PROCESSING` status added; fee recovery cohort strictly defined (`dueDate` in period).
7. **Absence Alert Catch-Up (8I):** Eliminates 2-minute run window; re-runs until daily cutoff; skips unmarked sections; idempotency per student per day.
8. **Credit Pack Order Rejection (8F):** Rejected in `calculate-total` and `submit-payment` before payment via `isPurchasable = false`; removes misleading `[SMS Notice]` tag.
9. **Transaction-Scoped Locks:** Replaces all session advisory locks with `pg_try_advisory_xact_lock` or `JobRunLog` claims across 6C, 8E, 8H, 8I.
10. **Dead-Letter Queue:** Outbox worker adds `DEAD_LETTER` state, manual retry endpoint, and alert notifications.
11. **Contradictions Resolved:** Downgrades unified as `type = 'DOWNGRADE'`; timetable swap unified as single-transaction negative periodNumber swap; reminder idempotency keys on `periodEndDate`; `RECEIPTS` constant unified; export keys unified; N05 confirmed Enterprise-only; statement trigger added for `MealAccountTransaction` truncate.
12. **Complete Full-Detail Specs for Phases 11, 12, 13:** Detailed schemas, API contracts, business invariants, DoD, and automated contract test matrices across all 41 remaining services.
