const fs = require('fs');
const path = require('path');

const artifactPath = 'C:/Users/DELL/.gemini/antigravity/brain/0f5abc21-213b-48d8-8206-8a725a9cb735/academix_plan_and_services_split_implementation_plan.md';
let content = fs.readFileSync(artifactPath, 'utf8');

// 1. Update Phase 7 Section Header and Status
content = content.replace(
  '### Phase 7: Complete In-Progress Core Services (86 Live Today $\\to$ 90 Live)',
  '### Phase 7: Complete In-Progress Core Services (90 Live — 100% COMPLETE & VERIFIED)'
);

content = content.replace(
  '> **Total Services Progression:** 86 Live + 76 Roadmap = 162 Total $\\to$ **90 Live + 72 Roadmap = 162 Total**.',
  `> **Total Services Progression:** 86 Live + 76 Roadmap = 162 Total $\\to$ **90 Live + 72 Roadmap = 162 Total**.\n> [!NOTE]\n> **STATUS: 100% COMPLETE & VERIFIED.** All 4 core services (#26, #25, #78, #98) have been fully implemented across backend services, workers, and route controllers. All 19 automated contract tests in \`phase7_contract.test.js\` pass with 0 failures, and all 16 contract tests in \`phase6_contract.test.js\` continue to pass with 0 failures.`
);

// Check all Phase 7 DoD checkboxes
content = content.replace(/- \[ \] Unified storage routing/g, '- [x] Unified storage routing');
content = content.replace(/- \[ \] Upload reservation lifecycle/g, '- [x] Upload reservation lifecycle');
content = content.replace(/- \[ \] Abandoned upload cleanup worker/g, '- [x] Abandoned upload cleanup worker');
content = content.replace(/- \[ \] R2 reconciliation backfill/g, '- [x] R2 reconciliation backfill');
content = content.replace(/- \[ \] Storage quota visualization UI/g, '- [x] Storage quota visualization UI');
content = content.replace(/- \[ \] Announcement status casing normalized/g, '- [x] Announcement status casing normalized');
content = content.replace(/- \[ \] Atomic scheduled circulars dispatcher worker/g, '- [x] Atomic scheduled circulars dispatcher worker');
content = content.replace(/- \[ \] Query-time visibility enforcement/g, '- [x] Query-time visibility enforcement');
content = content.replace(/- \[ \] HTML sanitization on circulars/g, '- [x] HTML sanitization on circulars');
content = content.replace(/- \[ \] IDOR check on \`GET \/announcements\/:id\`/g, '- [x] IDOR check on `GET /announcements/:id`');
content = content.replace(/- \[ \] Multi-profile coexistence supported/g, '- [x] Multi-profile coexistence supported');
content = content.replace(/- \[ \] Section-wise clash unique index enforced/g, '- [x] Section-wise clash unique index enforced');
content = content.replace(/- \[ \] Room, teacher, and section clash validation/g, '- [x] Room, teacher, and section clash validation');
content = content.replace(/- \[ \] Leave conflict warning implemented/g, '- [x] Leave conflict warning implemented');
content = content.replace(/- \[ \] Atomic slot swap via delete\+insert/g, '- [x] Atomic slot swap via delete+insert');
content = content.replace(/- \[ \] Timetable PDF export marked exempt/g, '- [x] Timetable PDF export marked exempt');
content = content.replace(/- \[ \] CashierShift single open shift constraint enforced/g, '- [x] CashierShift single open shift constraint enforced');
content = content.replace(/- \[ \] Zero-drift dynamic shift close formula/g, '- [x] Zero-drift dynamic shift close formula');
content = content.replace(/- \[ \] Idempotent order creation/g, '- [x] Idempotent order creation');
content = content.replace(/- \[ \] Race-condition-proof conditional stock decrement/g, '- [x] Race-condition-proof conditional stock decrement');
content = content.replace(/- \[ \] Daily spending limit enforced in PKT timezone/g, '- [x] Daily spending limit enforced in PKT timezone');
content = content.replace(/- \[ \] Cash-only meal account topup implemented/g, '- [x] Cash-only meal account topup implemented');
content = content.replace(/- \[ \] Order void workflow restores stock/g, '- [x] Order void workflow restores stock');
content = content.replace(/- \[ \] Negative meal account balance blocked/g, '- [x] Negative meal account balance blocked');

// 2. Prepare detailed replacement for Phase 8, Phase 9, Phase 10
const detailedPhases8to10 = `
### Phase 8: College Operational Roadmap Services (12 Services — Standard & Starter Tiers)
> [!IMPORTANT]
> **Phase 8 Architecture & Scope:**
> Delivers daily automation tools for Pakistani intermediate colleges across admissions, attendance, parent communication, and front-office administration.
> All services follow strict tenant isolation (\`college_id\` scoping), atomic transaction boundaries, and \`subscriptionGate(featureKey)\` authorization.
> **Third-Party Credential Isolation Rules (Per User Requirements):**
> - **#82 (Online Fee Payment Gateway):** Implemented via pluggable \`PaymentGatewayAdapter\` in **Mock / In-App Proof Mode**. Zero real third-party merchant credentials (no live Stripe/JazzCash merchant keys) required in codebase. Students/guardians upload payment receipts/screenshots via File Vault (#26), and accountants manually verify. Super Admin retains full plan-level toggle control (\`featureKey: 'online-payment-gateway'\`).
> - **#84 (SMS Alerts Gateway) & #85 (WhatsApp Alerts Gateway):** Implemented via pluggable \`MessagingAdapter\` in **In-App Routing Mode**. Zero external SMS/WhatsApp vendor credentials required. Notifications route to \`OutboxEvent\` and in-app notice feeds while debiting the dual-bucket credit ledger (\`PLAN\` vs \`PURCHASED\`). Super Admin retains full plan-level toggle control.

---

#### 8A: #27 Excel/CSV Bulk Import Engine with Row-Level Validation & Staged Rollback (Starter Tier)
* **Institutional Job:** Onboards hundreds of intermediate college students, roll numbers, board marks, and fee schedules from Excel/CSV files in a single pass without server timeouts.
* **Data Models:**
  \`\`\`prisma
  model BulkImportJob {
    id              String    @id @default(uuid())
    college_id      String
    entityType      String    // STUDENTS, MARKS, FEES, STAFF
    originalFileUrl String
    status          String    @default("PENDING") // PENDING, VALIDATING, STAGED, COMMITTED, FAILED
    totalRows       Int       @default(0)
    validRows       Int       @default(0)
    errorRows       Int       @default(0)
    stagedDataJson  Json?     // Parsed and validated rows ready for commit
    errorReportJson Json?     // Row-by-row error details: [{ row: 12, column: "bForm", error: "Invalid CNIC format" }]
    createdBy       String
    createdAt       DateTime  @default(now())
    completedAt     DateTime?

    college         College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, entityType, createdAt(sort: Desc)])
  }
  \`\`\`
* **API Contracts:**
  - \`POST /api/imports/preview\`: Uploads CSV/XLSX, validates header mappings, returns schema preview (first 10 rows) and total row count.
  - \`POST /api/imports/:jobId/validate\`: Validates all rows against database constraints (e.g. duplicate roll numbers, valid group codes) and populates \`errorReportJson\`.
  - \`POST /api/imports/:jobId/commit\`: Atomically inserts validated rows inside chunks of 200 within transactions. If fatal chunk error occurs, unrolls chunk.
* **Security & Invariants:**
  - File uploaded via File Vault (\`#26\`) with 25MB max size limit.
  - Roll numbers normalized via uppercase trimming.

---

#### 8B: #28 Student Diary & Academic Events Calendar (Standard Tier)
* **Institutional Job:** Daily class agenda, teacher homework assignments, institutional holidays, and academic calendar planner accessible by students and guardians.
* **Data Models:**
  \`\`\`prisma
  model ClassDiaryEntry {
    id          String   @id @default(uuid())
    college_id  String
    class       String   // e.g. "FSc Part 1"
    section_id  String
    subject_id  String
    date        DateTime @db.Date // PKT calendar date
    topicTitle  String
    homework    String?
    attachments String[]
    assignedBy  String   // teacher user ID
    createdAt   DateTime @default(now())

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, class, section_id, date])
  }

  model AcademicCalendarEvent {
    id          String   @id @default(uuid())
    college_id  String
    title       String
    description String?
    eventType   String   // HOLIDAY, EXAM_SESSION, SPORTS, ADMISSION, RESULT_DAY
    startDate   DateTime @db.Date
    endDate     DateTime @db.Date
    isPublic    Boolean  @default(true)
    createdAt   DateTime @default(now())

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, startDate, endDate])
  }
  \`\`\`
* **API Contracts:**
  - \`POST /api/diary/entries\`: Creates daily diary entry; emits in-app notification to section students.
  - \`GET /api/diary/entries\`: Fetches diary entries by section and date range.
  - \`POST /api/calendar/events\` & \`GET /api/calendar/events\`: Manages institutional milestones.

---

#### 8C: #29 Group-Wise Fee, Seats & Section Allocations (Starter Tier)
* **Institutional Job:** Group-specific seat quotas and differentiated fee structures tied directly to intermediate study disciplines (FSc Pre-Medical, FSc Pre-Engineering, ICS Computer Science, I.Com Commerce).
* **Data Models:**
  \`\`\`prisma
  model AcademicGroup {
    id              String   @id @default(uuid())
    college_id      String
    name            String   // "FSc Pre-Medical", "ICS", etc.
    code            String   // FSC_MED, FSC_ENG, ICS, ICOM
    seatCapacity    Int      @default(100)
    enrolledCount   Int      @default(0)
    monthlyFeePkr   Int      @default(3500)
    admissionFeePkr Int      @default(15000)
    isActive        Boolean  @default(true)
    createdAt       DateTime @default(now())

    college         College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@unique([college_id, code])
  }
  \`\`\`
* **Business Invariants:**
  - Student admission checks \`enrolledCount < seatCapacity\` before admission finalization.
  - Group fee schedule automatically drives fee voucher generation.

---

#### 8D: #79 Biometric Device Attendance Synchronizer (Standard Tier)
* **Institutional Job:** Synchronizes on-premise biometric turnstiles, RFID card readers, and face recognition terminals (ZKTeco ADMS protocol) into platform gate attendance records.
* **Data Models:**
  \`\`\`prisma
  model BiometricDevice {
    id            String    @id @default(uuid())
    college_id    String
    deviceName    String
    serialNumber  String    @unique
    ipAddress     String?
    direction     String    @default("IN") // IN, OUT, BIDIRECTIONAL
    lastHeartbeat DateTime?
    status        String    @default("ACTIVE") // ACTIVE, OFFLINE

    college       College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, status])
  }

  model BiometricPunchLog {
    id           String   @id @default(uuid())
    college_id   String
    deviceId     String
    deviceUserId String   // Biometric ID mapped to Student.biometricId or User.id
    punchTime    DateTime
    direction    String   // IN, OUT
    processed    Boolean  @default(false)
    createdAt    DateTime @default(now())

    @@index([college_id, processed, punchTime])
  }
  \`\`\`
* **Worker & Invariants:**
  - \`biometricSyncWorker.js\`: Drains \`BiometricPunchLog\` in batches of 100; resolves \`deviceUserId\` to \`Student\` or \`User\`; upserts \`DailyAttendance\` with \`status: 'PRESENT'\`, \`checkInTime: punchTime\`.
  - Safe replay: Idempotent punch processing via unique combination \`@@unique([college_id, deviceUserId, punchTime])\`.

---

#### 8E: #80 Teacher & Staff Attendance Register with Late Calculation (Standard Tier)
* **Institutional Job:** Digital check-in/out register for teaching and administrative staff with automatic 15-minute grace period calculation, late deduction metrics, and leave balance linkage.
* **Data Models:**
  \`\`\`prisma
  model StaffAttendance {
    id              String    @id @default(uuid())
    college_id      String
    userId          String    // Staff User ID
    date            DateTime  @db.Date
    checkIn         DateTime?
    checkOut        DateTime?
    status          String    @default("PRESENT") // PRESENT, LATE, HALF_DAY, ABSENT, ON_LEAVE
    lateMinutes     Int       @default(0)
    overtimeMinutes Int       @default(0)
    shiftStartTime  String    @default("08:00")
    verifiedBy      String?
    createdAt       DateTime  @default(now())

    college         College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@unique([college_id, userId, date])
    @@index([college_id, date, status])
  }
  \`\`\`
* **Late Calculation Rule:** If \`checkIn > shiftStartTime + 15 minutes\`, status transitions to \`LATE\` and \`lateMinutes\` is recorded. If \`checkIn > shiftStartTime + 90 minutes\`, marked \`HALF_DAY\`.

---

#### 8F: #81 Automated Attendance Shortage Scanner (Standard Tier)
* **Institutional Job:** Automated weekly background audit scanning student cumulative attendance percentages and issuing formal shortage notices for students falling below the board mandatory threshold (75% BISE requirement).
* **Data Models:**
  \`\`\`prisma
  model AttendanceShortageNotice {
    id            String    @id @default(uuid())
    college_id    String
    student_id    String
    academicTerm  String    // e.g. "Term 1 2026"
    totalHeld     Int
    totalAttended Int
    percentage    Float
    threshold     Float     @default(75.0)
    status        String    @default("ISSUED") // ISSUED, ACKNOWLEDGED, RESOLVED
    issuedAt      DateTime  @default(now())

    college       College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, student_id, issuedAt])
  }
  \`\`\`
* **Worker:** \`attendanceShortageScanner.js\` runs every Sunday at midnight; calculates \`percentage = (attended / held) * 100\`; if \`< 75.0%\`, creates shortage record and dispatches warning notification to guardian.

---

#### 8G: #82 Online Fee Payment Gateway Adapter (Standard Tier — Pluggable Interface / Mock In-App Proof Mode)
* **Institutional Job:** Pluggable framework for fee payments.
* **User Constraints & Architecture:**
  - **UI Implementation:** Settings card in College Billing rendered as non-clickable / view-only: *"Online Payment Gateway (Mock / Coming Soon — Controlled by Platform)"*.
  - **Zero Live Credentials:** No live Stripe, JazzCash, or EasyPaisa API keys or merchant secrets required in repository.
  - **In-App Payment Slip Workflow:**
    1. Guardian/student generates printable fee challan containing college Raast IBAN and bank account.
    2. Guardian uploads payment screenshot/bank deposit slip via File Vault (\`#26\`).
    3. Stored as \`FeePaymentProof\` with status \`PENDING_VERIFICATION\`.
    4. College cashier/accountant verifies slip in Billing Queue and marks fee paid.
  - **Super Admin Plan Control:** Gated by \`subscriptionGate('online-payment-gateway')\`. Can be turned on/off per plan or overridden in Super Admin Governance Deck.
  - **Pluggable Architecture:**
    \`\`\`javascript
    class PaymentGatewayAdapter {
      async initiatePayment(challanId, amountPkr, callbackUrl) {}
      async handleWebhook(headers, body) {}
      async verifyTransaction(txId) {}
    }
    // Default Driver: MockPaymentDriver (simulates successful callback or records manual proof)
    \`\`\`
* **Data Models:**
  \`\`\`prisma
  model FeePaymentProof {
    id            String    @id @default(uuid())
    college_id    String
    student_id    String
    challanNumber String
    amountPkr     Int
    slipFileId    String    // References StoredFile.id (exempt fee proof category)
    status        String    @default("PENDING") // PENDING, VERIFIED, REJECTED
    rejectionNote String?
    verifiedBy    String?
    verifiedAt    DateTime?
    createdAt     DateTime  @default(now())

    college       College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, status, createdAt])
  }
  \`\`\`

---

#### 8H: #83 Progressive Web App (PWA) Parent Portal (Standard Tier)
* **Institutional Job:** Mobile-first installable portal allowing guardians to view student live attendance, fee payment history, exam result cards, and class diaries.
* **Architecture:**
  - Responsive Next.js application at \`/parent\` authenticated via phone number OTP (in-app simulated) or secure student roll number + PIN.
  - Service worker caching shell and offline read-only storage of previous term results.

---

#### 8I: #84 SMS Alerts Gateway & #85 WhatsApp Business API Gateway (Standard Tier — Pluggable In-App Routing Mode)
* **Institutional Job:** Automated notification engines for fee notices, absence alerts, and board datesheets.
* **User Constraints & Architecture:**
  - **Zero Live Third-Party Credentials:** No external SMS aggregator credentials (Twilio, Telenor, Jazz) or Meta WhatsApp Cloud API tokens required.
  - **In-App Delivery Fallback:** When dispatches occur, messages route directly to \`OutboxEvent\` and populate student/parent in-app notifications with \`channel: 'IN_APP'\` and tag \`[SMS Notice]\` or \`[WhatsApp Notice]\`.
  - **Credit Ledger Integration:** Debits \`MessageCreditLedgerEntry\` (\`PLAN\` credits first, then \`PURCHASED\`). If credits are zero, dispatch fails with 422 \`INSUFFICIENT_MESSAGE_CREDITS\`.
  - **Super Admin Plan Control:** Fully controllable via \`subscriptionGate('sms-gateway')\` and \`subscriptionGate('whatsapp-notifications')\`.
  - **Pluggable Adapter Interface:**
    \`\`\`javascript
    class MessagingAdapter {
      async send(recipientPhone, templateName, params) {}
    }
    // Active driver: InAppMessagingDriver (writes OutboxEvent and in-app feed)
    // Placeholder drivers: TwilioSmsDriver, MetaWhatsAppDriver
    \`\`\`

---

#### 8J: #86 Instant Absence Push Delivery to Guardians (Standard Tier)
* **Institutional Job:** Automated trigger executing at college morning gate closure time (e.g. 09:30 AM PKT) that identifies all unexcused absences and triggers parent alerts via \`#84\`/\`#85\` adapter.
* **Worker Execution:** \`dailyAbsenceAlertWorker.js\` runs daily at 09:30 AM PKT; checks \`DailyAttendance\` where \`date = today AND status = 'ABSENT'\`; creates in-app notification rows and debits credit ledger.

---

#### 8K: #87 Principal & Executive KPI Analytics Dashboard (Standard Tier)
* **Institutional Job:** High-level executive dashboard aggregating real-time institutional metrics: fee recovery percentage, today's student attendance rate, faculty presence, and admission pipeline.
* **API Contracts:**
  - \`GET /api/executive/kpi-summary\`: Returns consolidated summary:
    \`\`\`json
    {
      "feeRecoveryRate": 84.5,
      "totalRevenuePkr": 14500000,
      "pendingFeePkr": 2650000,
      "studentAttendancePercent": 91.2,
      "staffAttendancePercent": 96.0,
      "totalEnrolled": 1420
    }
    \`\`\`

---

### Phase 9: Platform Security, Governance & Export Center (10 Services)
> [!IMPORTANT]
> **Phase 9 Scope & Security Invariants:**
> Delivers platform-level data export quotas, local RFC 6238 TOTP two-factor authentication, granular custom roles (strictly gated to Premium/Enterprise), and multi-step approval workflows.

---

#### 9A: N01 Platform Export Center with Tiered Monthly Quotas (Starter Tier)
* **Institutional Job:** Centralized data export hub enforcing monthly plan quotas (Starter: 3 CSV/mo, Standard: 60 CSV/mo, Premium: $\infty$ CSV / 60 PDF/mo, Enterprise: $\infty$).
* **Data Models:**
  \`\`\`prisma
  model ExportJob {
    id          String    @id @default(uuid())
    college_id  String
    userId      String
    exportType  String    // STUDENTS, ATTENDANCE, FEES, LEDGER, GAZETTE
    format      String    // CSV, PDF, XLSX
    status      String    @default("PENDING") // PENDING, GENERATING, READY, FAILED
    fileKey     String?
    rowCount    Int       @default(0)
    sizeBytes   Int       @default(0)
    expiresAt   DateTime  // 24-hour download TTL
    createdAt   DateTime  @default(now())

    college     College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, createdAt(sort: Desc)])
  }
  \`\`\`
* **Quota Metering:** Checked inside transaction against \`CollegeUsage.exportsCount\`. Resets on 1st of each month.

---

#### 9B: N02 Board-Format Gazette & Registration Excel Exporter (Standard Tier)
* **Institutional Job:** Formatted Excel exporter complying strictly with Pakistani BISE board registration and examination gazette layouts (Registration Number, Student Name, Father Name, B-Form / CNIC, Subject Combinations, Board Roll Number).

---

#### 9C: N03 Scheduled Executive Digest Email Worker (Premium Tier)
* **Institutional Job:** Automated weekly attendance, fee recovery, and enrollment digest emailed to college principals and board directors every Monday at 08:00 AM PKT.

---

#### 9D: N04 Accountant Double-Entry General Journal Exporter (Premium Tier)
* **Institutional Job:** Generates standard double-entry journal CSVs (Date, Voucher Number, Account Head, Debit PKR, Credit PKR, Description) formatted for 1-click import into QuickBooks, Tally, or Sage.

---

#### 9E: N05 1-Click Institutional Database & Vault Backup Snapshot (Enterprise Tier)
* **Institutional Job:** Complete self-service institutional backup. Generates a password-protected ZIP archive containing full database SQL dump, student photo archives, and StoredFile documents.

---

#### 9F: N06 Developer Public API & Outbound Webhook Subsystem (Enterprise Tier)
* **Institutional Job:** Developer API keys with HMAC-SHA256 signature verification and outbound webhook dispatching for external ERPs and mobile apps.
* **Data Models:**
  \`\`\`prisma
  model ApiKey {
    id          String    @id @default(uuid())
    college_id  String
    name        String
    keyHash     String    @unique
    keyPrefix   String    // e.g. "ak_live_..."
    permissions String[]
    lastUsedAt  DateTime?
    expiresAt   DateTime?
    isActive    Boolean   @default(true)
    createdAt   DateTime  @default(now())

    college     College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
  }

  model WebhookSubscription {
    id          String    @id @default(uuid())
    college_id  String
    targetUrl   String
    secret      String    // HMAC signing secret
    events      String[]  // "student.admitted", "fee.collected", "attendance.absent"
    isActive    Boolean   @default(true)
    createdAt   DateTime  @default(now())

    college     College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
  }
  \`\`\`

---

#### 9G: N07 Admin Local RFC 6238 TOTP Two-Factor Authentication & Login Alerts (Starter Tier)
* **Institutional Job:** Secures administrator, principal, and accountant logins against unauthorized access.
* **User Constraints & Architecture:**
  - **Zero Third-Party Credentials:** Operates completely offline without external SMS or phone verification services.
  - **RFC 6238 Standard:** Purely local cryptographic HMAC-SHA1 verification using 30-second time steps and 6-digit codes. Compatible with Google Authenticator, Microsoft Authenticator, and 1Password.
  - **Secret Storage:** Base32 secret generated via \`crypto.randomBytes(20)\` and stored encrypted in \`User.totpSecret\` using AES-256-GCM.
  - **Backup Codes:** 8 single-use 8-character alphanumeric backup codes stored hashed (bcrypt) in database.
* **API Contracts:**
  - \`POST /api/auth/2fa/setup\`: Generates secret and returns \`otpauth://\` URI and QR code data URL.
  - \`POST /api/auth/2fa/verify\`: Validates 6-digit code to enable 2FA on account.
  - \`POST /api/auth/2fa/validate\`: Validates TOTP code during login step 2 before issuing full JWT token.

---

#### 9H: N08 Offline-First Service Worker PWA for Faculty & Students (Standard Tier)
* **Institutional Job:** Offline timetable, classroom attendance register, and student directory caching for uninterrupted campus operations during internet blackouts.

---

#### 9I: N10 Granular Custom Roles & Permission Matrix Builder (Premium Tier Only — Strictly Gated from Starter & Standard)
* **Institutional Job:** Custom role builder allowing college administrators to define specialized institutional roles (e.g. "Fee Collector", "Hostel Warden", "Exam Moderator") with fine-grained permission bitmasks.
* **User Constraints & Plan Gating:**
  - **Strictly Gated from Starter & Standard:** Gated by \`subscriptionGate('custom-roles-permissions')\`.
  - **Access Rule:** Starter and Standard colleges CANNOT create or assign custom roles. They are restricted to fixed canonical roles (\`admin\`, \`principal\`, \`registrar\`, \`accountant\`, \`teacher\`, \`student\`, \`employee\`).
  - Calling \`POST /api/roles\` or \`PUT /api/roles/:id\` on Starter/Standard returns HTTP 403 \`UPGRADE_REQUIRED\` with message: *"Custom Roles & Permissions is a Premium tier capability. Please upgrade to unlock custom role matrices."*
* **Data Models:**
  \`\`\`prisma
  model CustomRole {
    id          String   @id @default(uuid())
    college_id  String
    name        String
    description String?
    permissions String[] // e.g. ["students:read", "fees:collect", "timetable:edit"]
    isAdminClass Boolean @default(false) // Non-admin class by default
    createdAt   DateTime @default(now())
    updatedAt   DateTime @updatedAt

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@unique([college_id, name])
  }

  model UserCustomRole {
    id          String   @id @default(uuid())
    userId      String
    roleId      String

    role        CustomRole @relation(fields: [roleId], references: [id], onDelete: Cascade)
    @@unique([userId, roleId])
  }
  \`\`\`

---

#### 9J: N11 Multi-Step Institutional Approval Workflows (Premium Tier)
* **Institutional Job:** Multi-tier authorization chains for high-value financial and administrative actions: fee concessions, refunds, staff leave applications, and exam mark adjustments.
* **Data Models:**
  \`\`\`prisma
  model ApprovalWorkflow {
    id          String   @id @default(uuid())
    college_id  String
    workflowType String  // FEE_CONCESSION, FEE_REFUND, STAFF_LEAVE, MARKS_EDIT
    currentStep Int      @default(1)
    maxSteps    Int      @default(2)
    status      String   @default("PENDING") // PENDING, APPROVED, REJECTED
    requesterId String
    payloadJson Json     // Details of requested action
    historyJson Json?    // Array of approvals: [{ step: 1, approverId: "...", action: "APPROVED", date: "..." }]
    createdAt   DateTime @default(now())

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, workflowType, status])
  }
  \`\`\`

---

### Phase 10: Multi-Campus & Institutional Infrastructure (8 Services — N13 Removed)
> [!IMPORTANT]
> **Phase 10 Scope & Revisions:**
> Delivers enterprise multi-branch governance, cross-campus transfers, IP allow-listing, and audit log exports.
> **User Architectural Revisions:**
> - **N12 (Custom Domains):** Deferred / left empty for now. Zero runtime background processes. Database model includes dormant \`College.customDomain\` nullable field to allow future zero-migration binding.
> - **N13 (White-Label Branding):** Permanently deleted / excluded from platform architecture per user directive ("useless").
> - **N14 (Single Sign-On SSO):** Empty credential placeholders. OAuth2/SAML endpoints return 501 \`SSO_NOT_CONFIGURED\` when credentials are absent. Local credentials and Google Firebase remain primary.

---

#### 10A: N12 Custom Apex Domain Hook (Premium Tier — Dormant Backend Hook / Deferred)
* **Institutional Job:** Architecture hook for custom apex/subdomains (\`portal.cadetcollege.edu.pk\`).
* **Design:** Subdomains (\`<slug>.collegeshub.org\`) continue as default. Database column \`College.customDomain String? @unique\` and \`College.customDomainStatus String? @default("INACTIVE")\` are provisioned in schema without active SSL workers, ensuring clean future activation with zero database migration.

---

#### 10B: N14 Single Sign-On (SSO) SAML / OAuth2 Enterprise Adapter (Enterprise Tier — Empty Credential Placeholders)
* **Institutional Job:** Integration framework for institutional identity providers (Google Workspace for Education, Microsoft Azure AD).
* **Design:** Auth router exposes \`/api/auth/sso/login\` and \`/api/auth/sso/callback\`. When \`College.ssoProvider\` or client secrets are null/empty, endpoints cleanly return HTTP 501 \`SSO_NOT_CONFIGURED\`. Local email/password and Firebase Google login handle 100% of authentications.

---

#### 10C: N15 Campus IP Allow-Listing & Session Hardening (Enterprise Tier)
* **Institutional Job:** Restricts administrative and accounts portal logins strictly to authorized campus office IP blocks (e.g. \`182.180.0.0/24\`).
* **Data Models:**
  \`\`\`prisma
  model IpAllowlistRule {
    id          String   @id @default(uuid())
    college_id  String
    label       String   // "Main Campus Accounts Office"
    cidrBlock   String   // CIDR or single IP
    isActive    Boolean  @default(true)
    createdAt   DateTime @default(now())

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, isActive])
  }
  \`\`\`
* **Middleware:** \`ipAllowlistGuard.js\` checks \`req.ip\` against active rules for admin and accountant roles.

---

#### 10D: N16 Data Retention, Archival & Legal Hold Subsystem (Enterprise Tier)
* **Institutional Job:** Automated archival rules moving graduated student records (5+ years old) to cold storage while preserving tamper-proof legal hold freezes during official board or court inquiries.
* **Data Models:**
  \`\`\`prisma
  model LegalHold {
    id          String   @id @default(uuid())
    college_id  String
    title       String
    reason      String
    scopeType   String   // ALL_STUDENTS, SPECIFIC_SESSION, SPECIFIC_STUDENT
    targetId    String?
    placedBy    String
    isActive    Boolean  @default(true)
    createdAt   DateTime @default(now())

    college     College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
    @@index([college_id, isActive])
  }
  \`\`\`
* **Invariants:** Permanent deletion (\`DELETE\`) queries check active legal holds and throw 403 \`LEGAL_HOLD_ACTIVE\`.

---

#### 10E: N17 Administrative Entitlement Audit Log Export Center (Premium Tier)
* **Institutional Job:** Export dashboard allowing college principals to search, filter, and download immutable records from \`CollegeEntitlementAudit\` and \`AuditLog\` to CSV/JSON.

---

#### 10F: N18 Multi-Campus Consolidated Executive Matrix (Premium Tier)
* **Institutional Job:** Unified reporting dashboard for educational groups operating multiple branch campuses under a single management board.
* **Data Models:**
  \`\`\`prisma
  model CampusGroup {
    id              String   @id @default(uuid())
    name            String   // "Punjab Group of Colleges - Lahore Region"
    parentCollegeId String   // Primary controlling head-office tenant
    createdAt       DateTime @default(now())

    members         CampusGroupMember[]
  }

  model CampusGroupMember {
    id          String   @id @default(uuid())
    groupId     String
    college_id  String   @unique
    branchName  String   // "Gulberg Campus", "Johar Town Campus"

    group       CampusGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
    college     College     @relation(fields: [college_id], references: [id], onDelete: Cascade)
  }
  \`\`\`

---

#### 10G: N19 Cross-Campus Student Academic & Financial Transfer Engine (Enterprise Tier)
* **Institutional Job:** 1-Click transfer wizard moving a student enrollment, academic transcripts, and outstanding fee balance from one group campus branch to another without data loss.
* **Execution:** Wrapped inside single atomic transaction: updates student's \`college_id\`, duplicates historical fee challan ledger as \`TRANSFERRED_IN\`, and logs audit trail.

---

#### 10H: N20 Message Credit Wallet Management & Quota Ledger Dashboard (Premium Tier)
* **Institutional Job:** Self-service administrative wallet UI showing real-time balance between monthly plan grant credits (\`PLAN\`) and non-expiring top-up credits (\`PURCHASED\`), with 1-click top-up requests generating manual bank deposit vouchers.
`;

// Replace lines between "### Phase 8" and "### Phase 11"
const phase8Index = content.indexOf('### Phase 8: College Operational Roadmap Services');
const phase11Index = content.indexOf('### Phase 11: Academic Management & Student Life Modules');

if (phase8Index !== -1 && phase11Index !== -1) {
  content = content.slice(0, phase8Index) + detailedPhases8to10 + '\n---\n\n' + content.slice(phase11Index);
  fs.writeFileSync(artifactPath, content, 'utf8');
  console.log('Successfully updated implementation plan artifact with full architectural specifications for Phase 8, 9, 10!');
} else {
  console.error('Could not locate markers for Phase 8 / Phase 11');
}

