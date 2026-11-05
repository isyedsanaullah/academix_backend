---

#### 8F: Messaging Layer & Guardian Notification Feed (supports #83, #86; #84 and #85 stay `coming_soon`)

* **Institutional Job:** one delivery interface that today delivers **in-app only**, at **zero credit cost**, and can later gain real SMS/WhatsApp drivers without changing callers.
* **Typed recipients** (replaces the ambiguous `recipientUserId`): `send({ collegeId, recipient, channel, template, body, refType, refId })` where `recipient` is `{ type: 'USER', userId }` or `{ type: 'GUARDIAN', studentId }`.
* **Guardian feed model** (the portal feed and #86 both depend on it):
```prisma
model GuardianNotification {
  id         String    @id @default(uuid())
  college_id String
  campus_id  String?   // Pre-wired for Phase 10 multi-campus isolation
  student_id String
  kind       String    // ABSENCE | DIARY | CIRCULAR | SHORTAGE | FEE | GENERAL
  title      String
  body       String
  refType    String?
  refId      String?
  readAt     DateTime?
  createdAt  DateTime  @default(now())
  @@index([college_id, student_id, createdAt(sort: Desc)])
  @@index([college_id, student_id, readAt])
}
```
* **Driver interface (`isReal` flag):**
  * `MessagingDriver` defines `isReal: boolean` (returns `false` on `InAppMessagingDriver`; `true` on real live drivers). Callers check `driver.isReal` rather than relying on brittle `instanceof` checks.
  * `InAppMessagingDriver.send` writes `OutboxEvent(eventType = 'IN_APP_MESSAGE')`; its handler inserts a `GuardianNotification` (guardian recipient) or a user notification (user recipient). Cost = **0 credits**, no ledger debit.
  * `send` with `channel = 'SMS'` or `'WHATSAPP'` returns `CHANNEL_NOT_AVAILABLE` while `driver.isReal === false`. `TwilioSmsDriver` / `MetaWhatsAppDriver` are empty stub classes, never instantiated.
  * **No misleading labels:** in-app messages are titled "Notice". They are never tagged `[SMS Notice]` or `[WhatsApp Notice]`, because parents would believe an SMS was sent.
* **Credit-pack rejection happens before payment, not at settlement** (settling a payment the college already made is too late):
  1. Add `AddonCatalog.isPurchasable Boolean` (default true). Messaging packs are set `false` while no real driver is registered. The catalog keys come from the seeded `AddonCatalog` rows (the schema comment lists `SMS_PACK_500/2000/5000`; verify against the actual rows). Code reads the flag and never hard-codes pack keys.
  2. `calculate-total` and `submit-payment` reject any line item whose catalog row is not purchasable with 422 `ITEM_NOT_PURCHASABLE`.
  3. The public catalog and `/request-subscription` show such packs as "Available when SMS goes live".
  4. Defence in depth: if an order was submitted before the flag flipped, settlement refuses that line with 422 and Super Admin rejects the payment through the normal offline-refund path.
* **Copy fix:** the Premium/Enterprise "200 / 600 included messages per month" row on `/request-subscription`, `/services` and §1 gets the note "active when SMS goes live". Monthly `PLAN` grants may continue to be written but are unusable until a driver exists.
* **Definition of Done:**
  - [ ] `GuardianNotification` model and `IN_APP_MESSAGE` handler registered.
  - [ ] Typed recipient; no message addressed by a session id.
  - [ ] `isReal` flag on driver interface; in-app driver costs 0; SMS/WhatsApp return `CHANNEL_NOT_AVAILABLE`.
  - [ ] No `[SMS Notice]`/`[WhatsApp Notice]` tags anywhere.
  - [ ] Packs rejected in `calculate-total` **and** `submit-payment` via `isPurchasable`.
  - [ ] Pricing/catalog copy updated; #84 and #85 remain `coming_soon`.

---

#### 8G: #83 Parent Portal PWA (Standard)

* **Institutional Job:** mobile-first installable portal for guardians to see attendance, fee statements, results, diary, circulars and notifications for their child.
* **OD-11 resolved:** authentication is **roll number + guardian PIN** (no simulated OTP). Guardian sessions are never `User` rows and **never count toward any quota**.
```prisma
model GuardianSession {
  id             String    @id @default(uuid())
  college_id     String
  campus_id      String?   // Pre-wired for Phase 10 multi-campus isolation
  studentId      String
  pinHash        String    // bcrypt
  isActive       Boolean   @default(true)
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?
  lastLoginAt    DateTime?
  pinIssuedAt    DateTime  @default(now())
  pinResetBy     String?
  @@unique([college_id, studentId])
}

model GuardianToken {
  id          String    @id @default(uuid())
  college_id  String
  campus_id   String?
  sessionId   String
  tokenHash   String    @unique
  tokenEpoch  Int       // College.tokenEpoch at issue time
  expiresAt   DateTime
  revokedAt   DateTime?
  @@index([sessionId])
}

model GuardianLoginAttempt {
  id         String   @id @default(uuid())
  college_id String
  campus_id  String?
  ipHash     String
  success    Boolean
  createdAt  DateTime @default(now())
  @@index([college_id, ipHash, createdAt])
}
```
* **PIN policy (the earlier "6-digit alphanumeric" was contradictory):** an **8-character PIN** from an unambiguous 32-character alphabet (≈ 2^40 combinations), generated server-side at admission and printed on the admission slip. A 6-digit numeric PIN would be brute-forceable across sequential roll numbers even with per-account lockout.
* **Brute-force controls & roll number disambiguation:**
  * **Disambiguated roll number lookup:** Because `rollNumber` is scoped to `(college_id, session_id)`, a roll number may exist in older sessions. Guardian lookup queries:
    ```sql
    SELECT s.id, s.session_id, s.class, s.section, s.status
    FROM "Student" s
    WHERE s.college_id = $college_id
      AND s."rollNumber" = $rollNumber
      AND s.status = 'active'
    ORDER BY s."createdAt" DESC;
    ```
    If exactly one active student is found, proceed to PIN verification. If multiple active records exist across sessions/shifts, the UI asks the guardian to select their student's class/session before verifying the PIN.
  * Per-account lockout: `parent.pinAttemptLimit` failures lock the account for `parent.lockoutMinutes`.
  * **Per-IP throttle** via `GuardianLoginAttempt` (DB-backed, because there is no shared limiter store): too many failures from one IP across any accounts blocks that IP for a window.
  * **Generic error:** every failure returns the same "Invalid roll number or PIN" (no distinction between unknown roll number, wrong PIN and locked account).
* **Guardian auth middleware** (every `/api/parent/*` request): load the token by hash; reject if revoked or expired; reject if `College.subStatus = SUSPENDED`; reject if `token.tokenEpoch < College.tokenEpoch`; reject if the session is inactive or the student is withdrawn or deleted. Resolve `studentId` from the session; **every query is scoped to that one student**.
* **Routes:** `GET /api/parent/{student,attendance,fees,results,diary,calendar,circulars,notifications}`. The only non-GET routes are `POST /api/parent/auth/login`, `POST /api/parent/auth/logout` and `POST /api/parent/notifications/:id/read`.
* **PIN issuance:** `POST /api/admin/parent-portal/issue` for one student; `POST /api/admin/parent-portal/issue-bulk` for **existing students** (every active student lacking a session). Bulk issuance produces a **one-time PIN slip PDF** in category `REPORTS` (server-exempt, 24 h TTL, single download) because the plaintext PIN exists only there. `POST …/:studentId/reset-pin` is audited. Admins can list sessions (`GET …/sessions`).
* **Logout and caching:** logout revokes the token, returns `Clear-Site-Data: "cache", "storage"` (HTTPS only) and messages the service worker to purge its caches.
* **Service-worker scope:** the parent app is scoped to `/parent/`. The faculty PWA (N08) uses a **different scope** (`/staff-app/`) and its own manifest so the two never share caches.
* **Audience extension:** add `PARENTS` to `AnnouncementAudience.audienceType`. Parent circulars are `audienceType IN ('ALL','PARENTS')` plus section targeting for the student's section.
* **Siblings:** one roll number maps to one student; a guardian with several children logs in separately. Linking siblings is out of scope.
* **Definition of Done:**
  - [ ] Models and 8-char PIN generation with bcrypt storage.
  - [ ] Account lockout, IP throttle and generic error messages tested.
  - [ ] Disambiguated roll number lookup scoped to active session/status.
  - [ ] Middleware checks suspended status, `tokenEpoch`, session and student state.
  - [ ] All data routes GET-only and scoped to the linked student; cross-student ID returns 404.
  - [ ] Bulk issuance for existing students with a one-time slip.
  - [ ] Sessions excluded from every quota count.
  - [ ] Logout clears caches; `/parent/` and `/staff-app/` scopes are separate.
  - [ ] `PARENTS` audience added to `AnnouncementAudience`.

---

#### 8H: #81 Attendance Shortage Scanner (Standard)

* **Institutional Job:** a weekly audit that finds students below the attendance threshold and issues notices.
* **Reuse #41:** extract the #41 percentage logic into `attendanceCalculationService.js` and call it from both. Do not fork it. Whatever #41 does with approved leave is what #81 does.
* **Counting rule:** count only days that are **marked** (`getMarkedDays` against `Attendance` model) and **not** holidays or weekly off (`getWorkingDays`) from 8B.
* **`termKey` definition:** `attendance.terms` in `CollegeSetting` is a list of `{ key, start, end }`; if unset, the single term is the active academic session and `termKey = session_id`.
```prisma
model AttendanceShortageNotice {
  id                String    @id @default(uuid())
  college_id        String
  campus_id         String?   // Pre-wired for Phase 10 multi-campus isolation
  studentId         String
  sectionId         String?
  termKey           String
  markedDays        Int
  attendedDays      Int
  attendancePercent Decimal   @db.Decimal(5, 2)
  thresholdPct      Decimal   @db.Decimal(5, 2)   // snapshot of the setting used
  status            String    // ISSUED | ACKNOWLEDGED | RESOLVED
  lastNotifiedPct   Decimal?  @db.Decimal(5, 2)
  notifyCount       Int       @default(0)
  firstIssuedAt     DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  @@unique([college_id, studentId, termKey])
  @@index([college_id, status])
}
```
* **Upsert semantics:** `INSERT … ON CONFLICT (college_id, studentId, termKey) DO UPDATE … RETURNING (xmax = 0) AS inserted`. A guardian notification (`SHORTAGE_NOTICE_ISSUED`) is sent only when the row was **inserted**, when the percentage has **fallen by at least `attendance.shortageRenotifyDropPct` points** since `lastNotifiedPct`, or when a `RESOLVED` notice re-opens. Otherwise the row is updated silently, so weekly runs do not spam and never reset an `ACKNOWLEDGED` notice back to `ISSUED`.
* **Worker:** weekly. `JobRunLog(jobKey='shortage-scanner', runKey=ISO week, college_id)` claim; entitlement check; skip suspended colleges.
* **Definition of Done:**
  - [ ] Shared calculation service used by #41 and #81 (parity test).
  - [ ] Unmarked days, holidays and weekly off excluded.
  - [ ] `termKey` resolved from settings or session; unique key enforced.
  - [ ] Upsert distinguishes new from updated; no repeat notification without a worsening band; preserves `ACKNOWLEDGED` state.
  - [ ] `JobRunLog` claim makes a double run send once.

---

#### 8I: #86 Absence Alerts to Guardians (Standard)

> [!IMPORTANT]
> **#86 depends on the messaging layer (8F) and the parent portal (8G).** It does **not** depend on #84/#85. Alerts are in-app notices at zero credit cost.

* **Catch-up semantics (replaces "exact time, one run per day"):** a section marked at 10:00 must still alert. The worker ticks every few minutes; a college is eligible when `now >= absence.alertTime` **and** `now < absence.cutoffTime` (PKT, both from settings). "Time passed and not yet done", not a 2-minute window.
* **Per tick, per college:**
  1. Entitlement and suspended checks; claim via a per-tick `pg_try_advisory_xact_lock(hash(college_id))` transaction.
  2. Skip non-working days (`getWorkingDays`).
  3. Process only sections that are **marked today** and have students not yet alerted; unmarked sections are simply retried next tick until the cutoff. After the cutoff, late-marked sections produce no alert (logged).
  4. Alert only `ABSENT` students; skip students with approved student leave; skip students with no active `GuardianSession` (counted as unreachable).
  5. **Idempotency is per student per day only** (no per-day run gate that would block later sections).
```prisma
model AbsenceAlertLog {
  id         String   @id @default(uuid())
  college_id String
  campus_id  String?  // Pre-wired for Phase 10 multi-campus isolation
  studentId  String
  alertDate  DateTime @db.Date
  sentAt     DateTime @default(now())
  @@unique([college_id, studentId, alertDate])
}
```
  6. **Atomic Absence Alert Dispatch (Zero Alert Loss):** Write both `AbsenceAlertLog` (`ON CONFLICT DO NOTHING`) AND the `OutboxEvent` (and `GuardianNotification`) inside the **same database transaction**. If event insertion fails, the transaction rolls back so the alert is not lost and is re-attempted on the next worker tick. Only when the transaction commits is the alert considered dispatched.
* **Definition of Done:**
  - [ ] Alert and cutoff times from settings; "passed and not done" logic tested with a 10:00 marking.
  - [ ] Unmarked sections retried until cutoff; none alerted after.
  - [ ] Holidays, approved leave and portal-less students skipped.
  - [ ] Two overlapping ticks send once (per-student unique).
  - [ ] Delivered through 8F at 0 credits; no dependency on #84/#85.

---

#### 8J: #87 Principal & Executive KPI Dashboard (Standard)

* **Pure service** `executiveKpiService.getKpiSummary(collegeId, { periodStart, periodEnd, campusId? })`. `campusId` is in the signature now because N18 (10E) calls it per campus. No `req`/`res` inside; N03 and N18 reuse it.
* **Formulas (all returned with raw numerators and denominators so callers can aggregate correctly):**

| Metric | Definition |
|:---|:---|
| `feeRecoveryRate` | `collectedCohortPkr ÷ billedCohortPkr * 100` for fee vouchers with `dueDate` falling within the period. If `billedCohortPkr === 0`, returns `0.0`. Arrears from prior periods reported separately in `arrearsCollectedPkr`, never mixed into cohort rate. |
| `collectedInPeriod` | verified payments received in the period (reported separately, never mixed into the rate) |
| `studentAttendancePct` | `present ÷ marked` for the date or range. `LATE` counts as present when `kpi.lateCountsAsPresent` is true |
| `studentAttendanceCoverage` | `sections with attendance marked ÷ sections expected to mark` |
| `staffAttendancePct` / `staffCoverage` | `presentStaff ÷ activeExpectedStaff`. Denominator equals active staff minus approved leaves minus scheduled weekly offs. |
| `totalEnrolled` | count of active students |

* **Coverage guard:** if coverage is below `kpi.minCoveragePct`, the attendance figure is returned with `lowCoverage: true` and the UI shows "based on N of M sections". Marking one section never displays as 95 % for the college.
* **Access:** `admin` and `principal`, or the permission `kpi:view` once N10 ships; accountants and teachers get 403.
* **API:** `GET /api/executive/kpi-summary?periodStart=&periodEnd=&campusId=`.
* **Definition of Done:**
  - [ ] Pure service, no HTTP imports; signature includes `campusId`.
  - [ ] Attendance is `present ÷ marked`; coverage returned; low-coverage flag tested.
  - [ ] `LATE` handling follows the setting.
  - [ ] Recovery formula cohort based on `dueDate`; guards against zero division; raw counts returned.
  - [ ] Role-restricted.

---

#### 8K: #82 Online Fee Payment Gateway (Standard; `coming_soon`, adapter interface only)

* **Ships only:** `backend/services/paymentGatewayAdapter.js` with a `PaymentGatewayDriver` interface (`initiatePayment`, `handleWebhook`, `verifyTransaction`), empty `JazzCashDriver` / `EasyPaisaDriver` stubs, and `getActiveGatewayDriver()` returning `null`. No credentials, no routes, **no new tables**.
* **Reuse #75:** the existing `PaymentProof` flow is the proof-of-payment path; **do not create `FeePaymentProof`**.
* **Storage (contradiction fixed):** fee proof slips use the tenant-counted category `FEE_PROOFS` and **count toward quota** (8.0.6). They are *not* exempt.
* **UI:** a non-clickable "Online fee payment (coming soon)" card.
* **Definition of Done:**
  - [ ] Interface and stubs only; #82 remains `coming_soon`.
  - [ ] No new tables; `PaymentProof` untouched.
  - [ ] Fee proofs verified to count toward storage quota.

---

#### Phase 8 Contract Tests (`backend/tests/phase8_contract.test.js`)

| Test | Covers |
|:---|:---|
| Allowed on correct tier, `FEATURE_NOT_IN_PLAN` below | every new gate key |
| Registry-key lint: every `subscriptionGate` literal exists in `FEATURE_REGISTRY` | all |
| Read-only: reads and whitelisted writes work, other writes blocked | #28, #80, #27 |
| Suspended: tenant, guardian and API access blocked; device punches stored, not processed | #79, #83 |
| Cross-tenant ID returns 404 | every new model |
| Seats full → 409; transfer blocked when destination full; transfer does not consume quota | #29 |
| Student create and restore consume quota; group assignment does not | #29 |
| Client upload with category `BACKUPS` rejected; reconciliation ignores exempt prefixes | 7A retrofit |
| Import: second active job → 409; chunk quota failure → `PARTIAL`; resume after reaper; undo skips records with payments | #27 |
| Staff import cannot create admin-class users and sends invites only | #27 |
| Same serial claimed twice → 409; unknown-serial punches discarded; force-release works | #79 |
| Punch replay ignored; first/last punch rule; far-future punch rejected | #79 |
| Student punch → student attendance; staff punch → staff attendance; manual beats biometric beats gate QR | #79, #80 |
| Late and half-day at exact thresholds | #80 |
| PIN lockout, IP throttle, generic error text, suspended/epoch rejection | #83 |
| Guardian cannot read another student's data | #83 |
| Shortage upsert: no duplicate, notify only when new or worsened | #81 |
| Absence alert: section marked at 10:00 still alerts before cutoff; none after; two ticks send once | #86 |
| Packs rejected in `calculate-total` and `submit-payment` | 8F |
| KPI attendance denominator is marked; low coverage flagged | #87 |
| Worker idempotency: running twice delivers once | #81, #86, 8F |
| Registry: **99 live + 62 roadmap = 161** | registry |
