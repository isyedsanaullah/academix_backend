/**
 * Academix master catalog v2: services, features, capabilities (with Plan B methods).
 *
 * Feature fields
 *   key        flag key (also names routes, sidebar item, quota, plan row)
 *   svc        parent service id
 *   name       display name
 *   plan       lowest plan that includes it: starter | standard | premium | enterprise
 *   addon      true = sold separately even when the plan level is reached
 *   effort     Low (<3 days) | Medium (1-2 weeks) | High (3+ weeks) | Done (already built)
 *   status     live | partial | planned
 *   groups     requiresGroups: college must offer one of these groups, else the feature stays hidden
 *   hard       hard dependencies: feature cannot work without them (blocked when off)
 *   needs      capabilities this feature cannot work without (any one working method is enough; none = blocked)
 *   uses       capabilities the feature calls but can live without (never blocks it)
 *   core       cannot be turned off
 *
 * Capability fields
 *   methods    ordered list, first available wins. A method is available when ALL its
 *              `requires` features are effectively ON. Manual methods require only core
 *              or base features, so a capability always has a Plan B.
 *   noFallback true = if no method is available the capability is DOWN and every feature
 *              that needs it is blocked (used only where no manual route makes sense).
 */

const PLAN_ORDER = ['starter', 'standard', 'premium', 'enterprise'];

const SERVICES = [
  { id: 'srv-academic', name: 'Academic & SIS Core' },
  { id: 'srv-college', name: 'Intermediate College Setup (groups, sessions)' },
  { id: 'srv-board', name: 'Board Registration & Exams' },
  { id: 'srv-exams', name: 'Send-up & Internal Exams' },
  { id: 'srv-practicals', name: 'Practicals & Labs' },
  { id: 'srv-entrytest', name: 'Entry-test Preparation' },
  { id: 'srv-admissions', name: 'Admissions' },
  { id: 'srv-lms', name: 'Learning Management' },
  { id: 'srv-erp', name: 'Finance, HR & Operations' },
  { id: 'srv-security', name: 'Campus Gate & Access' },
  { id: 'srv-comms', name: 'Parents & Communication' },
  { id: 'srv-guidance', name: 'Student Guidance' },
  { id: 'srv-ai', name: 'AI Education Suite' },
  { id: 'srv-intelligence', name: 'Analytics & Dashboards' },
  { id: 'srv-governance', name: 'Storage, Audit & Governance' },
  { id: 'srv-documents', name: 'Documents, Branding & Verification' },
];

// helper: F(key, svc, name, plan, effort, status, opts)
const F = (key, svc, name, plan, effort, status, o = {}) => ({
  key, svc, name, plan, effort, status,
  addon: !!o.addon, groups: o.groups || [], hard: o.hard || [], needs: o.needs || [], uses: o.uses || [], core: !!o.core,
});
const SCI = ['pre-medical', 'pre-engineering', 'ics', 'fsc-general'];

const FEATURES = [
  // ---- Academic core (live)
  F('core-academic', 'srv-academic', 'Sessions, classes, groups, sections', 'starter', 'Done', 'live', { core: true }),
  F('students', 'srv-academic', 'Student records and enrollment', 'starter', 'Done', 'live', { core: true, hard: ['core-academic'] }),
  F('attendance', 'srv-academic', 'Daily attendance (manual register)', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('timetable', 'srv-academic', 'Section timetable', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('universal-timetable', 'srv-academic', 'Universal master timetable', 'standard', 'Medium', 'partial', { hard: ['timetable'] }),
  F('exams-results', 'srv-academic', 'Exams, roll slips, result cards', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('teacher-evaluation', 'srv-academic', 'Teacher evaluation surveys', 'premium', 'Done', 'live', { hard: ['students'] }),
  F('certificates', 'srv-academic', 'Certificates with serial number (character, hope, migration, bonafide)', 'standard', 'Done', 'live', { hard: ['students'] }),
  F('id-cards', 'srv-academic', 'ID card printing with QR (QR is also shown on the student dashboard)', 'standard', 'Done', 'live', { hard: ['students'] }),
  F('qr-verify', 'srv-academic', 'QR and public verification of certificates and result cards (QR and public route do not exist yet)', 'standard', 'Done', 'live', { hard: ['certificates', 'doc-templates'] }),
  F('attendance-qr', 'srv-academic', 'Daily attendance marked automatically by the gate QR scan', 'standard', 'Done', 'live', { hard: ['attendance', 'gate-scanner'] }),
  F('attendance-biometric', 'srv-academic', 'Biometric device sync (ZKTeco and similar)', 'standard', 'Medium', 'planned', { hard: ['attendance'] }),
  F('faculty-attendance', 'srv-academic', 'Teacher and staff attendance', 'standard', 'Medium', 'planned', { hard: ['employees'] }),
  F('attendance-shortage', 'srv-academic', 'Attendance shortage warnings', 'standard', 'Low', 'planned', { hard: ['attendance'] }),
  F('bulk-import', 'srv-academic', 'Excel/CSV import with validation', 'starter', 'Medium', 'planned', { hard: ['students'] }),
  F('announcements', 'srv-comms', 'Announcements and in-app notifications', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('notice-board', 'srv-academic', 'Student diary and events calendar', 'starter', 'Low', 'planned', { hard: ['core-academic'] }),

  // ---- 1. Groups and subject combinations
  F('groups-subjects', 'srv-college', 'Group setup and subject combinations per group', 'starter', 'Medium', 'partial', { core: true, hard: ['core-academic'] }),
  F('combined-classes', 'srv-college', 'Combined classes (English, Urdu, Islamiat)', 'starter', 'Medium', 'planned', { hard: ['groups-subjects', 'timetable'] }),
  F('group-fee-seats', 'srv-college', 'Group-wise fee, seats and sections', 'starter', 'Low', 'planned', { hard: ['groups-subjects', 'fees-basic'] }),
  F('group-transfer', 'srv-college', 'Move student between groups in first weeks', 'starter', 'Low', 'planned', { hard: ['groups-subjects', 'students'] }),
  F('session-batches', 'srv-college', 'Two-year batches (2026-28) and 1st to 2nd year promotion', 'starter', 'Medium', 'planned', { hard: ['core-academic'] }),

  // ---- 2. Board registration and exams
  F('board-registration', 'srv-board', '1st-year board registration forms and fee collection', 'standard', 'Medium', 'planned', { hard: ['students', 'groups-subjects'], uses: ['fee.collect'] }),
  F('board-exam-forms', 'srv-board', '2nd-year annual exam admission forms', 'standard', 'Medium', 'planned', { hard: ['board-registration'] }),
  F('board-candidates', 'srv-board', 'Private, improvement and compartment candidates', 'standard', 'Medium', 'planned', { hard: ['board-exam-forms'] }),
  F('board-slips', 'srv-board', 'Board roll number slips, datesheet, centre details', 'standard', 'Low', 'planned', { hard: ['board-exam-forms'] }),
  F('board-results', 'srv-board', 'Board result record and gazette entry', 'standard', 'Medium', 'planned', { hard: ['students'], uses: ['board.result.load'] }),
  F('board-result-import', 'srv-board', 'Board result file import', 'standard', 'Medium', 'planned', { hard: ['board-results'] }),
  F('board-result-analysis', 'srv-board', 'Pass %, A+ count, positions by group/subject/teacher', 'standard', 'Medium', 'planned', { needs: ['board.result.load'] }),
  F('board-attendance-check', 'srv-board', 'Minimum attendance check before forms', 'standard', 'Low', 'planned', { hard: ['board-exam-forms', 'attendance'] }),

  // ---- 3. Send-up and internal exams
  F('internal-tests', 'srv-exams', 'Monthly, chapter-wise, mid-term tests', 'starter', 'Low', 'partial', { hard: ['exams-results'] }),
  F('send-up-exams', 'srv-exams', 'Send-up (pre-board) exams', 'standard', 'Low', 'planned', { hard: ['internal-tests'] }),
  F('eligibility-lists', 'srv-exams', 'Eligibility and defaulter lists (attendance + results)', 'standard', 'Medium', 'planned', { hard: ['send-up-exams'] }),
  F('weak-student-lists', 'srv-exams', 'Weak-student lists per subject', 'standard', 'Low', 'planned', { hard: ['internal-tests'] }),
  F('result-comparison', 'srv-exams', 'Subject and teacher result comparison', 'standard', 'Medium', 'planned', { hard: ['internal-tests'] }),

  // ---- 4. Practicals (science groups only)
  F('practicals', 'srv-practicals', 'Practical timetable and marks entry', 'standard', 'Medium', 'partial', { groups: SCI, hard: ['timetable', 'exams-results'] }),
  F('lab-journals', 'srv-practicals', 'Lab journals and lab attendance', 'standard', 'Low', 'planned', { groups: SCI, hard: ['practicals'] }),
  F('lab-stock', 'srv-practicals', 'Lab apparatus and chemicals stock', 'premium', 'Medium', 'planned', { groups: SCI, hard: ['practicals'] }),
  F('board-practicals', 'srv-practicals', 'Board practical exam arrangements, examiner records', 'standard', 'Medium', 'planned', { groups: SCI, hard: ['practicals', 'board-exam-forms'] }),

  // ---- 5. Entry-test preparation
  F('mcq-bank', 'srv-entrytest', 'Chapter-wise MCQ bank (MDCAT/engineering tags)', 'premium', 'Medium', 'planned', { addon: true, groups: ['pre-medical', 'pre-engineering'], hard: ['quizzes'] }),
  F('mock-tests', 'srv-entrytest', 'Mock test series with ranking', 'premium', 'Medium', 'planned', { addon: true, groups: ['pre-medical', 'pre-engineering'], hard: ['mcq-bank'], uses: ['mock.mark'] }),
  F('omr-scan', 'srv-entrytest', 'OMR sheet scanning', 'premium', 'High', 'planned', { addon: true, groups: ['pre-medical', 'pre-engineering'], hard: ['mock-tests'] }),
  F('aggregate-calc', 'srv-entrytest', 'Aggregate calculator (matric, FSc, entry test)', 'premium', 'Low', 'planned', { addon: true, groups: ['pre-medical', 'pre-engineering'], hard: ['students'] }),
  F('entry-reg-tracking', 'srv-entrytest', 'Entry-test and university application tracking', 'premium', 'Low', 'planned', { addon: true, groups: ['pre-medical', 'pre-engineering'], hard: ['students'] }),

  // ---- 6. Admissions
  F('admissions', 'srv-admissions', 'Admissions: review, merit lists, desk entry', 'standard', 'Done', 'live', { hard: ['core-academic'], uses: ['applicant.intake'] }),
  F('admissions-online', 'srv-admissions', 'Public apply portal (300 applications on Standard)', 'standard', 'Done', 'live', { hard: ['admissions'] }),
  F('admission-matric-capture', 'srv-admissions', 'Matric result, board, roll number at admission (Application ssc fields)', 'starter', 'Done', 'live', { hard: ['students'], uses: ['doc.extract'] }),
  F('equivalence', 'srv-admissions', 'Equivalence for O-level and other boards', 'standard', 'Medium', 'planned', { hard: ['admission-matric-capture'] }),
  F('merit-scholarship-tiers', 'srv-admissions', 'Merit lists by group, scholarship tiers by matric marks', 'standard', 'Medium', 'planned', { hard: ['admissions', 'groups-subjects'] }),
  F('quotas', 'srv-admissions', 'Quotas: Hafiz-e-Quran, sports, sibling, staff, orphan', 'standard', 'Medium', 'planned', { hard: ['admissions'] }),
  F('enquiry-leads', 'srv-admissions', 'Enquiry and lead tracking, admission test scheduling', 'standard', 'Medium', 'planned', { hard: ['admissions'] }),

  // ---- Finance, HR, operations
  F('fees-basic', 'srv-erp', 'Fee templates and cash vouchers', 'starter', 'Done', 'live', { hard: ['students'] }),
  F('bank-challans', 'srv-erp', '3-copy bank challans', 'standard', 'Done', 'live', { hard: ['fees-basic'] }),
  F('defaulters-dues', 'srv-erp', 'Defaulters and dues ledger', 'standard', 'Done', 'live', { hard: ['fees-basic'], uses: ['parent.notify'] }),
  F('treasury-ledger', 'srv-erp', 'Treasury and expense ledger', 'standard', 'Done', 'live', { hard: ['fees-basic'] }),
  F('fines', 'srv-erp', 'Disciplinary fines', 'standard', 'Done', 'live', { hard: ['fees-basic'], needs: ['student.identify'] }),
  F('fee-college-types', 'srv-erp', 'Admission, annual, lab, board, security fees per group; installments; late fees', 'standard', 'Medium', 'partial', { hard: ['fees-basic', 'groups-subjects'] }),
  F('fee-discounts', 'srv-erp', 'Merit/need discounts from quota rules', 'standard', 'Medium', 'partial', { hard: ['fee-college-types', 'quotas'] }),
  F('fee-refunds', 'srv-erp', 'Refunds when a student leaves in first weeks', 'standard', 'Low', 'planned', { hard: ['fees-basic'] }),
  F('fees-online-payments', 'srv-erp', 'Online fee payment (JazzCash, Easypaisa, 1Link, Raast)', 'standard', 'High', 'planned', { hard: ['fees-basic'] }),
  F('fee-board-alert', 'srv-erp', 'Fee alert to parents before board form deadline', 'standard', 'Low', 'planned', { hard: ['board-registration', 'fees-basic'], uses: ['parent.notify'] }),
  F('employees', 'srv-erp', 'Staff accounts and leaves', 'standard', 'Done', 'live'),
  F('payroll', 'srv-erp', 'Payroll and pay slips', 'standard', 'Done', 'live', { hard: ['employees'] }),
  F('canteen', 'srv-erp', 'Canteen POS (backend only; no counter screen yet)', 'premium', 'Medium', 'partial', { hard: ['students'], needs: ['student.identify'] }),

  // ---- Security
  F('gate-scanner', 'srv-security', 'Campus gate QR scanner', 'standard', 'Done', 'live', { hard: ['students'] }),
  F('gate-manual-log', 'srv-security', 'Gate log by roll number or name (no scanner)', 'starter', 'Low', 'planned', { hard: ['students'] }),
  F('early-exit', 'srv-security', 'Digital early exit pass', 'standard', 'Done', 'live', { hard: ['students'], needs: ['gate.log', 'student.identify'] }),
  F('visitors', 'srv-security', 'Visitor management', 'standard', 'Done', 'live'),

  // ---- Communication
  F('parent-portal', 'srv-comms', 'Parent portal (attendance, marks, fee status)', 'standard', 'Medium', 'planned', { hard: ['students'] }),
  F('sms-alerts', 'srv-comms', 'SMS alerts (prepaid credits)', 'standard', 'Medium', 'planned', { addon: true, hard: ['students'] }),
  F('whatsapp-alerts', 'srv-comms', 'WhatsApp alerts (prepaid credits)', 'standard', 'Medium', 'planned', { addon: true, hard: ['students'] }),
  F('absence-alerts', 'srv-comms', 'Absence alerts to parents', 'standard', 'Low', 'planned', { hard: ['attendance'], uses: ['parent.notify'] }),
  F('ptm', 'srv-comms', 'Parent-teacher meetings after each test', 'standard', 'Low', 'planned', { hard: ['internal-tests'], uses: ['parent.notify'] }),
  F('circulars', 'srv-comms', 'Circulars and exam notices (announcement templates)', 'starter', 'Low', 'partial', { hard: ['announcements'], uses: ['parent.notify'] }),

  // ---- Guidance
  F('career-counselling', 'srv-guidance', 'Career counselling after FSc', 'premium', 'Low', 'planned', { hard: ['students'] }),
  F('scholarship-tracking', 'srv-guidance', 'Scholarship tracking (government, endowment)', 'premium', 'Low', 'planned', { hard: ['students'] }),
  F('feedback-box', 'srv-guidance', 'Student feedback and complaint box', 'standard', 'Low', 'planned', { hard: ['students'] }),

  // ---- LMS
  F('assignments', 'srv-lms', 'Assignments and submissions', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('quizzes', 'srv-lms', 'Online quizzes and question bank', 'standard', 'Done', 'live', { hard: ['core-academic'] }),

  // ---- AI
  F('ai-chat', 'srv-ai', 'AI tutor chat', 'enterprise', 'Done', 'live'),
  F('ai-pdf-chat', 'srv-ai', 'PDF knowledge library', 'enterprise', 'Done', 'live', { hard: ['ai-chat'] }),
  F('ai-assessment-gen', 'srv-ai', 'AI quiz, paper, MCQ generator', 'enterprise', 'Done', 'live', { hard: ['ai-chat'] }),
  F('ai-pedagogy-gen', 'srv-ai', 'AI notes, assignment, syllabus', 'enterprise', 'Low', 'partial', { hard: ['ai-chat'] }),
  F('ai-board-mcq', 'srv-ai', 'MCQs generated from board syllabus', 'enterprise', 'Medium', 'planned', { hard: ['ai-assessment-gen'] }),
  F('ai-weak-topic', 'srv-ai', 'Weak-topic detection from test results', 'enterprise', 'Medium', 'planned', { hard: ['ai-chat', 'internal-tests'] }),
  F('ai-study-plan', 'srv-ai', 'Study plan suggestions per student', 'enterprise', 'Medium', 'planned', { hard: ['ai-weak-topic'] }),
  F('ai-ocr-docs', 'srv-ai', 'Document OCR to pre-fill admission forms', 'enterprise', 'Medium', 'planned', { hard: ['admission-matric-capture'] }),
  F('ai-whatsapp-bot', 'srv-ai', 'WhatsApp admissions chatbot', 'enterprise', 'High', 'planned', { hard: ['ai-chat', 'whatsapp-alerts', 'enquiry-leads'] }),
  F('ai-urdu-translate', 'srv-ai', 'English to Urdu translation of notices', 'enterprise', 'Low', 'planned', { hard: ['ai-chat'] }),
  F('ai-at-risk', 'srv-ai', 'AI at-risk student alerts', 'enterprise', 'Medium', 'planned', { hard: ['ai-chat'] }),


  // ---- Round 2: documents, branding, verification, payment proof, timetable
  F('college-branding', 'srv-documents', 'College logo, stamp, letterhead details and signature upload (admin, principal, accountant)', 'starter', 'Done', 'live', { hard: ['core-academic'] }),
  F('student-photo', 'srv-documents', 'Student profile photo uploaded by admin, resized, shown on ID card and records', 'starter', 'Done', 'live', { hard: ['students'] }),
  F('doc-templates', 'srv-documents', 'Branded PDF templates: certificate, fee voucher, paid receipt, student card (downloadable)', 'standard', 'Done', 'live', { hard: ['college-branding', 'students'] }),
  F('paid-receipt', 'srv-documents', 'Verified paid voucher with paid stamp, signature and QR', 'standard', 'Done', 'live', { hard: ['fees-basic', 'doc-templates'] }),
  F('voucher-verify', 'srv-documents', 'Public verification page for fee vouchers and paid receipts', 'standard', 'Done', 'live', { hard: ['paid-receipt'] }),
  F('student-reports', 'srv-documents', 'Per-student report (attendance, results, fees, fines) generated on demand as PDF', 'standard', 'Done', 'live', { hard: ['students', 'analytics-reports'] }),
  F('payment-proof', 'srv-erp', 'Student uploads EasyPaisa/JazzCash/bank screenshot; accountant verifies; duplicate transaction ids blocked', 'standard', 'Done', 'live', { hard: ['fees-basic'] }),
  F('ai-payment-ocr', 'srv-ai', 'Read transaction id and amount from payment screenshots', 'enterprise', 'Medium', 'planned', { addon: true, hard: ['payment-proof', 'ai-chat'] }),
  F('teacher-subjects', 'srv-academic', 'Teacher with several subjects, classes and groups', 'starter', 'Done', 'live', { hard: ['timetable'] }),
  F('student-timetable', 'srv-academic', 'Student sees own section timetable', 'starter', 'Done', 'live', { hard: ['timetable'] }),
  F('teacher-today', 'srv-academic', 'Teacher dashboard: current and next class, large, from the timetable', 'starter', 'Done', 'live', { hard: ['timetable', 'teacher-subjects'] }),
  F('substitutions', 'srv-academic', 'Teacher absent: admin reassigns each period to a different free teacher', 'standard', 'Done', 'live', { hard: ['timetable', 'teacher-subjects'] }),
  F('timetable-generator', 'srv-academic', 'Automatic conflict-free timetable from teacher, subject and room limits (no AI cost)', 'premium', 'Done', 'live', { hard: ['timetable', 'teacher-subjects'] }),
  F('ai-timetable-assist', 'srv-ai', 'AI explains conflicts and suggests fixes for the timetable', 'enterprise', 'Done', 'live', { hard: ['timetable-generator', 'ai-chat'] }),
  F('role-themes', 'srv-governance', 'Colour theme per role panel (accountant, registrar, principal, teacher ...)', 'starter', 'Done', 'live', { core: true }),
  F('media-optimization', 'srv-governance', 'Image resize and compression, thumbnails, on-demand PDFs, cleanup (lower storage cost)', 'starter', 'Done', 'live', { core: true }),

  // ---- Intelligence and governance
  F('analytics-reports', 'srv-intelligence', 'Report center (PDF)', 'standard', 'Done', 'live'),
  F('principal-dashboard', 'srv-intelligence', 'Principal/owner dashboard (fee recovery, seats, board history)', 'standard', 'Medium', 'planned', { hard: ['analytics-reports'] }),
  F('file-vault', 'srv-governance', 'File vault and storage quota', 'starter', 'Low', 'partial', { core: true }),
  F('audit-logs', 'srv-governance', 'Audit trail', 'starter', 'Done', 'live', { core: true }),
  F('trash', 'srv-governance', 'Recycle bin', 'starter', 'Done', 'live', { core: true }),
];

/**
 * Capabilities with Plan B. Methods are tried in order; first with all `requires` ON wins.
 * The last method of each capability is the manual route and requires only base features.
 */
const CAPABILITIES = [
  { key: 'student.identify', name: 'Find a student at a desk, gate or counter',
    methods: [
      { id: 'qr', label: 'Scan the student QR (card or phone) through the gate lookup', requires: ['gate-scanner'] },
      { id: 'search', label: 'Type roll number, CNIC or name', requires: ['students'] },
    ] },
  { key: 'attendance.mark', name: 'Record attendance',
    methods: [
      { id: 'biometric', label: 'Biometric device sync', requires: ['attendance-biometric'] },
      { id: 'qr', label: 'Gate QR scan marks the day present', requires: ['attendance-qr'] },
      { id: 'manual', label: 'Teacher marks the register', requires: ['attendance'] },
    ] },
  { key: 'gate.log', name: 'Log campus entry and exit',
    methods: [
      { id: 'qr', label: 'Guard scans QR', requires: ['gate-scanner'] },
      { id: 'manual', label: 'Guard types roll number or name', requires: ['gate-manual-log'] },
    ] },
  { key: 'doc.verify', name: 'Verify a certificate or result card at the office',
    methods: [
      { id: 'qr', label: 'Scan QR on the document (planned)', requires: ['qr-verify'] },
      { id: 'serial', label: 'Enter certificate number, or roll number plus exam', requires: ['students'] },
    ] },
  { key: 'fee.collect', name: 'Collect a fee',
    methods: [
      { id: 'gateway', label: 'Online payment, auto-marked paid', requires: ['fees-online-payments'] },
      { id: 'proof', label: 'Student uploads payment screenshot, accountant verifies', requires: ['payment-proof'] },
      { id: 'challan', label: 'Bank challan, accountant marks paid', requires: ['bank-challans'] },
      { id: 'cash', label: 'Cash voucher at counter', requires: ['fees-basic'] },
    ] },
  { key: 'parent.notify', name: 'Tell parents something',
    methods: [
      { id: 'whatsapp', label: 'WhatsApp message', requires: ['whatsapp-alerts'] },
      { id: 'sms', label: 'SMS', requires: ['sms-alerts'] },
      { id: 'portal', label: 'Parent portal notice', requires: ['parent-portal'] },
      { id: 'inapp', label: 'In-app notice to the student account', requires: ['announcements'] },
      { id: 'print', label: 'Printed list or slip handed to student', requires: ['students'] },
    ] },
  { key: 'applicant.intake', name: 'Receive an admission application',
    methods: [
      { id: 'online', label: 'Public apply portal', requires: ['admissions-online'] },
      { id: 'desk', label: 'Registrar enters the form by hand', requires: ['core-academic'] },
    ] },
  { key: 'doc.extract', name: 'Read matric details from uploaded documents',
    methods: [
      { id: 'ocr', label: 'OCR pre-fill', requires: ['ai-ocr-docs'] },
      { id: 'manual', label: 'Type the details', requires: ['students'] },
    ] },
  { key: 'mock.mark', name: 'Mark a mock test',
    methods: [
      { id: 'omr', label: 'Scan OMR sheets', requires: ['omr-scan'] },
      { id: 'manual', label: 'Enter marks or answer key by hand', requires: ['mock-tests'] },
    ] },
  { key: 'board.result.load', name: 'Load board results',
    methods: [
      { id: 'import', label: 'Import board file', requires: ['board-result-import'] },
      { id: 'manual', label: 'Enter results by hand', requires: ['board-results'] },
    ] },
];


/**
 * Mapping from today's keys (config/featureRegistry.js, config/planConstants.js, College.subscription.featureOverrides)
 * to the keys in this catalog. An old override applies to every key in its list.
 * Keys with no entry (fines, id-cards, student/class/section/subject routes) were never gated; they follow the plan.
 */
const LEGACY_KEY_MAP = {
  'core-academic': ['core-academic'],
  'attendance': ['attendance'],
  'timetable': ['timetable'],
  'exams-results': ['exams-results'],
  'assignments-quizzes': ['assignments', 'quizzes'],
  'certificates': ['certificates'],
  'announcements': ['announcements'],
  'fees': ['fees-basic', 'bank-challans', 'defaulters-dues', 'treasury-ledger'],
  'employees': ['employees', 'payroll'],
  'canteen': ['canteen'],
  'analytics-reports': ['analytics-reports'],
  'entry-system': ['gate-scanner', 'early-exit'],
  'visitors': ['visitors'],
  'ai-chat': ['ai-chat'],
  'ai-pdf-chat': ['ai-pdf-chat'],
  'ai-generators': ['ai-assessment-gen', 'ai-pedagogy-gen'],
};

/** Plan names in today's code: basic | standard | premium (enterprise is mapped to premium there). */
const PLAN_ALIASES = { basic: 'starter', starter: 'starter', standard: 'standard', premium: 'premium', enterprise: 'enterprise' };

/** Group names as typed in Group.name, Student.group, Subject.group, College.settings.programs -> catalog group keys. */
const GROUP_ALIASES = {
  'pre-medical': 'pre-medical', 'premedical': 'pre-medical', 'pre medical': 'pre-medical', 'fsc pre-medical': 'pre-medical',
  'pre-engineering': 'pre-engineering', 'preengineering': 'pre-engineering', 'pre engineering': 'pre-engineering', 'fsc pre-engineering': 'pre-engineering',
  'computer science': 'ics', 'ics': 'ics', 'i.c.s': 'ics',
  'fsc general': 'fsc-general', 'general science': 'fsc-general', 'fsc': 'fsc-general',
  'fa': 'fa', 'f.a': 'fa', 'arts': 'fa', 'humanities': 'fa',
  'i.com': 'i-com', 'icom': 'i-com', 'i com': 'i-com', 'commerce': 'i-com',
};

module.exports = { PLAN_ORDER, SERVICES, FEATURES, CAPABILITIES, LEGACY_KEY_MAP, PLAN_ALIASES, GROUP_ALIASES };
