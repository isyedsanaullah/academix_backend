---

#### 8D: #80 Teacher & Staff Attendance Register (Standard)

* **Institutional Job:** digital staff check-in/out with configurable grace, leave linkage and late metrics.
* **Audit-first:** staff leave is the **#63 staff leave model** (the audit found no `StaffLeave`; `LeaveApplication` is the *student* model and is not used here). `ON_LEAVE` is **derived at read time** from approved staff leave covering the date; it is never copied into `StaffAttendance`.
```prisma
model StaffAttendance {
  id           String    @id @default(uuid())
  college_id   String
  campus_id    String?   // Pre-wired for Phase 10 multi-campus isolation
  userId       String
  date         DateTime  @db.Date
  checkInTime  DateTime?
  checkOutTime DateTime?
  status       String    // PRESENT | LATE | HALF_DAY | ABSENT | DEFERRED_PROCESSING (ON_LEAVE is derived live)
  minutesLate  Int       @default(0)
  source       String    // MANUAL | BIOMETRIC | GATE_QR | SYSTEM
  markedById   String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@unique([college_id, userId, date])
  @@index([college_id, date(sort: Desc)])
}
```
* **Settings (no per-row defaults):** `staff.shiftStartTime`, `staff.graceMinutes`, `staff.halfDayAfterMinutes` from `CollegeSetting`. Definition, with `d = minutes after shiftStart`:
  * `d <= graceMinutes` → `PRESENT`
  * `graceMinutes < d <= halfDayAfterMinutes` → `LATE`, `minutesLate = d`
  * `d > halfDayAfterMinutes` → `HALF_DAY`
  * (`halfDayAfterMinutes` is measured from shift start, not from the end of grace.)
* **Source priority & denominator preservation:**
  - Priority hierarchy: `MANUAL` (rank 4) > `BIOMETRIC` (rank 3) > `GATE_QR` (rank 2) > `SYSTEM` (rank 1).
  - A lower-priority write never overwrites a higher one; a higher one overwrites a lower one.
  - **Denominator inflation guard (Single Authoritative Method):** "Present ÷ marked" without `ABSENT` rows would cause absent staff to vanish from the register, falsely driving the attendance rate toward 100%. Daily at 14:00 PKT (after morning arrival shifts conclude), `staffAttendanceWorker` queries all active staff accounts lacking a `StaffAttendance` row for the day (excluding staff on approved leave or scheduled weekly off) and writes explicit `status = 'ABSENT', source = 'SYSTEM'` rows. Because `source = 'SYSTEM'` has the lowest rank (1), any subsequent biometric punch (`BIOMETRIC`, rank 3) or manual mark (`MANUAL`, rank 4) overwrites it cleanly.
  - `status = 'DEFERRED_PROCESSING'` is used for biometric punches received while a college is in `SUSPENDED` status, queued until reactivation.
* **Audit trail:** every manual create/edit writes an `AuditLog` entry (`STAFF_ATTENDANCE_EDIT`, before/after). There is no separate `editHistory` column (one source of truth).
* **Suspended/read-only:** read-only mode blocks manual marks (reads and CSV export still work). Suspended means login is blocked, so nothing is reachable; device punches are stored and processed after reactivation (8E).
* **APIs:** `GET /api/staff-attendance?date=&userId=`, `POST /api/staff-attendance`, `PUT /api/staff-attendance/:id`, `GET /api/staff-attendance/summary?from=&to=`. Export goes through the Report Center (#77) until N01 exists.
* **Definition of Done:**
  - [ ] Real #63 leave model identified; `ON_LEAVE` derived live.
  - [ ] Shift, grace and half-day rules read from `CollegeSetting`.
  - [ ] Late/half-day boundaries tested at the exact thresholds.
  - [ ] Source priority enforced both ways (`MANUAL` > `BIOMETRIC` > `GATE_QR` > `SYSTEM`).
  - [ ] Manual edits audited in `AuditLog`.
  - [ ] Cross-tenant record ID returns 404.

---

#### 8E: #79 Biometric Turnstile Synchronizer (Path B & Dev Simulator — Stays `coming_soon`)

* **Institutional Job:** Ingest turnstile and terminal attendance punches and translate them into **student and staff** attendance records.
* **Deployment Status:** **`coming_soon`**. Because physical turnstile/biometric hardware is not available in the test environment, #79 remains `status = 'coming_soon'` in `featureRegistry.js`. The complete data pipeline, security layers, and processing worker are fully implemented and verified using Path B and an automated dev simulator script.

##### 8E.1 Ingestion Protocol: Path B Only
* Ingestion uses **Path B (HTTPS Ingestion with Per-Device Bearer Secret)**:
  * Route: `POST /api/biometric/devices/:deviceId/punches`
  * Authentication: Header `Authorization: Bearer <secretToken>` where `sha256(secretToken)` matches `BiometricDevice.pushSecretHash`.
  * The device ID in the URL unambiguously scopes punches to the correct device and tenant.
* **Native ADMS (`/iclock/*`) & Claim Flow:**
  > [!NOTE]
  > Native plain-HTTP `/iclock/*` routes and the unauthenticated `UnclaimedDeviceContact` auto-claim flow are deferred until real physical devices are provisioned and connected on a dedicated ingress host in production.

##### 8E.2 Device Identity Model
```prisma
model BiometricDevice {
  id             String    @id @default(uuid())
  college_id     String
  campus_id      String?   // Pre-wired for Phase 10 multi-campus isolation
  serialNumber   String    @unique          // GLOBAL unique
  deviceName     String
  location       String?
  status         String    // ACTIVE | DISABLED
  pushSecretHash String    // SHA-256 hash of device bearer secret, shown once on creation
  createdAt      DateTime  @default(now())
  lastSeenAt     DateTime?
  @@index([college_id, status])
}
```

##### 8E.3 Data Models
```prisma
model BiometricIdentityMap {
  id           String  @id @default(uuid())
  college_id   String
  campus_id    String? // Pre-wired for Phase 10 multi-campus isolation
  deviceUserId String
  subjectType  String  // STUDENT | STAFF
  subjectId    String
  @@unique([college_id, deviceUserId])
  @@index([college_id, subjectType, subjectId])
}

model BiometricPunchLog {
  id           String   @id @default(uuid())
  college_id   String
  campus_id    String?  // Pre-wired for Phase 10 multi-campus isolation
  deviceId     String
  deviceUserId String
  punchTime    DateTime // UTC, converted by the server
  processed    Boolean  @default(false)
  createdAt    DateTime @default(now())
  @@unique([college_id, deviceId, deviceUserId, punchTime])
  @@index([college_id, processed, punchTime])
}

model UnmappedBiometricPunch {
  id           String   @id @default(uuid())
  college_id   String
  campus_id    String?  // Pre-wired for Phase 10 multi-campus isolation
  deviceId     String
  deviceUserId String
  punchTime    DateTime
  resolvedAt   DateTime?
  @@index([college_id, resolvedAt, punchTime])
}
```
* The compound unique index `[college_id, deviceId, deviceUserId, punchTime]` makes replays completely idempotent (`INSERT … ON CONFLICT DO NOTHING`).
* **Time Invariants:**
  * Device-local timestamp is converted to UTC using `biometric.timezone` from `CollegeSetting`.
  * Punches later than `now + 5 min` are rejected with HTTP 422 (`FUTURE_PUNCH_REJECTED`).
  * Punches older than `biometric.maxBackfillDays` (default 7 days) are rejected.
* **In/Out Punch Calculation:** No direction field from hardware is trusted. Per subject per PKT day, the **first punch of the day** is check-in and the **last punch of the day** is check-out.
* **Unmapped Punches:** Punches from unrecognized `deviceUserId` entries are safely stored in `UnmappedBiometricPunch`. When an admin creates the mapping in `BiometricIdentityMap`, the unmapped queue is automatically re-driven.
* **Payload Limits:** Request body capped at 512 KB and maximum 1,000 punches per batch push.

##### 8E.4 Worker (`biometricSyncWorker`)
Runs via `JobRunLog` claim. For each college:
* Checks entitlement and suspended status (`SUSPENDED` colleges mark punches `status = 'DEFERRED_PROCESSING'`).
* Claims unprocessed batch `WHERE processed = false FOR UPDATE SKIP LOCKED LIMIT 200`.
* Resolves `BiometricIdentityMap`:
  * **Staff** → updates `StaffAttendance` with `source = 'BIOMETRIC'`, respecting priority (`MANUAL` > `BIOMETRIC` > `GATE_QR` > `SYSTEM`).
  * **Student** → updates `Attendance` with `method = 'biometric'`, never overwriting a teacher's manual mark.

##### 8E.5 Dev Simulator Script (`backend/scripts/simulateBiometricPunches.js`)
* Development and automated test harness (strictly disabled when `NODE_ENV === 'production'`).
* Simulates real-world device pushes over Path B:
  1. Valid punch batch for enrolled staff and student.
  2. Duplicate punch to verify idempotency.
  3. Unmapped `deviceUserId` punch to verify routing into `UnmappedBiometricPunch`.
  4. Far-future punch (`now + 10 min`) to verify 422 rejection.

* **Definition of Done:**
  - [ ] Path B bearer authentication enforced at `POST /api/biometric/devices/:deviceId/punches`.
  - [ ] Unique constraint `[college_id, deviceId, deviceUserId, punchTime]` prevents duplicate entries.
  - [ ] Student and staff identity resolution via `BiometricIdentityMap`.
  - [ ] First/last punch in/out rule implemented.
  - [ ] Future punch rejection and backfill window verified.
  - [ ] Unmapped punches stored and re-driven upon mapping creation.
  - [ ] Dev simulator script `simulateBiometricPunches.js` created and passing.
  - [ ] Feature #79 remains `coming_soon` in `featureRegistry.js`.
