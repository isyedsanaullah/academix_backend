const fs = require('fs');
const BASE = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/';
const V2 = BASE + 'academix_implementation_plan_v2.md';
const V3 = BASE + 'academix_implementation_plan_v3.md';
const P = 'd:/projects/CESMS/backend/plan_parts/';
const rd = f => fs.readFileSync(P + f, 'utf8');
const log = [];
const note = (n, ok) => log.push((ok ? 'OK   ' : 'MISS ') + n);

let L = fs.readFileSync(V2, 'utf8').split('\n');
const p8 = L.findIndex(x => x.startsWith('### Phase 8'));
let sealed = L.slice(0, p8).join('\n');

// ---- 1. character cleanup of sealed text
sealed = sealed.replace(/\ufffd/g, '\u2014');
sealed = sealed.replace(/\(\?(\d)/g, '(\u00a7$1');
sealed = sealed.replace(/ \? /g, ' \u2192 ');
sealed = sealed.replace(/^- \?\? \*\*/gm, '- \u23f3 **').replace(/^- \? \*\*/gm, '- \u2705 **');
sealed = sealed.replace(/^(\s*)\? /gm, '$1\u2705 ');
sealed = sealed.replace(/\r/g, '');

// ---- 2. new header
const hdrEnd = sealed.indexOf('## 1. Commercial Pricing');
const header = `# Academix: Master Subscription, Quota Enforcement, Super Admin Automation & 161-Service Build Blueprint (v3)

**Reference Document:** [\`D:\\projects\\CESMS\\docs\\Academix Plans and Services Split.md\`](file:///d:/projects/CESMS/docs/Academix%20Plans%20and%20Services%20Split.md)
**Date:** November 2026
**Status:** Architecture blueprint. Phases 1-7 built and verified. Phases 8-13 planned (this revision). **No Phase 8+ code has been written.**
**Last Updated:** November 5, 2026

**Execution Progress:**
- \u2705 **Phase 1 [COMPLETED]:** schema migration, canonical registry (DAG-validated), Neon backfill. 23/23 contract tests.
- \u2705 **Phase 2 [COMPLETED]:** entitlement resolver, \`subscriptionGate\`, \`quotaGate\`, dual-bucket credit ledger. 13/13 contract tests.
- \u2705 **Phase 3 [COMPLETED]:** public pricing page (\`/request-subscription\`).
- \u2705 **Phase 4 [COMPLETED]:** public services catalog (\`/services\`).
- \u2705 **Phase 5 [COMPLETED]:** college billing and renewal pages (admin and accountant).
- \u2705 **Phase 6 [COMPLETED]:** settlement engine, plan versioning, governance deck. 16/16 contract tests.
- \u2705 **Phase 7 [COMPLETED]:** #26 File Vault, #25 Circulars, #78 Timetable, #98 Canteen POS. 19/19 contract tests. **90 live + 71 roadmap = 161.**
- \u23f3 **Phase 8 [PLANNED]:** 9 services go live, 3 stay \`coming_soon\` \u2192 **99 live + 62 roadmap**.
- \u23f3 **Phase 9 [PLANNED]:** 10 services \u2192 **109 live + 52 roadmap** (108/53 if N02 waits on OD-18).
- \u23f3 **Phase 10 [PLANNED]:** 6 services live; N12 and N14 stay \`coming_soon\`; N13 removed \u2192 **115 live + 46 roadmap**.
- \u23f3 **Phases 11-13 [ROADMAP]:** 41 services (academic and student life, auxiliary operations, AI). No git push or deployment until all phases are complete.

---

`;
sealed = header + sealed.slice(hdrEnd);
note('header', true);

// ---- 3. cut 7C/7D, insert clean versions
const i7c = sealed.indexOf('#### 7C:');
if (i7c < 0) note('7C found', false);
else {
  sealed = sealed.slice(0, i7c) + rd('p7c.md') + '\n\n' + rd('p7d.md') + '\n';
  note('7C/7D replaced', true);
}

// ---- 4. targeted patches
function rep(name, re, to) {
  const before = sealed;
  sealed = sealed.replace(re, to);
  note(name, before !== sealed);
}
rep('exports row', /^\| \*\*Exports per Month \(N01\)\*\*.*$/m,
  '| **Exports per Month (N01)** | 3 CSV / mo (max 1,000 rows) | 60 CSV / mo | Unlimited CSV, 60 PDF / mo | Unlimited *(row caps above Starter: see OD-21)* |');
rep('backup row', /^\| \*\*Backup Frequency \(N05\)\*\*.*$/m,
  '| **Data Export / Backup (N05)** | Super Admin export on offboarding only | Super Admin export on offboarding only | Super Admin export on offboarding only | 1 self-service export / month |');
rep('message row', /^\| \*\*Message Credits \(SMS\/WA\)\*\*.*$/m,
  '| **Message Credits (SMS/WA)** | Not available | Packs only (no base pool) | 200 included / mo *(active when SMS goes live)* | 600 included / mo *(active when SMS goes live)* |');
rep('1.1 export rows', /^\| `exportsCsv` \/ `exportsPdf`.*$/m,
  '| `exportsCsvMonthly` | `MONTHLY` (`YYYY-MM`, PKT) | `limits.exportsCsvMonthly` | 3 (Starter), 60 (Std), unlimited (Prem, Ent) |\n| `exportsPdfMonthly` | `MONTHLY` (`YYYY-MM`, PKT) | `limits.exportsPdfMonthly` | 0 (Starter/Std), 60 (Prem), unlimited (Ent) |\n| `exportMaxRows` | per job | `limits.exportMaxRows` | 1,000 (Starter); other tiers per OD-21 |');
rep('6B.1 keys', /`exportsMonthly`, `exportsPdfMonthly`,/, '`exportsCsvMonthly`, `exportsPdfMonthly`, `exportMaxRows`,');
rep('phase3 counts', /\(33, 88, 141, 162\)/g, '(33, 88, 141, 161)');
rep('phase4 badges', /Live \(86\) vs\. Roadmap \(76\) badges/, 'Live vs. Roadmap badges (counts come from the registry)');
rep('162 services p4', /(\d+) service accordion cards/, '161 service accordion cards');
rep('stray N13 phase11 line', /^- \*\*Phase 11 \(15 Academic & Student Life Modules\):\*\* \*\(N13[^\n]*\n/m, '');
rep('7A ttl', /15-minute/g, '10-minute');
rep('6B.3 reset-2fa', /(\n##### 6B\.4)/, '\n> [!NOTE]\n> **Planned addition (Phase 9, N07):** a `reset-2fa` action (step-up protected, reason required, audited) is added to this list. A second planned action, `disable-ip-allowlist`, arrives with N15 in Phase 10.\n$1');
rep('7A retrofit pointer', /(\n#### 7B:)/, '\n> [!WARNING]\n> **Retrofit required (Phase 8 \u00a78.0.6):** the storage reconciliation excludes only `receipts/`, and `reserve-upload` accepts client-chosen categories. Both must be tightened so server-exempt categories (`EXPORTS`, `BACKUPS`, `REPORTS`, `RECEIPTS`, `IMPORT_SOURCE`) are server-write-only and never reconciled into `StoredFile`.\n$1');

// ---- 5. Phase 8 settings key patch
let p8a = rd('p8a.md');
p8a = p8a.replace('`attendance.shortageThresholdPct`,', '`attendance.shortageThresholdPct`, `attendance.shortageRenotifyDropPct`,');

// ---- 6. assemble
const out = [sealed.trimEnd(), '\n\n---\n', p8a, rd('p8b.md'), rd('p8c.md'), rd('p9a.md'), rd('p9b.md'), rd('p10.md'), rd('ptail.md')].join('\n');
fs.writeFileSync(V3, out, 'utf8');
console.log(log.join('\n'));
const O = out.split('\n');
console.log('lines', O.length);
const bad = [];
O.forEach((l, i) => { if (/[\x00-\x08\x0b\x0c\x0e-\x1f\t]/.test(l) || l.includes('\ufffd')) bad.push(i + 1); });
console.log('ctrl/tab lines:', bad.join(','));
const q = [];
O.forEach((l, i) => { if (/\?\?|(^|[\s(])\?[A-Za-z*`]/.test(l) && !/\?(sig|page|date|from|campus|periodStart|sectionId|userId|limit)/.test(l)) q.push(i + 1); });
console.log('suspect ? lines:', q.slice(0, 60).join(','));
const stale = [];
O.forEach((l, i) => { if (/\b162\b|72 roadmap|76 roadmap|UPGRADE_REQUIRED/.test(l)) stale.push((i + 1) + ': ' + l.slice(0, 100)); });
console.log('stale refs:\n' + stale.join('\n'));

