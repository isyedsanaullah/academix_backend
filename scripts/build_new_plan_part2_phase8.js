'use strict';
/**
 * Step 2: Append revised Phase 8 to new plan file.
 */
const fs = require('fs');
const NEW = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v2.md';

const phase8 = `

---

### Phase 8: College Operational Services (12 Services — 9 go LIVE, 3 stay coming_soon)

> [!IMPORTANT]
> **Registry outcome:** 90 live (Phase 7) + 9 new = **99 live + 62 roadmap = 161 total**.
> **#82, #84, #85 remain \`coming_soon\`.** Only the pluggable adapter interfaces are shipped; no live credentials exist and no credits are billed until a real driver is wired.

> [!NOTE]
> **Decisions resolved before coding:**
> - **OD-11 resolved:** Guardian authenticates via **roll number + guardian PIN** (bcrypt-hashed, issued at admission, 5-attempt lockout, admin-reset with audit). No simulated OTP. Parent accounts never count toward any quota.
> - **#84/#85 credits:** \`InAppMessagingDriver\` costs **0 credits**. Message-pack orders are rejected server-side (HTTP 422 \`NO_REAL_DRIVER_CONFIGURED\`) until a live driver is wired. \`#84\` and \`#85\` remain \`coming_soon\`.
> - **#86 depends on #83**, not on #84/#85.
> - **Campus model:** Audit confirms no \`Campus\` model or \`campus_id\` exists. \`quotaGate('campuses')\` already exists. Decision: **single-tenant-with-campus model** — a lightweight \`Campus\` table under \`college_id\`, pooling all quotas at the \`College\` level. No \`CampusGroup\`, no cross-\`college_id\` changes. Detailed design in Phase 10.

> [!IMPORTANT]
> **Cross-cutting rules applied to every Phase 8 service:**
> 1. **Audit-first:** Check existing models before adding tables. \`Group\` model already exists (id, college_id, class_id, name, seats, feeNote). \`PaymentProof\` already exists (use it for #82, do not create \`FeePaymentProof\`). \`LeaveApplication\` already exists (derive ON_LEAVE from it). \`DailyAttendance\` exists (use for #80, #81, #86).
> 2. **View-only/suspended behavior:** Exports, reads and PDFs always work. Device punches and gateway callbacks are stored but processing deferred. Everything blocked when suspended.
> 3. **Workers:** Every worker needs an advisory lock (\`pg_try_advisory_lock\`), an idempotency key, an entitlement check (\`getEntitlements()\`), and fanout through \`OutboxEvent\`. Shared \`JobRunLog(college_id, jobKey, runKey)\` replaces per-job dedupe tables for #81, #86, N03.
> 4. **Storage categories:** Quota-exempt with TTL purge: \`EXPORTS\`, \`BACKUPS\`, \`REPORTS\`, \`RECEIPTS\`. Fee proofs and diary attachments count toward quota. Bulk-import source files are transient (purged after job completes or fails).
> 5. **Gating:** Every route uses \`subscriptionGate(key)\` with keys matching the registry exactly. Single error code: **\`FEATURE_NOT_IN_PLAN\`** (not \`UPGRADE_REQUIRED\`).
> 6. **Quota hooks:** Anything creating students, staff, or admin-class users must go through \`withQuota\`.
> 7. **Every new model** has \`college_id\`. Every phase contract test includes a cross-tenant ID check returning 404.
> 8. **No hard-coded defaults** for fees, thresholds, or times — they belong in college settings (\`CollegeSetting\` key-value table or specific config models).

**Build order: 8A(#29) → 8B(#28) → 8C(#27) → 8D(#80) → 8E(#79) → 8F(#83) → 8G(Messaging Adapter) → 8H(#81) → 8I(#86) → 8J(#87) → 8K(#82 adapter-only)**

---

#### 8A: #29 Group-Wise Fee, Seats & Section Allocations (Starter)

* **Institutional Job:** Discipline-specific seat quotas (FSc Pre-Medical, ICS, I.Com, FA) with differentiated fee structures tied directly to academic groups per session.
* **Audit-First — existing \`Group\` model:**
  The \`Group\` model already exists in schema: \`(id, college_id, class_id, name, seats, feeNote, isActive)\`. **Do NOT create \`AcademicGroup\`.**
  - \`seats\` is not session-aware → add \`GroupSeatAllocation\` to track capacity per session.
  - \`enrolledCount\` stored counter drifts → **derive it** at query time (\`COUNT(Student WHERE group_id = X AND session_id = Y AND status = 'enrolled')\`) under a PostgreSQL advisory lock before admission to prevent race conditions.
  - Fee has no effective date → add \`GroupFeeSchedule\` so issued vouchers keep their snapshot even when fees change mid-year.

* **New Models (additive only — do not replace Group):**
  \`\`\`prisma
  model GroupSeatAllocation {
    id          String  @id @default(uuid())
    college_id  String
    group_id    String
    session_id  String
    seatCapacity Int    @default(100)
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt

    @@unique([college_id, group_id, session_id])
    @@index([college_id, session_id])
  }

  model GroupFeeSchedule {
    id              String   @id @default(uuid())
    college_id      String
    group_id        String
    session_id      String
    effectiveFrom   DateTime @db.Date  // Issued vouchers snapshot from this row
    monthlyFeePkr   Int
    admissionFeePkr Int
    registrationFee Int      @default(0)
    createdById     String
    createdAt       DateTime @default(now())

    @@unique([college_id, group_id, session_id, effectiveFrom])
    @@index([college_id, group_id, session_id])
  }
  \`\`\`

* **Business Invariants:**
  1. **Seat check under advisory lock:** Before any student admission to a group, acquire \`pg_advisory_xact_lock(hashtext('group_seats_' || group_id || '_' || session_id))\`. Derive live \`enrolledCount\`. Reject with 409 \`SEATS_FULL\` if \`enrolledCount >= seatCapacity\`.
  2. **Group transfer (#9):** Must re-run seat check on the destination group under the same lock. Source group seat is released atomically.
  3. **Fee snapshot:** When generating a fee voucher, read \`GroupFeeSchedule WHERE effectiveFrom <= voucherDate ORDER BY effectiveFrom DESC LIMIT 1\`. The snapshot is stored on the voucher line item so retrospective fee changes don't corrupt paid records.
  4. **Quota hook:** Any student creation or group-assignment that changes enrollment status calls \`withQuota(collegeId, 'students', 1, callback)\`.

* **API Contracts:**
  - \`GET /api/groups\` — list groups with live derived \`enrolledCount\` and \`availableSeats\` per session.
  - \`POST /api/groups\` — create group (subscriptionGate('group-wise-seats')).
  - \`PUT /api/groups/:id\` — update group metadata.
  - \`POST /api/groups/:id/seat-allocations\` — set seatCapacity per session.
  - \`POST /api/groups/:id/fee-schedules\` — add new fee schedule with effectiveFrom.
  - \`GET /api/groups/:id/fee-schedule?date=YYYY-MM-DD\` — resolve active fee for a date.

* **Definition of Done (8A):**
  - [ ] \`GroupSeatAllocation\` and \`GroupFeeSchedule\` added to schema; \`prisma generate\` run.
  - [ ] Seat check uses advisory lock + derived count (never stored counter).
  - [ ] Fee vouchers snapshot from \`GroupFeeSchedule\` at effectiveFrom.
  - [ ] Group transfer respects seats on destination.
  - [ ] \`withQuota\` called on enrollment.
  - [ ] Cross-tenant ID test: fetching another college's group returns 404.
  - [ ] Contract test: seats full → 409 \`SEATS_FULL\`; transfer blocked when destination full.

---

#### 8B: #28 Student Diary & Academic Events Calendar (Standard)

* **Institutional Job:** Daily class agenda and homework log per section/subject, plus institutional calendar (holidays, exam sessions, sports days) accessible to students, staff, and parents.

* **Data Models:**
  \`\`\`prisma
  model ClassDiaryEntry {
    id           String   @id @default(uuid())
    college_id   String
    section_id   String
    subject_id   String
    teacherId    String
    entryDate    DateTime @db.Date   // PKT date
    topicCovered String
    homework     String?
    remarks      String?
    // Attachments stored as StoredFile IDs (not raw URL strings)
    attachmentFileIds String[]        // StoredFile.id references
    createdAt    DateTime @default(now())
    updatedAt    DateTime @updatedAt

    @@unique([college_id, section_id, subject_id, entryDate])
    @@index([college_id, section_id, entryDate(sort: Desc)])
  }

  model AcademicCalendarEvent {
    id             String   @id @default(uuid())
    college_id     String
    title          String
    description    String?
    eventType      String   // HOLIDAY | EXAM_SESSION | TEST_DAY | SPORTS | ADMISSION | RESULT_DAY | GENERAL
    startDate      DateTime @db.Date
    endDate        DateTime @db.Date
    isPublic       Boolean  @default(true)
    targetAudience String   @default("ALL")  // ALL | STUDENTS | STAFF | PARENTS
    createdById    String
    createdAt      DateTime @default(now())
    updatedAt      DateTime @updatedAt

    @@index([college_id, startDate, endDate])
    @@index([college_id, eventType, startDate])
  }
  \`\`\`

* **Business Invariants:**
  1. **Teacher write scope:** A teacher may only create or edit \`ClassDiaryEntry\` rows for section/subject pairs where they appear in \`TeacherSubject\`. Validate at the service layer: \`SELECT 1 FROM TeacherSubject WHERE teacher_id = req.user.id AND section_id = ? AND subject_id = ?\`. Reject with 403 \`NOT_YOUR_SECTION\` if no row found.
  2. **Attachments via File Vault:** \`attachmentFileIds[]\` stores \`StoredFile.id\` references. Attachments are uploaded via #26 File Vault (category \`DIARY_ATTACHMENTS\`), count toward storage quota, and are served via presigned URLs. Never store raw file URLs in the diary entry.
  3. **Shared \`getWorkingDays(collegeId, startDate, endDate)\`:** Returns an array of calendar dates that are neither holidays (from \`AcademicCalendarEvent WHERE eventType = 'HOLIDAY'\`) nor weekly off days (from \`CollegeSetting.weeklyOffDays\`). This function is imported by #81 (shortage scanner), #86 (absence alerts), and #87 (KPI dashboard). Build it as \`backend/services/workingDaysService.js\`.
  4. **Notification fanout:** On new diary entry creation, write one \`OutboxEvent(type='DIARY_ENTRY_CREATED', payload={ entryId, sectionId })\`. The outbox worker fans out in-app notifications to all students in the section.
  5. **Parent targeting:** \`AcademicCalendarEvent\` with \`targetAudience = 'PARENTS'\` will be visible in the #83 parent portal. This extends the \`AnnouncementAudience\` audience model deferred in Phase 7B — calendar events are the first place parent-targeted content exists.

* **API Contracts:**
  - \`POST /api/diary/entries\` — create diary entry (teacher only, section/subject validation).
  - \`GET /api/diary/entries?sectionId=&date=\` — fetch entries by section + date range.
  - \`PUT /api/diary/entries/:id\` — edit entry (same teacher only, within 24 hours).
  - \`POST /api/calendar/events\` — create calendar event (admin/principal only).
  - \`GET /api/calendar/events?from=&to=&audience=\` — fetch events by date range + audience.
  - \`GET /api/calendar/working-days?from=&to=\` — returns working day array (uses \`getWorkingDays\`).

* **Definition of Done (8B):**
  - [ ] \`ClassDiaryEntry\` and \`AcademicCalendarEvent\` added to schema.
  - [ ] Teacher write scope validated against \`TeacherSubject\` on every write.
  - [ ] Attachments stored as \`StoredFile.id\` references via File Vault.
  - [ ] \`getWorkingDays()\` service built and exported from \`backend/services/workingDaysService.js\`.
  - [ ] \`OutboxEvent\` written on new entry; outbox worker fans out section notifications.
  - [ ] Cross-tenant test: fetching another college's diary entry returns 404.

---

#### 8C: #27 Excel/CSV Bulk Import Engine (Starter)

* **Institutional Job:** Onboards hundreds of students, roll numbers, board marks, and fee schedules from Excel/CSV in a single background job without server timeouts.

* **Audit-First — existing \`studentImport.controller.js\`:**
  An earlier controller exists. This service supersedes it with proper background processing, row-level error paging, and quota enforcement.

* **Data Models:**
  \`\`\`prisma
  model BulkImportJob {
    id               String   @id @default(uuid())
    college_id       String
    importType       String   // STUDENTS | STAFF | MARKS | FEES
    originalFilename String
    sourceFileId     String?  // StoredFile.id — transient, purged after job completes/fails
    status           String   @default("PENDING")
    // PENDING → VALIDATING → VALIDATED → COMMITTING → DONE | FAILED | PARTIAL
    totalRows        Int      @default(0)
    validRows        Int      @default(0)
    errorRows        Int      @default(0)
    committedRows    Int      @default(0)
    headerMappingJson Json?   // { csvColumn: "Name", targetField: "fullName" }
    createdById      String
    createdAt        DateTime @default(now())
    updatedAt        DateTime @updatedAt

    rows             BulkImportRow[]
    @@index([college_id, status, createdAt(sort: Desc)])
  }

  model BulkImportRow {
    id        String  @id @default(uuid())
    job_id    String
    rowIndex  Int
    rowJson   Json    // parsed row data
    isValid   Boolean @default(false)
    errors    Json?   // [{ field: "phone", code: "INVALID_FORMAT", message: "..." }]
    committed Boolean @default(false)

    job       BulkImportJob @relation(fields: [job_id], references: [id], onDelete: Cascade)
    @@index([job_id, isValid, committed])
    @@index([job_id, rowIndex])
  }
  \`\`\`

* **Business Invariants:**
  1. **File size per tier:** Starter 10 MB, Standard 25 MB, Premium 50 MB, Enterprise 100 MB. Enforced at upload via \`effectiveLimits.maxUploadBytes\`. The 25 MB hard-limit in the old spec was wrong.
  2. **Commit in background worker:** \`POST /api/imports/:jobId/commit\` does NOT process rows inline. It sets \`status = 'COMMITTING'\` and enqueues a \`BulkImportCommitJob\` via \`OutboxEvent\`. The \`bulkImportWorker.js\` picks it up asynchronously. Clients poll \`GET /api/imports/:jobId\` for progress.
  3. **Chunk failure behavior:** Worker commits valid rows in chunks of 200. If a chunk fails, that chunk is rolled back. Already-committed chunks remain. Job ends as \`status = 'PARTIAL'\`. An error CSV is generated listing failed rows with reasons. Rows from the \`BulkImportRow\` table (committed = false) can be used to generate a corrected import file. Deleted students from committed chunks are recoverable via recycle bin by \`importJobId\`.
  4. **Pre-commit quota reserve:** Before any insert, call \`withQuota(collegeId, 'students', validStudentCount, callback)\`. If quota exceeded, entire commit is rejected with 422 \`QUOTA_WOULD_BE_EXCEEDED\`.
  5. **Seat check per group:** For student imports, check available seats in target group/session under advisory lock before inserting each chunk.
  6. **Staff import restrictions:** Cannot create users with admin-class roles (\`isAdminClass = true\`). All staff imported via bulk import must have \`mustChangePassword = true\` set on first login.
  7. **Source file is transient:** \`sourceFileId\` (StoredFile in category \`IMPORT_SOURCE\`) is purged 48 hours after job reaches terminal status (\`DONE\`, \`FAILED\`, or \`PARTIAL\`). Import source files do NOT count toward long-term storage quota.
  8. **Row table enables paged error reports:** \`GET /api/imports/:jobId/errors?page=1&limit=50\` queries \`BulkImportRow WHERE isValid = false\` and returns paged error list without loading full \`stagedDataJson\` into memory.

* **API Contracts:**
  - \`POST /api/imports/upload\` — upload file via File Vault, create \`BulkImportJob\`, return \`jobId\`.
  - \`POST /api/imports/:jobId/map-headers\` — save header mapping JSON.
  - \`POST /api/imports/:jobId/validate\` — trigger validation worker (sets status VALIDATING → VALIDATED/FAILED).
  - \`GET /api/imports/:jobId\` — poll job status + progress counts.
  - \`GET /api/imports/:jobId/errors?page=&limit=\` — paged error rows from \`BulkImportRow\`.
  - \`GET /api/imports/:jobId/error-csv\` — download error report as CSV.
  - \`POST /api/imports/:jobId/commit\` — enqueue background commit worker.

* **Definition of Done (8C):**
  - [ ] \`BulkImportJob\` + \`BulkImportRow\` in schema (replaces \`stagedDataJson\` blob).
  - [ ] File size enforced per tier (not flat 25 MB).
  - [ ] Commit runs in \`bulkImportWorker.js\`, not inline; client polls status.
  - [ ] Chunk failure leaves committed chunks intact; partial job generates error CSV.
  - [ ] Quota reserved before any insert; seat check per group per chunk.
  - [ ] Staff import blocks admin-class roles; sets \`mustChangePassword = true\`.
  - [ ] Source file purged 48h after terminal status.
  - [ ] Paged error report endpoint (\`/errors?page=\`) works without full blob load.

---

#### 8D: #80 Teacher & Staff Attendance Register (Standard)

* **Institutional Job:** Digital check-in/out register for teaching and administrative staff with configurable grace periods, leave linkage, and late deduction metrics.

* **Audit-First:**
  - \`LeaveApplication\` model exists with \`status\` (pending/approved/rejected). **Derive \`ON_LEAVE\` status** from \`LeaveApplication WHERE status = 'approved' AND leaveDate <= today AND leaveDateEnd >= today AND user_id = userId\`. Do NOT copy leave status into \`StaffAttendance\`.
  - \`DailyAttendance\` exists for student attendance — \`StaffAttendance\` is a separate model.

* **Data Model:**
  \`\`\`prisma
  model StaffAttendance {
    id            String    @id @default(uuid())
    college_id    String
    userId        String
    date          DateTime  @db.Date
    checkInTime   DateTime?
    checkOutTime  DateTime?
    // Status derived from checkInTime vs shift settings + leave check
    status        String    @default("PRESENT")
    // PRESENT | LATE | HALF_DAY | ABSENT | ON_LEAVE
    minutesLate   Int       @default(0)
    source        String    @default("MANUAL") // MANUAL | BIOMETRIC
    markedById    String?   // userId who made manual mark
    editHistory   Json?     // Array of { editedBy, editedAt, previousStatus } for audit
    createdAt     DateTime  @default(now())
    updatedAt     DateTime  @updatedAt

    @@unique([college_id, userId, date])
    @@index([college_id, date(sort: Desc)])
    @@index([college_id, userId, date])
  }
  \`\`\`

* **Business Invariants:**
  1. **Shift settings from CollegeSetting:** \`shiftStartTime\`, \`gracePeriodMinutes\` (default 15), \`halfDayThresholdMinutes\` (default 90) are stored in \`CollegeSetting\` key-value table, not hard-coded per row. Load once per request.
  2. **Late calculation logic:**
     - \`minutesLate = max(0, checkInTime - (shiftStart + gracePeriod))\`
     - If \`minutesLate == 0\`: status = \`PRESENT\`
     - If \`0 < minutesLate <= (halfDayThreshold - gracePeriod)\`: status = \`LATE\`
     - If \`minutesLate > (halfDayThreshold - gracePeriod)\`: status = \`HALF_DAY\`
  3. **Leave override:** Always check \`LeaveApplication\` before computing status. If approved leave exists for the date, status = \`ON_LEAVE\` regardless of punch times. This check runs at query time, not stored.
  4. **Manual edits → AuditLog:** Every PUT to a \`StaffAttendance\` record writes an entry to the existing \`AuditLog\` table (action: \`STAFF_ATTENDANCE_EDIT\`, before/after JSON). The \`editHistory\` JSONB on the record also appends a compact entry.
  5. **Mark priority:** Manual marks from admin override biometric-sourced records (\`source = 'BIOMETRIC'\`). Admin can mark a record even if biometric already set it.
  6. **Suspended college:** Reads always work. Writes (manual marks) blocked when \`forceReadOnly = true\`. Biometric-sourced records continue to store but status = \`DEFERRED_PROCESSING\`.

* **API Contracts:**
  - \`GET /api/staff-attendance?date=&userId=\` — fetch register for a date or staff member.
  - \`POST /api/staff-attendance\` — manual mark (admin/principal only).
  - \`PUT /api/staff-attendance/:id\` — edit existing record; logs to AuditLog.
  - \`GET /api/staff-attendance/summary?from=&to=&userId=\` — attendance summary with leave derivation.
  - \`GET /api/staff-attendance/export?from=&to=\` — CSV export (via N01 export engine once built).

* **Definition of Done (8D):**
  - [ ] \`StaffAttendance\` added to schema; \`@@unique([college_id, userId, date])\`.
  - [ ] \`shiftStartTime\`, \`gracePeriodMinutes\`, \`halfDayThresholdMinutes\` read from \`CollegeSetting\`.
  - [ ] \`ON_LEAVE\` derived live from \`LeaveApplication\`, not stored.
  - [ ] Manual edits write to \`AuditLog\` + append to \`editHistory\`.
  - [ ] Manual marks override biometric source.
  - [ ] Cross-tenant test: fetching another college's staff attendance returns 404.

---

#### 8E: #79 Biometric Device Attendance Synchronizer (Standard)

* **Institutional Job:** Synchronizes ZKTeco ADMS-compatible biometric punch logs into platform attendance records, with idempotent replay and device authentication.

* **Data Models:**
  \`\`\`prisma
  model BiometricDevice {
    id           String    @id @default(uuid())
    college_id   String
    deviceName   String
    serialNumber String    // College-scoped unique; global unique squatting mitigated below
    ipAddress    String?
    location     String?
    isActive     Boolean   @default(true)
    lastHeartbeat DateTime?
    registeredAt DateTime  @default(now())

    // No global @unique on serialNumber — prevents squatting.
    // Super Admin release path: SA can reassign serialNumber to a different college_id.
    @@unique([college_id, serialNumber])
    @@index([college_id, isActive])
  }

  model BiometricPunchLog {
    id           String   @id @default(uuid())
    college_id   String
    deviceId     String   // BiometricDevice.id
    deviceUserId String   // Employee ID on device
    userId       String?  // Resolved Academix userId (null = unmapped)
    punchTime    DateTime // UTC (converted from device-local by server)
    processed    Boolean  @default(false)
    createdAt    DateTime @default(now())

    @@unique([college_id, deviceId, deviceUserId, punchTime])
    @@index([college_id, processed, punchTime])
    @@index([college_id, userId, punchTime])
  }

  // Unmapped punches queue — deviceUserId not matched to any User
  model UnmappedBiometricPunch {
    id           String   @id @default(uuid())
    college_id   String
    deviceId     String
    deviceUserId String
    punchTime    DateTime
    dismissed    Boolean  @default(false)
    createdAt    DateTime @default(now())

    @@index([college_id, dismissed, createdAt(sort: Desc)])
  }
  \`\`\`

* **Business Invariants:**
  1. **ZKTeco push endpoint is public by design.** \`POST /api/biometric/push/:deviceSerial\` accepts pushes from ZKTeco ADMS without a user JWT. Security controls:
     - **Registered serial only:** Look up \`BiometricDevice WHERE serialNumber = :deviceSerial AND isActive = true\`. If not found → 403 \`DEVICE_NOT_REGISTERED\`.
     - **Rate limit:** Max 500 punches / minute per \`deviceSerial\` (express-rate-limit or pg advisory semaphore).
     - **Body size cap:** Max 512 KB per push payload.
     - **Far-future rejection:** Reject punches where \`punchTime > NOW() + 5 minutes\` (UTC after conversion).
  2. **Device-local time → UTC:** Device sends local time. Server receives \`timezone\` from device registration (\`CollegeSetting.timezone\`, default \`Asia/Karachi\`). Convert: \`utcTime = moment.tz(deviceLocalTime, collegeTimezone).toDate()\`.
  3. **In/out from first/last punch:** Do NOT use a \`direction\` field on the punch. For each \`(userId, date)\`, the first punch of the day = check-in, last punch = check-out. Derived at processing time.
  4. **Mark priority:** \`StaffAttendance.source = 'MANUAL'\` takes precedence over \`'BIOMETRIC'\`. Worker skips upsert if a manual record already exists for \`(userId, date)\`.
  5. **Unmapped punch handling:** If \`deviceUserId\` has no match in \`User\` table for the college, write to \`UnmappedBiometricPunch\`. Admin resolves by mapping \`deviceUserId → userId\` in device settings. Worker retries unmapped punches after mapping.
  6. **Super Admin serial release:** \`PUT /api/super-admin/biometric-devices/:id/reassign\` allows SA to change \`college_id\` on a device (removes the squatting risk of global @unique).

* **Worker (\`biometricSyncWorker.js\`):**
  - Advisory lock: \`pg_try_advisory_lock(hash('biometric_sync'))\`.
  - Runs every 5 minutes.
  - Drains \`BiometricPunchLog WHERE processed = false ORDER BY punchTime ASC LIMIT 500\`.
  - For each punch: resolve \`deviceUserId → userId\`. If unmapped → write \`UnmappedBiometricPunch\`, mark processed.
  - Derive in/out from first/last punch of day for the userId.
  - Upsert \`StaffAttendance\` only if no manual record exists.
  - Mark \`processed = true\`.

* **Definition of Done (8E):**
  - [ ] \`@@unique([college_id, deviceId, deviceUserId, punchTime])\` in schema (idempotency).
  - [ ] \`@@unique([college_id, serialNumber])\` (not global) with SA reassign endpoint.
  - [ ] Push endpoint validates registered serial, rate-limits, caps body size.
  - [ ] Device-local time converted to UTC; far-future punches rejected.
  - [ ] In/out derived from first/last punch (no direction field).
  - [ ] Manual marks take priority; worker skips upsert if manual record exists.
  - [ ] Unmapped punches queue populated; retried after userId mapping.
  - [ ] Worker uses advisory lock + idempotency (\`JobRunLog\`).

---

#### 8F: #83 Progressive Web App (PWA) Parent Portal (Standard)

* **Institutional Job:** Mobile-first installable portal for guardians to view student attendance, fee statements, exam results, class diaries, and college circulars.

* **OD-11 (Resolved): Guardian PIN Authentication**
  - Parent does NOT need an institutional \`User\` account.
  - Guardian authenticates with: **Roll Number + Guardian PIN**.
  - PIN is a 6-digit alphanumeric code **issued by the registrar at admission** and stored bcrypt-hashed in \`GuardianSession\`.
  - Admin can reset the PIN at any time (audit-logged).
  - **5-attempt lockout:** After 5 failed PIN attempts within 15 minutes, the account is locked for 30 minutes. Lockout state stored in \`GuardianSession.failedAttempts\` + \`lockedUntil\`.
  - **Parent accounts do not count toward any quota** (students, staff, admins).

* **Data Models:**
  \`\`\`prisma
  model GuardianSession {
    id             String    @id @default(uuid())
    college_id     String
    studentId      String    // Which student this guardian is linked to
    // Guardian identity comes from Student.guardianName / guardianPhone (existing fields)
    pinHash        String    // bcrypt(6-digit PIN issued at admission)
    isActive       Boolean   @default(true)
    failedAttempts Int       @default(0)
    lockedUntil    DateTime?
    lastLoginAt    DateTime?
    pinResetBy     String?   // Admin userId who last reset the PIN
    pinResetAt     DateTime?
    createdAt      DateTime  @default(now())
    updatedAt      DateTime  @updatedAt

    @@unique([college_id, studentId])
    @@index([college_id])
  }

  // JWT-like session token for parent (short-lived, separate from staff JWTs)
  model GuardianToken {
    id         String   @id @default(uuid())
    college_id String
    sessionId  String   // GuardianSession.id
    tokenHash  String   @unique
    expiresAt  DateTime
    revokedAt  DateTime?
    createdAt  DateTime @default(now())

    @@index([sessionId])
    @@index([expiresAt])
  }
  \`\`\`

* **Auth Flow:**
  1. \`POST /api/parent/auth/login\` — accepts \`{ rollNumber, pin }\`. Finds student by roll number + \`college_id\` (from subdomain). Fetches \`GuardianSession\`. Checks lockout. Verifies \`bcrypt.compare(pin, pinHash)\`. On success: issues short-lived (8-hour) \`GuardianToken\`. On failure: increments \`failedAttempts\`, sets \`lockedUntil\` after 5 failures.
  2. \`POST /api/parent/auth/logout\` — revokes \`GuardianToken\` (sets \`revokedAt\`), clears client-side cache.
  3. **Cache clearing on logout:** Service worker cache for the parent session is invalidated by the logout response setting a \`Clear-Site-Data\` header.
  4. **Pre-auth token:** Login returns a \`preAuthToken\` (1-minute TTL) if PIN is correct but further verification needed in future (e.g., device fingerprint). Today it immediately issues the full session token.

* **Routes (GET-only, scoped to linked student):**
  All routes under \`/api/parent/*\` require \`GuardianToken\` auth middleware. The middleware resolves \`studentId\` from \`GuardianSession\`. All queries scope to that specific \`studentId\` only.
  - \`GET /api/parent/student\` — basic profile (name, class, section, photo).
  - \`GET /api/parent/attendance?month=YYYY-MM\` — monthly attendance summary.
  - \`GET /api/parent/fees\` — fee vouchers + payment history.
  - \`GET /api/parent/results\` — published exam results.
  - \`GET /api/parent/diary?from=&to=\` — class diary entries for student's section.
  - \`GET /api/parent/circulars\` — public + parent-targeted announcements.
  - \`GET /api/parent/notifications\` — in-app notification feed for this guardian.

* **Admin endpoints:**
  - \`POST /api/admin/parent-portal/setup\` — issue initial PIN for a student (creates/updates GuardianSession).
  - \`POST /api/admin/parent-portal/:studentId/reset-pin\` — reset PIN (audit-logged to AuditLog).
  - \`GET /api/admin/parent-portal/sessions\` — list all guardian sessions with last login.

* **AnnouncementAudience extension:** Add \`'PARENTS'\` as a valid \`audienceType\` in \`AnnouncementAudience\`. Phase 7B deferred this. The parent portal circular endpoint filters on \`audienceType IN ('ALL', 'PARENTS')\`.

* **Definition of Done (8F):**
  - [ ] \`GuardianSession\` + \`GuardianToken\` in schema.
  - [ ] Login: bcrypt PIN verify, 5-attempt lockout, lockout timer reset after 30 min.
  - [ ] Guardian tokens separate from staff JWTs; short 8-hour expiry.
  - [ ] All parent routes GET-only, scoped strictly to linked studentId.
  - [ ] Cache cleared on logout (\`Clear-Site-Data\` header).
  - [ ] \`GuardianSession\` does not count toward any quota.
  - [ ] Admin PIN reset writes to \`AuditLog\`.
  - [ ] \`AnnouncementAudience\` extended with \`'PARENTS'\` audienceType.

---

#### 8G: Messaging Adapter Layer (#84 SMS, #85 WhatsApp — coming_soon)

* **Institutional Job:** Pluggable messaging infrastructure that today routes all notifications in-app at zero credit cost, and can be switched to live SMS/WhatsApp drivers without code changes when credentials are added.

> [!IMPORTANT]
> **#84 and #85 remain \`coming_soon\` in the registry.** This phase ships only the adapter interface and in-app driver. No live Twilio/Meta credentials exist. Message-pack orders are **rejected server-side** (HTTP 422 \`NO_REAL_DRIVER_CONFIGURED\`) until a live driver is configured. Only the \`InAppMessagingDriver\` is active.

* **\`InAppMessagingDriver\` cost = 0 credits.** No credit ledger debit occurs for in-app delivery. This prevents colleges from purchasing credit packs that deliver nothing outside the app.

* **\`MessagingAdapter\` interface (\`backend/services/messagingAdapter.js\`):**
  \`\`\`javascript
  class MessagingDriver {
    // Returns { messageId, status, creditsUsed }
    async send(channel, recipientPhone, recipientUserId, body, metadata) {}
    get creditCostPerMessage() { return 0; } // Override in real drivers
  }

  class InAppMessagingDriver extends MessagingDriver {
    async send(channel, recipientPhone, recipientUserId, body, metadata) {
      // Write OutboxEvent(type='IN_APP_MESSAGE', payload={recipientUserId, body, channel, tag})
      // Tag: '[SMS Notice]' or '[WhatsApp Notice]' based on channel
      return { messageId: uuid(), status: 'IN_APP_DELIVERED', creditsUsed: 0 };
    }
    get creditCostPerMessage() { return 0; }
  }

  // Stub classes — empty, never instantiated until credentials exist
  class TwilioSmsDriver extends MessagingDriver { /* future */ }
  class MetaWhatsAppDriver extends MessagingDriver { /* future */ }

  function getActiveDriver(channel) {
    // Always returns InAppMessagingDriver until a real driver is configured
    return new InAppMessagingDriver();
  }
  \`\`\`

* **Credit pack order rejection:**
  \`POST /api/subscription/renew\` with \`itemType = 'CREDIT_PACK'\` and \`addonType IN ('SMS_PACK_500','SMS_PACK_2000','SMS_PACK_5000')\`: the settlement engine checks \`getActiveDriver('SMS')\` → if \`driver instanceof InAppMessagingDriver\` → reject entire CREDIT_PACK line item with 422 \`NO_REAL_DRIVER_CONFIGURED\` and message: *"SMS credit packs cannot be purchased until a live SMS driver is configured by the platform. Contact support."*

* **Definition of Done (8G):**
  - [ ] \`messagingAdapter.js\` created with \`InAppMessagingDriver\`, \`TwilioSmsDriver\` stub, \`MetaWhatsAppDriver\` stub.
  - [ ] \`InAppMessagingDriver.creditCostPerMessage = 0\`; no ledger debit.
  - [ ] Credit pack orders for SMS/WhatsApp rejected with 422 when no real driver active.
  - [ ] \`#84\` and \`#85\` remain \`coming_soon\` in \`featureRegistry.js\`.

---

#### 8H: #81 Automated Attendance Shortage Scanner (Standard)

* **Institutional Job:** Weekly background audit computing student attendance percentages against board-mandated threshold (default 75% BISE) and issuing formal shortage notices.

* **Audit-First:**
  - Reuse the **same calculation logic** as #41 (minimum attendance check for exam eligibility). Extract into \`attendanceCalculationService.js\`.
  - \`DailyAttendance\` exists for student attendance — query it directly.
  - Use \`getWorkingDays()\` from 8B to count only days where attendance was actually marked (not holidays, not weekly off).

* **Data Model:**
  \`\`\`prisma
  model AttendanceShortageNotice {
    id               String   @id @default(uuid())
    college_id       String
    studentId        String
    sectionId        String?
    termKey          String   // e.g. "2026-T1" — identifies the academic term
    scanRunDate      DateTime @db.Date
    totalWorkingDays Int
    attendedDays     Int
    attendancePercent Decimal @db.Decimal(5, 2)
    threshold        Decimal  @db.Decimal(5, 2) // From CollegeSetting, default 75.00
    status           String   @default("ISSUED") // ISSUED | ACKNOWLEDGED | RESOLVED
    notificationSentAt DateTime?
    createdAt        DateTime @default(now())

    // Upsert key: same student, same term → update (no weekly spam)
    @@unique([college_id, studentId, termKey])
    @@index([college_id, scanRunDate(sort: Desc)])
  }

  // Shared worker run log for advisory lock + idempotency
  model JobRunLog {
    id         String   @id @default(uuid())
    college_id String
    jobKey     String   // e.g. 'shortage-scanner' | 'absence-alerts' | 'digest'
    runKey     String   // e.g. YYYY-MM-DD or YYYY-WW (week)
    startedAt  DateTime @default(now())
    finishedAt DateTime?
    status     String   @default("RUNNING") // RUNNING | DONE | FAILED
    summary    Json?

    @@unique([college_id, jobKey, runKey])
    @@index([college_id, jobKey, startedAt(sort: Desc)])
  }
  \`\`\`

* **Worker (\`attendanceShortageScanner.js\`):**
  1. **Advisory lock:** \`SELECT pg_try_advisory_lock(hash('shortage_scanner_' || collegeId))\`.
  2. **Idempotency (\`JobRunLog\`):** Upsert \`JobRunLog(college_id, jobKey='shortage-scanner', runKey=ISO_WEEK)\`. If status = 'DONE', skip.
  3. **Entitlement check:** \`getEntitlements(collegeId)\` — skip college if \`'attendance-shortage-scanner'\` not in plan.
  4. **Working-day count:** Call \`getWorkingDays(collegeId, termStart, today)\` for days where attendance was marked.
  5. **Only count marked days:** Only include dates where at least one \`DailyAttendance\` record exists for the section. Otherwise every student looks absent on un-marked days.
  6. **Reuse #41 logic:** \`attendancePercent = (attendedDays / totalWorkingDays) * 100\`.
  7. **Threshold from CollegeSetting:** \`attendanceThreshold\` (default 75.0). Not hard-coded.
  8. **Upsert:** \`INSERT INTO AttendanceShortageNotice ... ON CONFLICT (college_id, studentId, termKey) DO UPDATE\`. No duplicate notices per term.
  9. **Fanout:** Write \`OutboxEvent(type='SHORTAGE_NOTICE_ISSUED', payload={studentId, collegeId, percent})\` per new notice for in-app notification.

* **Schedule:** Every Sunday at midnight PKT (via cron worker or Render scheduler).

* **Definition of Done (8H):**
  - [ ] \`AttendanceShortageNotice\` with \`@@unique([college_id, studentId, termKey])\` — upsert prevents weekly spam.
  - [ ] \`JobRunLog\` model created (shared by #81, #86, N03).
  - [ ] Worker uses advisory lock + \`JobRunLog\` idempotency key.
  - [ ] Only days where attendance was marked are counted (not holidays or un-marked days).
  - [ ] \`getWorkingDays()\` used from 8B service.
  - [ ] Threshold read from \`CollegeSetting\`, not hard-coded.
  - [ ] Upsert on \`@@unique\` — same student same term → update, not duplicate.

---

#### 8I: #86 Instant Absence Push Delivery to Guardians (Standard)

> [!IMPORTANT]
> **#86 depends on #83 (parent portal), not on #84/#85.** Absence alerts route through \`InAppMessagingDriver\` to the parent portal notification feed — not through external SMS or WhatsApp. No credits are debited.

* **Institutional Job:** Daily automated trigger identifying student absences and delivering in-app alerts to guardians via the parent portal notification feed.

* **Worker (\`dailyAbsenceAlertWorker.js\`):**
  1. **Alert time from CollegeSetting:** \`absenceAlertTime\` (HH:mm, default \`09:30\`, PKT). **Not hard-coded.** Cron fires every minute; worker checks if current PKT time matches the college's setting within a 2-minute window.
  2. **Advisory lock + \`JobRunLog\`:** Key = \`'absence-alerts'\`, runKey = \`YYYY-MM-DD\`. Skip if already DONE for today.
  3. **Entitlement check:** Skip college if \`'absence-alerts-parents'\` not in plan.
  4. **Skip un-marked sections:** Only process sections where at least one \`DailyAttendance\` record exists for today. If a teacher has not marked attendance yet, skip the entire section — otherwise every student appears absent.
  5. **Skip holidays:** Call \`getWorkingDays(collegeId, today, today)\`. If today is a holiday or weekly off, skip.
  6. **Skip approved leaves:** For each absent student, check \`LeaveApplication WHERE student_id = X AND status = 'approved' AND leaveDate <= today AND leaveDateEnd >= today\`. If approved leave found, skip the alert.
  7. **Idempotency per student per day:** Before writing \`OutboxEvent\`, check \`JobRunLog\` sub-key or a simple \`@@unique([college_id, studentId, alertDate])\` on \`AbsenceAlertLog\`.
  8. **Delivery:** Call \`messagingAdapter.send('IN_APP', null, guardianSessionId, alertBody)\`. Routes to parent portal notification feed. Credits = 0.

* **Data Model (idempotency log):**
  \`\`\`prisma
  model AbsenceAlertLog {
    id         String   @id @default(uuid())
    college_id String
    studentId  String
    alertDate  DateTime @db.Date
    sentAt     DateTime @default(now())

    @@unique([college_id, studentId, alertDate])
  }
  \`\`\`

* **Definition of Done (8I):**
  - [ ] Alert time read from \`CollegeSetting\` (not hard-coded 09:30).
  - [ ] \`JobRunLog\` advisory lock + idempotency per college per day.
  - [ ] Un-marked sections skipped entirely.
  - [ ] Holidays and weekly off days skipped via \`getWorkingDays()\`.
  - [ ] Approved leaves skipped.
  - [ ] \`AbsenceAlertLog\` prevents double-alerting per student per day.
  - [ ] Delivery via \`InAppMessagingDriver\` (0 credits); reaches parent portal feed.

---

#### 8J: #87 Principal & Executive KPI Analytics Dashboard (Standard)

* **Institutional Job:** High-level executive dashboard with defined formulas, restricted to admin and principal roles. Built as a pure reusable service for N03 and N18.

* **Defined Formulas (non-negotiable):**
  | Metric | Formula | Period |
  |:---|:---|:---|
  | \`feeRecoveryRate\` | \`collected ÷ billed\` × 100 | \`periodStart\` → \`periodEnd\` (query param) |
  | \`totalRevenuePkr\` | SUM of verified fee payments | Same period |
  | \`pendingFeePkr\` | SUM of billed − collected | Same period |
  | \`studentAttendancePercent\` | present ÷ **marked** (not enrolled) | Today |
  | \`staffAttendancePercent\` | present ÷ **marked** (not all staff) | Today |
  | \`totalEnrolled\` | COUNT active students | Snapshot |
  | \`newAdmissionsThisPeriod\` | COUNT admitted in period | Period |

  > **attendance = present ÷ marked** (not enrolled). If 200 students are enrolled but only 180 attendance records exist for today, the denominator is 180, not 200.

* **Architecture (pure service):**
  \`\`\`javascript
  // backend/services/executiveKpiService.js
  async function getKpiSummary(collegeId, periodStart, periodEnd) {
    // Returns the KPI object — no HTTP layer. Called by:
    // - GET /api/executive/kpi-summary (Phase 8J)
    // - N03 scheduled digest worker (Phase 9)
    // - N18 multi-campus matrix (Phase 10)
  }
  \`\`\`

* **API Contract:**
  - \`GET /api/executive/kpi-summary?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD\`
  - **Role restriction:** \`admin\`, \`principal\` only. Accountant and teachers cannot access.
  - \`subscriptionGate('executive-kpi-dashboard')\`
  - Returns:
    \`\`\`json
    {
      "period": { "start": "2026-10-01", "end": "2026-10-31" },
      "feeRecoveryRate": 84.5,
      "totalRevenuePkr": 14500000,
      "pendingFeePkr": 2650000,
      "studentAttendancePercent": 91.2,
      "studentAttendanceBase": "marked",
      "staffAttendancePercent": 96.0,
      "staffAttendanceBase": "marked",
      "totalEnrolled": 1420,
      "newAdmissionsThisPeriod": 47
    }
    \`\`\`

* **Definition of Done (8J):**
  - [ ] \`executiveKpiService.js\` as pure service (no HTTP logic inside).
  - [ ] \`feeRecoveryRate\` = collected ÷ billed (not enrolled).
  - [ ] \`attendance\` = present ÷ marked (not enrolled).
  - [ ] Period passed as query param (not hard-coded to current month).
  - [ ] Role-restricted: admin + principal only.
  - [ ] Reusable by N03 (digest) and N18 (multi-campus).

---

#### 8K: #82 Online Fee Payment Gateway Adapter (Standard — coming_soon, Adapter Interface Only)

> [!IMPORTANT]
> **#82 remains \`coming_soon\` in the registry.** This sub-phase ships ONLY the pluggable \`PaymentGatewayAdapter\` interface. No merchant credentials, no live gateway callbacks, no new database tables.

* **Audit-First — existing \`PaymentProof\` model:**
  The model \`PaymentProof\` already exists: \`(id, college_id, student_id, fee_id, method, amount, transactionId, file_id, status, verifiedBy)\`. **Do NOT create \`FeePaymentProof\`.** The gateway adapter will record proof against this existing model.

* **Fee proof storage category:** Fee proof slips (bank screenshots, deposit slips) are uploaded via File Vault category \`FEE_PROOFS\` and **count toward storage quota**. This is NOT an exempt category — per §6.0 of the existing plan, only platform-generated \`SUBSCRIPTION_RECEIPTS\` are exempt. Fee proofs are tenant-uploaded data.

* **What ships in Phase 8:**
  \`\`\`javascript
  // backend/services/paymentGatewayAdapter.js
  class PaymentGatewayDriver {
    async initiatePayment(challanId, amountPkr, callbackUrl) { throw new Error('NOT_IMPLEMENTED'); }
    async handleWebhook(headers, rawBody) { throw new Error('NOT_IMPLEMENTED'); }
    async verifyTransaction(txId) { throw new Error('NOT_IMPLEMENTED'); }
  }
  // Stub only — never instantiated
  class JazzCashDriver extends PaymentGatewayDriver {}
  class EasyPaisaDriver extends PaymentGatewayDriver {}

  function getActiveGatewayDriver() {
    return null; // No active driver until Phase N (future)
  }
  \`\`\`

* **UI:** Non-clickable settings card in the Admin Billing page: *"Online Fee Payment (Coming Soon — Platform Controlled)"*.

* **Definition of Done (8K):**
  - [ ] \`paymentGatewayAdapter.js\` with driver interface and stubs created.
  - [ ] \`#82\` remains \`coming_soon\` in \`featureRegistry.js\`.
  - [ ] No new tables created (reuses existing \`PaymentProof\`).
  - [ ] Fee proof files counted toward storage quota (not exempt).

---

#### Phase 8 Contract Tests (\`backend/tests/phase8_contract.test.js\`)

For every service, the test suite must include:

| Test | Covers |
|:---|:---|
| Tier access allowed on correct tier | Each feature key |
| Tier blocked (FEATURE_NOT_IN_PLAN) on tier below | Each feature key |
| Read-only mode: reads succeed, writes blocked | #80, #83 |
| Suspended college: all writes blocked | All |
| Cross-tenant ID returns 404 | All models |
| Quota enforcement: seats full → 409 | #29 |
| Quota enforcement: student quota exceeded | #27 |
| Guardian PIN lockout after 5 attempts | #83 |
| Guardian token does not count toward admin quota | #83 |
| Worker idempotency: running twice sends once | #81, #86 |
| Biometric punch replay (same punchTime) ignored | #79 |
| Staff manual mark overrides biometric | #80 |
| Shortage notice upserts (no duplicates per term) | #81 |
| Absence alert skips un-marked section | #86 |
| Absence alert skips approved leave | #86 |
| Credit pack order rejected (no real driver) | #84/#85 |
| KPI denominator is marked, not enrolled | #87 |
| Registry count: 99 live + 62 roadmap = 161 total | Registry |

`;

fs.appendFileSync(NEW, phase8, 'utf8');
console.log('Phase 8 appended. File size:', fs.statSync(NEW).size, 'bytes');

