const fs = require('fs');
const path = require('path');

const artifactPath = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_plan_and_services_split_implementation_plan.md';
let content = fs.readFileSync(artifactPath, 'utf8');

// 1. Update Executive Summary (lines 13-17)
content = content.replace(
  /- ⏳ \*\*Phase 6 \[IN PROGRESS — Build Next\]:\*\*[\s\S]*?- ⏳ \*\*Phase 7 \[QUEUED — after Phase 6 complete\]:\*\*[\s\S]*?signed TTL URLs\./,
  `- ✅ **Phase 6 [COMPLETED]:** *(Built order: 6A → 6C → 6B — 16/16 contract tests passing)*
  * **6A — Settlement Engine & Billing Queue:** \`CollegeSubscriptionPayment\` migration delta, \`PlanVersion\`/\`ReceiptCounter\`/\`OutboxEvent\`/\`UsedStepUpToken\` schemas, \`settlementService.js\` with pessimistic row-lock & cap re-validation, \`outboxWorker.js\` draining with \`SKIP LOCKED\`, \`POST /auth/step-up\`, \`/super-admin/billing\` queue UI, 16 contract tests (\`phase6_contract.test.js\`).
  * **6C — Plan Versioning & Lifecycle Worker:** \`PUT /api/super-admin/plans/:planId\` inserts new \`PlanVersion\` row, \`College.planVersionId\` pinning, \`subscriptionLifecycleWorker.js\` (advisory lock, \`SubscriptionReminderLog\`, 30/14/7/1-day reminders, 90-day grandfather alert on first run), grace-period read-only transition, Health Dashboard \`GET /api/super-admin/health\`.
  * **6B — Governance Deck:** \`CollegeQuotaOverride\` CRUD, feature-override matrix (\`FORCE_ON\` blocked for \`coming_soon\`), lifecycle actions (\`suspend\`/\`reactivate\`/\`clear-readonly\`/\`extend-trial\`), manual credit adjustment (reason required), step-up token validation, \`/super-admin/colleges/[id]/entitlements\` UI.
- ✅ **Phase 7 [COMPLETED]:** *(Built order: 7A → 7B → 7C → 7D — 19/19 contract tests passing, 90 Live Services)*
  * **7A — #26 File Vault:** \`UploadReservation\` model, quota lock (usage + pending + declared), HEAD-verify finalize, R2 legacy backfill (excludes \`receipts/\`), signed TTL URLs.
  * **7B — #25 Circulars:** Status casing normalized to uppercase, query-time visibility (\`SCHEDULED\` with \`scheduledFor <= now\` visible immediately), atomic dispatcher with \`FOR UPDATE SKIP LOCKED\`, \`CircularReadReceipt\` model, IDOR tenant check on \`GET /announcements/:id\`.
  * **7C — #78 Timetable:** Multi-profile coexistence (at most one active per \`[college_id, type]\`), period FK cascade, denormalized section clash unique index \`section_clash_unq\`, hard blocks (teacher, room, section), leave conflict warning, atomic swap via delete+insert, exempt PDF export.
  * **7D — #98 Canteen POS:** \`CashierShift\` with single open shift partial unique index, zero-drift dynamic shift close formula, POS idempotency via \`clientOrderId\`, conditional stock decrement with race-condition rollback (409), PKT calendar day daily spending limit, cash-only topup, void order refund routing and inventory restoration, \`balance >= 0\` check.
- ⏳ **Phase 8 [QUEUED — Build Next]:** *(12 College Operational Roadmap Services: Bulk Import, Student Diary, Group Fees, Biometric Sync, Staff Attendance, Shortage Alerts, Fee Gateway, Parent PWA, SMS/WhatsApp Pluggable Adapters, Absence Alerts, Executive KPI Deck)*.`
);

// 2. Update Mermaid Diagram (lines 160-188)
content = content.replace(
  'subgraph P6["⏳ Phase 6: Super Admin Settlement Engine & Governance"]',
  'subgraph P6["✅ Phase 6: Super Admin Settlement Engine & Governance [COMPLETED]"]'
);
content = content.replace(
  'subgraph P7["⏳ Phase 7: Complete In-Progress Core Services (86 Live -> 90 Live)"]',
  'subgraph P7["✅ Phase 7: Complete In-Progress Core Services (90 Live) [COMPLETED]"]'
);
content = content.replace(
  'P8["⏳ Phase 8: College Operational Services (Bulk Import, Biometrics, Attendance, Fees)"]',
  'P8["⏳ Phase 8: College Operational Services [QUEUED — Build Next]"]'
);

// 3. Update Phase 6 Section Header (line 267)
content = content.replace(
  '### Phase 6: Super Admin Settlement Engine, Governance Deck & Platform Control Center (`/super-admin/billing`)',
  `### Phase 6 [COMPLETED]: Super Admin Settlement Engine, Governance Deck & Platform Control Center (\`/super-admin/billing\`)
> [!NOTE]
> **STATUS: 100% COMPLETE & VERIFIED.** All sub-phases (6A, 6C, 6B) are fully built and active in the database. All 16 automated contract tests in \`backend/tests/phase6_contract.test.js\` pass with 0 failures.`
);

// 4. Update Phase 7 Section Header (around line 813)
content = content.replace(
  '### Phase 7: Complete In-Progress Core Services (90 Live — 100% COMPLETE & VERIFIED)',
  '### Phase 7 [COMPLETED]: Complete In-Progress Core Services (90 Live — 100% Complete & Verified)'
);

// 5. Check all remaining checkboxes in Phase 6 and Phase 7
// Phase 6A checkboxes
content = content.replace(/- \[ \] All Phase 6 schema migration delta fields added/g, '- [x] All Phase 6 schema migration delta fields added');
content = content.replace(/- \[ \] Duplicate `transactionId` detection at submit/g, '- [x] Duplicate `transactionId` detection at submit');
content = content.replace(/- \[ \] Partial unique index applied as raw SQL migration/g, '- [x] Partial unique index applied as raw SQL migration');
content = content.replace(/- \[ \] Unified order types processed in strict/g, '- [x] Unified order types processed in strict');
content = content.replace(/- \[ \] Pessimistic `FOR UPDATE` lock \+ `updateMany` count-check/g, '- [x] Pessimistic `FOR UPDATE` lock + `updateMany` count-check');
content = content.replace(/- \[ \] Upgrade\/addon-order cap validation is hard-block/g, '- [x] Upgrade/addon-order cap validation is hard-block');
content = content.replace(/- \[ \] Early renewal stacks `periodEnd`/g, '- [x] Early renewal stacks `periodEnd`');
content = content.replace(/- \[ \] Conditional read-only clearing:/g, '- [x] Conditional read-only clearing:');
content = content.replace(/- \[ \] `SUSPENDED` status never cleared by payment approval/g, '- [x] `SUSPENDED` status never cleared by payment approval');
content = content.replace(/- \[ \] `ReceiptCounter` row-locked upsert generates/g, '- [x] `ReceiptCounter` row-locked upsert generates');
content = content.replace(/- \[ \] `OutboxEvent` written in-tx; worker drains/g, '- [x] `OutboxEvent` written in-tx; worker drains');
content = content.replace(/- \[ \] `College.tokenEpoch` replaces Redis for session/g, '- [x] `College.tokenEpoch` replaces Redis for session');

// Phase 6B checkboxes
content = content.replace(/- \[ \] `CollegeQuotaOverride` replaces BASE limit only/g, '- [x] `CollegeQuotaOverride` replaces BASE limit only');
content = content.replace(/- \[ \] Override covers all 16 metric keys/g, '- [x] Override covers all 16 metric keys');
content = content.replace(/- \[ \] Feature matrix rejects `FORCE_ON` for `coming_soon`/g, '- [x] Feature matrix rejects `FORCE_ON` for `coming_soon`');
content = content.replace(/- \[ \] Suspend increments `tokenEpoch`/g, '- [x] Suspend increments `tokenEpoch`');
content = content.replace(/- \[ \] Trial extension restricted to \+7 or \+14 days/g, '- [x] Trial extension restricted to +7 or +14 days');
content = content.replace(/- \[ \] `POST \/api\/auth\/step-up` issues 5-minute action-class-bound/g, '- [x] `POST /api/auth/step-up` issues 5-minute action-class-bound');
content = content.replace(/- \[ \] `CollegeEntitlementAudit` migration applied/g, '- [x] `CollegeEntitlementAudit` migration applied');

// Phase 6C checkboxes
content = content.replace(/- \[ \] `PlanVersion` table, `College.planVersionId` FK/g, '- [x] `PlanVersion` table, `College.planVersionId` FK');
content = content.replace(/- \[ \] Resolver and `calculateTotal` read from pinned/g, '- [x] Resolver and `calculateTotal` read from pinned');
content = content.replace(/- \[ \] AddonCatalog editor updates pricing/g, '- [x] AddonCatalog editor updates pricing');
content = content.replace(/- \[ \] Lifecycle worker uses advisory lock/g, '- [x] Lifecycle worker uses advisory lock');
content = content.replace(/- \[ \] All \*\*16 Phase 6 contract tests\*\* passing/g, '- [x] All **16 Phase 6 contract tests** passing');
content = content.replace(/- \[ \] Rollout checklist documented and validated/g, '- [x] Rollout checklist documented and validated');

// Phase 7 checkboxes (any remaining in sub-sections 7A, 7B, 7C, 7D)
content = content.replace(/- \[ \] Quota reservation check includes `usage \+ sum\(unexpired PENDING\) \+ declared`/g, '- [x] Quota reservation check includes `usage + sum(unexpired PENDING) + declared`');
content = content.replace(/- \[ \] `UploadReservation` with 15-minute TTL/g, '- [x] `UploadReservation` with 15-minute TTL');
content = content.replace(/- \[ \] Finalize endpoint performs R2 HEAD verification/g, '- [x] Finalize endpoint performs R2 HEAD verification');
content = content.replace(/- \[ \] Abandoned uploads cleaned up by background worker/g, '- [x] Abandoned uploads cleaned up by background worker');
content = content.replace(/- \[ \] Soft-deleted files count toward quota/g, '- [x] Soft-deleted files count toward quota');
content = content.replace(/- \[ \] Legacy upload reconciliation audit runs nightly/g, '- [x] Legacy upload reconciliation audit runs nightly');
content = content.replace(/- \[ \] Platform receipt PDFs excluded from storage count/g, '- [x] Platform receipt PDFs excluded from storage count');

content = content.replace(/- \[ \] Status casing normalized to UPPERCASE/g, '- [x] Status casing normalized to UPPERCASE');
content = content.replace(/- \[ \] Query-time visibility returns SCHEDULED circulars/g, '- [x] Query-time visibility returns SCHEDULED circulars');
content = content.replace(/- \[ \] Atomic claim dispatcher claims circulars/g, '- [x] Atomic claim dispatcher claims circulars');
content = content.replace(/- \[ \] Outbox event generated for in-app delivery/g, '- [x] Outbox event generated for in-app delivery');
content = content.replace(/- \[ \] Circular read receipts recorded and counted/g, '- [x] Circular read receipts recorded and counted');
content = content.replace(/- \[ \] Cross-tenant access blocked by IDOR check/g, '- [x] Cross-tenant access blocked by IDOR check');

content = content.replace(/- \[ \] Multi-profile coexistence enforced/g, '- [x] Multi-profile coexistence enforced');
content = content.replace(/- \[ \] Period numbers cascade on profile deletion/g, '- [x] Period numbers cascade on profile deletion');
content = content.replace(/- \[ \] Teacher clash hard-blocks entry creation/g, '- [x] Teacher clash hard-blocks entry creation');
content = content.replace(/- \[ \] Section clash hard-blocked by unique constraint/g, '- [x] Section clash hard-blocked by unique constraint');
content = content.replace(/- \[ \] Room clash hard-blocks entry creation/g, '- [x] Room clash hard-blocks entry creation');
content = content.replace(/- \[ \] Leave clash generates non-blocking warning/g, '- [x] Leave clash generates non-blocking warning');
content = content.replace(/- \[ \] Slot swap executes via delete\+insert/g, '- [x] Slot swap executes via delete+insert');
content = content.replace(/- \[ \] Timetable PDF export marked exempt/g, '- [x] Timetable PDF export marked exempt');

content = content.replace(/- \[ \] Single open shift constraint enforced/g, '- [x] Single open shift constraint enforced');
content = content.replace(/- \[ \] Dynamic shift close formula calculates discrepancy/g, '- [x] Dynamic shift close formula calculates discrepancy');
content = content.replace(/- \[ \] Order creation is idempotent via clientOrderId/g, '- [x] Order creation is idempotent via clientOrderId');
content = content.replace(/- \[ \] Conditional stock decrement rolls back on race condition/g, '- [x] Conditional stock decrement rolls back on race condition');
content = content.replace(/- \[ \] Daily spending limit enforced on student meal accounts/g, '- [x] Daily spending limit enforced on student meal accounts');
content = content.replace(/- \[ \] Top-up endpoint is strictly cash-only/g, '- [x] Top-up endpoint is strictly cash-only');
content = content.replace(/- \[ \] Voiding restores stock and routes refund/g, '- [x] Voiding restores stock and routes refund');
content = content.replace(/- \[ \] Negative meal account balance blocked/g, '- [x] Negative meal account balance blocked');

fs.writeFileSync(artifactPath, content, 'utf8');
console.log('Successfully updated implementation plan artifact statuses and checkboxes!');

