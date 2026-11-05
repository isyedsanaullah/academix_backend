'use strict';
const fs = require('fs');
const NEW = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v2.md';

const phase9 = `

---

### Phase 9: Platform Security, Governance & Export Center (10 Services)

> [!IMPORTANT]
> **Build order: N07 → N01 → N10 → N11 → N06 → N05 → N08 → N03 → N02 → N04**
> This order ensures: 2FA is live before data exports (N01), custom roles before approvals (N11 builds on N10 permission catalog), API (N06) after the data layer is stable, digests (N03) after the KPI service (#87) is built, and accounting exports (N04) seeds N40's chart of accounts.

---

#### 9A: N07 Admin 2FA & Login Alerts (Starter)

* **Institutional Job:** Secures administrator, principal, and accountant logins with local RFC 6238 TOTP and known-device login alerts.

> [!IMPORTANT]
> **Zero third-party dependencies.** No SMS OTP, no Auth0, no Firebase Phone Auth. Pure local HMAC-SHA1 computation. Compatible with Google Authenticator, Microsoft Authenticator, 1Password.

* **Implementation Details:**
  1. **TOTP secret storage:** Generate \`crypto.randomBytes(20)\` → Base32-encode. Encrypt with **a separate AES-256-GCM key** (env var \`TOTP_ENCRYPTION_KEY\`, distinct from \`JWT_SECRET\`). Store encrypted blob in \`User.totpSecretEnc\`. Never log or expose the plaintext secret.
  2. **±1 time-step window:** Accept codes from \`[currentStep - 1, currentStep, currentStep + 1]\` to handle clock skew.
  3. **Used time-step protection:** Store the last accepted \`timeStep\` in \`User.totpLastStep\`. Reject any code where \`timeStep <= totpLastStep\` (prevents replay within the ±1 window).
  4. **5-attempt lockout:** After 5 failed TOTP attempts within 15 minutes → lock TOTP for 30 minutes. Store \`User.totpFailedAttempts\` + \`User.totpLockedUntil\`.
  5. **Pre-auth token (not full JWT):** After password step succeeds for a 2FA-enrolled user, issue a **short-lived (5-minute) pre-auth token** (signed, single-use) instead of a full JWT. The client uses it in \`POST /api/auth/2fa/validate\` to complete login. Prevents half-authenticated sessions.
  6. **Backup codes:** 8 × 10-character alphanumeric codes. Stored as bcrypt hashes in \`User.totpBackupCodes Json[]\`. Each code single-use (delete from array on use).
  7. **Known-device tracking:** On successful login, record \`KnownDevice(userId, deviceFingerprint, ipAddress, userAgent, firstSeenAt, lastSeenAt)\`. On new-device login (fingerprint not in known list) → write \`OutboxEvent(type='NEW_DEVICE_LOGIN')\` → outbox worker sends email alert via existing outbox pattern.
  8. **Firebase Google login:** If user has TOTP enrolled AND logs in via Firebase Google auth, the Firebase callback must redirect to the TOTP step (issue pre-auth token, require TOTP). Firebase login does not bypass 2FA.
  9. **Optional vs enforced:** 2FA is optional by default (users can enable it). College admins can set \`CollegeSetting.require2FAForAdmins = true\` to enforce enrollment for all admin-class users.
  10. **Reset path (lost device):** Admin provides a backup code via \`POST /api/auth/2fa/recover\`. If all 8 backup codes are exhausted, the user contacts Super Admin who can clear \`User.totpSecretEnc\` via governance deck (audit-logged).

* **New Schema Fields on \`User\` model (additive):**
  \`\`\`prisma
  // Add to existing User model:
  totpSecretEnc     String?   // AES-256-GCM encrypted Base32 TOTP secret
  totpEnabled       Boolean   @default(false)
  totpLastStep      BigInt?   // Last accepted time step (replay protection)
  totpFailedAttempts Int      @default(0)
  totpLockedUntil   DateTime?
  totpBackupCodes   Json?     // Array of bcrypt hashes, consumed on use

  // New table:
  model KnownDevice {
    id                String   @id @default(uuid())
    userId            String
    college_id        String
    deviceFingerprint String   // Hash of UA + IP subnet + screen dims
    ipAddress         String
    userAgent         String?
    firstSeenAt       DateTime @default(now())
    lastSeenAt        DateTime @default(now())

    @@unique([userId, deviceFingerprint])
    @@index([userId])
  }
  \`\`\`

* **API Contracts:**
  - \`POST /api/auth/2fa/setup\` — generate secret, return \`otpauth://\` URI + QR data URL.
  - \`POST /api/auth/2fa/verify\` — confirm first TOTP code to enable 2FA; generate backup codes.
  - \`POST /api/auth/2fa/validate\` — validate TOTP code during login step 2; exchanges pre-auth token for full JWT.
  - \`POST /api/auth/2fa/recover\` — consume backup code; issues full JWT.
  - \`POST /api/auth/2fa/disable\` — disable 2FA (requires TOTP confirmation or backup code).
  - \`GET /api/auth/known-devices\` — list user's known devices.
  - \`DELETE /api/auth/known-devices/:id\` — revoke a device (forces re-verification on next login from that device).

* **Definition of Done (9A):**
  - [ ] TOTP secrets encrypted with \`TOTP_ENCRYPTION_KEY\` (separate from \`JWT_SECRET\`).
  - [ ] ±1 time-step window; \`totpLastStep\` prevents replay.
  - [ ] 5-attempt lockout; 30-minute lock timer.
  - [ ] Pre-auth token issued after password step; full JWT only after TOTP validated.
  - [ ] 8 bcrypt-hashed backup codes; single-use (deleted on consumption).
  - [ ] Firebase Google login path enforces TOTP if enrolled.
  - [ ] New-device login alert via OutboxEvent → email (not SMS, zero third-party deps).
  - [ ] Reset path documented: backup codes → SA clear (audit-logged).

---

#### 9B: N01 Platform Export Center with Tiered Monthly Quotas (Starter)

* **Institutional Job:** Centralized data export hub enforcing monthly plan quotas with formula injection prevention, role restrictions, and 24-hour storage TTL.

* **Metric keys (must match §1.1 exactly):**
  | Key | Starter | Standard | Premium | Enterprise |
  |:---|:---|:---|:---|:---|
  | \`exportsCsvMonthly\` | 3 | 60 | Unlimited | Unlimited |
  | \`exportsPdfMonthly\` | 0 | 0 | 60 | Unlimited |
  | \`exportMaxRows\` | 1,000 | 10,000 | 100,000 | Unlimited |

* **Period key:** \`YYYY-MM\` in PKT (e.g. \`2026-11\`). **Not "reset on the 1st"** — the period key IS the month string; quota is consumed against this key. No cron needed to reset; a new month = a new key.

* **Quota lifecycle:**
  - **Count on job creation** (not on completion). If quota exceeded → reject with 403 \`EXPORT_QUOTA_EXCEEDED\` before creating the job.
  - **Refund on failure:** If job fails (status = \`FAILED\`), call \`quotaService.refund(collegeId, 'exportsCsvMonthly', 1)\`. The quota entry for the month is decremented.

* **Export type gating (each type by its own feature):**
  - \`STUDENTS\`, \`ATTENDANCE\`, \`FEES\`: Starter+. Gate: \`export-center\`.
  - \`GAZETTE\`, \`BOARD_REGISTRATION\`: Standard+. Gate: \`board-gazette-export\`.
  - \`LEDGER\`, \`PAYROLL\`: Premium+. Gate: \`ledger-export\`.

* **Data Model:**
  \`\`\`prisma
  model ExportJob {
    id          String    @id @default(uuid())
    college_id  String
    userId      String
    exportType  String    // STUDENTS | ATTENDANCE | FEES | GAZETTE | LEDGER | PAYROLL
    format      String    // CSV | PDF | XLSX
    status      String    @default("PENDING")
    // PENDING | GENERATING | READY | FAILED | EXPIRED
    fileKey     String?   // R2 key; category = EXPORTS (quota-exempt, 24h TTL)
    rowCount    Int       @default(0)
    sizeBytes   BigInt    @default(0)   // BigInt — large exports exceed Int range
    filters     Json?     // date ranges, section IDs, etc.
    expiresAt   DateTime  // createdAt + 24 hours
    periodKey   String    // "2026-11" — for quota tracking
    createdAt   DateTime  @default(now())
    updatedAt   DateTime  @updatedAt

    @@index([college_id, createdAt(sort: Desc)])
    @@index([college_id, periodKey])
    @@index([status, expiresAt])  // For TTL cleanup worker
  }
  \`\`\`

* **Storage:** Category \`EXPORTS\` is **quota-exempt** (like \`RECEIPTS\`). A TTL cleanup worker deletes R2 objects and marks jobs \`EXPIRED\` after 24 hours. This ensures exports function even when a college is over storage quota.

* **CSV formula injection prevention:**
  Any cell value starting with \`=\`, \`+\`, \`-\`, or \`@\` must be prefixed with a tab character: \`\\t=SUM(A1)\` → safe. Apply in the CSV serializer layer.

* **Role restriction + audit:** Only \`admin\`, \`principal\`, \`registrar\`, \`accountant\` may trigger exports. Every export creation writes to \`AuditLog(action='DATA_EXPORT', payload={exportType, format, rowCount})\`.

* **API Contracts:**
  - \`POST /api/exports\` — create export job (quota check on creation, audit log).
  - \`GET /api/exports/:jobId\` — poll job status + download URL (15-min presigned, only when READY).
  - \`GET /api/exports\` — list recent export jobs for the college.

* **Definition of Done (9B):**
  - [ ] \`exportsCsvMonthly\`, \`exportsPdfMonthly\`, \`exportMaxRows\` metric keys match §1.1.
  - [ ] YYYY-MM PKT period key; quota counted on creation, refunded on failure.
  - [ ] GAZETTE/LEDGER gated by their own feature keys (not just \`export-center\`).
  - [ ] \`sizeBytes\` is \`BigInt\`.
  - [ ] CSV cells sanitized against formula injection.
  - [ ] \`EXPORTS\` category quota-exempt; 24h TTL cleanup worker.
  - [ ] AuditLog entry on every export creation.

---

#### 9C: N10 Granular Custom Roles & Permission Matrix Builder (Premium Only)

> [!IMPORTANT]
> **Strictly Premium+ only.** Starter and Standard get HTTP 403 **\`FEATURE_NOT_IN_PLAN\`** (not \`UPGRADE_REQUIRED\` — that code is now retired; use \`FEATURE_NOT_IN_PLAN\` everywhere).

* **Canonical permission catalog:**
  Free-text \`permissions[]\` is not allowed. The server maintains a canonical permission catalog in \`backend/config/permissionCatalog.js\`:
  \`\`\`javascript
  const PERMISSION_CATALOG = [
    'students:read', 'students:write', 'students:delete',
    'fees:read', 'fees:collect', 'fees:waive',
    'attendance:read', 'attendance:mark',
    'timetable:read', 'timetable:edit',
    'exams:read', 'exams:manage',
    'staff:read', 'staff:write',
    'reports:read', 'reports:export',
    // ... full catalog
  ];
  // super-admin permissions are NEVER in this catalog — they cannot be assigned
  \`\`\`
  On \`POST/PUT /api/roles\`, validate every string in \`permissions[]\` against \`PERMISSION_CATALOG\`. Reject with 422 \`INVALID_PERMISSION_KEY\` if any are not in the catalog.

* **\`requirePermission()\` middleware:** New middleware added alongside \`subscriptionGate\`:
  \`\`\`javascript
  // Checks fixed canonical role OR custom role permission
  function requirePermission(permKey) {
    return (req, res, next) => {
      if (hasFixedRolePermission(req.user.role, permKey)) return next();
      if (hasCustomRolePermission(req.user, permKey)) return next();
      return res.status(403).json({ code: 'PERMISSION_DENIED' });
    };
  }
  \`\`\`
  Later, this replaces \`OD-04\`'s \`isCanteenCashier\` boolean with \`requirePermission('canteen:cashier')\`.

* **Privilege escalation prevention:**
  - A user cannot create a role containing permissions they themselves do not possess.
  - Super Admin permissions (govern billing, suspend colleges, etc.) are excluded from \`PERMISSION_CATALOG\` and can never be in a custom role.
  - \`isAdminClass = true\` assignment: creating or assigning a custom role with \`isAdminClass = true\` calls \`withQuota(collegeId, 'admins', 1, callback)\`.

* **Data Models:**
  \`\`\`prisma
  model CustomRole {
    id          String   @id @default(uuid())
    college_id  String
    name        String
    description String?
    permissions String[] // Validated against PERMISSION_CATALOG
    isAdminClass Boolean @default(false)
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt

    assignments UserCustomRole[]
    @@unique([college_id, name])
    @@index([college_id])
  }

  model UserCustomRole {
    id         String   @id @default(uuid())
    college_id String   // Required for tenant isolation
    userId     String
    roleId     String
    assignedBy String
    assignedAt DateTime @default(now())

    role       CustomRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
    @@unique([college_id, userId, roleId])
    @@index([college_id, userId])
  }
  \`\`\`

* **Downgrade behavior:** If a college downgrades from Premium to Standard, custom roles are not deleted. They are marked dormant: \`CustomRole.isDormant = true\`. Users with dormant custom roles fall back to their base canonical role. On re-upgrade to Premium, roles reactivate automatically.

* **Definition of Done (9C):**
  - [ ] \`PERMISSION_CATALOG\` in config; every assignment validated server-side.
  - [ ] Super-admin permissions excluded from catalog (unreachable by custom roles).
  - [ ] \`requirePermission()\` middleware maps onto fixed-role + custom-role checks.
  - [ ] \`UserCustomRole\` has \`college_id\` for tenant isolation.
  - [ ] Privilege escalation blocked (can't grant what you don't have).
  - [ ] \`isAdminClass = true\` assignment goes through \`withQuota('admins')\`.
  - [ ] Downgrade: roles go dormant, users fall back to base role.
  - [ ] Error code is \`FEATURE_NOT_IN_PLAN\` (not \`UPGRADE_REQUIRED\`).

---

#### 9D: N11 Multi-Step Institutional Approval Workflows (Premium)

* **Institutional Job:** Configurable multi-tier authorization chains for fee concessions, refunds, staff leaves, and exam mark adjustments. Endpoints return 202 when a chain is configured; they act immediately when no chain exists.

* **Data Models:**
  \`\`\`prisma
  model ApprovalChain {
    id           String   @id @default(uuid())
    college_id   String
    workflowType String   // FEE_CONCESSION | FEE_REFUND | STAFF_LEAVE | MARKS_EDIT
    isActive     Boolean  @default(true)
    createdAt    DateTime @default(now())

    steps        ApprovalChainStep[]
    @@unique([college_id, workflowType])
    @@index([college_id, isActive])
  }

  model ApprovalChainStep {
    id          String @id @default(uuid())
    chainId     String
    stepNumber  Int    // 1, 2, 3...
    approverRole String? // 'principal' | 'admin' — fixed canonical role
    approverId   String? // specific userId (overrides role if set)

    chain       ApprovalChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
    @@unique([chainId, stepNumber])
  }

  model ApprovalRequest {
    id           String   @id @default(uuid())
    college_id   String
    workflowType String
    requesterId  String
    currentStep  Int      @default(1)
    totalSteps   Int
    status       String   @default("PENDING")
    // PENDING | APPROVED | REJECTED | CANCELLED
    payloadJson  Json     // The action to execute on final approval
    createdAt    DateTime @default(now())
    updatedAt    DateTime @updatedAt

    actions      ApprovalAction[]
    @@index([college_id, workflowType, status])
    @@index([college_id, requesterId])
  }

  model ApprovalAction {
    id          String   @id @default(uuid())
    requestId   String
    college_id  String
    stepNumber  Int
    approverId  String
    action      String   // APPROVED | REJECTED
    note        String?
    actedAt     DateTime @default(now())

    request     ApprovalRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
    @@index([requestId, stepNumber])
  }
  \`\`\`

* **Business Invariants:**
  1. **Approve with conditional update on currentStep:**
     \`\`\`javascript
     const updated = await tx.approvalRequest.updateMany({
       where: { id: requestId, currentStep: expectedStep, status: 'PENDING' },
       data: { currentStep: { increment: 1 } }
     });
     if (updated.count !== 1) throw new Error('APPROVAL_STEP_CONFLICT');
     \`\`\`
     This prevents race conditions when two approvers act simultaneously.
  2. **Requester cannot approve their own request:** \`if (action.approverId === request.requesterId) throw 403 'SELF_APPROVAL_NOT_ALLOWED'\`.
  3. **\`ApprovalAction\` rows instead of \`historyJson\` appends:** JSON array appends race under concurrent updates. Use the relational \`ApprovalAction\` table with individual rows.
  4. **Handler registry at final approval:** When \`currentStep > totalSteps\` (all steps approved), a \`workflowHandlers\` registry function is called. It re-validates the \`payloadJson\` before executing the action (e.g. re-check fee concession amount is still within policy, re-check leave balance). If re-validation fails → request stays PENDING with \`REVALIDATION_FAILED\` note.
  5. **Endpoint behavior:**
     - **Chain configured:** \`POST /api/fees/:id/concession\` → returns 202 with \`{ approvalRequestId }\` instead of acting.
     - **No chain configured:** Acts immediately (backward compatible with today's behavior).
  6. **STAFF_LEAVE** workflow type included. **STUDENT_LEAVE** type added when N24 ships in Phase 11.

* **Definition of Done (9D):**
  - [ ] \`ApprovalChain\`, \`ApprovalChainStep\`, \`ApprovalRequest\`, \`ApprovalAction\` in schema.
  - [ ] Conditional update on \`currentStep\` prevents race conditions.
  - [ ] Self-approval blocked.
  - [ ] \`ApprovalAction\` rows (not historyJson appends).
  - [ ] Handler registry re-validates payload before executing final action.
  - [ ] Endpoints return 202 when chain exists; act immediately when no chain.

---

#### 9E: N06 Developer Public API & Webhook Subsystem (Enterprise)

* **Institutional Job:** Read-only v1 REST API with HMAC-signed webhooks for institutional system integrations.

* **v1 Scope (read-only):** Students, Attendance, Fees, Classes, Sections. No write endpoints in v1.

* **Data Models:**
  \`\`\`prisma
  model ApiKey {
    id          String    @id @default(uuid())
    college_id  String
    name        String
    keyHash     String    @unique  // SHA-256 hash of raw key
    keyPrefix   String             // First 8 chars (displayed to user)
    permissions String[]           // Subset of read-only catalog
    lastUsedAt  DateTime?
    expiresAt   DateTime?
    isActive    Boolean   @default(true)
    createdAt   DateTime  @default(now())
  }

  model WebhookSubscription {
    id          String    @id @default(uuid())
    college_id  String
    targetUrl   String    // HTTPS only; private IPs blocked (SSRF protection)
    secretHash  String    // SHA-256 of signing secret (shown once to user, then hashed)
    events      String[]  // "student.admitted" | "fee.collected" | "attendance.absent"
    isActive    Boolean   @default(true)
    failureCount Int      @default(0)  // Auto-disabled after 5 consecutive failures
    createdAt   DateTime  @default(now())
  }

  model WebhookDelivery {
    id             String   @id @default(uuid())
    subscriptionId String
    college_id     String
    eventType      String
    payloadJson    Json
    responseStatus Int?
    responseBody   String?
    attemptCount   Int      @default(0)
    nextRetryAt    DateTime?
    status         String   @default("PENDING")
    // PENDING | DELIVERED | FAILED | ABANDONED
    createdAt      DateTime @default(now())
    deliveredAt    DateTime?

    @@index([subscriptionId, status, nextRetryAt])
  }
  \`\`\`

* **Security invariants:**
  1. **SSRF protection on webhook URL:** Validate \`targetUrl\` is HTTPS. Resolve the hostname and reject if the IP is in private ranges (10.x, 192.168.x, 172.16-31.x, 127.x, ::1). Use \`dns.resolve()\` + IP range check at registration time.
  2. **Webhook signing:** Each delivery signs with HMAC-SHA256 of \`timestamp + '.' + rawBody\`. Header: \`X-Academix-Signature: t=1234567890,v1=hex...\`. Receiver validates within 5-minute timestamp window.
  3. **API key stored as SHA-256 hash only.** Raw key shown once at creation, then irrecoverable.
  4. **Calendar-month rate limit (\`apiCalls\` = \`YYYY-MM\` key):** Atomic increment via \`quotaService\`. Hard 429 after \`limits.apiCallsMonthly\` (100,000 on Enterprise). Additionally: per-minute soft limit (200 req/min) using sliding window.
  5. **Reject suspended college keys:** Auth middleware checks \`College.subStatus !== 'SUSPENDED'\` for API key requests.
  6. **Auto-disable webhooks:** After 5 consecutive delivery failures (\`failureCount >= 5\`), set \`isActive = false\`. Notify admin via OutboxEvent.

* **Definition of Done (9E):**
  - [ ] API keys stored as SHA-256 hash; shown once at creation.
  - [ ] SSRF protection: HTTPS-only, private IP block at registration.
  - [ ] Webhook signed with HMAC-SHA256 timestamp + body.
  - [ ] \`WebhookDelivery\` table with retry + auto-disable after 5 failures.
  - [ ] \`apiCalls\` quota: YYYY-MM key, atomic increment, hard 429.
  - [ ] Per-minute rate limit (200 req/min).
  - [ ] Suspended college API keys rejected.

---

#### 9F: N05 Institutional Data Export & Backup Snapshot (Enterprise)

* **Institutional Job:** Self-service export of all college data as a structured archive for backup or platform exit.

> [!IMPORTANT]
> **Cannot \`pg_dump\` a shared multi-tenant database.** The database is shared across all colleges. Only tenant-scoped rows (\`WHERE college_id = X\`) can be exported. Format: JSON/CSV per entity type.

* **What is exported:**
  - All major entities with \`college_id = X\`: students, staff, fees, attendance, results, announcements, stored file manifests.
  - **Excluded:** password hashes, \`totpSecretEnc\`, API key hashes, Super Admin internal notes from \`CollegeEntitlementAudit\`.

* **Archive format:**
  - A manifest JSON listing all exported entity files.
  - Presigned R2 links for each \`StoredFile\` (not raw file bytes — files remain in R2).
  - Total ZIP limit: generate a \`manifest.json\` + per-entity CSV/JSON files. Final ZIP assembled server-side. If total exceeds 300 MB, split into volumes.
  - Stored in category \`BACKUPS\` (quota-exempt, TTL = 7 days).

* **Plan fix:**
  - Old spec said "Premium: 1 request/quarter." This is wrong — N05 is **Enterprise-only**.
  - Quota key: \`backupZipMonthly\` (1 per month on Enterprise, 0 on all others).

* **Definition of Done (9F):**
  - [ ] Tenant-scoped row export (not pg_dump).
  - [ ] Passwords, TOTP secrets, API key hashes excluded from export.
  - [ ] \`BACKUPS\` category exempt from storage quota; 7-day TTL.
  - [ ] Manifest JSON + presigned R2 links for files.
  - [ ] \`backupZipMonthly\` quota enforced; Enterprise-only.

---

#### 9G: N08 Offline-First Faculty & Student PWA (Standard — flag on #83 engine)

* **Institutional Job:** Offline timetable, attendance register, and student directory caching for uninterrupted campus operations.

> [!NOTE]
> N08 is a **tier flag on the #83 parent portal engine** (same Next.js PWA shell, different user role). Build after #83 is complete. Offline support is **read-only caches only**: timetable, roster. No offline writes (attendance marking offline) unless explicitly decided.

* **Cache invalidation:** Cached student data (photos, rosters) must be cleared from the service worker cache on user logout. Use \`Clear-Site-Data: "cache", "storage"\` header on logout response.

---

#### 9H: N03 Scheduled Executive Digest Email Worker (Premium)

* **Institutional Job:** Automated weekly digest of attendance, fee recovery, and enrollment metrics emailed to principals every Monday 08:00 AM PKT.

* **Dependencies:** Requires #87 (\`executiveKpiService.js\`) to be built first.

* **Config model (required — no config = no digest):**
  \`\`\`prisma
  model DigestConfig {
    id          String   @id @default(uuid())
    college_id  String   @unique
    isEnabled   Boolean  @default(false)
    recipients  String[] // Email addresses
    scheduleDay String   @default("MONDAY")
    scheduleHour Int     @default(8)
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt
  }
  \`\`\`

* **Content:** Aggregates only (percentages, totals, counts). No raw student or financial records in digest body.

* **Worker:** Uses \`JobRunLog(jobKey='weekly-digest', runKey=YYYY-WW)\` for idempotency + advisory lock.

---

#### 9I: N02 Board-Format Gazette & Registration Excel Exporter (Standard)

* **Institutional Job:** Excel export matching Pakistani BISE board registration formats (Registration Number, Name, Father Name, B-Form/CNIC, Subject Combo, Board Roll No).

* **Decisions required:** Sample export files are needed for each supported BISE board (Lahore, Gujranwala, Rawalpindi, etc.) to validate column alignment. These are business artifacts, not code artifacts.

* **Quota:** Counts against \`exportsCsvMonthly\` via N01 export engine. Each gazette export = 1 export credit.

---

#### 9J: N04 Accountant Double-Entry CSV Exporter (Premium)

* **Institutional Job:** Generates standard double-entry journal CSV for import into accounting software.

* **Corrections from original spec:**
  1. **Account-head mapping is configurable** (not hard-coded): colleges map their fee heads to account names via \`AccountHeadMapping(college_id, feeType, accountName)\`. This mapping **seeds N40's chart of accounts** in Phase 12.
  2. **One generic CSV format** (Date, Voucher No, Account Head, Debit PKR, Credit PKR, Description). Not QuickBooks/Tally/Sage-specific formats in Phase 9.
  3. **Debit = Credit validation:** Every generated journal must pass a balancing check before download. If \`SUM(debit) != SUM(credit)\` → reject with 500 \`JOURNAL_UNBALANCED\` and log to AuditLog.

---

#### Phase 9 Contract Tests (\`backend/tests/phase9_contract.test.js\`)

| Test | Covers |
|:---|:---|
| TOTP valid code accepted; replay of same code rejected | N07 |
| TOTP lockout after 5 failed attempts | N07 |
| Pre-auth token cannot be used as full JWT | N07 |
| Backup code single-use; second use rejected | N07 |
| Firebase Google login path enforces TOTP if enrolled | N07 |
| Export quota counted on creation; refunded on failure | N01 |
| exportMaxRows enforced (Starter: 1,000 rows max) | N01 |
| CSV formula injection cells prefixed with tab | N01 |
| Custom role with invalid permission key → 422 | N10 |
| Custom role cannot contain super-admin permissions | N10 |
| Starter/Standard → FEATURE_NOT_IN_PLAN on custom roles | N10 |
| Downgrade: custom roles go dormant | N10 |
| Approval step race: second concurrent approve → conflict error | N11 |
| Self-approval blocked | N11 |
| Handler registry re-validates payload at final step | N11 |
| Endpoint returns 202 when chain configured | N11 |
| Webhook URL with private IP rejected at registration | N06 |
| API key rate limit: 429 after 100,001st call | N06 |
| API key of suspended college rejected | N06 |
| Webhook auto-disabled after 5 delivery failures | N06 |
| Backup excludes password hashes and TOTP secrets | N05 |
| Backup quota: 0 on Starter, 1/month on Enterprise | N05 |
| Digest not sent if DigestConfig.isEnabled = false | N03 |
| Journal CSV debit != credit → rejected | N04 |
| Registry count: live count after Phase 9 | Registry |

`;

fs.appendFileSync(NEW, phase9, 'utf8');
console.log('Phase 9 appended. File size:', fs.statSync(NEW).size, 'bytes');

