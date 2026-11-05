---

#### 9D: N11 Multi-Step Approvals (Premium)

* **Institutional Job:** configurable approval chains for fee concessions (#60), refunds (#61), staff leave (#63), marks edits; later student leave (N24) and campus transfer (N19).
* **Models (chain configuration plus a per-request snapshot):**
```prisma
model ApprovalChain {
  id           String   @id @default(uuid())
  college_id   String
  workflowType String   // FEE_CONCESSION | FEE_REFUND | STAFF_LEAVE | MARKS_EDIT | PURCHASE_ORDER (+ STUDENT_LEAVE, CAMPUS_TRANSFER later)
  isActive     Boolean  @default(true)
  steps        ApprovalChainStep[]
  @@unique([college_id, workflowType])
}
model ApprovalChainStep {
  id           String @id @default(uuid())
  chainId      String
  stepNumber   Int
  approverType String // ROLE | USER | CUSTOM_ROLE
  approverRef  String // role name, userId or customRoleId
  chain ApprovalChain @relation(fields: [chainId], references: [id], onDelete: Cascade)
  @@unique([chainId, stepNumber])
}
model ApprovalRequest {
  id           String   @id @default(uuid())
  college_id   String
  campus_id    String?  // Pre-wired for Phase 10 multi-campus isolation
  workflowType String
  requesterId  String
  currentStep  Int      @default(1)
  totalSteps   Int
  status       String   // PENDING | APPROVED | REJECTED | CANCELLED
  payloadJson  Json
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  steps        ApprovalRequestStep[]
  actions      ApprovalAction[]
  @@index([college_id, workflowType, status])
  @@index([college_id, requesterId])
}
model ApprovalRequestStep {          // snapshot copied from the chain at creation
  id           String @id @default(uuid())
  requestId    String
  college_id   String
  campus_id    String?
  stepNumber   Int
  approverType String
  approverRef  String
  request ApprovalRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  @@unique([requestId, stepNumber])
}
model ApprovalAction {
  id         String   @id @default(uuid())
  requestId  String
  college_id String
  campus_id  String?
  stepNumber Int
  actorId    String
  action     String   // APPROVED | REJECTED | CANCELLED
  note       String?
  actedAt    DateTime @default(now())
  request ApprovalRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  @@unique([requestId, stepNumber, action])
}
```
* **Snapshot:** approvers are copied into `ApprovalRequestStep` at creation, so editing a chain never changes an in-flight request.
* **Decision algorithm (one transaction):**
  1. Load the request `FOR UPDATE`; require `status = PENDING`.
  2. **Actor check first:** the actor must match the snapshot approver for `currentStep` (role match, user match, or holder of the active custom role) **and** must not be the requester (`SELF_APPROVAL_NOT_ALLOWED`).
  3. Conditional advance: `updateMany WHERE id, status='PENDING', currentStep = expected` → `count` must be 1, else 409 `APPROVAL_STEP_CONFLICT`.
  4. Insert the `ApprovalAction` row.
  5. If this was the **last** step: call the type's handler **inside the same transaction** (revalidate the payload, then execute). If the handler throws, the **whole transaction rolls back**: no action row is stored and the request stays on its step; the response is 422 `REVALIDATION_FAILED` and the requester is notified. (The earlier design incremented the step first and could leave the request inconsistent.)
* **Reject and cancel:** any current-step approver may reject with a note → terminal `REJECTED`. The requester may cancel while `PENDING` → `CANCELLED`. Both write an `ApprovalAction`.
* **Handler registry:** `workflowHandlers[type] = { validate(payload), execute(tx, payload) }`; handlers are idempotent.
* **Approvers may be custom roles** (`CUSTOM_ROLE`) once N10 is live; before that only `ROLE` and `USER` are offered.
* **Notifications:** `OutboxEvent('APPROVAL_PENDING')` to the next approver(s) on creation and on each advance; `APPROVAL_DECIDED` to the requester on any terminal state.
* **Endpoint behaviour:** when an active chain exists for the type, the originating endpoints (#60, #61, #63, marks edit) **create a request and return 202 `{ approvalRequestId }` instead of acting**; with no chain they behave exactly as today. `STUDENT_LEAVE` is added when N24 ships; `CAMPUS_TRANSFER` with N19.
* **Definition of Done:**
  - [ ] Chain, request-step snapshot and action tables; chain edits do not affect open requests.
  - [ ] Actor-is-approver and not-requester checks run first.
  - [ ] Conditional step advance; concurrent approvals conflict cleanly.
  - [ ] Revalidate and execute share the transaction; failure leaves state unchanged.
  - [ ] Reject, cancel and notifications implemented.
  - [ ] Originating endpoints return 202 only when a chain exists.

---

#### 9E: N06 Public API & Webhooks (Enterprise)

* **v1 scope: read-only** — students, attendance, fees, classes, sections.
* **API keys:** raw key shown **once**; stored as SHA-256 hash with an 8-char lookup prefix; compared in constant time. Created by `admin` only. API-key auth is a separate middleware that derives the tenant from the key. Keys of **suspended** colleges are rejected; read-only colleges can still read.
* **Webhook secrets need the plaintext to sign,** so a hash is useless. Secrets are stored **AES-256-GCM encrypted** (`WEBHOOK_SECRET_ENC_KEY`, separate from the TOTP key), revealed once at creation or rotation (`POST …/rotate-secret`).
```prisma
model ApiKey {
  id          String    @id @default(uuid())
  college_id  String
  campus_id   String?   // Pre-wired for Phase 10 multi-campus isolation
  name        String
  keyPrefix   String
  keyHash     String    @unique
  scopes      String[]
  lastUsedAt  DateTime?
  expiresAt   DateTime?
  isActive    Boolean   @default(true)
  createdBy   String
  createdAt   DateTime  @default(now())
  @@index([college_id, isActive])
}
model WebhookSubscription {
  id                   String   @id @default(uuid())
  college_id           String
  campus_id            String?  // Pre-wired for Phase 10 multi-campus isolation
  targetUrl            String
  secretEnc            String
  events               String[]
  isActive             Boolean  @default(true)
  consecutiveAbandoned Int      @default(0)
  disabledReason       String?
  createdAt            DateTime @default(now())
}
model WebhookDelivery {
  id             String    @id @default(uuid())
  college_id     String
  campus_id      String?
  subscriptionId String
  eventType      String
  payloadJson    Json
  attempt        Int       @default(0)
  status         String    // PENDING | DELIVERED | ABANDONED
  nextAttemptAt  DateTime
  lastStatusCode Int?
  lastError      String?
  createdAt      DateTime  @default(now())
  deliveredAt    DateTime?
  @@index([status, nextAttemptAt])
  @@index([college_id, subscriptionId])
}
model ApiUsageWindow {
  college_id String
  apiKeyId   String
  windowKey  String   // 'M:2026-11' or 'm:2026-11-05T10:15'
  count      Int      @default(0)
  @@id([college_id, apiKeyId, windowKey])
}
```
* **SSRF defence (registration is not enough: DNS rebinding):**
  * At registration: HTTPS only, port 443, hostname resolved and rejected if any A/AAAA is private, loopback, link-local or metadata (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, fe80::/10).
  * **At every delivery:** resolve DNS again, re-run the same checks, **connect to the pinned IP** (custom `lookup`, keeping the original `Host`/SNI), **disable redirects**, 10 s timeout, response body capped at 64 KB.
* **Signing:** `X-Academix-Signature: t=<unix>,v1=<HMAC-SHA256(secret, t + '.' + rawBody)>`; the docs tell receivers to reject timestamps older than 5 minutes.
* **Delivery worker:** claims due rows (`status='PENDING' AND nextAttemptAt <= now()` `FOR UPDATE SKIP LOCKED`). Retry schedule 1 min, 5 min, 30 min, 2 h, 12 h; after the fifth failure the delivery is `ABANDONED`. **`consecutiveAbandoned` counts abandoned deliveries, not individual retries**; a success resets it; at 5 the subscription is disabled and the admin is notified via the outbox. Domain events enqueue deliveries through a single `emitDomainEvent(collegeId, type, payload)` helper, in the same transaction as the change where possible.
* **Limits (DB-atomic, multi-instance safe):** the monthly `apiCallsMonthly` cap (calendar month, OD-13) and a per-minute limit (`api.rateLimitPerMinute` setting) both use `ApiUsageWindow` atomic upserts. Over the limit → **hard 429** with `Retry-After`. Failed authentication is not metered but is IP-throttled.
* **Definition of Done:**
  - [ ] Keys hashed; secrets AES-GCM encrypted and shown once; rotation works.
  - [ ] SSRF checks at registration **and** per delivery with pinned IP, no redirects, size cap.
  - [ ] Delivery worker with backoff; abandoned-delivery counting and auto-disable defined and tested.
  - [ ] Monthly and per-minute limits via atomic windows; 429 tested across two simulated instances.
  - [ ] Suspended college keys rejected; v1 endpoints strictly read-only.

---

#### 9F: N05 Institutional Data Export / Backup (Enterprise)

* **Institutional Job:** self-service export of all of a college's data.
* **A shared multi-tenant database cannot be `pg_dump`-ed.** The export is **tenant-scoped rows** (`WHERE college_id = X`) as per-entity NDJSON/CSV plus a file manifest.
* **Excluded always:** password hashes, TOTP secrets and backup codes, API-key hashes, webhook secrets, guardian PIN hashes and tokens, `CollegeEntitlementAudit` internals.
* **Job model and streaming:**
```prisma
model BackupJob {
  id           String    @id @default(uuid())
  college_id   String
  campus_id    String?   // Pre-wired for Phase 10 multi-campus isolation
  requestedBy  String
  status       String    // QUEUED | RUNNING | READY | FAILED | EXPIRED
  archiveKey   String?   // category BACKUPS (server-exempt)
  manifestKey  String?
  sizeBytes    BigInt    @default(0)
  claimedBy    String?
  heartbeatAt  DateTime?
  expiresAt    DateTime
  failureReason String?
  createdAt    DateTime  @default(now())
  @@index([college_id, createdAt(sort: Desc)])
  @@index([status, heartbeatAt])
}
```
  The archive is **streamed** (entity cursors → ZIP stream → R2 multipart upload); nothing is buffered in Render's memory. Claim, heartbeat and reaper follow the export pattern.
* **Self-containedness (the 7-day-link problem):** a manifest of expiring links is not an exit-ready archive. Decision: the archive contains the full data export plus a file manifest; file links are **re-issuable** (`POST /api/backups/:id/refresh-links`) for as long as the account is active; the offboarding procedure (Super Admin) retains the tenant file prefix for a configured window and issues fresh links on request. A physically self-contained archive including files is available only up to a size ceiling (OD-23); beyond it, files are delivered via links.
* **Password protection (restored):** the requester supplies a passphrase at request time; the ZIP is AES-256 encrypted using `archiver-zip-encryptable` (Node.js AES-256 ZIP streaming engine). The passphrase is never stored; a lost passphrase means re-running the export.
* **Quota and pricing correction:** `backupZipMonthly` = 1 on Enterprise, 0 elsewhere. **§1 and the pricing page currently say "Premium: 1 request/quarter"; that is wrong.** Starter/Standard/Premium: "Super Admin export on offboarding only"; Enterprise: "1 self-service export per month". Update §1, `/request-subscription` and `/services`.
* **Definition of Done:**
  - [ ] Tenant-scoped export; exclusion list tested.
  - [ ] `BackupJob` claim/heartbeat/reaper; streaming proven on a large dataset.
  - [ ] Re-issuable file links and an offboarding procedure documented.
  - [ ] Passphrase-encrypted ZIP; passphrase not persisted.
  - [ ] Pricing copy and §1 corrected; Enterprise-only gate.

---

#### 9G: N08 Faculty & Student Offline PWA (Standard)

* **Institutional Job:** keep timetable and rosters usable during connectivity loss.
* **Scope:** a tier flag on the #83 PWA engine, built **after #83**, but with its **own service-worker scope `/staff-app/` and manifest** so it never shares caches with `/parent/`.
* **Read-only offline caches only:** the teacher's timetable and the rosters of their **assigned sections** (no photos). **No offline writes** (attendance marking offline would need sync and conflict handling and is explicitly out of scope).
* **Data protection:** cached student data has a maximum age (`pwa.cacheMaxAgeHours` setting) and is cleared on logout (`Clear-Site-Data` plus a service-worker purge message).
* **Definition of Done:**
  - [ ] Gated by N08's registry key; `/staff-app/` scope distinct from `/parent/`.
  - [ ] Only timetable and assigned-section rosters cached; no writes queued offline.
  - [ ] Cache expiry and logout purge tested.
  - [ ] Cross-tenant and cross-section data never present in the cache.

---

#### 9H: N03 Scheduled Executive Digest (Premium)

* **Depends on #87** (`executiveKpiService`).
```prisma
model DigestConfig {
  id          String   @id @default(uuid())
  college_id  String   @unique
  campus_id   String?  // Pre-wired for Phase 10 multi-campus isolation
  isEnabled   Boolean  @default(false)
  recipients  String[] // admin-entered emails, validated, capped
  weekday     Int      // 1-7
  sendHour    Int      // 0-23, PKT
  updatedAt   DateTime @updatedAt
}
```
* **Schedule:** "time passed and not yet sent", not exact-minute matching. The worker ticks hourly; a college is due when the current PKT week's configured weekday/hour has passed **and** `JobRunLog(jobKey='weekly-digest', runKey=ISO week)` has no `DONE` row. The claim makes a double tick send once; a down worker catches up.
* **Content:** aggregates only (rates, counts, coverage); never student- or voucher-level rows. Sent through the outbox email path. Disabled or unconfigured colleges are skipped; suspended colleges are skipped.
* **Definition of Done:**
  - [ ] `DigestConfig` CRUD with validated recipients and a cap.
  - [ ] Catch-up scheduling and `JobRunLog` idempotency tested (including a missed hour).
  - [ ] Aggregates-only content asserted.
  - [ ] Gated by N03's registry key; skips disabled and suspended colleges.

---

#### 9I: N02 Board-Format Gazette Excel Export (Standard)

* Runs through N01 (`exportType = 'GAZETTE'`, N02's registry key), so it **consumes `exportsCsvMonthly` quota**.
* **Data-driven board profiles:** `BoardExportProfile(boardCode, columnsJson, version)` defines column order and headers per BISE board, so adding a board needs data, not code.
* **Blocked by OD-18:** a real sample file per supported board is required to write the acceptance test. If samples are late, N02 slips and the counts become 108 live + 53 roadmap.
* **Definition of Done:**
  - [ ] Profile table plus at least one board validated against a real sample.
  - [ ] Counts against N01 quota; row cap respected.
  - [ ] Registry key from N02; formula-injection-safe XLSX.

---

#### 9J: N04 Accountant Journal CSV (Premium)

* Runs through N01 (`exportType = 'LEDGER'`, N04's registry key).
* **Account-head mapping (schema, since there is no chart of accounts until N40):**
```prisma
model AccountHeadMapping {
  id          String @id @default(uuid())
  college_id  String
  campus_id   String? // Pre-wired for Phase 10 multi-campus isolation
  sourceType  String  // FEE_TYPE | PAYMENT_METHOD | FINE | REFUND
  sourceKey   String
  accountName String
  accountCode String?
  @@unique([college_id, sourceType, sourceKey])
}
```
  This table **seeds N40's chart of accounts** in Phase 12.
* **Journal rules (v1 is cash-basis):** for each verified payment in the range: **Dr** the account mapped to its `PAYMENT_METHOD` (cash/bank), **Cr** the account mapped to its `FEE_TYPE`. A refund writes the reverse. Fines collected credit the `FINE` account. Discounts are not journaled in cash-basis v1.
* **Pre-flight instead of a balance check** (a debit = credit check is true by construction): before generating, every fee type and payment method appearing in the range must be mapped. Otherwise return 422 `UNMAPPED_HEADS` with the list. (A balance assertion stays as a unit test only.)
* **One generic CSV** (Date, Voucher No, Account, Debit PKR, Credit PKR, Narration). No QuickBooks/Tally/Sage variants in this phase.
* **Definition of Done:**
  - [ ] `AccountHeadMapping` CRUD and N40 seeding path documented.
  - [ ] Unmapped heads block generation and list the gaps.
  - [ ] Unit test: debits equal credits for a mixed payments-and-refunds fixture.
  - [ ] Counts against N01 quota; N04's registry key.

---

#### Phase 9 Contract Tests (`phase9_contract.test.js`)

| Test | Covers |
|:---|:---|
| Allowed on correct tier, `FEATURE_NOT_IN_PLAN` below; registry-key lint passes | all |
| Read-only: exports, whitelisted writes work; suspended: all blocked | N01, N05 |
| Cross-tenant ID returns 404 | every new model |
| TOTP replay, ±1 window, lockout, pre-auth `jti` single-use, Firebase path forced to TOTP | N07 |
| Device cookie present → no alert; absent → one alert | N07 |
| Unenrolled admin after grace gets enrol-only session; `reset-2fa` audited | N07 |
| Export quota counted on creation, refunded once on failure; v1-pinned college resolves new keys | N01 |
| Row-cap overflow → 422, never truncated; CSV/XLSX injection cells neutralised | N01 |
| Role must hold permission to grant it; super-admin permission rejected; composite-FK blocks cross-tenant assignment | N10 |
| Role creation free; assignment and `isAdminClass` toggle enforce admin quota | N10 |
| Downgrade deactivates custom roles without a stored flag | N10 |
| Non-approver rejected; requester rejected; concurrent approve conflicts; handler failure rolls back | N11 |
| Chain edit does not alter open request; reject and cancel flows | N11 |
| Private-IP webhook rejected at registration **and** at delivery (rebinding test); redirects refused | N06 |
| 429 at the monthly and per-minute caps across two instances; suspended key rejected | N06 |
| Abandoned-delivery counting and auto-disable | N06 |
| Backup excludes secrets; passphrase ZIP; Enterprise-only quota | N05 |
| Offline cache holds only assigned sections and clears on logout | N08 |
| Digest catch-up after a missed hour sends once; disabled config skipped | N03 |
| Unmapped head → 422 with list; journal balances | N04 |
| Registry: **108 live + 53 roadmap** (107/54 if N02 deferred) | registry |

