### Phase 8: College Operational Services (12 Services; 8 go LIVE, 4 stay `coming_soon`)

> [!IMPORTANT]
> **Registry outcome:** 90 live (Phase 7) + 8 = **98 live + 63 roadmap = 161 total.** #79 (Biometric Hardware), #82 (Payment Gateway), #84 (SMS) and #85 (WhatsApp) stay `coming_soon`.
> **Build order:** 8.0 foundations (Outbox Hardening & Storage Whitelist) → 8A #29 → 8B #28 → 8C #27 → 8D #80 → 8E #79 (Path B + Simulator) → 8F messaging layer → 8G #83 → 8H #81 → 8I #86 → 8J #87 → 8K #82 (adapter only).
> The messaging layer (8F) is built **before** the parent portal (8G) because the portal's notification feed depends on it. The campus model is decided once, in Phase 10 §10.1.

#### 8.0 Foundations (build and test before 8A)

##### 8.0.1 Pre-coding audit checklist (output goes in `docs/phase8_audit.md`)
The Phase 8 plan names several models from memory. Resolve each against `schema.prisma` before writing any migration:

| Concept | Known so far | Action |
|:---|:---|:---|
| Academic group | `Group(id, college_id, class_id, name, seats?, feeNote?, isActive)` exists | Extend, never duplicate (8A). |
| Payment proof (#75) | `PaymentProof(… fee_id, method, amount, transactionId, file_id, status …)` exists | #82 reuses it (8K). |
| Student leave | `LeaveApplication` (has `student_id`) exists | It is the **student** leave model. N24 (Phase 11) must extend it, not create a parallel one. |
| Staff leave (#63) | **A grep for `StaffLeave` found no model** | Find the real #63 leave model name and use it for #80 `ON_LEAVE` derivation. |
| Student attendance | **A grep for `DailyAttendance` found no model** | The real model is `Attendance` with composite unique `(college_id, session_id, student_id, date)`. |
| Staff invite | `staffInvite.controller.js` exists | Reused by 8C staff import. |
| Notifications | `notification.controller.js` exists (user-addressed) | Guardians are not users, so 8F adds a guardian feed. |
| Settings | `CollegeSetting(college_id, key, valueJson)` exists | See 8.0.2. |
| Report Center (#77) | exists | Check before adding any new report/PDF endpoints. |

##### 8.0.2 `CollegeSetting` (audit, then define)
Audit whether `College` already carries settings columns or a JSON blob. If not, add:
```prisma
model CollegeSetting {
  id         String   @id @default(uuid())
  college_id String
  key        String
  valueJson  Json
  updatedBy  String?
  updatedAt  DateTime @updatedAt
  @@unique([college_id, key])
}
```
All keys are declared in `backend/config/settingsRegistry.js` with a type, validator, human label and a **registry default**. Business logic never contains a literal fee, threshold, time or window: it calls `getSetting(collegeId, key)`, which returns the college's row or the registry default. The "no hard-coded defaults" rule means *no literals in schema or logic*; defaults live only in this registry and are shown in the settings UI.

Phase 8 keys: `attendance.weeklyOffDays`, `attendance.terms`, `attendance.shortageThresholdPct`, `attendance.shortageRenotifyDropPct`, `staff.shiftStartTime`, `staff.graceMinutes`, `staff.halfDayAfterMinutes`, `absence.alertTime`, `absence.cutoffTime`, `kpi.lateCountsAsPresent`, `kpi.minCoveragePct`, `biometric.timezone`, `biometric.maxBackfillDays`, `diary.editWindowHours`, `parent.pinAttemptLimit`, `parent.lockoutMinutes`, `twofa.enforcementGraceDays`, `api.rateLimitPerMinute`, `pwa.cacheMaxAgeHours`.

##### 8.0.3 Suspended versus read-only (applies to every service)
| State | Meaning | Behaviour |
|:---|:---|:---|
| **Read-only** (`forceReadOnly`: expired, trial-expired, manual) | Users can log in | Reads, exports, PDFs work. Writes are blocked except the **read-only write whitelist** (below). |
| **Suspended** (`subStatus = SUSPENDED`) | Login blocked; JWTs revoked via `tokenEpoch` | Nothing works for tenant users, guardians or API keys. Unauthenticated device endpoints may still **store** punches and callbacks; their processing is deferred until the college is active again. Workers skip the college. |

**Read-only write whitelist** (a single constant `READONLY_WRITE_WHITELIST` consumed by `subscriptionGate`): shift close, file delete (to free space), export creation (`POST /api/exports`), backup request, logout, `POST /api/parent/notifications/:id/read`. Every new write endpoint must state whether it joins the whitelist.

##### 8.0.4 `JobRunLog` and worker concurrency
**Session-level `pg_try_advisory_lock` is unsafe behind Neon's pooler** (the lock can outlive or leave the pooled connection). Phase 8+ workers use one of:
1. **`pg_try_advisory_xact_lock(key)` inside a transaction**, for work that fits in one transaction; or
2. **A claim row** for longer work: an `INSERT … ON CONFLICT DO NOTHING RETURNING` into `JobRunLog`, with a heartbeat and a reaper.
```prisma
model JobRunLog {
  id          String    @id @default(uuid())
  college_id  String    // use the platform sentinel 'PLATFORM' for global jobs
  jobKey      String
  runKey      String
  status      String    @default("RUNNING") // RUNNING | DONE | FAILED
  claimedBy   String?   // instance id
  startedAt   DateTime  @default(now())
  heartbeatAt DateTime  @default(now())
  finishedAt  DateTime?
  summary     Json?
  @@unique([college_id, jobKey, runKey])
  @@index([jobKey, status, heartbeatAt])
}
```
A `RUNNING` row whose `heartbeatAt` is older than the job's timeout is reclaimable by the reaper. **Retrofit:** the existing 6C `subscriptionLifecycleWorker` uses `pg_try_advisory_xact_lock` inside `$transaction`. Longer jobs in 8C, 8E, 8H use `JobRunLog` claims.

Every worker must also: check `getEntitlements(collegeId)` per college, skip suspended colleges, and fan out notifications through `OutboxEvent`.

##### 8.0.5 `OutboxEvent` Hardening & Conventions (Build BEFORE 8A)
The column is **`eventType`** (not `type`). Every new `eventType` must be registered in the outbox worker's **handler registry**; an unregistered type is a startup error. New types in Phases 8–10: `DIARY_ENTRY_CREATED`, `IN_APP_MESSAGE`, `SHORTAGE_NOTICE_ISSUED`, `ABSENCE_ALERT`, `NEW_DEVICE_LOGIN`, `APPROVAL_PENDING`, `APPROVAL_DECIDED`, `EXPORT_READY`, `STAFF_INVITE`.

**Outbox Hardening (Built First):**
1. **`status = 'DEAD_LETTER'`**: An event that exhausts its 3 attempts is transitioned to `DEAD_LETTER` with `failedAt = NOW()` and `lastError`.
2. **Super Admin Dead-Letter Queue**: `GET /api/super-admin/outbox/dead-letter` provides pagination and college filtering.
3. **Manual Retry Endpoint**: `POST /api/super-admin/outbox/:id/retry` resets `status = 'PENDING'`, `attempts = 0`, and `nextAttemptAt = NOW()`.
4. **Super Admin Alert**: When an event transitions to `DEAD_LETTER`, an in-app Super Admin alert is automatically created.
5. **Batched Fanout**: Worker claims and dispatches notifications in chunks of 200 recipients per dispatch tick. Heavy background work (bulk import, export generation, backups) uses claimed job tables, never the outbox.

##### 8.0.6 Storage categories (retrofit of 7A)
Two classes of category:

| Class | Categories | Who may write | Counts toward quota |
|:---|:---|:---|:---|
| **Tenant-counted** | `PHOTOS`, `CIRCULARS`, `EXAM_PAPERS`, `SYLLABUS`, `FEE_PROOFS`, `DIARY_ATTACHMENTS`, `GENERAL` | Client via `reserve-upload` | Yes |
| **Server-exempt** | `EXPORTS`, `BACKUPS`, `REPORTS`, `RECEIPTS`, `IMPORT_SOURCE` | **Server code only** | No (TTL-purged) |

Required changes to Phase 7A code:
1. `reserve-upload` and `finalize-upload` accept **only** the tenant-counted allow-list. A client-supplied exempt category returns 400 `CATEGORY_NOT_ALLOWED`.
2. `storageReconciliationService` excludes **every** server-exempt prefix (`tenants/{id}/{EXPORTS|BACKUPS|REPORTS|RECEIPTS|receipts|IMPORT_SOURCE}/`), not just `receipts/`. It must never register them as `StoredFile`.
3. Each exempt category has a TTL purge worker: `EXPORTS` 24 h, `REPORTS` 24 h, `RECEIPTS` 15 min signed URLs, `IMPORT_SOURCE` 48 h after the job's terminal state, `BACKUPS` per N05.
4. `IMPORT_SOURCE` is written by the import endpoint after it receives the multipart body (not via `reserve-upload`). Abuse is bounded by the tier's `maxUploadBytes`, one active import per college and the 48 h TTL.
5. **Fee proofs and diary attachments count toward quota.**

##### 8.0.7 Gating, quota and test rules
* Every route uses `subscriptionGate(key)`; **keys must exist in `FEATURE_REGISTRY`.** Add a **registry-key lint test** that scans all `subscriptionGate('…')` literals and fails on any key not in the registry (this also protects the 161-service count tests). Gate failure code is always **`FEATURE_NOT_IN_PLAN`**.
* `withQuota` is a **single transaction**, so it is called per unit of work (per student creation, per import chunk), never "reserved up front".
* Every new model carries `college_id`; every phase has cross-tenant-ID tests (404).

##### 8.0.8 Campus Column Population Rule
* Every new model carries a nullable `campus_id String?`.
* For class/section-scoped entities (`ClassDiaryEntry`, `AcademicCalendarEvent`), `campus_id` is automatically populated from `section.class.campus_id` or `class.campus_id`.
* For `GroupSeatAllocation` and `GroupFeeSchedule`, `campus_id` is populated from `group.class.campus_id` when set.
* For `BulkImportJob` and `BiometricDevice`, `campus_id` is an optional administrative assignment.
* If multi-campus is not enabled or for single-campus colleges (Phases 1–9), `campus_id` defaults to `NULL` (representing the primary / default campus).
* Staff campus filtering in 8J and N18: when a `campusId` filter is provided, staff are filtered by primary department/section campus or included in all if unassigned.

##### 8.0.9 Authorized Leave Handling Invariant
* `LEAVE` rows in `Attendance` (student leave) and `StaffAttendance` (staff leave) represent authorized absences.
* In attendance percentage metrics (#41, #81, #87), `LEAVE` rows are **strictly excluded from BOTH numerator and denominator**:
  $$\text{attendancePct} = \frac{\text{present}}{\text{present} + \text{absent} + \text{late}} \times 100$$
* Students or staff on authorized leave are never penalized as absent or counted against shortage thresholds.

---

#### 8A: #29 Group-Wise Fee, Seats & Section Allocations (Starter)

* **Institutional Job:** per-session seat quotas and effective-dated fee structures for each academic group (FSc Pre-Medical, ICS, I.Com, FA).
* **Audit-first:** extend the existing `Group` model; **do not create `AcademicGroup`**.
* **Single source of truth for seats:** `GroupSeatAllocation` is authoritative. `Group.seats` is **deprecated**: a one-off migration copies it into a `GroupSeatAllocation` row for the active session, after which the column is no longer read or written (kept physically to avoid a destructive migration). Two live sources are not allowed.
* **No defaults:** capacity and fees have no `@default`; the admin must supply them.
```prisma
model GroupSeatAllocation {
  id           String   @id @default(uuid())
  college_id   String
  group_id     String
  session_id   String
  campus_id    String?  // nullable now; FK added by the Phase 10 campus migration
  seatCapacity Int
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([college_id, group_id, session_id])
  @@index([college_id, session_id])
}

model GroupFeeSchedule {
  id              String   @id @default(uuid())
  college_id      String
  group_id        String
  session_id      String
  effectiveFrom   DateTime @db.Date
  monthlyFeePkr   Int
  admissionFeePkr Int
  registrationFeePkr Int
  createdById     String
  createdAt       DateTime @default(now())
  @@unique([college_id, group_id, session_id, effectiveFrom])
  @@index([college_id, group_id, session_id])
}
```
* **Invariants:**
  1. `enrolledCount` is **derived** (`COUNT(Student WHERE group_id, session_id, status enrolled)`), never stored.
  2. **Seat check:** inside a transaction take `pg_advisory_xact_lock(hashtext('group_seats_' || group_id || '_' || session_id))`, derive the count, reject with 409 `SEATS_FULL` if `enrolled >= seatCapacity`.
  3. **Group transfer (#9):** repeats the seat check on the destination under the same lock. It **does not touch the student quota**.
  4. **Quota hook (corrected):** only **student creation** and **restore from the recycle bin** call `withQuota('students', 1)`. Group assignment and transfer never do, because the head-count is unchanged.
  5. **Fee snapshot:** a voucher reads `GroupFeeSchedule` with the greatest `effectiveFrom <= voucherDate` and stores the amounts on the voucher line, so later fee changes do not alter issued vouchers.
* **APIs:** `GET/POST /api/groups`, `PUT /api/groups/:id`, `POST /api/groups/:id/seat-allocations`, `POST /api/groups/:id/fee-schedules`, `GET /api/groups/:id/fee-schedule?date=`. Gate key: the registry key for #29.
* **Definition of Done:**
  - [ ] `Group.seats` migrated to `GroupSeatAllocation` and no longer read.
  - [ ] Seat check uses the transaction advisory lock and a derived count.
  - [ ] Fee voucher snapshots from `GroupFeeSchedule` by effective date.
  - [ ] Transfer respects destination seats and does not call `withQuota`.
  - [ ] Student creation and recycle-bin restore call `withQuota`.
  - [ ] Cross-tenant group ID returns 404.

---

#### 8B: #28 Student Diary & Academic Events Calendar (Standard)

* **Institutional Job:** daily class agenda and homework per section and subject, plus an institutional calendar for students, staff and guardians.
```prisma
model ClassDiaryEntry {
  id           String   @id @default(uuid())
  college_id   String
  campus_id    String?  // Pre-wired for Phase 10 multi-campus isolation
  section_id   String
  subject_id   String
  teacher_id   String
  entryDate    DateTime @db.Date   // PKT date
  periodNumber Int      @default(1) // Supports double lectures and practical split batches
  topicCovered String
  homework     String?
  remarks      String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  attachments  ClassDiaryAttachment[]
  @@unique([college_id, section_id, subject_id, entryDate, periodNumber])
  @@index([college_id, section_id, entryDate(sort: Desc)])
}

model ClassDiaryAttachment {
  id         String @id @default(uuid())
  college_id String
  campus_id  String?
  entry_id   String
  file_id    String   // StoredFile.id, category DIARY_ATTACHMENTS (counts toward quota)
  entry      ClassDiaryEntry @relation(fields: [entry_id], references: [id], onDelete: Cascade)
  @@unique([entry_id, file_id])
  @@index([college_id, file_id])
}

model AcademicCalendarEvent {
  id             String   @id @default(uuid())
  college_id     String
  campus_id      String?  // Pre-wired for Phase 10 multi-campus isolation
  title          String
  description    String?
  eventType      String   // HOLIDAY | EXAM_SESSION | TEST_DAY | SPORTS | ADMISSION | RESULT_DAY | GENERAL
  startDate      DateTime @db.Date
  endDate        DateTime @db.Date
  targetAudience String   // ALL | STUDENTS | STAFF | PARENTS (required, no default)
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([college_id, startDate, endDate])
  @@index([college_id, eventType, startDate])
}
```
* **Invariants:**
  1. **Teacher write scope (#18):** a teacher may write only for `(section, subject)` pairs present in `TeacherSubject`; otherwise 403 `NOT_YOUR_SECTION`. Admin/principal may write for any.
  2. **Attachments** are `StoredFile` rows linked through `ClassDiaryAttachment` (referential integrity and cascade), uploaded with category `DIARY_ATTACHMENTS`.
  3. **One entry per section/subject/day/periodNumber.** Supports double lectures, split practical batches, and separate period agendas. Edits are allowed within `diary.editWindowHours`.
  4. **Shared `workingDaysService.js`:**
     * `getWorkingDays(collegeId, from, to, { campusId? })` = calendar days minus `attendance.weeklyOffDays` minus `HOLIDAY` events.
     * `getMarkedDays(collegeId, sectionId, from, to)` = days on which at least one `‹StudentAttendance›` row exists for that section.
     * #81, #86 and #87 all import these two functions; none re-implements them.
  5. **Fan-out:** creating an entry writes `OutboxEvent(eventType = 'DIARY_ENTRY_CREATED')` in the same transaction; the registered handler notifies section students and (through 8F) guardians.
  6. **Parent visibility:** events with `targetAudience = 'PARENTS'` or `'ALL'` appear in the parent portal (8G). `AnnouncementAudience` is extended with the `PARENTS` audience type (deferred from Phase 7B) in 8G.
* **APIs:** `POST/PUT /api/diary/entries`, `GET /api/diary/entries?sectionId=&from=&to=`, `POST/GET /api/calendar/events`, `GET /api/calendar/working-days`.
* **Definition of Done:**
  - [ ] Teacher scope enforced against `TeacherSubject`.
  - [ ] Attachments linked by `ClassDiaryAttachment` and counted toward quota.
  - [ ] `workingDaysService` exported and covered by tests (holiday, weekly off, unmarked day).
  - [ ] Outbox event has a registered handler.
  - [ ] Cross-tenant diary entry ID returns 404.

---

#### 8C: #27 Excel/CSV Bulk Import Engine (Starter)

* **Institutional Job:** onboard hundreds of students, staff, marks and fee schedules from Excel/CSV via a background job.
* **Audit-first:** `studentImport.controller.js` exists; this engine supersedes it and the old route is retired after parity tests.
```prisma
model BulkImportJob {
  id               String    @id @default(uuid())
  college_id       String
  importType       String    // STUDENTS | STAFF | MARKS | FEES
  originalFilename String
  sourceFileKey    String?   // IMPORT_SOURCE object; purged 48h after terminal state
  status           String    @default("UPLOADED")
  // UPLOADED → VALIDATING → VALIDATED → QUEUED → COMMITTING → DONE | PARTIAL | FAILED | UNDONE
  totalRows        Int       @default(0)
  validRows        Int       @default(0)
  errorRows        Int       @default(0)
  committedRows    Int       @default(0)
  headerMappingJson Json?
  failureReason    String?
  claimedBy        String?
  lockedAt         DateTime?
  heartbeatAt      DateTime?
  createdById      String
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  rows             BulkImportRow[]
  @@index([college_id, status, createdAt(sort: Desc)])
  @@index([status, heartbeatAt])
}

model BulkImportRow {
  id        String  @id @default(uuid())
  college_id String
  job_id    String
  rowIndex  Int
  rowJson   Json
  isValid   Boolean @default(false)
  errors    Json?
  committed Boolean @default(false)
  job       BulkImportJob @relation(fields: [job_id], references: [id], onDelete: Cascade)
  @@unique([job_id, rowIndex])
  @@index([job_id, isValid, committed])
}
```
* **Schema additions for undo:** nullable, indexed `importJobId String?` on `Student` and on the staff `User` table (`@@index([college_id, importJobId])`).
* **Raw SQL:** one active import per college:
  ```sql
  CREATE UNIQUE INDEX "one_active_import_per_college" ON "BulkImportJob" (college_id)
    WHERE status IN ('VALIDATING','VALIDATED','QUEUED','COMMITTING');
  ```
  A second upload while one is active returns 409 `IMPORT_ALREADY_ACTIVE`.
* **Limits:** file size is the tier's `maxUploadBytes` (10/25/50/100 MB). There is also a **row cap** per job (`platformLimits.importMaxRows`, resolved via OD-21: Starter 1,000; Standard 5,000; Premium 10,000; Enterprise 25,000 rows/job). Marks imports are capped separately by file size or subject matrix. A file exceeding the row cap is rejected with 422 `IMPORT_ROW_CAP_EXCEEDED` (never truncated silently).
* **Commit is a claimed background job, not an outbox event:**
  1. `POST /commit` sets `status = 'QUEUED'`.
  2. `bulkImportWorker` claims: `UPDATE "BulkImportJob" SET status='COMMITTING', claimedBy=$i, lockedAt=now(), heartbeatAt=now() WHERE id = (SELECT id … WHERE status='QUEUED' ORDER BY createdAt FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.
  3. It processes valid, uncommitted rows in chunks of 200, updating `heartbeatAt` per chunk.
  4. **Stuck-job reaper:** a `COMMITTING` job with a stale `heartbeatAt` returns to `QUEUED`; because each row has a `committed` flag, the job **resumes** without duplicating rows.
* **Quota and seats (corrected):**
  * **Fail-fast pre-check** at `/validate`: if `validStudentRows > remaining student quota`, mark the job `FAILED` with `QUOTA_WOULD_BE_EXCEEDED` before any insert. This is advisory only.
  * **Authoritative check per chunk:** each chunk runs inside one transaction that calls `withQuota(collegeId, 'students', chunkSize, …)` and takes the group seat advisory lock before inserting. If a chunk hits the quota or seat limit, earlier chunks stay committed and the job ends `PARTIAL` with `failureReason`.
* **Chunk-failure policy:** commit valid rows, never roll back earlier chunks, mark failed rows, and produce an **error CSV** (`GET /errors.csv`) of every uncommitted row with its reason, which the admin can fix and re-upload.
* **Undo:** `POST /api/imports/:id/undo` (admin only, within a setting-defined window) soft-deletes (recycle bin) every record with that `importJobId`. Students that already have fee payments, results or attendance are **skipped and listed**, never deleted. Job becomes `UNDONE` (or stays `PARTIAL` with a report).
* **Staff import rules:** no admin-class roles can be created or assigned by import (hard-coded rejection, tested). Rows need a valid email. Staff are created in `INVITED` state and receive the **existing staff-invite flow** (`STAFF_INVITE` outbox event): a single-use set-password link. **No password appears in the CSV, the database or any email.** Accounts require a password change on first login. Staff creation goes through `withQuota('staff')` per chunk.
* **Parsing safety:** parse values only (never evaluate formulas); cap uncompressed XLSX size; normalize roll numbers (trim, uppercase).
* **APIs:** `POST /api/imports/upload`, `POST /:id/map-headers`, `POST /:id/validate`, `GET /:id`, `GET /:id/errors?page=&limit=`, `GET /:id/errors.csv`, `POST /:id/commit`, `POST /:id/undo`.
* **Definition of Done:**
  - [ ] `BulkImportRow` table replaces any staged JSON blob; error report is paged.
  - [ ] Commit runs in a claimed worker with heartbeat and a stuck-job reaper; resume proven by test.
  - [ ] Quota via `withQuota` per chunk plus a fail-fast pre-check; seats checked per chunk.
  - [ ] One active job per college (partial unique index) and a row cap.
  - [ ] `importJobId` on Student and staff; undo skips records with dependent activity.
  - [ ] Staff import cannot create admin-class users; uses the invite flow; no passwords stored or emailed.
  - [ ] `IMPORT_SOURCE` purged 48 h after terminal state and excluded from reconciliation.

