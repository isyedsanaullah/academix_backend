const fs = require('fs');
const BASE = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/';
const V2 = BASE + 'academix_implementation_plan_v2.md';
const V4 = BASE + 'academix_implementation_plan_v4.md';
const MASTER = BASE + 'academix_plan_and_services_split_implementation_plan.md';
const P = 'd:/projects/CESMS/backend/plan_parts/';
const rd = f => fs.readFileSync(P + f, 'utf8');
const log = [];
const note = (n, ok) => log.push((ok ? 'OK   ' : 'MISS ') + n);

let L = fs.readFileSync(V2, 'utf8').split('\n');
const p8 = L.findIndex(x => x.startsWith('### Phase 8'));
let sealed = L.slice(0, p8).join('\n');

// 1. character cleanup
sealed = sealed.replace(/\ufffd/g, '\u2014');
sealed = sealed.replace(/\(\?(\d)/g, '(\u00a7$1');
sealed = sealed.replace(/ \? /g, ' \u2192 ');
sealed = sealed.replace(/^- \?\? \*\*/gm, '- \u23f3 **').replace(/^- \? \*\*/gm, '- \u2705 **');
sealed = sealed.replace(/^(\s*)\? /gm, '$1\u2705 ');
sealed = sealed.replace(/\r/g, '');

// 2. new header with reconciled counts
const hdrEnd = sealed.indexOf('## 1. Commercial Pricing');
const header = `# Academix: Master Subscription, Quota Enforcement, Super Admin Automation & 161-Service Build Blueprint (v4.1 — Final Master Spec)

**Reference Document:** [\`D:\\projects\\CESMS\\docs\\Academix Plans and Services Split.md\`](file:///d:/projects/CESMS/docs/Academix%20Plans%20and%20Services%20Split.md)
**Date:** November 2026
**Status:** Comprehensive Architecture & Sequential Phased Execution Blueprint — **Blueprint SEALED & Fully Specified for All Phases 1–13.**
**Last Updated:** November 6, 2026

**Execution Progress & Roadmap Milestones:**
- ✅ **Phase 1 [COMPLETED]:** Database Schema Migration, Canonical Feature Registry (161 services DAG-validated), Neon Backfill. 23/23 Contract Tests Passing.
- ✅ **Phase 2 [COMPLETED]:** Entitlement Resolver, \`subscriptionGate\`, \`quotaGate\`, Dual-Bucket Credit Ledger. 13/13 Contract Tests Passing.
- ✅ **Phase 3 [COMPLETED]:** Public Pricing Page & Add-on Policy UI (\`/request-subscription\`).
- ✅ **Phase 4 [COMPLETED]:** Public Interactive Services Catalog (\`/services\`) with 161 service accordion cards.
- ✅ **Phase 5 [COMPLETED]:** College Admin Subscription Dashboard (\`/admin/subscription\`) & Accountant Ledger.
- ✅ **Phase 6 [COMPLETED]:** Settlement Engine, Plan Versioning (\`PlanVersion\`), Governance Deck. 16/16 Contract Tests Passing.
- ✅ **Phase 7 [COMPLETED]:** #26 File Vault, #25 Circulars, #78 Universal Master Timetable, #98 Canteen POS. 19/19 Contract Tests Passing. **Current Status: 90 Live + 71 Roadmap = 161 Total.**
- ⏳ **Phase 8 [QUEUED — Build Next]:** 8 services go live, 4 stay \`coming_soon\` (#79, #82, #84, #85) → **98 live + 63 roadmap = 161 Total.**
- ⏳ **Phase 9 [QUEUED]:** 10 security & governance services (N07, N01, N10, N11, N06, N05, N08, N03, N02, N04) → **108 live + 53 roadmap = 161 Total.**
- ⏳ **Phase 10 [QUEUED]:** 6 infrastructure & multi-campus services (N15, N17, N16, N20, N18, N19; N12/N14 \`coming_soon\`; N13 removed) → **114 live + 47 roadmap = 161 Total.**
- ⏳ **Phase 11 [QUEUED]:** 15 academic management & student life services (11A Exams, 11B Leaves/Clearance, 11C Teaching, 11D Student Life, 11E Localization/Flags) → **129 live + 32 roadmap = 161 Total.**
- ⏳ **Phase 12 [QUEUED]:** 7 campus operations & auxiliary modules (N35 Library, N36 Transport, N37 Hostel, N38 Inventory, N39 Purchase, N40 Accounting, N41 Budgets) → **136 live + 25 roadmap = 161 Total.**
- ⏳ **Phase 13 [QUEUED — Final]:** 19 AI & autonomous intelligence services (6 specialized engines, Lite/Plus/Full tiers, Autonomous Agent N45, centralized credit ledger) → **155 live + 6 roadmap = 161 Total.**

---

`;
sealed = header + sealed.slice(hdrEnd);
note('header', true);

// 3. cut 7C/7D, insert clean versions
const i7c = sealed.indexOf('#### 7C:');
if (i7c >= 0) {
  sealed = sealed.slice(0, i7c) + rd('p7c.md') + '\n\n' + rd('p7d.md') + '\n';
  note('7C/7D replaced', true);
} else {
  note('7C found', false);
}

// 4. targeted patches
function rep(name, re, to) {
  const before = sealed;
  sealed = sealed.replace(re, to);
  note(name, before !== sealed);
}

rep('exports row', /^\| \*\*Exports per Month \(N01\)\*\*.*$/m,
  '| **Exports per Month (N01)** | 3 CSV / mo (max 1,000 rows) | 60 CSV / mo | Unlimited CSV, 60 PDF / mo | Unlimited *(1,000,000 streaming technical ceiling)* |');
rep('backup row', /^\| \*\*Backup Frequency \(N05\)\*\*.*$/m,
  '| **Data Export / Backup (N05)** | Super Admin export on offboarding only | Super Admin export on offboarding only | Super Admin export on offboarding only | 1 self-service export / month |');
rep('message row', /^\| \*\*Message Credits \(SMS\/WA\)\*\*.*$/m,
  '| **Message Credits (SMS/WA)** | Not available | Packs only (no base pool) | 200 included / mo *(active when SMS goes live)* | 600 included / mo *(active when SMS goes live)* |');
rep('1.1 export rows', /^\| `exportsCsv` \/ `exportsPdf`.*$/m,
  '| `exportsCsvMonthly` | `MONTHLY` (`YYYY-MM`, PKT) | `limits.exportsCsvMonthly` | 3 (Starter), 60 (Std), unlimited (Prem, Ent) |\n| `exportsPdfMonthly` | `MONTHLY` (`YYYY-MM`, PKT) | `limits.exportsPdfMonthly` | 0 (Starter/Std), 60 (Prem), unlimited (Ent) |\n| `exportMaxRows` | per job | `limits.exportMaxRows` | 1,000 (Starter), 10,000 (Std), 100,000 (Prem), 1,000,000 (Ent) |');
rep('6B.1 keys', /`exportsMonthly`, `exportsPdfMonthly`,/, '`exportsCsvMonthly`, `exportsPdfMonthly`, `exportMaxRows`,');
rep('phase3 counts', /\(33, 88, 141, 162\)/g, '(33, 88, 141, 161)');
rep('phase4 badges', /Live \(86\) vs\. Roadmap \(76\) badges/, 'Live vs. Roadmap badges (counts query featureRegistry)');
// 6C.3 SubscriptionReminderLog model and advisory lock
const srlOld = `model SubscriptionReminderLog {
  id         String   @id @default(uuid())
  college_id String
  eventType  String   // RENEWAL_30D, RENEWAL_14D, RENEWAL_7D, RENEWAL_1D, TRIAL_3D, TRIAL_1D, GRANDFATHER_90D, GRANDFATHER_60D, GRANDFATHER_30D, GRANDFATHER_14D, EXPIRY_TRANSITION
  sentDate   DateTime @db.Date // Calendar date (YYYY-MM-DD in Asia/Karachi PKT)
  createdAt  DateTime @default(now())

  @@unique([college_id, eventType, sentDate])`;

const srlNew = `model SubscriptionReminderLog {
  id            String    @id @default(uuid())
  college_id    String
  eventType     String    // RENEWAL_30D, RENEWAL_14D, RENEWAL_7D, RENEWAL_1D, TRIAL_3D, TRIAL_1D, GRANDFATHER_90D, GRANDFATHER_60D, GRANDFATHER_30D, GRANDFATHER_14D, EXPIRY_TRANSITION
  sentDate      DateTime  @db.Date // Calendar date (YYYY-MM-DD in Asia/Karachi PKT)
  periodEndDate DateTime? @db.Date // End date of subscription period (cycle isolation)
  createdAt     DateTime  @default(now())

  @@unique([college_id, eventType, periodEndDate])`;

rep('srl model update', srlOld, srlNew);
rep('srl unique text', /@@unique\(\[college_id, eventType, sentDate\]\)/g, '@@unique([college_id, eventType, periodEndDate])');
rep('srl advisory lock text', /pg_try_advisory_lock/g, 'pg_try_advisory_xact_lock');

// 5. clean up question marks & formatting in sealed
sealed = sealed.replace(/\? Not available/g, 'Not available').replace(/\? \*\*Included Free\*\*/g, '✅ **Included Free**');
sealed = sealed.replace('**\tokenEpoch per-request', '**`tokenEpoch` per-request');

// 6. fix mermaid in sealed
for (const n of [1, 2, 3, 4, 5]) sealed = sealed.replace(new RegExp('\\["\\? Phase ' + n + ':'), '["✅ Phase ' + n + ':');
sealed = sealed.replace(/subgraph P6\["\? Phase 6:/, 'subgraph P6["✅ Phase 6:').replace(/subgraph P7\["\? Phase 7:/, 'subgraph P7["✅ Phase 7:');
sealed = sealed.replace(/P8\["\? Phase 8:[^"]*"\]/, 'P8["⏳ Phase 8: Operational Services (#29, #28, #27, #80, 8F Messaging, #83, #81, #86, #87; #79 simulator, #82 adapter)"]');
sealed = sealed.replace(/P9\["\? Phase 9:[^"]*"\]/, 'P9["⏳ Phase 9: Security & Export Center (N07, N01, N10, N11, N06, N05, N08, N03, N02, N04)"]');
sealed = sealed.replace(/P10\["\? Phase 10:[^"]*"\]/, 'P10["⏳ Phase 10: Multi-Campus & Audit (N15, N17, N16, N20, N18, N19; N13 removed)"]');
sealed = sealed.replace(/P11\["\? Phase 11:/, 'P11["⏳ Phase 11: Academic & Student Life (15 Services)"]').replace(/P12\["\? Phase 12:/, 'P12["⏳ Phase 12: Operations & Auxiliary (7 Services)"]').replace(/P13\["\? Phase 13/, 'P13["⏳ Phase 13: AI & Autonomous Automation (19 Services)"]');

// 7. Assemble all parts
const parts = [
  sealed.trimEnd(),
  '\n\n---\n',
  rd('p8a.md'),
  rd('p8b.md'),
  rd('p8c.md'),
  rd('p9a.md'),
  rd('p9b.md'),
  rd('p10.md'),
  rd('p11a.md'),
  rd('p11b.md'),
  rd('p11c.md'),
  rd('p11d.md'),
  rd('p11e.md'),
  rd('p12.md'),
  rd('p13.md'),
  rd('ptail.md')
];

let finalOut = parts.join('\n');

// Clean up any remaining broken mermaid in assembled output
finalOut = finalOut.replace(/P11\["⏳ Phase 11: Academic & Student Life \(15 Services\)"\][^"\n]*"\]/g, 'P11["⏳ Phase 11: Academic & Student Life (15 Services)"]');
finalOut = finalOut.replace(/P12\["⏳ Phase 12: Operations & Auxiliary \(7 Services\)"\][^"\n]*"\]/g, 'P12["⏳ Phase 12: Operations & Auxiliary (7 Services)"]');
finalOut = finalOut.replace(/P13\["⏳ Phase 13: AI & Autonomous Automation \(19 Services\)"\][^"\n]*"\]/g, 'P13["⏳ Phase 13: AI & Autonomous Automation (19 Services)"]');

fs.writeFileSync(V4, finalOut, 'utf8');
fs.writeFileSync(MASTER, finalOut, 'utf8');

console.log(log.join('\n'));
const O = finalOut.split('\n');
console.log('Final lines:', O.length);
console.log('Final size in bytes:', fs.statSync(MASTER).size);

// Verification check
const headings = O.filter(l => /^#{1,4} /.test(l)).map(l => l.slice(0, 80));
console.log('\nTotal headings:', headings.length);
console.log('Major phase sections found:');
headings.filter(h => h.includes('Phase ')).forEach(h => console.log('  ' + h));
