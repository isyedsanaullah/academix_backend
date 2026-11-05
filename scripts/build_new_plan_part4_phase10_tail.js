'use strict';
const fs = require('fs');
const BASE = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/';
const OLD = BASE + 'academix_plan_and_services_split_implementation_plan.md';
const NEW = BASE + 'academix_implementation_plan_v2.md';

const body = `

---

### Phase 10: Infrastructure, Audit & Multi-Campus (8 Services — N13 permanently removed)

> [!IMPORTANT]
> **Build order: N15 → N17 → N16 → N20 → (campus decision applied) → N18 → N19.**
> **N12 (Custom Domain) and N14 (SSO) stay \`coming_soon\` in the registry.** No 501 stub endpoints, no dormant \`customDomain\` column. A nullable column is trivial to add later. Their catalog entries keep the "Coming soon" badge on \`/services\` and \`/request-subscription\` so Premium and Enterprise buyers are not misled.
> **N13 (White-label)** is removed from the registry, \`planConstants\`, \`/services\`, \`/request-subscription\` and the blueprint.

#### 10.0 Count Fix Required Before Any Phase 10 Code (N13 removal)

| Item | Before | After |
|:---|:---|:---|
| Enterprise cumulative services | 162 | **161** |
| Total registry | 162 | **161** |
| Roadmap after Phase 7 | 72 | **71** |
| Live after Phase 7 | 90 | 90 |
| Live after Phase 8 (9 services) | n/a | **99 live + 62 roadmap** |

Files to update: \`planConstants.js\`, \`featureRegistry.js\` (delete N13), \`phase1_contract.test.js\` count assertions, \`/request-subscription\` (Enterprise card "161 services"), \`/services\` (badges and totals), \`GET /public/services-catalog\`, this blueprint. N12 and N14 remain as \`coming_soon\`.

#### 10.1 Campus Model Decision (resolves N18/N19 contradiction)

**Audit result:** no \`Campus\` model and no \`campus_id\` column exist. \`quotaGate('campuses')\`, \`limits.maxCampuses\` and the \`CAMPUS\` add-on exist, but nothing counts campuses yet.

| Option | Description | Verdict |
|:---|:---|:---|
| A. Tenant-per-campus | Each campus is its own \`College\`, joined by \`CampusGroup\` | **Rejected.** Quotas and billing are per \`College\`, so pooling needs cross-tenant locking. Transfers need ID remapping across classes, sections, fee ledgers and files. |
| B. **Campus inside one tenant** | One \`College\`, many \`Campus\` rows, nullable \`campus_id\` on operational tables | **CHOSEN.** Matches the pricing promise "campuses under one admin" and pools quotas for free. |

**Decision: Option B.**
- \`CampusGroup\` and \`CampusGroupMember\` are dropped from the plan.
- Quotas pool automatically, because one \`College\` row means one \`CollegeUsage\`.
- \`quotaGate('campuses')\` becomes \`COUNT(Campus WHERE college_id = X AND isActive)\` against \`maxCampuses\`.
- Existing data gets a default "Main Campus" row. Backfill sets \`campus_id\` on Student, Section, Class and StaffProfile.

\`\`\`prisma
model Campus {
  id         String   @id @default(uuid())
  college_id String
  name       String
  code       String
  address    String?
  isDefault  Boolean  @default(false)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())

  @@unique([college_id, code])
  @@index([college_id, isActive])
}
// Additive nullable campus_id on: Student, Class, Section, User (staff).
\`\`\`
Creating a campus runs inside \`withQuota(collegeId, 'campuses', 1, cb)\` with the \`College\` row locked \`FOR UPDATE\`.

---

#### 10A: N15 IP Allow-Listing (Enterprise)

* **Proxy fix first:** set \`app.set('trust proxy', <hop count>)\` to match the Render and Cloudflare chain. Derive the client IP from \`req.ip\` only. Never read \`X-Forwarded-For\` directly, since it is spoofable.
* **Validation:** accept IPv4 and IPv6, single IP or CIDR, using a vetted library (\`ipaddr.js\` or \`net.BlockList\`). Reject malformed input with 422.
* **Lockout protection:** on save, evaluate the new rule set against the saver's current IP. If the saver would be locked out, refuse with 409 \`WOULD_LOCK_OUT_SAVER\`.
* **Log-only mode first:** \`CollegeSetting.ipAllowlistMode\` is \`OFF | LOG_ONLY | ENFORCE\`. New rule sets default to \`LOG_ONLY\` for 7 days and write \`IpAllowlistViolation\` rows.
* **Coverage:** admin, principal, registrar, accountant and any custom role with \`isAdminClass = true\`. Teachers and students are not restricted.
* **Super Admin escape hatch:** \`POST /super-admin/colleges/:id/actions\` with \`disable-ip-allowlist\`, step-up protected and audited.
* **"Session controls" in the registry description has no design.** Drop it from the description. N15 is IP allow-listing only.

\`\`\`prisma
model IpAllowlistRule {
  id         String   @id @default(uuid())
  college_id String
  label      String
  cidr       String
  isActive   Boolean  @default(true)
  createdBy  String
  createdAt  DateTime @default(now())
  @@index([college_id, isActive])
}
model IpAllowlistViolation {
  id         String   @id @default(uuid())
  college_id String
  userId     String?
  ip         String
  path       String
  mode       String   // LOG_ONLY | ENFORCE
  createdAt  DateTime @default(now())
  @@index([college_id, createdAt(sort: Desc)])
}
\`\`\`

**DoD:** proxy trust configured and tested; CIDR and IPv6 validated; saver-lockout refused; log-only default; all admin-class roles covered; SA audited disable; registry description trimmed.

---

#### 10B: N17 Audit Log Download (Premium)

* **Do not expose \`CollegeEntitlementAudit\` raw.** It holds internal notes (override reasons, concessions, Super Admin IPs).
* **Export sources:** the tenant \`AuditLog\` plus a sanitized subset of plan events (type, timestamp, plan names only; no notes, no IPs, no actor identity beyond "Platform").
* **Runs through N01's job engine** (\`exportType = 'AUDIT_LOG'\`), so it gets quota, TTL, formula-injection safety and audit logging for free.
* **Required date range** (max 366 days) and a **row cap** (\`exportMaxRows\`). Missing range returns 422.
* Role restriction: admin and principal only.

**DoD:** sanitizer unit test proves no override notes or IPs in output; date range required; cap enforced; reuses N01.

---

#### 10C: N16 Data Retention & Legal Hold (Enterprise)

* **No global DELETE hook.** Enforce through one shared \`assertNoLegalHold(collegeId, entityType, entityId)\` called from the real hard-delete paths only: recycle-bin purge, the 7A 30-day file purge worker, Super Admin purge, and college offboarding.
* **Cold-storage archival is cut** (not in the registry description).
* **Retention windows** are a small config model.

\`\`\`prisma
model LegalHold {
  id          String    @id @default(uuid())
  college_id  String
  title       String
  reason      String
  scopeType   String    // ALL_STUDENTS | SESSION | STUDENT
  targetId    String?
  placedBy    String
  isActive    Boolean   @default(true)
  releasedAt  DateTime?
  releasedBy  String?
  releaseReason String?
  createdAt   DateTime  @default(now())
  @@index([college_id, isActive])
}
model RetentionPolicy {
  id           String @id @default(uuid())
  college_id   String
  entityType   String // TRASHED_STUDENT | STORED_FILE | AUDIT_LOG
  retainDays   Int
  @@unique([college_id, entityType])
}
\`\`\`
* Release requires \`releasedBy\` and \`releaseReason\`; rows are never deleted.
* A blocked purge returns 403 \`LEGAL_HOLD_ACTIVE\`, and workers skip held items and log the skip.

**DoD:** helper wired into the four delete paths, with a test per path; release audit trail; no archival code.

---

#### 10D: N20 Message Credit Wallet View (Premium)

* **Reuse the Phase 5/6 credit-pack order flow.** Do **not** invent a new voucher type.
* Build only: ledger history (\`GET /api/subscription/credits/ledger\`, paged) and a usage view (PLAN vs PURCHASED balance, consumption by month and channel).
* Top-up button links into the existing \`CREDIT_ORDER\` flow.
* **Honesty rule:** while \`getActiveDriver()\` returns the in-app driver, the wallet shows a notice "SMS and WhatsApp delivery not yet active" and the top-up button is disabled, consistent with 8G.

**DoD:** read-only ledger endpoints, no new payment type, disabled top-up while driver is in-app.

---

#### 10E: N18 Multi-Campus Dashboard (Premium)

* Built on Option B. It is a reporting layer over \`campus_id\`.
* Calls \`executiveKpiService.getKpiSummary(collegeId, start, end, { campusId })\` once per campus. The 8J service takes an optional \`campusId\` filter.
* **"Campus budget allocation" is dropped.** It depends on N41 (Phase 12). It returns as part of N41.
* Gate: \`subscriptionGate('multi-campus-dashboard')\` plus campus count from \`quotaGate('campuses')\`.

**DoD:** per-campus KPI cards; unfiltered view equals the sum of campuses; cross-tenant campus ID returns 404.

---

#### 10F: N19 Cross-Campus Student Transfer (Enterprise)

* With Option B, the student stays in the same \`College\`. The transfer is a controlled update, not a data copy.
* **Minimal scope:** one transaction that
  1. locks the student row,
  2. checks seats in the destination section and group (advisory lock, as in 8A),
  3. updates \`Student.campus_id\`, \`class_id\` and \`section_id\`,
  4. writes a \`StudentCampusTransfer\` history row,
  5. leaves the fee ledger, files and attendance history untouched, because their \`college_id\` is unchanged.
* **Outstanding fee balance stays attached to the student.** There is no \`TRANSFERRED_IN\` duplication.
* Routed through N11 approvals when a chain exists.
* No quota change, because the student count is unchanged.

\`\`\`prisma
model StudentCampusTransfer {
  id             String   @id @default(uuid())
  college_id     String
  student_id     String
  fromCampusId   String
  toCampusId     String
  fromSectionId  String
  toSectionId    String
  reason         String?
  transferredBy  String
  createdAt      DateTime @default(now())
  @@index([college_id, student_id])
}
\`\`\`

**DoD:** atomic transfer; seats respected; history row; fee ledger unchanged (asserted in test); cross-tenant 404.

---

#### Phase 10 Contract Tests (\`phase10_contract.test.js\`)

| Test | Covers |
|:---|:---|
| Allowed on correct tier, \`FEATURE_NOT_IN_PLAN\` below | N15, N16, N17, N18, N19, N20 |
| Read-only and suspended behavior (exports and reads work, writes blocked) | all |
| Cross-tenant ID returns 404 | Campus, LegalHold, IpAllowlistRule, transfer |
| Spoofed \`X-Forwarded-For\` does not bypass allow-list | N15 |
| Rule set that locks out saver is refused | N15 |
| LOG_ONLY records a violation but does not block | N15 |
| Audit export contains no override notes or Super Admin IPs | N17 |
| Held student cannot be purged by any of the 4 paths | N16 |
| Release stores releasedBy and reason | N16 |
| Campus creation beyond \`maxCampuses\` is rejected | N18 |
| Transfer blocked when destination seats are full | N19 |
| Transfer leaves fee ledger rows unchanged | N19 |
| Registry count test with updated totals (161 total, N13 absent, N12 and N14 \`coming_soon\`) | Registry |

---

### Phase 11: Academic Management & Student Life (15 Services) — Split into Sub-Phases

| Sub-phase | Services | Notes |
|:---|:---|:---|
| **11A Exams** | N25 seating plan, N26 paper moderation, N27 re-check requests, N28 report-card remarks | Share exam session data. |
| **11B Leave & Clearance** | N24 student leave, N29 leaving certificate clearance | N24 is Standard but N11 is Premium: **build the basic teacher review first**, and N11 layers on top. Add \`STUDENT_LEAVE\` to N11 workflow types. N29 clearance heads are **configurable** (\`ClearanceHead\`), because N35 Library is Phase 12. |
| **11C Teaching** | N23 syllabus tracker, N30 live class links, N31 Q&A forum | |
| **11D Student life** | N32 discipline, N33 events and clubs, N34 alumni | N32 is confidential: role-restricted and excluded from the parent portal. |
| **11E Flags & language** | N09 Urdu/RTL, N21 notice templates, N22 parent push | **N09 is scoped to documents and the student and parent screens**, not every admin screen. N21 and N22 are flags on #25 and #83. |

Each sub-phase must carry the standard contract-test set from section 5.1.

### Phase 12: Auxiliary Operations (7 Services)

Order is unchanged (N35 to N41), with these constraints:
- **N04's \`AccountHeadMapping\` seeds N40's chart of accounts** (migration, not re-entry).
- **N36 Transport and N37 Hostel need fee-voucher integration** (new fee heads on the existing voucher engine), designed before building.
- N41 absorbs the "campus budget allocation" dropped from N18.
- Module add-ons (N35, N36, N37) use the existing \`MODULE_*\` add-on gate.

### Phase 13: AI & Intelligence (19 Services)

- **#99 to #102 are live and metered today. Measure real token costs now for OD-14.** Do not wait for Phase 13. Add a \`TokenCostSample\` log (feature, model, inputTokens, outputTokens, credits) and review it monthly.
- **Re-verify their \`startsIn\` tiers and limits** against the registry and \`planConstants\` before Phase 13 begins.
- Engine order is unchanged (RAG library, tutor chat, OCR, weak-topic, ask-your-data, timetable fixer).

---

## 5. Definition of Done (DoD) for Every Service (Phases 7–13)

A service moves from \`coming_soon\` to \`live\` only when all criteria are verified:
1. **Registry entry:** canonical key in \`featureRegistry.js\` with accurate \`dependsOn\`, \`startsIn\`, \`category\`, metadata.
2. **Route gating:** \`protect\`, \`tenantContext\` and \`subscriptionGate(key)\`, with keys that **exactly match the registry**. One error code: **\`FEATURE_NOT_IN_PLAN\`**. Workers call \`getEntitlements()\`.
3. **Quota hooks:** anything that creates students, staff or admin-class users goes through \`withQuota\`.
4. **Tests:** see 5.1.
5. **Catalog and UI badge:** status \`live\` and the \`/services\` directory reflects it.

### 5.1 Standard Contract-Test Set (every phase)
1. Tier access allowed, and blocked with \`FEATURE_NOT_IN_PLAN\` on the tier below.
2. Read-only and suspended behavior per service.
3. Cross-tenant ID returns 404.
4. Quota enforcement where applicable.
5. Worker idempotency (running twice sends once).
6. Registry count test with the updated totals.

### 5.2 Cross-Cutting Rules (apply to every service)
- **Audit first:** check existing models (Group, guardian fields, LeaveApplication, DailyAttendance, PaymentProof, Report Center) before adding tables.
- **View-only and suspended:** exports, reads and PDFs always work. Device punches and gateway callbacks are stored but processed later. Everything else is blocked when suspended.
- **Workers:** advisory lock, idempotency key, entitlement check, fanout via \`OutboxEvent\`. Shared \`JobRunLog(college_id, jobKey, runKey)\` replaces per-job dedupe tables.
- **Storage categories:** quota-exempt with TTL purge are \`EXPORTS\`, \`BACKUPS\`, \`REPORTS\`, \`RECEIPTS\`. Fee proofs and diary attachments **count** toward quota. Bulk-import source files are transient.
- **Every new model has \`college_id\`.** No hard-coded fees, thresholds or times; they live in college settings.

---

## 6. Open Decisions

### 6.1 Phase 6 and 6.2 Phase 7
*(Unchanged: OD-01 to OD-10 as recorded above in the sealed phases. OD-04's \`isCanteenCashier\` is replaced by a permission once N10 ships.)*

### 6.3 Phases 8–13

| # | Decision | Status | Resolution or recommendation |
|:-|:---|:---|:---|
| OD-11 | Parent login (#83) | **RESOLVED** | Roll number + guardian PIN issued at admission (bcrypt, 5-attempt lockout, admin reset with audit). No simulated OTP. Parents do not count toward any quota. |
| OD-12 | Online payment gateway (#82) | **DEFERRED** | #82 stays \`coming_soon\`. Adapter interface only. |
| OD-13 | N06 rate-limit window | **RESOLVED** | Calendar month (\`YYYY-MM\`), atomic increment, hard 429. |
| OD-14 | AI credit ratio | **ACTIVE NOW** | Measure #99 to #102 token costs now, not in Phase 13. |
| OD-15 | Campus model | **RESOLVED** | Campus inside one tenant (Option B, section 10.1). |
| OD-16 | N07 optional vs enforced for admin-class users | **Recommend optional by default**, with \`CollegeSetting.require2FAForAdmins\`. | |
| OD-17 | N08 offline scope | **Recommend read-only caches** (timetable, roster). | |
| OD-18 | N02 sample files per BISE board | **OPEN (business input)** | Needed before N02 build. |
| OD-19 | N06 v1 scope | **Recommend read-only:** students, attendance, fees, classes. | |
| OD-20 | Bulk-import chunk failure policy | **Recommend** commit valid rows, give an error CSV, undo via \`importJobId\` and the recycle bin. | |

---

## 7. Audit Findings — Reality vs. Prior Assumptions

*(All Phase 1–7 findings from the previous version remain valid.)* New findings from this revision:

| Finding | Prior assumption | Reality | Impact |
|:---|:---|:---|:---|
| Group model | New \`AcademicGroup\` needed | \`Group(college_id, class_id, name, seats, feeNote)\` exists | 8A adds \`GroupSeatAllocation\` and \`GroupFeeSchedule\` only |
| Payment proofs | New \`FeePaymentProof\` | \`PaymentProof\` (#75) exists with \`file_id\` | #82 reuses it; no new table |
| Leave data | Copy leave into attendance | \`LeaveApplication\` (student) exists | ON_LEAVE is derived, never copied |
| Guardian data | Needs new identity | \`guardianName/Phone/Relation/Cnic\` already on Student | \`GuardianSession\` stores only the PIN hash and lockout state |
| Campus model | \`CampusGroup\` across tenants | No \`Campus\` or \`campus_id\` anywhere | Option B (10.1) |
| \`UPGRADE_REQUIRED\` | Used by N10 | Registry and gates use \`FEATURE_NOT_IN_PLAN\` | One error code everywhere |
| N13 | In registry | Removed by product decision | Counts become 161 total |
| #84/#85 credits | Debit credits in in-app mode | Would charge for nothing | In-app driver costs 0; packs rejected |
| N05 | \`pg_dump\` | Shared multi-tenant DB | Tenant-scoped row export |
| \`CollegeEntitlementAudit\` | Safe to export | Holds internal notes and SA IPs | N17 exports sanitized subset only |
`;

fs.appendFileSync(NEW, body, 'utf8');
console.log('Phase 10-13 and tail appended. Size:', fs.statSync(NEW).size);

