'use strict';
/**
 * Step 1: Extract Phases 1-7 from old plan, fix 162->161 count,
 * write to new plan file (phases 1-7 only, then we append 8-10 separately).
 */
const fs = require('fs');
const OLD = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_plan_and_services_split_implementation_plan.md';
const NEW = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_implementation_plan_v2.md';

const lines = fs.readFileSync(OLD, 'utf8').split('\n');

// Keep lines 0..1245 (Phase 8 heading is at index 1246)
let p1to7 = lines.slice(0, 1246).join('\n');

// Fix service counts: N13 removed => 162->161 total, 76 roadmap->71 roadmap (Phase 8-13 reduced too)
// Header title
p1to7 = p1to7.replace('162-Service Build Blueprint', '161-Service Build Blueprint');
// Executive summary counts on line ~11 (phase 4 description)
p1to7 = p1to7.replace('162 service accordion cards', '161 service accordion cards');
// §1 pricing table Enterprise row
p1to7 = p1to7.replace('**162 Services**', '**161 Services**');
// Cumulative services counter in §3.1 heading
p1to7 = p1to7.replace('86 Live Today + 76 Roadmap = 162 Total', '90 Live Today + 71 Roadmap = 161 Total (post-Phase 7)');
// §3.1 description
p1to7 = p1to7.replace('The 86 live services exist today; the 76 roadmap services', 'The 90 live services exist after Phase 7; the 71 roadmap services');
// §3.2 heading
p1to7 = p1to7.replace('The 76 Roadmap Services to Build', 'The 71 Roadmap Services to Build');
// Phase 7 live count note
p1to7 = p1to7.replace('86 Live + 76 Roadmap = 162 Total', '90 Live + 71 Roadmap = 161 Total');
p1to7 = p1to7.replace('90 Live + 72 Roadmap = 162 Total', '90 Live + 71 Roadmap = 161 Total');
// Mermaid diagram Phase 8 label
p1to7 = p1to7.replace(
  'P8["⏳ Phase 8: College Operational Services (Bulk Import, Biometrics, Attendance, Fees)"]',
  'P8["⏳ Phase 8: College Operational Services (#29,#28,#27,#80,#79,#83,#81,#86,#87)"]'
);
// Phase 10 label - remove N13
p1to7 = p1to7.replace(
  'P10["⏳ Phase 10: Multi-Campus & Institutional Infrastructure"]',
  'P10["⏳ Phase 10: Infrastructure, Audit & Multi-Campus (N13 removed)"]'
);
// §3.2 Phase 10 roadmap list - remove N13
p1to7 = p1to7.replace(
  '- **Phase 10 (9 Multi-Campus & Comms):** N12 Custom domain, N13 White-label branding, N14 SSO (Google/Azure), N15 IP allow-listing, N16 Data retention & legal hold, N17 Audit log download, N18 Multi-campus dashboard, N19 Cross-campus student transfers, N20 Message credit wallet UI.',
  '- **Phase 10 (8 Infrastructure & Multi-Campus):** N12 Custom domain *(coming soon)*, N14 SSO *(coming soon)*, N15 IP allow-listing, N16 Data retention & legal hold, N17 Audit log download, N18 Multi-campus dashboard, N19 Cross-campus student transfers, N20 Message credit wallet UI. *(N13 White-label permanently removed.)*'
);
// §3.2 Phase 8 list - fix
p1to7 = p1to7.replace(
  '- **Phase 8 (12 Operational Services):** #27 Bulk CSV import, #28 Student diary, #29 Group-wise fees/seats, #79 Biometric turnstile sync, #80 Staff attendance register, #81 Shortage warnings, #82 Online fee payment, #83 Parent portal PWA, #84 SMS alerts, #85 WhatsApp alerts, #86 Absence alerts to parents, #87 Principal executive dashboard.',
  '- **Phase 8 (12 Services, 9 go live):** #29 Group-wise fees/seats, #28 Student diary, #27 Bulk import, #80 Staff attendance, #79 Biometric sync, #83 Parent portal PWA, messaging adapter layer, #81 Shortage scanner, #86 Absence alerts, #87 KPI dashboard; #82/#84/#85 stay `coming_soon`.'
);
// Add N13 removal note to Phase 11 list
p1to7 = p1to7.replace(
  '- **Phase 11 (15 Academic & Student Life Modules):**',
  '- **Phase 11 (15 Academic & Student Life Modules):** *(N13 White-label permanently removed from all phases.)*\n- **Phase 11 (15 Academic & Student Life Modules):**'
);

// Fix OD-11 from "Open" to resolved
p1to7 = p1to7.replace(
  "| OD-11 | **Parent portal SMS/WhatsApp authentication (Phase 8 #83).** How should parents authenticate without an institutional `User` account? | *Open* | A) Magic link to enrolled guardian phone/email \u2013 B) OTP SMS to guardian mobile \u2013 C) Student CNIC + parent phone combo | #83 auth flow, Phase 8 SMS credit deduction on login |",
  "| OD-11 | **Parent portal authentication (#83).** Guardian authenticates via roll number + guardian PIN issued at admission (hashed, bcrypt, 5-attempt lockout, admin reset with audit trail). Parent accounts do NOT count toward any quota. | **RESOLVED: Guardian PIN** | Roll number + bcrypt-hashed guardian PIN | #83 `GuardianSession` table, `ParentAccessToken`, quota exemption |"
);

fs.writeFileSync(NEW, p1to7, 'utf8');
console.log('Part 1 written:', NEW);
console.log('Lines written:', p1to7.split('\n').length);

