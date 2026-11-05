---

### Phase 9: Platform Security, Governance & Export Center (10 Services)

> [!IMPORTANT]
> **Build order: N07 → N01 → N10 → N11 → N06 → N05 → N08 → N03 → N02 → N04.**
> **Registry outcome:** 98 + 10 = **108 live + 53 roadmap = 161 total** (107 / 54 if N02 waits on OD-18).
> Phase 9 inherits every 8.0 rule (suspended vs read-only, `JobRunLog` claims, outbox conventions, storage classes, registry-key lint). Gate keys below are written as **"the N-service's registry key"**; the implementer reads the actual slug from `FEATURE_REGISTRY` and the lint test enforces it. Do **not** invent keys such as `board-gazette-export` or `ledger-export`.
> **Shared rate limiting (no Redis):** per-minute and monthly counters use one DB-atomic helper, `INSERT … ON CONFLICT (…) DO UPDATE SET count = count + 1 RETURNING count`, keyed by window. In-memory limiters are *not* used for anything that must be correct across instances.

#### 9A: N07 Admin 2FA & Login Alerts (Starter)

* **Institutional Job:** protect admin-class logins with local RFC 6238 TOTP and new-device alerts. **Zero third-party dependency** (no SMS OTP, no external auth service).
* **TOTP:** HMAC-SHA1, 30 s step, 6 digits, ±1 step window, constant-time compare. Secret from `crypto.randomBytes(20)`, Base32; stored AES-256-GCM encrypted with a **dedicated** `TOTP_ENCRYPTION_KEY` (never `JWT_SECRET`). Ciphertext carries a key-version prefix (`v1:`) so the key can rotate.
* **Replay protection:** `User.totpLastStep` stores the last accepted step; a code whose step is `<=` it is rejected.
* **Fields on `User`:** `totpSecretEnc`, `totpEnabled`, `totpLastStep BigInt?`, `totpFailedAttempts`, `totpLockedUntil`, `totpBackupCodes Json?` (bcrypt hashes of ten 10-char codes, removed on use), `twofaEnrolledAt`.
* **Two-step login:**
  1. Password (or verified Firebase ID token) succeeds for a user with TOTP enabled → server issues a **pre-auth token**: a short-lived (5 min) signed token with a `jti`, scope `PREAUTH_2FA`, **never accepted as a session JWT**.
  2. `POST /api/auth/2fa/validate` consumes the token: the `jti` is inserted into the single-use store (`UsedStepUpToken` extended with a `kind` column) so it cannot be replayed. Each pre-auth token allows at most 5 code attempts; the user also has the account-level lockout (`totpFailedAttempts`, 30-minute lock).
* **Firebase Google login does not bypass 2FA.** The Firebase callback verifies the ID token, then treats it exactly like a successful password step: if TOTP is enabled it issues the pre-auth token.
* **Known-device alerts (replaces fingerprinting):** the server cannot see screen size and IP subnets change constantly, so fingerprints would spam alerts. Instead, after a successful login the server sets a **signed, httpOnly, `Secure`, `SameSite=Lax` device cookie** (`__Host-acx_did`, random id, HMAC-signed). `KnownDevice(id, college_id, campus_id?, userId, deviceIdHash, firstSeenAt, lastSeenAt, lastIp, userAgent)` records it. A login **without** a recognised cookie writes `OutboxEvent('NEW_DEVICE_LOGIN')`, delivered by email (coarse IP and user agent only). Clearing cookies triggers an alert again; this is accepted.
* **Optional vs enforced:** optional by default for regular staff. `CollegeSetting.require2FAForAdmins` enforces it, with `twofa.enforcementGraceDays`. After the grace period an **unenrolled admin-class user logs in to a restricted session** (scope `ENROLL_2FA`) that can call only the 2FA setup endpoints until enrolled; they are never locked out of the platform entirely.
* **Super Admin mandatory 2FA:** For platform Super Admin accounts (`role === 'superAdmin'`), 2FA enrollment is **strictly mandatory from day one**. Super Admins cannot log into `/super-admin/*` without completing TOTP setup and verification; they cannot disable 2FA.
* **Lost device:** (1) backup code via `POST /api/auth/2fa/recover`; (2) if none remain, a **principal-level admin** (not the same user) resets it with step-up and audit; (3) a Super Admin can reset with the new governance action **`reset-2fa`**. **`reset-2fa` must be added to the §6B.3 action list** (step-up protected, reason required, audited). A reset clears the secret, backup codes and known devices; the user re-enrols at next login.
* **APIs:** `POST /api/auth/2fa/{setup,verify,validate,recover,disable}`, `GET/DELETE /api/auth/known-devices`.
* **Definition of Done:**
  - [ ] Dedicated encryption key with key-version prefix; secret never logged.
  - [ ] ±1 window, replay blocked by `totpLastStep`, account and per-token lockouts.
  - [ ] Pre-auth token is single-use (`jti` store) and rejected as a session token.
  - [ ] Firebase path enforces TOTP.
  - [ ] Device-cookie alerts via outbox email; no fingerprint heuristics.
  - [ ] Enforcement yields an enrol-only session, not a lockout.
  - [ ] Recovery paths and `reset-2fa` (added to 6B.3) tested and audited.

---

#### 9B: N01 Export Center (Starter)

* **Institutional Job:** one export engine with monthly quotas, safe output and a 24-hour download window.
* **Metric keys (this replaces `exportsMonthly`/`exportsCsv`/`exportsPdf` in §1.1 and §6B.1):** `exportsCsvMonthly`, `exportsPdfMonthly`, `exportMaxRows`.
  * `exportsCsvMonthly`: Starter 3, Standard 60, Premium unlimited, Enterprise unlimited. `exportsPdfMonthly`: Premium 60, Enterprise unlimited, otherwise 0.
  * `exportMaxRows`: **Starter 1,000**, **Standard 10,000**, **Premium 100,000**, **Enterprise 1,000,000** (technical streaming ceiling, per OD-21). Attendance is exported in monthly matrix form (one row per student) to prevent raw daily punch explosions from breaching the cap.
* **Pinned-plan problem:** colleges pinned to `PlanVersion` v1 do not have these keys. Fix both ways: (1) publish `PlanVersion` v2 for all four plans carrying the new keys (new renewals pin it); (2) the resolver falls back to `PLAN_LIMITS` in `planConstants.js` when a key is absent from the pinned version, so no forced re-pin is needed.
* **Quota with refund:** the period key is `YYYY-MM` in PKT (`getMonthlyKey`). Quota is counted atomically **on job creation**. A new function `refundQuota(collegeId, metric, periodKey, n)` (**does not exist today**; add it: `UPDATE CollegeUsage SET used = GREATEST(used − n, 0)`) is called when a job fails, guarded by `ExportJob.quotaRefundedAt` so a job refunds at most once.
* **Export types and gating (each by its own registry key):** `STUDENTS`, `ATTENDANCE`, `FEES` → N01's key; `GAZETTE` → **N02's key**; `LEDGER` → **N04's key**; `AUDIT_LOG` → **N17's key**. `PAYROLL` and `BOARD_REGISTRATION` were invented and are removed.
* **Formats:** `CSV`, `XLSX`, `PDF`, plus `JSON` for `AUDIT_LOG` only (N17 needs it). JSON counts against `exportsCsvMonthly`.
* **Row cap:** if the result exceeds `exportMaxRows`, reject with 422 `EXPORT_ROW_CAP_EXCEEDED` (returning the count and a "narrow your filters" hint). **Never truncate silently.**
* **Formula injection:** string cells beginning with `=`, `+`, `-`, `@`, tab or CR are prefixed with a single quote in CSV. Numeric-typed columns (amounts) are written as numbers, not prefixed. **XLSX cells are always written with string type** (`t: 's'`), never as formula cells.
* **Job engine (not the outbox):**
```prisma
model ExportJob {
  id              String    @id @default(uuid())
  college_id      String
  userId          String
  exportType      String
  format          String
  filtersJson     Json?
  periodKey       String
  status          String    // QUEUED | RUNNING | READY | FAILED | EXPIRED
  fileKey         String?   // category EXPORTS (server-exempt)
  rowCount        Int       @default(0)
  sizeBytes       BigInt    @default(0)
  failureReason   String?
  quotaRefundedAt DateTime?
  claimedBy       String?
  heartbeatAt     DateTime?
  expiresAt       DateTime
  createdAt       DateTime  @default(now())
  @@index([college_id, createdAt(sort: Desc)])
  @@index([college_id, periodKey])
  @@index([status, heartbeatAt])
  @@index([status, expiresAt])
}
```
  A worker claims `QUEUED` jobs with `FOR UPDATE SKIP LOCKED`, streams rows to an R2 **multipart upload** (no full buffer on Render), updates `heartbeatAt`, and a reaper requeues stale `RUNNING` jobs. `sizeBytes` is a `BigInt`; API serialization uses `serializeUsage`.
* **Access and audit:** `admin`, `principal`, `registrar`, `accountant` (or `exports:create` after N10); every creation writes an `AuditLog` entry. **`POST /api/exports` is on the read-only write whitelist** (exports always work in read-only mode) but blocked when suspended. The `EXPORTS` category is server-exempt with a 24 h TTL purge.
* **Definition of Done:**
  - [ ] Metric keys, `PlanVersion` v2 **and** resolver fallback in place; §1.1 and §6B.1 updated.
  - [ ] `refundQuota` implemented and idempotent via `quotaRefundedAt`.
  - [ ] Each export type gated by its own registry key (lint test passes).
  - [ ] Cap overflow rejects with 422; XLSX string typing and CSV prefixing tested.
  - [ ] Claimed worker, heartbeat, reaper and streaming upload.
  - [ ] Whitelisted in read-only; blocked when suspended; audited.

---

#### 9C: N10 Custom Roles & Permission Builder (Premium and above only)

> [!IMPORTANT]
> Starter and Standard receive 403 **`FEATURE_NOT_IN_PLAN`**. (`UPGRADE_REQUIRED` is retired platform-wide.)

* **Permission catalog (concrete, not "…full catalog"):** `backend/config/permissionCatalog.js` lists only permissions that map to routes **migrated** to `requirePermission` in this phase: `students:read`, `students:write`, `fees:read`, `fees:collect`, `attendance:read`, `attendance:mark`, `timetable:read`, `timetable:edit`, `announcements:publish`, `reports:read`, `exports:create`, `kpi:view`, `approvals:act`, `canteen:cashier`. Super-admin capabilities are never in the catalog. The catalog grows only as routes migrate.
* **Baseline map:** `backend/config/rolePermissions.js` maps each fixed role (`admin`, `principal`, `registrar`, `accountant`, `teacher`, `employee`) to the permissions it implicitly holds. `requirePermission(p)` passes if the **fixed-role map** grants `p` **or** an active custom role does. Routes not yet migrated keep their existing `authorize(...)` checks. **Custom roles grant access only on migrated routes**, and the role editor shows exactly which modules a permission affects.
* **Computed activity (no stored `isDormant`):** a custom role is active iff the college currently has the `custom-roles-permissions` entitlement (its registry key), evaluated per request. On downgrade, holders silently fall back to their base role; on re-upgrade they regain access, with no flag to drift.
* **Models:**
```prisma
model CustomRole {
  id           String   @id @default(uuid())
  college_id   String
  name         String
  description  String?
  permissions  String[] // validated against the catalog on every write
  isAdminClass Boolean  @default(false)
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  assignments  UserCustomRole[]
  @@unique([college_id, name])
  @@unique([id, college_id])
}

model UserCustomRole {
  id         String   @id @default(uuid())
  college_id String
  userId     String
  roleId     String
  assignedBy String
  assignedAt DateTime @default(now())
  role CustomRole @relation(fields: [roleId, college_id], references: [id, college_id], onDelete: Cascade)
  @@unique([college_id, userId, roleId])
  @@index([college_id, userId])
}
```
  The composite FK `(roleId, college_id) → (id, college_id)` makes cross-tenant assignment impossible at the database level. The user is verified to belong to the same college in the service.
* **Admin quota rules:** one function `countAdminClassUsers(collegeId)` = users whose base role is admin **or** who hold an active `isAdminClass` role (each user counted once). **Creating a role consumes no quota.** *Assigning* an admin-class role to a user who is not already admin-class calls `withQuota('admins', 1)`; unassigning releases it. **Toggling `isAdminClass` on an existing role** re-checks quota for the holders who would become newly admin-class and rejects with 422 if the limit would be exceeded.
* **Privilege-escalation rules:** a grantor can include only permissions they hold; nobody edits their own role; admin-class roles are assignable only by a fixed-role `admin`; super-admin capabilities are unreachable.
* **Audit:** create, update, delete, assign and unassign each write an `AuditLog` entry (actor, before/after).
* **Later:** OD-04's `isCanteenCashier` boolean is replaced by `canteen:cashier`.
* **Definition of Done:**
  - [ ] Concrete catalog and baseline role map; unmigrated routes unchanged.
  - [ ] Activity computed from entitlements (downgrade and re-upgrade tested).
  - [ ] Composite FK; cross-tenant assignment fails.
  - [ ] Quota semantics: role creation free; assignment and `isAdminClass` toggle checked.
  - [ ] Escalation rules and audit entries tested.
  - [ ] Starter/Standard get `FEATURE_NOT_IN_PLAN`.

