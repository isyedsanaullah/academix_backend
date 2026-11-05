const { PLAN_LEVEL, normalizePlanId } = require('./planConstants');

/**
 * Academix Master Canonical Feature Registry
 * Platform catalog of all 162 configurable services across 10 functional categories.
 * Tiers: Starter (33) -> Standard (88) -> Premium (141) -> Enterprise (162).
 * Status: 86 Live Today + 76 Roadmap (Phases 7-13).
 */

const CATEGORIES = [
  'Academic Core',
  'Admissions & Board',
  'Fees & Treasury',
  'Gate & Security',
  'HR & Staff',
  'Parents & Comms',
  'Examination & Test Prep',
  'Operations',
  'Governance & Infrastructure',
  'AI & Intelligence Suite'
];

const FEATURE_REGISTRY = [
  // -------------------------------------------------------------
  // STARTER TIER (33 Services: 26 Live + 7 Coming Soon)
  // -------------------------------------------------------------
  {
    id: '#1',
    key: 'sessions-classes-groups',
    name: 'Sessions, classes, groups and sections',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: true,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['core-academic'],
    description: 'Academic year setup, class definitions (1st year, 2nd year), study groups (Pre-Medical, Pre-Engineering, ICS, I.Com, Arts) and multi-section division.',
    institutionBenefit: 'Forms the foundational structural spine for all student allocations, schedules, and academic reporting.',
    tierLevels: { starter: 'Full configuration', standard: 'Full configuration', premium: 'Full configuration', enterprise: 'Full configuration' }
  },
  {
    id: '#2',
    key: 'student-records',
    name: 'Student records and enrollment',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: true,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Master student profiles containing demographic, academic, guardian, emergency contact, and enrollment status records.',
    institutionBenefit: 'Centralizes student data across years, eliminating duplicate paper records and identity mix-ups.',
    tierLevels: { starter: 'Up to 300 students', standard: 'Up to 750 students', premium: 'Up to 1,500 students', enterprise: 'Up to 3,000 students' }
  },
  {
    id: '#3',
    key: 'daily-attendance',
    name: 'Daily attendance (manual register)',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: true,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['attendance'],
    description: 'Teacher and admin interface for marking section-wise daily student attendance (Present, Absent, Leave, Late).',
    institutionBenefit: 'Instantly tracks student presence and provides the audit baseline for board examination eligibility.',
    tierLevels: { starter: 'Single campus manual register', standard: 'Automated via QR & biometrics', premium: 'Multi-campus parent alerts', enterprise: 'Enterprise-wide sync' }
  },
  {
    id: '#4',
    key: 'section-timetable',
    name: 'Section timetable',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: ['timetable'],
    description: 'Grid schedule per section mapping daily periods to specific subjects, teachers, and classrooms.',
    institutionBenefit: 'Ensures structured daily class routines and prevents teacher double-booking at the section level.',
    tierLevels: { starter: 'Section-wise timetable grids', standard: 'Staff conflict checks', premium: 'Master universal grid (#78)', enterprise: 'AI conflict auto-fixer (#102)' }
  },
  {
    id: '#5',
    key: 'exams-roll-slips-results',
    name: 'Exams, roll slips and result cards',
    category: 'Examination & Test Prep',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['exams-results'],
    description: 'Term exam creation, automated roll number slip generation with seat numbers, marks entry, and printable result cards.',
    institutionBenefit: 'Standardizes internal institutional testing and professionalizes student progress reports for parents.',
    tierLevels: { starter: 'Standard PDF result cards', standard: 'Board exam workflows (#34-#42)', premium: 'OMR scanning & analytics (#92)', enterprise: 'AI auto-marking (#50)' }
  },
  {
    id: '#6',
    key: 'announcements',
    name: 'Announcements and in-app notifications',
    category: 'Parents & Comms',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['announcements'],
    description: 'Broadcast notice board for campus-wide alerts, holidays, urgent notices, and role-targeted notifications.',
    institutionBenefit: 'Keeps staff, students, and administration aligned on schedules, deadlines, and emergency notices.',
    tierLevels: { starter: 'In-app broadcasts', standard: 'Scheduled & Urdu circulars (N21)', premium: 'SMS & WhatsApp broadcasts (#84/#85)', enterprise: 'Autonomous AI notices (N48)' }
  },
  {
    id: '#7',
    key: 'group-subject-combinations',
    name: 'Group setup and subject combinations per group',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Configuration of mandatory and elective subject packages corresponding to Intermediate board specializations.',
    institutionBenefit: 'Enforces correct subject combinations matching BISE curriculum guidelines across all disciplines.',
    tierLevels: { starter: 'Standard intermediate combinations', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#8',
    key: 'combined-classes',
    name: 'Combined classes (English, Urdu, Islamiat)',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Grouping multiple sections together in large lecture halls for shared compulsory subjects like English, Urdu, and Islamic Studies.',
    institutionBenefit: 'Optimizes faculty utilization and room scheduling for compulsory subjects without duplicating lectures.',
    tierLevels: { starter: 'Standard combined lectures', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#9',
    key: 'group-transfers',
    name: 'Move students between groups in the first weeks',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Safe workflow for migrating students between study groups (e.g., Pre-Medical to ICS) during initial admission adjustment periods.',
    institutionBenefit: 'Maintains historical attendance and fee continuity while recalculating subject allocations cleanly.',
    tierLevels: { starter: 'Within single campus', standard: 'Within single campus', premium: 'Cross-campus transfer audits', enterprise: 'Automated multi-campus transfers (N19)' }
  },
  {
    id: '#10',
    key: 'two-year-batches',
    name: 'Two-year batches and 1st to 2nd year promotion',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Batch lifecycle manager governing 2-year intermediate cycles, automated annual promotions, and roll number retention.',
    institutionBenefit: 'Streamlines annual session transitions without manual re-enrollment or data loss.',
    tierLevels: { starter: 'Standard promotion batch runner', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#11',
    key: 'monthly-tests',
    name: 'Monthly, chapter-wise and mid-term tests',
    category: 'Examination & Test Prep',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Routine classroom assessment manager for tracking continuous academic performance between major exams.',
    institutionBenefit: 'Enables continuous formative assessment and early detection of academic distress.',
    tierLevels: { starter: 'Manual test entry', standard: 'Auto-calculation of internal marks', premium: 'Weak-topic analytics (#105)', enterprise: 'AI automated quiz generation' }
  },
  {
    id: '#12',
    key: 'matric-result-intake',
    name: 'Matric result, board and roll number at admission',
    category: 'Admissions & Board',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Intake capture for 10th-grade matriculation marks, BISE roll number, passing board, and school background.',
    institutionBenefit: 'Secures authentic baseline verification required for board enrollment and merit sorting.',
    tierLevels: { starter: 'Manual data entry', standard: 'Board gazette verification', premium: 'Document OCR extraction (#107)', enterprise: 'Direct API board validation' }
  },
  {
    id: '#13',
    key: 'cash-fee-vouchers',
    name: 'Fee templates and cash vouchers',
    category: 'Fees & Treasury',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['fees'],
    description: 'Fee structure configuration (admission, tuition, lab, library) and generation of printable cash fee vouchers.',
    institutionBenefit: 'Establishes financial control over cash collections with receipt numbering and audit trails.',
    tierLevels: { starter: 'Manual cash fee vouchers', standard: '3-copy bank challans (#55)', premium: 'Online payment gateways (#82)', enterprise: 'Full double-entry accounting (N40)' }
  },
  {
    id: '#14',
    key: 'manual-gate-log',
    name: 'Gate log by roll number or name (no scanner)',
    category: 'Gate & Security',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Security guard desk log for recording student arrival and departure times manually without hardware scanners.',
    institutionBenefit: 'Provides low-tech campus boundary security and entry timestamps for accountability.',
    tierLevels: { starter: 'Manual desk log', standard: 'QR scanner app (#65)', premium: 'Biometric turnstile sync (#79)', enterprise: 'Subnet IP & perimeter control' }
  },
  {
    id: '#15',
    key: 'assignments-submissions',
    name: 'Assignments and submissions',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['assignments-quizzes'],
    description: 'Digital homework and coursework assignment portal with deadlines, student file uploads, and teacher grading.',
    institutionBenefit: 'Extends learning beyond classrooms with digital submission logs and anti-loss verification.',
    tierLevels: { starter: 'Max 10 MB per file', standard: 'Max 25 MB per file', premium: 'Max 50 MB per file', enterprise: 'Max 100 MB per file' }
  },
  {
    id: '#16',
    key: 'college-branding-signatures',
    name: 'College logo, stamp, letterhead and signatures',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Institutional asset upload for digital signatures of Principal, Controller of Examinations, and college stamp.',
    institutionBenefit: 'Automatically brands all generated PDF certificates, fee vouchers, and result cards.',
    tierLevels: { starter: 'Standard institutional branding', standard: 'Standard branding', premium: 'Custom domains (N12)', enterprise: 'Custom domains (N12)' }
  },
  {
    id: '#17',
    key: 'student-profile-photo',
    name: 'Student profile photo (shown on ID card and records)',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Student passport-photo upload with automated cropping and display on student records and ID cards.',
    institutionBenefit: 'Prevents student impersonation during examinations and campus entry.',
    tierLevels: { starter: 'Standard photo storage', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#18',
    key: 'teacher-subjects',
    name: 'Teacher subjects, classes and groups',
    category: 'HR & Staff',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Faculty mapping linking teachers to their assigned subjects, study groups, sections, and workload limits.',
    institutionBenefit: 'Defines faculty pedagogical ownership and enforces correct permissions for grading and attendance.',
    tierLevels: { starter: 'Teacher-subject mappings', standard: 'Workload & substitution logs', premium: 'Teacher evaluation surveys (#88)', enterprise: 'Staff appraisal assistant (N42)' }
  },
  {
    id: '#19',
    key: 'student-timetable-view',
    name: 'Students see their own section timetable',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['section-timetable'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Read-only student portal view displaying the weekly schedule and classroom locations for their section.',
    institutionBenefit: 'Reduces student confusion and hallway congestion during period transitions.',
    tierLevels: { starter: 'In-app weekly grid', standard: 'Installable PWA view (N08)', premium: 'Parent portal sync (N22)', enterprise: 'Multi-campus schedule view' }
  },
  {
    id: '#20',
    key: 'teacher-dashboard',
    name: 'Teacher dashboard: current and next class',
    category: 'HR & Staff',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['teacher-subjects'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Personalized faculty command center highlighting real-time lecture schedule, next room, and quick attendance links.',
    institutionBenefit: 'Saves teacher administrative time with 1-click attendance and class progress tracking.',
    tierLevels: { starter: 'Standard web dashboard', standard: 'Faculty mobile PWA (N08)', premium: 'Pedagogy AI workspace (#103)', enterprise: 'Autonomous class assistant' }
  },
  {
    id: '#21',
    key: 'role-color-themes',
    name: 'Colour theme per role panel',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Visual distinction system applying distinctive UI palettes across Admin, Teacher, Student, and Cashier roles.',
    institutionBenefit: 'Prevents operational confusion when administrators manage multiple role contexts.',
    tierLevels: { starter: 'Pre-set role palettes', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Custom role palettes' }
  },
  {
    id: '#22',
    key: 'image-resize-pdf-cleanup',
    name: 'Image resize, compression and PDF cleanup',
    category: 'Operations',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automatic backend image optimization and PDF compression reducing upload size and bandwidth usage.',
    institutionBenefit: 'Keeps cloud storage lean and accelerates page load times over mobile data connections.',
    tierLevels: { starter: 'Automated client & server compression', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#23',
    key: 'audit-trail',
    name: 'Audit trail',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Comprehensive administrative log capturing user actions, timestamp, IP address, and changed entity values.',
    institutionBenefit: 'Ensures absolute accountability and non-repudiation for grades, attendance, and financial updates.',
    tierLevels: { starter: '30 days retention', standard: '90 days retention', premium: '180 days retention', enterprise: '365 days + legal hold (N16)' }
  },
  {
    id: '#24',
    key: 'recycle-bin',
    name: 'Recycle bin / soft-delete recovery',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Safety recovery holding area allowing restoration of accidentally deleted students, staff, or transactions.',
    institutionBenefit: 'Eliminates permanent data loss incidents caused by administrative mistakes.',
    tierLevels: { starter: '30 days recovery', standard: '30 days recovery', premium: '60 days recovery', enterprise: '90 days recovery' }
  },
  {
    id: '#25',
    key: 'circulars-notices',
    name: 'Circulars and exam notices',
    category: 'Parents & Comms',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['announcements'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Formal circular publishing system with PDF notice generation, dispatch scheduling, and recipient read confirmations.',
    institutionBenefit: 'Creates an official institutional paper trail for board notices, fee deadlines, and event announcements.',
    tierLevels: { starter: 'Standard circular dispatch', standard: 'Urdu templates & scheduling (N21)', premium: 'SMS & WhatsApp push alerts', enterprise: 'Autonomous notice writer (N48)' }
  },
  {
    id: '#26',
    key: 'file-vault-quota',
    name: 'File vault and storage quota manager',
    category: 'Operations',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Institution file repository with category tagging, storage breakdown analytics, and hard quota safeguards.',
    institutionBenefit: 'Allows colleges to store syllabus documents, past papers, and regulatory files safely with visibility into usage.',
    tierLevels: { starter: '5 GB quota / 10 MB file max', standard: '25 GB quota / 25 MB file max', premium: '100 GB quota / 50 MB file max', enterprise: '300 GB quota / 100 MB file max' }
  },
  {
    id: '#27',
    key: 'bulk-csv-import',
    name: 'Excel/CSV bulk import with validation',
    category: 'Academic Core',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Batch spreadsheet importer with validation checks for duplicate B-forms, missing fields, and roll number format errors.',
    institutionBenefit: 'Saves hundreds of manual data entry hours during peak seasonal admissions.',
    tierLevels: { starter: 'Up to 1,000 rows/import', standard: 'Up to 5,000 rows/import', premium: 'Up to 20,000 rows/import', enterprise: 'Up to 50,000 rows/import' }
  },
  {
    id: '#29',
    key: 'group-wise-fees-seats',
    name: 'Group-wise fee, seats and sections',
    category: 'Fees & Treasury',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups', 'cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Differentiation rules specifying distinct fee amounts, seat quotas, and section allocations by study group (e.g. Pre-Med vs Arts).',
    institutionBenefit: 'Prevents seat over-subscription in popular science groups and ensures accurate fee billing per discipline.',
    tierLevels: { starter: 'Standard group fee configs', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#30',
    key: 'certificates',
    name: 'Certificates (character, hope, migration, bonafide)',
    category: 'Examination & Test Prep',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['certificates'],
    description: 'Automated generation of official institutional certificates (Character, Hope, Migration, Bonafide) with student academic history.',
    institutionBenefit: 'Allows instant issuance of formal student certificates without manual drafting.',
    tierLevels: { starter: 'Standard certificate templates', standard: 'QR verification enabled (#32)', premium: 'Custom layout builder', enterprise: 'Multi-campus issuance tracking' }
  },
  {
    id: '#63',
    key: 'staff-accounts-leaves',
    name: 'Staff accounts and leaves',
    category: 'HR & Staff',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['employees'],
    description: 'Staff account directory, designation tracking, leave balance tracking (Casual, Sick, Annual), and approval workflows.',
    institutionBenefit: 'Provides transparent faculty leave governance and prevents unscheduled teacher shortages.',
    tierLevels: { starter: 'Up to 20 staff accounts', standard: 'Up to 50 staff accounts', premium: 'Up to 100 staff accounts', enterprise: 'Up to 200 staff accounts' }
  },
  {
    id: 'N01',
    key: 'export-center',
    name: 'Export Center',
    category: 'Operations',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Unified administrative export hub for generating student, fee, marks, and attendance reports in CSV, Excel, and PDF formats.',
    institutionBenefit: 'Consolidates all institutional reporting with monthly plan quotas to protect server bandwidth.',
    tierLevels: { starter: '3 CSV/mo (max 1,000 rows)', standard: '60 CSV/mo', premium: 'Unlimited CSV, 60 PDF/mo', enterprise: 'Unlimited CSV & PDF exports' }
  },
  {
    id: 'N07',
    key: 'admin-2fa-login-alerts',
    name: 'Admin 2FA and login alerts',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Time-based OTP two-factor authentication for administrative accounts, session timeouts, and new-device login notifications.',
    institutionBenefit: 'Hardens college records and financial ledgers against unauthorized access and credential leaks.',
    tierLevels: { starter: 'Email OTP & login alerts', standard: 'Authenticator app (TOTP)', premium: 'SMS OTP alerts', enterprise: 'IP allow-list & SSO enforcement' }
  },
  {
    id: 'N09',
    key: 'bilingual-rtl-ui',
    name: 'Bilingual UI and right-to-left Urdu screens',
    category: 'Governance & Infrastructure',
    startsIn: 'starter',
    status: 'coming_soon',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Full localized interface supporting English and Urdu with Right-to-Left (RTL) typography for notices, vouchers, and result cards.',
    institutionBenefit: 'Empowers Urdu-speaking staff, cashiers, guards, and parents to operate the system comfortably.',
    tierLevels: { starter: 'Urdu templates & screen toggle', standard: 'Same on all tiers', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },

  // -------------------------------------------------------------
  // STANDARD TIER (55 Services: 44 Live + 11 Coming Soon)
  // Cumulative: 33 + 55 = 88 Services
  // -------------------------------------------------------------
  {
    id: '#28',
    key: 'student-diary-calendar',
    name: 'Student diary and events calendar',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Digital daily student diary recording daily homework, subject topics taught, upcoming tests, and academic calendar dates.',
    institutionBenefit: 'Bridge daily classroom activities with student and parent awareness to improve study discipline.',
    tierLevels: { starter: 'Not available', standard: 'Daily diary & academic calendar', premium: 'Syncs to Parent App (N22)', enterprise: 'Multi-campus calendar sync' }
  },
  {
    id: '#31',
    key: 'id-card-printing-qr',
    name: 'ID card printing with QR',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Batch printable student and staff smart ID cards with photo, barcode/QR code, blood group, and emergency contact details.',
    institutionBenefit: 'Produces durable, machine-readable student credentials for rapid campus entry scanning.',
    tierLevels: { starter: 'Basic ID card without QR', standard: 'Encrypted QR ID card generation', premium: 'Custom ID card designer', enterprise: 'Multi-campus smart credentials' }
  },
  {
    id: '#32',
    key: 'qr-verification',
    name: 'QR verification of certificates and result cards',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['certificates'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Public scan verification verifying the authenticity of college-issued credentials against database records.',
    institutionBenefit: 'Completely eliminates forged transcripts, fake character certificates, and altered fee receipts.',
    tierLevels: { starter: 'Not available', standard: 'Public cryptographic QR verification', premium: 'Custom verification URL', enterprise: 'Enterprise security seals' }
  },
  {
    id: '#33',
    key: 'gate-qr-auto-attendance',
    name: 'Gate QR scan auto-marks daily attendance',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['daily-attendance', 'id-card-printing-qr'],
    addonTiers: [],
    addonType: null,
    aliases: ['entry-system'],
    description: 'Camera scanner app that marks student attendance in real time when scanning their ID card QR code at campus gates.',
    institutionBenefit: 'Captures attendance for hundreds of students in minutes without wasting classroom teaching time.',
    tierLevels: { starter: 'Not available', standard: 'Mobile camera gate scanner', premium: 'Multi-gate synchronization', enterprise: 'Biometric turnstile auto-sync (#79)' }
  },
  {
    id: '#34',
    key: 'board-registration-1st-year',
    name: '1st-year board registration forms and fee collection',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Board registration package compiling student matric data, B-form, board registration fees, and BISE format export.',
    institutionBenefit: 'Eliminates rejection penalties from BISE boards by verifying registration fields before submission.',
    tierLevels: { starter: 'Not available', standard: 'BISE 1st-year registration engine', premium: 'Board-format Excel export (N02)', enterprise: 'Direct BISE integration' }
  },
  {
    id: '#35',
    key: 'board-exam-forms-2nd-year',
    name: '2nd-year annual exam admission forms',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Second-year annual exam examination form processing, fee reconciliation, and candidate batch compilation.',
    institutionBenefit: 'Streamlines graduation and board examination filing for 2nd-year candidate cohorts.',
    tierLevels: { starter: 'Not available', standard: '2nd-year annual exam submission', premium: 'Automated fee clearance check', enterprise: 'Multi-campus batch submission' }
  },
  {
    id: '#36',
    key: 'board-private-candidates',
    name: 'Private, improvement and compartment candidates',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Specialized record tracking for marks improvement, repeaters, and compartment students sitting for supplementary board exams.',
    institutionBenefit: 'Prevents regular student record pollution by isolating improvement candidate fees and roll numbers.',
    tierLevels: { starter: 'Not available', standard: 'Improvement & supply candidate tracks', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#37',
    key: 'board-roll-slips-datesheet',
    name: 'Board roll slips, datesheet and centre details',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['board-registration-1st-year'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Repository for board roll number slips, examination centre allocations, and official BISE datesheets.',
    institutionBenefit: 'Allows instant distribution of board roll slips to candidates and tracks centre allocations.',
    tierLevels: { starter: 'Not available', standard: 'Board slip upload & student view', premium: 'Parent app push notification', enterprise: 'Batch SMS distribution' }
  },
  {
    id: '#38',
    key: 'board-gazette-entry',
    name: 'Board result record and gazette entry',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Official board exam result ledger mapping subject-wise scores, grades, and pass/fail status from board gazettes.',
    institutionBenefit: 'Stores permanent historical academic records for accreditation and alumni verification.',
    tierLevels: { starter: 'Not available', standard: 'Gazette marks entry & student sync', premium: 'Automated gazette CSV parser (#39)', enterprise: 'Cross-campus comparative metrics' }
  },
  {
    id: '#39',
    key: 'board-result-file-import',
    name: 'Board result file import',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['board-gazette-entry'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated CSV/Excel board gazette parser that ingests thousands of student results and matches them by roll number.',
    institutionBenefit: 'Replaces weeks of manual marks entry with a 30-second bulk file upload on board result day.',
    tierLevels: { starter: 'Not available', standard: 'Automated gazette file import', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#41',
    key: 'minimum-attendance-check',
    name: 'Minimum attendance check before board forms',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['daily-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated audit calculating percentage attendance per student against the board 75% regulatory requirement.',
    institutionBenefit: 'Protects the college from regulatory violations by preventing unapproved defaulters from exam filing.',
    tierLevels: { starter: 'Not available', standard: '75% attendance threshold auditor', premium: 'Automated shortage warnings (#81)', enterprise: 'Legal hold on ineligible candidates' }
  },
  {
    id: '#42',
    key: 'send-up-exams',
    name: 'Send-up (pre-board) exams',
    category: 'Examination & Test Prep',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Rigorous pre-board examination manager with comprehensive full-syllabus testing, grading criteria, and clearance status.',
    institutionBenefit: 'Identifies student weaknesses months before final board exams, enabling targeted intervention.',
    tierLevels: { starter: 'Not available', standard: 'Send-up exam workflow & results', premium: 'Subject comparison analytics (#45)', enterprise: 'AI remedial plan generation (#106)' }
  },
  {
    id: '#43',
    key: 'eligibility-defaulter-lists',
    name: 'Eligibility and defaulter lists',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers', 'minimum-attendance-check'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Cross-functional filter generating clearance lists based on simultaneous attendance compliance and fee clearance.',
    institutionBenefit: 'Prevents fee defaulters and chronic absentees from receiving roll slips without administrative approval.',
    tierLevels: { starter: 'Not available', standard: 'Attendance & fee clearance matrix', premium: 'Automated clearance workflows (N11)', enterprise: 'Multi-campus defaulter sync' }
  },
  {
    id: '#46',
    key: 'practical-timetable-marks',
    name: 'Practical timetable and marks',
    category: 'Academic Core',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['section-timetable'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Laboratory schedule management (Physics, Chemistry, Biology, Computer Science) and practical performance marks tracking.',
    institutionBenefit: 'Ensures safe laboratory rotation and accurate practical coursework records for science students.',
    tierLevels: { starter: 'Not available', standard: 'Lab scheduling & marks entry', premium: 'Apparatus inventory link (#89)', enterprise: 'Multi-campus lab scheduling' }
  },
  {
    id: '#47',
    key: 'lab-journals-attendance',
    name: 'Lab journals and attendance',
    category: 'Academic Core',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['practical-timetable-marks'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Tracking practical notebook submissions, lab experiment completion sign-offs, and lab session attendance.',
    institutionBenefit: 'Guarantees that students satisfy board practical exam prerequisite journal requirements.',
    tierLevels: { starter: 'Not available', standard: 'Journal sign-off tracking', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#48',
    key: 'board-practical-arrangements',
    name: 'Board practical arrangements',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['practical-timetable-marks'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Coordination manager for official BISE practical examiners, lab staff duty rosters, apparatus setup, and external marks entry.',
    institutionBenefit: 'Flawlessly executes high-stakes external board practical sessions with zero scheduling clashes.',
    tierLevels: { starter: 'Not available', standard: 'Practical batch & examiner rosters', premium: 'Same on all tiers', enterprise: 'Multi-campus examiner management' }
  },
  {
    id: '#49',
    key: 'admissions-review-merit',
    name: 'Admissions review and merit calculation',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Intake application workflow computing merit points from matriculation percentages, test scores, and bonus marks.',
    institutionBenefit: 'Ensures completely transparent, auditable, and dispute-free college admission merit lists.',
    tierLevels: { starter: 'Not available', standard: 'Automated merit formula calculator', premium: 'Document OCR intake (#107)', enterprise: 'AI applicant lead scoring (N51)' }
  },
  {
    id: '#50',
    key: 'public-online-apply',
    name: 'Public online apply portal',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['admissions-review-merit'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Public-facing online admission portal where prospective applicants submit biodata, marks, and document scans from home.',
    institutionBenefit: 'Expands the college applicant pool beyond walk-ins and eliminates admission counter crowding.',
    tierLevels: { starter: 'Manual desk intake only', standard: 'Up to 50 applications/year', premium: 'Up to 150 applications/year', enterprise: 'Up to 400 applications/year' }
  },
  {
    id: '#51',
    key: 'olevel-equivalence',
    name: 'O-level and other board equivalence',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['admissions-review-merit'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Conversion matrix converting Cambridge O-Level, Federal Board, and provincial board marks into standardized BISE percentages.',
    institutionBenefit: 'Accurately ranks foreign and inter-provincial applicants on fair footing with local matric candidates.',
    tierLevels: { starter: 'Not available', standard: 'IBCC conversion rules & tracking', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#52',
    key: 'merit-lists-matric',
    name: 'Merit lists by matric score, quota and group',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['admissions-review-merit'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated generation of 1st, 2nd, and 3rd admission merit lists broken down by study group and seat availability.',
    institutionBenefit: 'Allows rapid publishing of cut-off lists with 1-click status promotion from applicant to admitted.',
    tierLevels: { starter: 'Not available', standard: 'Multi-round merit list publisher', premium: 'SMS alerts to selected candidates', enterprise: 'Multi-campus centralized merit' }
  },
  {
    id: '#53',
    key: 'quota-admissions',
    name: 'Quotas (Hafiz, sports, kin, disabled, seat caps)',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['admissions-review-merit'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Special reservation quota manager managing seat reservations and 20-mark additions for Hafiz-e-Quran, sports champions, and staff kin.',
    institutionBenefit: 'Enforces statutory government and trust quotas precisely without exceeding sanctioned group seat caps.',
    tierLevels: { starter: 'Not available', standard: 'Quota rule manager & bonus points', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#54',
    key: 'enquiry-lead-tracking',
    name: 'Enquiry and lead tracking before admission',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Admission office CRM tracking visitor queries, prospectus sales, phone enquiries, and follow-up call outcomes.',
    institutionBenefit: 'Improves admission conversion rates by ensuring prospective students receive structured follow-ups.',
    tierLevels: { starter: 'Not available', standard: 'Front-desk admission CRM', premium: 'WhatsApp follow-up templates', enterprise: 'AI lead conversion scoring (N51)' }
  },
  {
    id: '#55',
    key: 'bank-challans-3copy',
    name: '3-copy bank challans with barcode',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Generates standard 3-copy printable bank deposit challans (Bank Copy, College Copy, Student Copy) with barcodes.',
    institutionBenefit: 'Facilitates seamless fee collection through commercial bank branches (e.g. HBL, MCB, Meezan, BoP).',
    tierLevels: { starter: 'Not available', standard: '3-copy bank challans with barcode', premium: 'Online payment gateways (#82)', enterprise: 'Bank direct API auto-matching' }
  },
  {
    id: '#56',
    key: 'fee-defaulters-ledger',
    name: 'Fee defaulters ledger and warning letters',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Comprehensive debtor ledger listing overdue student balances with automated 1st, 2nd, and final notice letter generation.',
    institutionBenefit: 'Accelerates fee recovery and prevents year-end uncollectible debts.',
    tierLevels: { starter: 'Not available', standard: 'Defaulter ledger & warning letters', premium: 'Automated SMS defaulter warnings (#84)', enterprise: 'AI predictive recovery assistant (N48)' }
  },
  {
    id: '#57',
    key: 'treasury-ledger',
    name: 'Treasury ledger and cash-in-hand book',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Daily cash book reconciling cashier cash collections, bank deposits, authorized petty expenses, and net daily closing balances.',
    institutionBenefit: 'Prevents cashier misappropriation with end-of-day cash reconciliation.',
    tierLevels: { starter: 'Not available', standard: 'Daily cash book & treasury balance', premium: 'Accountant CSV export (N04)', enterprise: 'Double-entry general ledger (N40)' }
  },
  {
    id: '#58',
    key: 'disciplinary-fines',
    name: 'Disciplinary, damage and absence fines',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Ad-hoc fine assessment system for recording absence fines, lab breakage fees, uniform violations, and library overdue fines.',
    institutionBenefit: 'Enforces campus discipline while automatically adding fines onto next month fee vouchers.',
    tierLevels: { starter: 'Not available', standard: 'Fines management & voucher billing', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#59',
    key: 'fee-installments-late-fees',
    name: 'Fee installments and late fee rules',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Flexible payment plan builder allowing tuition fee splitting into customized monthly installments with grace periods.',
    institutionBenefit: 'Accommodates financially constrained students while maintaining systematic collection schedules.',
    tierLevels: { starter: 'Not available', standard: 'Installment plans & late fine rules', premium: 'Approval workflows for waivers (N11)', enterprise: 'Multi-campus financial policies' }
  },
  {
    id: '#60',
    key: 'fee-discounts-scholarships',
    name: 'Merit, need and kinship fee discounts',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Concession engine managing sibling discounts, high-achiever fee concessions, orphan waivers, and teacher-child discounts.',
    institutionBenefit: 'Enforces structured institutional discount policies and prevents discretionary unauthorized fee cuts.',
    tierLevels: { starter: 'Not available', standard: 'Concession policy rules & tracking', premium: 'Multi-step waiver approvals (N11)', enterprise: 'Multi-campus scholarship budgets' }
  },
  {
    id: '#61',
    key: 'fee-early-refunds',
    name: 'Early refunds (board cancellation, migration)',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Formal refund processing for admitted students migrating to government colleges or seeking board cancellation.',
    institutionBenefit: 'Maintains strict financial audit trails for returned funds with security deposit deductions.',
    tierLevels: { starter: 'Not available', standard: 'Refund calculation & debit vouchers', premium: 'Approval hierarchy (N11)', enterprise: 'Same on all tiers' }
  },
  {
    id: '#62',
    key: 'fee-alert-board-deadline',
    name: 'Fee alert before board admission deadline',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Urgent collection alert triggering when board examination registration deadlines approach for students with unpaid dues.',
    institutionBenefit: 'Guarantees fee recovery before submitting student admission forms to BISE.',
    tierLevels: { starter: 'Not available', standard: 'In-app deadline urgency banners', premium: 'Automated SMS alerts to parents', enterprise: 'Automated WhatsApp payment alerts' }
  },
  {
    id: '#64',
    key: 'payroll-pay-slips',
    name: 'Payroll, allowances, deductions and pay slips',
    category: 'HR & Staff',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['staff-accounts-leaves'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Monthly faculty and staff payroll calculation with basic pay, allowances, absence deductions, and printable pay slips.',
    institutionBenefit: 'Automates monthly staff salary preparation with transparent deductions for unpaid leaves.',
    tierLevels: { starter: 'Not available', standard: 'Monthly payroll & PDF pay slips', premium: 'Bank payment file export', enterprise: 'Full ledger integration (N40)' }
  },
  {
    id: '#65',
    key: 'campus-gate-qr-scanner',
    name: 'Campus gate QR scanner for guards',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['gate-qr-auto-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Dedicated high-contrast, low-latency mobile and tablet scanner interface built specifically for security guard use.',
    institutionBenefit: 'Allows gate security staff to quickly verify student status and flag fee defaulters or expelled individuals.',
    tierLevels: { starter: 'Not available', standard: 'Guard portal with audio chime', premium: 'Multi-gate synchronization', enterprise: 'Hardware turnstile bridge' }
  },
  {
    id: '#66',
    key: 'digital-early-exit-pass',
    name: 'Digital early-exit gate pass',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Electronic gate-pass approval system permitting sick or authorized students to leave campus before dismissal time.',
    institutionBenefit: 'Prevents unauthorized student walkouts and provides verifiable security verification for parents.',
    tierLevels: { starter: 'Not available', standard: 'Digital pass with guard QR scan', premium: 'Instant parent notification', enterprise: 'Biometric exit timestamp' }
  },
  {
    id: '#67',
    key: 'visitor-management',
    name: 'Visitor management and guest log',
    category: 'Gate & Security',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['visitors'],
    description: 'Campus reception visitor check-in logging guest CNIC, phone number, vehicle number, host staff member, and visit purpose.',
    institutionBenefit: 'Protects college safety by creating an auditable record of all external persons on campus grounds.',
    tierLevels: { starter: 'Not available', standard: 'Visitor check-in & badge printing', premium: 'Host staff SMS alert', enterprise: 'Multi-campus visitor analytics' }
  },
  {
    id: '#68',
    key: 'ptm-logs',
    name: 'Parent-teacher meeting log',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Structured documentation system for recording guardian discussions, academic commitments, and agreed behavioral targets.',
    institutionBenefit: 'Builds parental partnership and maintains historical proof of guardian consultations.',
    tierLevels: { starter: 'Not available', standard: 'PTM discussion logs & sign-offs', premium: 'Parent portal feedback view', enterprise: 'Same on all tiers' }
  },
  {
    id: '#69',
    key: 'anonymous-feedback-box',
    name: 'Anonymous student feedback box',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Confidential digital suggestion portal where students can submit anonymous feedback on facilities, teaching, and bullying.',
    institutionBenefit: 'Surfaces campus grievances and student safety concerns that students are too afraid to report verbally.',
    tierLevels: { starter: 'Not available', standard: 'Confidential feedback channel', premium: 'Categorized sentiment dashboard', enterprise: 'AI grievance triaging' }
  },
  {
    id: '#70',
    key: 'online-quizzes-auto-marking',
    name: 'Online quizzes and auto-marking',
    category: 'Examination & Test Prep',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Interactive student quiz portal with multiple choice questions, timer countdowns, and instant score calculation.',
    institutionBenefit: 'Eliminates grading burdens for teachers while providing students immediate feedback on mastery.',
    tierLevels: { starter: 'Not available', standard: 'Standard manual quiz builder', premium: 'AI quiz generator (#101/#104)', enterprise: 'Autonomous daily quiz agent' }
  },
  {
    id: '#71',
    key: 'branded-pdf-templates',
    name: 'Branded PDF templates for result cards and receipts',
    category: 'Operations',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['college-branding-signatures'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'High-resolution PDF generation engine formatting transcripts, fee receipts, and admit cards with college crest and watermarks.',
    institutionBenefit: 'Delivers publication-quality institutional documents ready for color printing and laminated distribution.',
    tierLevels: { starter: 'Standard system template', standard: 'Custom colors & watermark templates', premium: 'Custom CSS layout editor', enterprise: 'Full white-label document branding' }
  },
  {
    id: '#72',
    key: 'verified-paid-voucher-qr',
    name: 'Verified paid voucher with security QR',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Security stamped paid voucher receipt containing tamper-evident cryptographic QR code verifying settlement details.',
    institutionBenefit: 'Eliminates fake paid stamps and protects parents and college accounts from fraud.',
    tierLevels: { starter: 'Not available', standard: 'Encrypted QR paid voucher', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: '#73',
    key: 'public-voucher-verification',
    name: 'Public voucher verification page',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['verified-paid-voucher-qr'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Public web endpoint enabling banks, parents, and accountants to scan a voucher QR and verify its settlement status.',
    institutionBenefit: 'Guarantees third-party trust and instantaneous verification for disputed fee settlements.',
    tierLevels: { starter: 'Not available', standard: 'Public verification portal', premium: 'Branded verification domain', enterprise: 'Same on all tiers' }
  },
  {
    id: '#74',
    key: 'student-report-pdf',
    name: 'Per-student academic and fee history PDF',
    category: 'Academic Core',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'One-click compiled dossier assembling a complete 2-year timeline of student attendance, monthly test marks, and fee history.',
    institutionBenefit: 'Essential for parent conferences, disciplinary boards, and transfer clearance reviews.',
    tierLevels: { starter: 'Not available', standard: 'Consolidated PDF history dossier', premium: 'Include AI behavioral summary', enterprise: 'Multi-campus transcript' }
  },
  {
    id: '#75',
    key: 'payment-proof-upload',
    name: 'Payment proof upload by student or cashier',
    category: 'Fees & Treasury',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Upload interface for students, cashiers, and accountants to submit bank deposit receipts, ATM slips, and transfer screenshots.',
    institutionBenefit: 'Allows manual reconciliation before physical bank statements arrive at the campus.',
    tierLevels: { starter: 'Not available', standard: 'Manual screenshot upload & review', premium: 'Vision AI OCR auto-matching (#111/N43)', enterprise: 'Same on all tiers' }
  },
  {
    id: '#76',
    key: 'teacher-substitutions',
    name: 'Teacher substitution when a teacher is on leave',
    category: 'HR & Staff',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['teacher-subjects'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Intelligent substitution allocator recommending available teachers with matching subject competence during unplanned absences.',
    institutionBenefit: 'Eliminates idle classroom periods and maintains syllabus continuity when instructors take leave.',
    tierLevels: { starter: 'Not available', standard: 'Conflict-aware substitution manager', premium: 'Instant SMS alert to substitute', enterprise: 'AI timetable load balancing' }
  },
  {
    id: '#77',
    key: 'report-center',
    name: 'Report Center (all standard reports in one place)',
    category: 'Operations',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['analytics-reports'],
    description: 'Comprehensive reporting catalog housing standard attendance, financial collection, enrollment, and exam analytics reports.',
    institutionBenefit: 'Gives management single-click access to operational health indicators across departments.',
    tierLevels: { starter: 'Not available', standard: 'Standard operational report suite', premium: 'Scheduled email delivery (N03)', enterprise: 'Ask-Your-Data AI reports (N46)' }
  },
  {
    id: '#80',
    key: 'staff-attendance-register',
    name: 'Teacher and staff attendance register',
    category: 'HR & Staff',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['staff-accounts-leaves'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Dedicated digital register tracking daily faculty and admin check-in times, check-out times, and half-day leaves.',
    institutionBenefit: 'Provides an objective attendance foundation for monthly payroll leave deductions.',
    tierLevels: { starter: 'Not available', standard: 'Daily digital staff register', premium: 'Biometric biometric turnstile sync (#79)', enterprise: 'Multi-campus staff tracking' }
  },
  {
    id: '#81',
    key: 'attendance-shortage-warnings',
    name: 'Attendance shortage warnings',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['daily-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated notification engine alerting students and parents when attendance falls below 85% and approaches the 75% BISE cutoff.',
    institutionBenefit: 'Prevents surprise exam disbarment by intervening while students still have time to recover their attendance.',
    tierLevels: { starter: 'Not available', standard: 'In-app and email warnings', premium: 'Automated SMS alerts to parents', enterprise: 'Multi-channel WhatsApp triggers' }
  },
  {
    id: '#101',
    key: 'ai-quiz-generator',
    name: 'AI quiz, paper and MCQ generator',
    category: 'AI & Intelligence Suite',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['ai-generators'],
    description: 'Generative AI exam assistant creating chapter-wise MCQs, short questions, and long questions tailored to board curricula.',
    institutionBenefit: 'Saves teachers hours of assessment drafting while producing diverse question variants.',
    tierLevels: { starter: 'Not available', standard: 'Manual assist: up to 20 tests/mo', premium: 'Elevated: up to 150 tests/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: '#109',
    key: 'notice-translation',
    name: 'English to Urdu translation of notices',
    category: 'AI & Intelligence Suite',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['announcements'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Neural translation and formal phrasing assistant transforming administrative English circulars into polished Urdu notices.',
    institutionBenefit: 'Ensures clear, culturally appropriate communications with parents without hiring dedicated translators.',
    tierLevels: { starter: 'Not available', standard: 'Up to 30 notices/mo', premium: 'Up to 300 notices/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: 'N02',
    key: 'board-format-excel-export',
    name: 'Board-format Excel export',
    category: 'Admissions & Board',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['export-center'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'One-click spreadsheet generator formatting candidate enrollment and exam records precisely to respective BISE requirements.',
    institutionBenefit: 'Prevents formatting rejection and manual data re-entry when filing board candidate returns.',
    tierLevels: { starter: 'Not available', standard: 'Punjab, Federal & Sindh BISE formats', premium: 'Same on all tiers', enterprise: 'Same on all tiers' }
  },
  {
    id: 'N08',
    key: 'faculty-student-pwa',
    name: 'Installable app for students and teachers',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Lightweight Progressive Web App (PWA) allowing staff and students to install Academix on smartphones with offline caching.',
    institutionBenefit: 'Provides an app store-quality mobile experience without app store fees or forced updates.',
    tierLevels: { starter: 'Not available', standard: 'Installable mobile PWA', premium: 'Push alerts enabled', enterprise: 'White-label mobile splash screen' }
  },
  {
    id: 'N21',
    key: 'notice-templates-scheduling',
    name: 'Notice templates with scheduled dispatch',
    category: 'Parents & Comms',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['announcements'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Pre-written templates for recurring announcements (fee reminders, parent meetings, holidays) with time-delayed publishing.',
    institutionBenefit: 'Enables administrative teams to plan communication campaigns in advance.',
    tierLevels: { starter: 'Not available', standard: 'Templates & scheduled dispatch', premium: 'Same on all tiers', enterprise: 'Autonomous AI scheduling' }
  },
  {
    id: 'N24',
    key: 'student-leave-requests',
    name: 'Student leave applications',
    category: 'Academic Core',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Digital portal where students or parents submit leave requests with medical certificates for class teacher approval.',
    institutionBenefit: 'Distinguishes authorized leaves from truancy and automatically updates attendance registers upon approval.',
    tierLevels: { starter: 'Not available', standard: 'Digital student leave portal', premium: 'Multi-step approval chain (N11)', enterprise: 'Same on all tiers' }
  },
  {
    id: 'N25',
    key: 'exam-seating-invigilation',
    name: 'Exam seating plan and invigilation roster',
    category: 'Examination & Test Prep',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated hall seating arrangement algorithm that scrambles adjacent students across groups to prevent exam cheating.',
    institutionBenefit: 'Builds conflict-free exam hall arrangements and assigns invigilation duty rosters in seconds.',
    tierLevels: { starter: 'Not available', standard: 'Seating generator & invigilation lists', premium: 'Same on all tiers', enterprise: 'Multi-campus hall allocator' }
  },
  {
    id: 'N28',
    key: 'digital-report-card-remarks',
    name: 'Digital report card with teacher remarks',
    category: 'Examination & Test Prep',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Printable report card combining subject grades, attendance percentages, and personalized qualitative teacher comments.',
    institutionBenefit: 'Provides parents a comprehensive understanding of student character, effort, and academic progress.',
    tierLevels: { starter: 'Not available', standard: 'Standard remarks entry', premium: 'AI report card remark assistant (N47)', enterprise: 'Same on all tiers' }
  },
  {
    id: 'N29',
    key: 'leaving-certificate-clearance',
    name: 'Leaving certificate and no-dues clearance',
    category: 'Academic Core',
    startsIn: 'standard',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Inter-departmental sign-off workflow requiring clearance from Library, Science Labs, Sports, and Accounts before certificate issuance.',
    institutionBenefit: 'Prevents students from withdrawing or migrating while retaining college property or unpaid fees.',
    tierLevels: { starter: 'Not available', standard: 'Multi-department clearance checklist', premium: 'Formal approval workflows (N11)', enterprise: 'Same on all tiers' }
  },

  // -------------------------------------------------------------
  // PREMIUM TIER (53 Services: 15 Live + 38 Coming Soon)
  // Cumulative: 88 + 53 = 141 Services
  // -------------------------------------------------------------
  {
    id: '#40',
    key: 'pass-percentage-analytics',
    name: 'Pass %, A+ count, positions by group, subject and teacher',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['board-gazette-entry'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Institutional academic performance analytics evaluating pass rates, GPA distributions, and top position holders.',
    institutionBenefit: 'Gives management quantifiable metrics to evaluate teacher efficacy and institutional reputation.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Comprehensive performance analytics', enterprise: 'Cross-campus comparative benchmarks' }
  },
  {
    id: '#44',
    key: 'weak-student-lists',
    name: 'Weak-student lists per subject',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Diagnostic roster highlighting students falling below 40% in specific subjects for remedial coaching assignments.',
    institutionBenefit: 'Enables focused remedial classes to pull borderline students into passing brackets.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Subject-wise weak student rosters', enterprise: 'AI weak-topic detection (#105)' }
  },
  {
    id: '#45',
    key: 'subject-teacher-comparison',
    name: 'Subject and teacher result comparison',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Comparative analytics comparing grade distributions across sections teaching the same syllabus.',
    institutionBenefit: 'Identifies instructional disparities and informs faculty development programs.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Teacher result comparison matrix', enterprise: 'Multi-campus faculty appraisal link' }
  },
  {
    id: '#78',
    key: 'universal-master-timetable',
    name: 'Universal master timetable',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['section-timetable'],
    addonTiers: ['standard'],
    addonType: null,
    aliases: [],
    description: 'Institution-wide master grid displaying every room, teacher, and section in a unified, conflict-free matrix view.',
    institutionBenefit: 'Gives the Principal complete real-time visibility over the entire college active operations at any minute.',
    tierLevels: { starter: 'Not available', standard: 'Optional add-on', premium: 'Included in plan', enterprise: 'AI conflict auto-fixer (#102)' }
  },
  {
    id: '#79',
    key: 'biometric-device-sync',
    name: 'Biometric device sync (ZKTeco)',
    category: 'Gate & Security',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['daily-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Hardware synchronization agent connecting ZKTeco and compatible biometric fingerprint/facial recognition turnstiles directly to Academix.',
    institutionBenefit: 'Eliminates human error and buddy-punching at campus gates with hardware verification.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Single campus device sync', enterprise: 'Multi-campus distributed biometric sync' }
  },
  {
    id: '#82',
    key: 'online-fee-payment',
    name: 'Online fee payment (JazzCash, Easypaisa, 1Link, Raast)',
    category: 'Fees & Treasury',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Payment gateway integration enabling parents to pay fee vouchers online via JazzCash, Easypaisa, 1Link, or Raast with instant reconciliation.',
    institutionBenefit: 'Accelerates fee collections by removing the requirement for parents to visit bank branches in person.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Payment gateway callback integration', enterprise: 'Auto payment matching & reconciliation (N43)' }
  },
  {
    id: '#83',
    key: 'parent-portal-pwa',
    name: 'Parent portal (attendance, marks, fee status)',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Dedicated web and PWA portal where parents monitor student daily attendance, test marks, fee voucher status, and notices.',
    institutionBenefit: 'Strengthens parent accountability and dramatically reduces routine enquiry calls to the college front desk.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Parent portal web & PWA', enterprise: 'White-label parent portal' }
  },
  {
    id: '#84',
    key: 'sms-alerts',
    name: 'SMS alerts gateway',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'High-throughput branded SMS dispatch engine for instant delivery of absence notices, exam slips, and fee reminders.',
    institutionBenefit: 'Reaches parents immediately on standard mobile networks regardless of internet connectivity.',
    tierLevels: { starter: 'Not available', standard: 'Packs only (wallet)', premium: '200 message credits included / mo', enterprise: '600 message credits included / mo' }
  },
  {
    id: '#85',
    key: 'whatsapp-alerts',
    name: 'WhatsApp alerts gateway',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Official WhatsApp Business API integration delivering rich PDF vouchers, result cards, and circulars directly to parents WhatsApp.',
    institutionBenefit: 'Provides high open rates and immediate receipt of downloadable PDF fee challans and report cards.',
    tierLevels: { starter: 'Not available', standard: 'Packs only (2 credits/msg)', premium: 'Included within message credit pool', enterprise: 'Included within message credit pool' }
  },
  {
    id: '#86',
    key: 'absence-alerts-parents',
    name: 'Absence alerts to parents',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['daily-attendance', 'parent-portal-pwa'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated morning alert engine triggered when gate registers close, dispatching urgent notifications to parents of absent students.',
    institutionBenefit: 'Notifies guardians within 30 minutes of missed arrival, dramatically reducing truancy.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Automated SMS/WhatsApp absence triggers', enterprise: 'Multi-campus alert rules' }
  },
  {
    id: '#87',
    key: 'principal-executive-dashboard',
    name: 'Principal / owner executive dashboard',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['treasury-ledger', 'daily-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'High-level executive dashboard showing daily fee collections, overall attendance percentage, staff presence, and admission pipeline.',
    institutionBenefit: 'Provides leadership complete operational awareness in a single 60-second morning briefing screen.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: '2-campus executive dashboard', enterprise: '3-campus consolidated governance (N18)' }
  },
  {
    id: '#88',
    key: 'teacher-evaluations',
    name: 'Teacher evaluation surveys',
    category: 'HR & Staff',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['teacher-subjects'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Confidential end-of-term student feedback survey evaluating clarity of instruction, punctuality, and syllabus coverage.',
    institutionBenefit: 'Provides objective student input for annual teacher performance appraisals and bonuses.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Standard evaluation survey', enterprise: 'Staff appraisal assistant (N42)' }
  },
  {
    id: '#89',
    key: 'lab-apparatus-stock',
    name: 'Lab apparatus and chemicals stock',
    category: 'Operations',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['practical-timetable-marks'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Inventory register tracking science laboratory glass apparatus, microscopes, chemicals, and breakage logs.',
    institutionBenefit: 'Prevents laboratory equipment loss and monitors hazardous chemical consumption before inspections.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Lab stock & breakage register', enterprise: 'Full asset register (N38)' }
  },
  {
    id: '#90',
    key: 'mdcat-mcq-bank',
    name: 'Chapter-wise MCQ bank (MDCAT / engineering)',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Vast repository of chapter-tagged entrance exam MCQs formatted for NUMS, UHS, ECAT, and NUST entry test preparation.',
    institutionBenefit: 'Enables intermediate colleges to offer competitive entry-test preparation alongside board curricula.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Full entry-test MCQ bank', enterprise: 'Same on all tiers' }
  },
  {
    id: '#91',
    key: 'mock-test-series',
    name: 'Mock test series with ranking',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['mdcat-mcq-bank'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Standardized full-length mock examination runner computing provincial merit rankings and percentile scoring.',
    institutionBenefit: 'Prepares students for high-stakes admission test time management and stress environments.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Institutional mock test series', enterprise: 'Inter-campus competitive rankings' }
  },
  {
    id: '#92',
    key: 'omr-sheet-scanning',
    name: 'OMR sheet scanning',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['mock-test-series'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Optical Mark Recognition (OMR) software processing mobile photos or scanner scans of bubble test sheets in seconds.',
    institutionBenefit: 'Grades hundreds of objective exam sheets in minutes with zero marking fatigue or human grading errors.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Up to 5,000 sheets/mo', enterprise: 'Up to 20,000 sheets/mo' }
  },
  {
    id: '#93',
    key: 'aggregate-calculator',
    name: 'Aggregate calculator (matric, FSc, entry test)',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Formula calculator computing official PMC/PMDC medical aggregate and PEC engineering aggregate scores.',
    institutionBenefit: 'Enables realistic university admission counseling based on current academic trajectory.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Standard aggregate calculator', enterprise: 'Same on all tiers' }
  },
  {
    id: '#94',
    key: 'entry-test-tracking',
    name: 'Entry-test and university application tracking',
    category: 'Admissions & Board',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Counseling tracker monitoring 2nd-year student applications to medical colleges, engineering universities, and armed forces.',
    institutionBenefit: 'Helps administration guide graduating seniors toward timely university admissions.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Senior application tracker', enterprise: 'Alumni placement link (N34)' }
  },
  {
    id: '#95',
    key: 'career-counselling',
    name: 'Career counselling after FSc',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Advisory portal providing degree pathway guidance, university deadlines, and scholarship requirements for college graduates.',
    institutionBenefit: 'Enhances college value proposition by supporting students beyond intermediate examination completion.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Career guidance library & notes', enterprise: 'AI personalized study plans (#106)' }
  },
  {
    id: '#96',
    key: 'scholarship-tracking',
    name: 'Scholarship tracking (government, endowment)',
    category: 'Fees & Treasury',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['cash-fee-vouchers'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Tracking portal for external scholarships including PEEF, Ehsaas, HEC, and institutional endowment awards.',
    institutionBenefit: 'Ensures timely scholarship disbursements and avoids double-billing sponsored students.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'External scholarship ledger', enterprise: 'Same on all tiers' }
  },
  {
    id: '#97',
    key: 'auto-timetable-generator',
    name: 'Auto conflict-free timetable generator',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['section-timetable'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Constraint satisfaction algorithm that compiles an entire semester timetable with zero teacher or room overlaps in seconds.',
    institutionBenefit: 'Saves weeks of administrative schedule wrestling at the start of every academic session.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Automated CSP timetable solver', enterprise: 'AI timetable conflict fixer (#102)' }
  },
  {
    id: '#98',
    key: 'canteen-pos',
    name: 'Canteen POS & sales ledger',
    category: 'Operations',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: ['standard'],
    addonType: 'CANTEEN_POS',
    aliases: ['canteen'],
    description: 'Touch-optimized canteen counter sales point with barcode product scanning, daily cash ledger, and inventory alerts.',
    institutionBenefit: 'Streamlines break-time food queues and accounts for daily campus refreshment revenue.',
    tierLevels: { starter: 'Not available', standard: 'Add-on (PKR 800/mo)', premium: 'Included in plan', enterprise: 'Included in plan' }
  },
  {
    id: '#99',
    key: 'student-tutor-chat',
    name: 'AI tutor chat',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['pdf-knowledge-library'],
    addonTiers: [],
    addonType: null,
    aliases: ['ai-chat'],
    description: '24/7 AI academic tutor that answers student syllabus questions strictly grounded in their textbooks and class notes.',
    institutionBenefit: 'Provides personalized academic support after college hours without increasing faculty teaching loads.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Lite model: 10 msgs/student/day', enterprise: 'Full model: 30 msgs/student/day' }
  },
  {
    id: '#100',
    key: 'pdf-knowledge-library',
    name: 'PDF knowledge library (AI chat over your PDFs)',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['ai-pdf-chat'],
    description: 'Retrieval-Augmented Generation (RAG) library indexing college textbooks, teacher notes, and board past papers for AI querying.',
    institutionBenefit: 'Prevents AI hallucinations by strictly constraining tutor responses to verified institutional PDFs.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Up to 25 PDFs, max 50 MB each', enterprise: 'Unlimited within storage, 100 MB max' }
  },
  {
    id: '#103',
    key: 'ai-pedagogy-generator',
    name: 'AI notes, assignment and syllabus generator',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Faculty assistant generating chapter lesson plans, lecture summaries, student worksheets, and concept handouts.',
    institutionBenefit: 'Dramatically cuts teacher lecture prep time and standardizes academic instructional quality.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Up to 100 generations/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: '#104',
    key: 'board-syllabus-mcqs',
    name: 'MCQs generated from board syllabus',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['ai-quiz-generator'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Curriculum-aligned question generator synthesizing high-yield MCQs mapped to specific SLOs of provincial boards.',
    institutionBenefit: 'Ensures test papers accurately reflect board examination style and cognitive depth.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Counts toward 150 quiz pool/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: '#105',
    key: 'weak-topic-detection',
    name: 'Weak-topic detection from test results',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Analytics engine identifying specific chapters, concepts, and question types where students consistently lose marks.',
    institutionBenefit: 'Pinpoints exact curriculum gaps so teachers can review problematic topics before final exams.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Per-class on-demand heatmap', enterprise: 'Automated weekly campus-wide scan' }
  },
  {
    id: '#107',
    key: 'document-ocr',
    name: 'Document OCR (pre-fill admission forms from matric cards)',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Vision AI OCR that scans matric result cards and B-forms, extracting candidate name, marks, and roll number automatically.',
    institutionBenefit: 'Accelerates desk admission data entry by 80% and eliminates typing errors in candidate records.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Up to 150 documents/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: '#111',
    key: 'payment-screenshot-ocr',
    name: 'Payment screenshot OCR',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['payment-proof-upload'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Vision AI extracting transaction ID, paid amount, timestamp, and sender details from JazzCash/Easypaisa/Bank receipt screenshots.',
    institutionBenefit: 'Pre-verifies fee screenshots in seconds and prevents fraudulent duplicate submission of old receipts.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Included within AI credits pool', enterprise: 'Included within AI credits pool' }
  },
  {
    id: 'N03',
    key: 'scheduled-reports-email',
    name: 'Scheduled reports by email',
    category: 'Operations',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['report-center'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated cron dispatcher emailing consolidated attendance, cash collection, and defaulter summaries to leadership weekly.',
    institutionBenefit: 'Keeps principals and trustees informed without requiring them to log into the software.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Weekly & monthly email schedules', enterprise: 'Custom executive report schedules' }
  },
  {
    id: 'N04',
    key: 'accountant-csv-export',
    name: 'Accountant file export (CSV)',
    category: 'Fees & Treasury',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['treasury-ledger'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Consolidated double-entry financial export formatted for external accounting software like QuickBooks, Sage, or Tally.',
    institutionBenefit: 'Bridges college fee collections directly into external professional auditing packages without re-entry.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Consolidated monthly accountant CSV', enterprise: 'Double-entry general ledger (N40)' }
  },
  {
    id: 'N10',
    key: 'custom-roles-permissions',
    name: 'Custom roles & permissions builder',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Granular RBAC permission manager allowing creation of specialized roles like Vice Principal, Exam Controller, or Fee Clerk.',
    institutionBenefit: 'Enforces principle of least privilege by restricting staff to their exact departmental responsibilities.',
    tierLevels: { starter: 'Fixed standard roles', standard: 'Fixed standard roles', premium: 'Custom role builder with permissions', enterprise: 'Unlimited custom roles & campus scopes' }
  },
  {
    id: 'N11',
    key: 'approval-workflows',
    name: 'Multi-step approval workflows',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['multi-step-approvals'],
    description: 'Configurable multi-stage authorization chains for high-stakes actions like fee waivers, refunds, and grade corrections.',
    institutionBenefit: 'Prevents unilateral decisions by requiring accountant and principal sign-offs before financial adjustments take effect.',
    tierLevels: { starter: 'Single approval', standard: 'Single approval', premium: '2-step approval hierarchy', enterprise: 'Unlimited multi-step approval chains' }
  },
  {
    id: 'N12',
    key: 'custom-domain',
    name: 'Custom domain integration',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Custom domain mapping allowing the college to run its portal under its official web address (e.g., portal.pgc.edu.pk).',
    institutionBenefit: 'Elevates institutional prestige and student trust with a branded institutional address.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Single custom domain with SSL', enterprise: 'Multiple domains & multi-campus hostnames' }
  },
  {
    id: 'N17',
    key: 'audit-log-export',
    name: 'Audit log download center',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['audit-trail'],
    addonTiers: [],
    addonType: null,
    aliases: ['comprehensive-audit-log'],
    description: 'Administrative export hub allowing security officers to download comprehensive system audit trails as CSV or encrypted JSON.',
    institutionBenefit: 'Complies with external data protection audits and supports internal forensic investigations.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'CSV audit log exports (180 days)', enterprise: 'Full forensic export & legal hold (N16)' }
  },
  {
    id: 'N18',
    key: 'multi-campus-dashboard',
    name: 'Combined multi-campus dashboard',
    category: 'Governance & Infrastructure',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['principal-executive-dashboard'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Consolidated executive cockpit displaying aggregated student headcounts, fee collections, and staff presence across branches.',
    institutionBenefit: 'Empowers network owners to benchmark branch performance and identify struggling campuses instantly.',
    tierLevels: { starter: '1 Campus only', standard: '1 Campus only', premium: 'Up to 2 Campuses combined', enterprise: 'Up to 3 Campuses combined' }
  },
  {
    id: 'N20',
    key: 'message-credit-wallet',
    name: 'Message credit wallet UI',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'live',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: ['credit-wallet'],
    description: 'Self-service wallet interface for tracking communication credit balances, delivery reports, and purchasing top-up bundles.',
    institutionBenefit: 'Maintains complete transparency over communication expenditure with detailed delivery audit logs.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Wallet UI with delivery reports', enterprise: 'Wallet UI with multi-campus allocation' }
  },
  {
    id: 'N22',
    key: 'parent-app-push-alerts',
    name: 'Installable parent app with push alerts',
    category: 'Parents & Comms',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['parent-portal-pwa'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Push notification engine delivering instant real-time alerts to installed parent smartphones for attendance and emergency notices.',
    institutionBenefit: 'Replaces recurring per-message SMS costs with zero-marginal-cost web push notifications.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Free push notifications to parent app', enterprise: 'White-label parent notifications' }
  },
  {
    id: 'N23',
    key: 'syllabus-coverage-tracker',
    name: 'Lesson plans and syllabus coverage tracker',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Academic curriculum tracking system where teachers log completed textbook topics and the Principal monitors syllabus pace.',
    institutionBenefit: 'Prevents end-of-year syllabus scrambles and ensures all board topics are thoroughly covered before exams.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Curriculum completion tracker & pace alert', enterprise: 'AI auto-linking with daily quizzes' }
  },
  {
    id: 'N26',
    key: 'paper-setting-moderation',
    name: 'Paper-setting workflow with moderation',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Secure paper-setting portal where teachers draft exam questions, subject moderators review difficulty, and papers stay locked.',
    institutionBenefit: 'Protects exam confidentiality and elevates paper quality to board examination standards.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Drafting & moderation workflow', enterprise: 'Multi-campus centralized paper bank' }
  },
  {
    id: 'N27',
    key: 'result-moderation-recheck',
    name: 'Result moderation and re-check requests',
    category: 'Examination & Test Prep',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Formal post-result workflow managing student paper re-checking applications, recounting logs, and authorized grace marks.',
    institutionBenefit: 'Provides an auditable dispute-resolution process for students and protects teacher credibility.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Re-checking requests & grace mark log', enterprise: 'Same on all tiers' }
  },
  {
    id: 'N30',
    key: 'live-class-lecture-library',
    name: 'Live-class links and recorded lecture library',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Virtual lecture portal linking Zoom/Google Meet links to timetable periods and hosting video lecture recordings.',
    institutionBenefit: 'Supports hybrid learning and provides revision material for absent or struggling students.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'External live links & video repository', enterprise: 'AI lecture transcription to notes (N49)' }
  },
  {
    id: 'N31',
    key: 'class-discussion-forum',
    name: 'Class discussion and Q&A forum',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Moderated subject-specific academic forums where students ask homework questions and teachers post clarifications.',
    institutionBenefit: 'Fosters collaborative peer learning under supervised, safe institutional moderation.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Moderated section discussion boards', enterprise: 'Same on all tiers' }
  },
  {
    id: '#32_N32',
    key: 'discipline-counselling-records',
    name: 'Discipline and counselling records',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Restricted-access behavioral tracking portal recording misconduct incidents, suspensions, parent counseling, and medical notes.',
    institutionBenefit: 'Maintains confidential historical records for student welfare without compromising privacy.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Confidential discipline file & alerts', enterprise: 'Multi-campus behavioral history' }
  },
  {
    id: 'N33',
    key: 'events-sports-clubs',
    name: 'Events, sports and clubs',
    category: 'Operations',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Co-curricular manager organizing student societies (Debating, Science, Sports, Dramatics), event registration, and tournament rosters.',
    institutionBenefit: 'Strengthens student campus life and tracks non-academic achievements for character certificates.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Societies, sports & event management', enterprise: 'Inter-campus tournament coordination' }
  },
  {
    id: 'N34',
    key: 'alumni-records-placement',
    name: 'Alumni records and placement tracking',
    category: 'Academic Core',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Graduate network directory logging university placements, employment status, contact details, and alumni donations.',
    institutionBenefit: 'Maintains strong alumni relations to support campus fundraising and prospective student recruitment.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Graduate database & placement logs', enterprise: 'Alumni network portal' }
  },
  {
    id: 'N35',
    key: 'library-management',
    name: 'Library management module',
    category: 'Operations',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: ['standard'],
    addonType: 'LIBRARY_MODULE',
    aliases: [],
    description: 'Comprehensive college library system with book accession register, barcode check-out/return, and overdue fine calculations.',
    institutionBenefit: 'Protects expensive reference books from loss and accelerates book circulation.',
    tierLevels: { starter: 'Not available', standard: 'Add-on (PKR 800/mo)', premium: 'Included in plan', enterprise: 'Included in plan' }
  },
  {
    id: 'N38',
    key: 'inventory-asset-register',
    name: 'Inventory, stationery and asset register',
    category: 'Operations',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Campus asset register tracking classroom furniture, IT hardware, generators, sports equipment, and recurring stationery stock.',
    institutionBenefit: 'Prevents asset theft, schedules routine maintenance, and accounts for campus depreciation.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Fixed assets & stock inventory', enterprise: 'Multi-campus asset depreciation' }
  },
  {
    id: 'N39',
    key: 'purchase-requests-vendor-ledger',
    name: 'Purchase requests and vendor ledger',
    category: 'Fees & Treasury',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['treasury-ledger'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Departmental procurement system routing staff requisitions, quotations, purchase orders, and vendor invoice settlements.',
    institutionBenefit: 'Maintains strict financial governance over campus expenses and tracks vendor payables.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Requisition portal & vendor ledger', enterprise: 'Departmental budget integration (N41)' }
  },
  {
    id: 'N43',
    key: 'auto-payment-matching',
    name: 'Automatic payment matching',
    category: 'Fees & Treasury',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['payment-screenshot-ocr'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated reconciliation engine matching OCR transaction IDs against bank statements and 1Link settlement records.',
    institutionBenefit: 'Eliminates hours of manual voucher reconciliation by auto-approving matched student fee receipts.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'OCR transaction ID matching', enterprise: 'Full bank settlement automation' }
  },
  {
    id: 'N44',
    key: 'ai-readonly-assistant',
    name: 'AI assistant (read-only)',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Conversational assistant enabling administrators to query college data in natural language without write privileges.',
    institutionBenefit: 'Allows instant answers to operational queries without searching through complex database tables.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Read-only college records assistant', enterprise: 'Autonomous AI admin agent (N45)' }
  },
  {
    id: 'N46',
    key: 'ask-your-data',
    name: 'Ask-Your-Data conversational analytics',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['report-center'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Conversational data reporting interface generating instant charts and tables from natural language prompts using safe queries.',
    institutionBenefit: 'Democratizes complex business intelligence for principals and non-technical trustees.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Up to 50 queries/mo', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: 'N47',
    key: 'ai-report-card-remarks',
    name: 'AI report-card remarks and parent message drafts',
    category: 'AI & Intelligence Suite',
    startsIn: 'premium',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['digital-report-card-remarks'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Generative AI assistant synthesizing student marks and attendance into constructive, personalized remarks in English and Urdu.',
    institutionBenefit: 'Assists teachers in writing hundreds of meaningful, individualized student comments in minutes.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Included within AI credits pool', enterprise: 'Included within AI credits pool' }
  },

  // -------------------------------------------------------------
  // ENTERPRISE TIER (21 Services: 1 Live + 20 Coming Soon)
  // Cumulative: 141 + 21 = 162 Services
  // -------------------------------------------------------------
  {
    id: '#102',
    key: 'ai-timetable-fixer',
    name: 'AI timetable conflict explainer and fixer',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: ['auto-timetable-generator'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'AI-assisted schedule repair tool that diagnoses timetable clashes, explains root bottlenecks, and proposes minimal room/teacher swaps.',
    institutionBenefit: 'Resolves complex scheduling deadlocks that human planners spend days attempting to fix.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Full AI constraint explainer & auto-fixer' }
  },
  {
    id: '#106',
    key: 'study-plan-suggestions',
    name: 'Study plan suggestions per student',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records', 'weak-topic-detection'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Personalized remedial schedule generator tailoring daily study routines based on individual student test weaknesses.',
    institutionBenefit: 'Delivers private-tutor quality study guidance to every enrolled student at scale.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: '#108',
    key: 'whatsapp-admissions-chatbot',
    name: 'WhatsApp admissions chatbot',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['whatsapp-alerts'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Autonomous 24/7 WhatsApp bot answering applicant queries regarding eligibility, fees, merit cutoffs, and prospectus links.',
    institutionBenefit: 'Captures and qualifies admission leads around the clock without keeping staff at phone desks.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Full autonomous conversational intake' }
  },
  {
    id: '#110',
    key: 'ai-at-risk-alerts',
    name: 'AI at-risk student alerts',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records', 'daily-attendance'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Predictive early-warning system scanning attendance trajectories and test scores to flag students at risk of failing.',
    institutionBenefit: 'Allows academic leadership to intervene proactively before failures harm the college public pass percentage.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Automated weekly campus-wide risk audit' }
  },
  {
    id: 'N05',
    key: 'self-service-data-backup',
    name: 'Self-service data backup and restore points',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Automated full database and document storage backup generator producing downloadable encrypted ZIP archives.',
    institutionBenefit: 'Guarantees sovereign data ownership and institutional disaster recovery independence.',
    tierLevels: { starter: 'On leaving only', standard: 'On leaving only', premium: 'On leaving only', enterprise: '1 self-service ZIP download / month' }
  },
  {
    id: 'N06',
    key: 'public-api-webhooks',
    name: 'Public API and webhooks',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Comprehensive REST API and real-time event webhooks enabling integration with custom college portals, ERPs, and mobile apps.',
    institutionBenefit: 'Allows IT departments to seamlessly extend Academix with internal institutional systems.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: '100,000 API calls/mo included' }
  },
  {
    id: 'N14',
    key: 'single-sign-on',
    name: 'Single Sign-On (SSO)',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Enterprise identity federation allowing faculty and administrators to sign in using Google Workspace or Microsoft Azure AD accounts.',
    institutionBenefit: 'Simplifies password management and allows instant de-provisioning of departing staff via central directory.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Google Workspace & Microsoft Azure AD SSO' }
  },
  {
    id: 'N15',
    key: 'ip-allowlist-session-controls',
    name: 'Campus IP allow-listing',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: [],
    addonTiers: [],
    addonType: null,
    aliases: ['ip-allowlisting'],
    description: 'Network perimeter security restricting administrative and cashier access strictly to authorized campus IP addresses and subnets.',
    institutionBenefit: 'Prevents staff from accessing sensitive financial ledgers and student records from outside college grounds.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Campus IP subnet whitelist' }
  },
  {
    id: 'N16',
    key: 'data-retention-legal-hold',
    name: 'Data retention rules and legal hold',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: ['audit-trail'],
    addonTiers: [],
    addonType: null,
    aliases: ['legal-hold', 'data-retention'],
    description: 'Institutional compliance manager establishing automated record purging schedules and legal hold (delete protection) for records under active legal dispute.',
    institutionBenefit: 'Protects the college from statutory liability while ensuring compliance with record privacy laws.',
    tierLevels: { starter: '30 days retention', standard: '90 days retention', premium: '180 days retention', enterprise: '365 days retention + legal hold delete protection' }
  },
  {
    id: 'N19',
    key: 'cross-campus-transfers',
    name: 'Cross-campus student transfers',
    category: 'Governance & Infrastructure',
    startsIn: 'enterprise',
    status: 'live',
    isCore: false,
    dependsOn: ['sessions-classes-groups'],
    addonTiers: [],
    addonType: null,
    aliases: ['inter-campus-transfers'],
    description: 'Inter-branch migration manager transferring student enrollment, paid fees, and academic records seamlessly between branch campuses.',
    institutionBenefit: 'Provides unified multi-campus mobility for college networks without manual paperwork.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Full cross-campus student migration' }
  },
  {
    id: 'N36',
    key: 'transport-management',
    name: 'Transport management module',
    category: 'Operations',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: ['standard', 'premium'],
    addonType: 'TRANSPORT_MODULE',
    aliases: [],
    description: 'College bus and van management tracking transport routes, pickup stops, vehicle fitness, driver details, and monthly bus fees.',
    institutionBenefit: 'Coordinates student transportation safety and automatically bills monthly transport charges on fee challans.',
    tierLevels: { starter: 'Not available', standard: 'Add-on (PKR 1,200/mo)', premium: 'Add-on (PKR 1,200/mo)', enterprise: 'Included in plan' }
  },
  {
    id: 'N37',
    key: 'hostel-management',
    name: 'Hostel management module',
    category: 'Operations',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['student-records'],
    addonTiers: ['standard', 'premium'],
    addonType: 'HOSTEL_MODULE',
    aliases: [],
    description: 'Campus residential hostel system governing room inventory, bed allotment, warden registers, mess billing, and gate curfews.',
    institutionBenefit: 'Ensures safe boarding operations and automates hostel accommodation fee collections.',
    tierLevels: { starter: 'Not available', standard: 'Add-on (PKR 1,200/mo)', premium: 'Add-on (PKR 1,200/mo)', enterprise: 'Included in plan' }
  },
  {
    id: 'N40',
    key: 'double-entry-accounting',
    name: 'Double-entry accounting and financial statements',
    category: 'Fees & Treasury',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['treasury-ledger'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'GAAP-compliant accounting engine maintaining Chart of Accounts, journal entries, trial balance, income statement, and balance sheet.',
    institutionBenefit: 'Delivers full financial transparency and eliminates the need for expensive third-party accounting software.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Full double-entry general ledger & balance sheet' }
  },
  {
    id: 'N41',
    key: 'department-budgets-cost-centers',
    name: 'Budgets and cost centres',
    category: 'Fees & Treasury',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['double-entry-accounting'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Departmental spending control system establishing annual expense budgets per campus or subject department with overspend warnings.',
    institutionBenefit: 'Guarantees financial discipline and prevents departments from exceeding authorized operational budgets.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Campus & departmental cost center controls' }
  },
  {
    id: 'N42',
    key: 'staff-appraisal-recruitment',
    name: 'Staff appraisal, contracts and recruitment',
    category: 'HR & Staff',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['staff-accounts-leaves'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Human resources management pipeline managing faculty candidate applications, interviews, contract renewals, and annual appraisal scoring.',
    institutionBenefit: 'Professionalizes academic hiring and maintains structured employee performance reviews.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Recruitment pipeline & annual appraisals' }
  },
  {
    id: 'N45',
    key: 'autonomous-admin-agent',
    name: 'Autonomous AI Admin Agent',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['ai-readonly-assistant'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Autonomous AI operational agent drafting routine administrative actions (fee reminders, timetable adjustments) with 1-click human confirmation.',
    institutionBenefit: 'Acts as a tireless virtual assistant for the Principal, multiplying administrative team productivity.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Autonomous AI action drafts with confirmation' }
  },
  {
    id: 'N48',
    key: 'ai-outreach-anomaly-alerts',
    name: 'AI outreach drafts and attendance anomaly alerts',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['daily-attendance', 'ai-readonly-assistant'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Pattern recognition engine detecting abnormal multi-day absence clusters, spikes in student dropouts, and drafting outreach messages.',
    institutionBenefit: 'Surfaces hidden behavioral anomalies before they develop into major student drop-out incidents.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'AI pattern detection & automated outreach' }
  },
  {
    id: 'N49',
    key: 'ai-audio-transcription',
    name: 'AI lecture-to-notes from audio',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['live-class-lecture-library'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Speech-to-text AI model transcribing recorded classroom lectures into formatted, searchable student study notes in English and Urdu.',
    institutionBenefit: 'Instantly converts daily faculty lectures into revision notes for absent and revision-seeking students.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Unlimited within AI credits pool' }
  },
  {
    id: 'N50',
    key: 'ai-answer-marking-assistant',
    name: 'AI answer-check assistant',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['exams-roll-slips-results'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Rubric-based AI grading assistant that analyzes written student answers, suggests marks, and highlights missing key concepts.',
    institutionBenefit: 'Accelerates teacher essay and short-answer grading while maintaining objective rubric consistency.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Rubric marking suggestions with teacher review' }
  },
  {
    id: 'N51',
    key: 'ai-admission-lead-scoring',
    name: 'AI admission lead scoring and follow-up',
    category: 'AI & Intelligence Suite',
    startsIn: 'enterprise',
    status: 'coming_soon',
    isCore: false,
    dependsOn: ['enquiry-lead-tracking'],
    addonTiers: [],
    addonType: null,
    aliases: [],
    description: 'Predictive scoring model evaluating admission enquiry conversion probability and prioritizing counseling callback schedules.',
    institutionBenefit: 'Focuses admission staff energy on the highest-potential applicants to maximize college enrollment yield.',
    tierLevels: { starter: 'Not available', standard: 'Not available', premium: 'Not available', enterprise: 'Predictive admission yield scoring' }
  }
];

// Legacy feature key alias map for 100% backward compatibility
const FEATURE_ALIASES = {
  'core-academic': 'sessions-classes-groups',
  'attendance': 'daily-attendance',
  'timetable': 'section-timetable',
  'exams-results': 'exams-roll-slips-results',
  'assignments-quizzes': 'assignments-submissions',
  'certificates': 'certificates',
  'announcements': 'announcements',
  'fees': 'cash-fee-vouchers',
  'employees': 'staff-accounts-leaves',
  'canteen': 'canteen-pos',
  'analytics-reports': 'report-center',
  'entry-system': 'gate-qr-auto-attendance',
  'visitors': 'visitor-management',
  'ai-chat': 'student-tutor-chat',
  'ai-pdf-chat': 'pdf-knowledge-library',
  'ai-generators': 'ai-quiz-generator'
};

/**
 * Validates the full 162-service DAG for uniqueness, categories, valid tiers,
 * proper tier hierarchy ordering, and zero cyclic dependencies.
 */
function validateRegistryDAG() {
  const keys = new Set();
  const ids = new Set();
  const byTier = { starter: 0, standard: 0, premium: 0, enterprise: 0 };
  const byStatus = { live: 0, coming_soon: 0 };

  for (const s of FEATURE_REGISTRY) {
    if (keys.has(s.key)) throw new Error(`Duplicate service key: ${s.key}`);
    keys.add(s.key);

    if (ids.has(s.id)) throw new Error(`Duplicate service id: ${s.id}`);
    ids.add(s.id);

    if (!CATEGORIES.includes(s.category)) throw new Error(`Invalid category for ${s.key}: ${s.category}`);
    if (!['starter', 'standard', 'premium', 'enterprise'].includes(s.startsIn)) {
      throw new Error(`Invalid startsIn tier for ${s.key}: ${s.startsIn}`);
    }
    if (!['live', 'coming_soon'].includes(s.status)) {
      throw new Error(`Invalid status for ${s.key}: ${s.status}`);
    }

    byTier[s.startsIn]++;
    byStatus[s.status]++;
  }

  // Tier ordering & valid dependency check
  for (const s of FEATURE_REGISTRY) {
    for (const depKey of s.dependsOn) {
      const dep = FEATURE_REGISTRY.find(x => x.key === depKey);
      if (!dep) {
        throw new Error(`Service ${s.key} depends on non-existent ${depKey}`);
      }
      const sLvl = PLAN_LEVEL[s.startsIn];
      const depLvl = PLAN_LEVEL[dep.startsIn];
      if (depLvl > sLvl) {
        const allowsAddon = dep.addonTiers && dep.addonTiers.includes(s.startsIn);
        if (!allowsAddon) {
          throw new Error(`Tier inversion: ${s.key} (${s.startsIn}) depends on higher ${depKey} (${dep.startsIn}) without add-on!`);
        }
      }
    }
  }

  // Cycle check using DFS
  const visited = new Map();
  function dfs(key) {
    visited.set(key, 1);
    const s = FEATURE_REGISTRY.find(x => x.key === key);
    if (s && s.dependsOn) {
      for (const dep of s.dependsOn) {
        if (visited.get(dep) === 1) {
          throw new Error(`Dependency cycle detected involving ${key} -> ${dep}`);
        }
        if (!visited.get(dep)) {
          dfs(dep);
        }
      }
    }
    visited.set(key, 2);
  }

  for (const s of FEATURE_REGISTRY) {
    if (!visited.get(s.key)) {
      dfs(s.key);
    }
  }

  return {
    total: FEATURE_REGISTRY.length,
    byTier,
    byStatus,
    valid: true
  };
}

/**
 * Resolves effective active features for a given college subscription,
 * taking into account:
 * 1. Base tier inclusion (nested: starter -> standard -> premium -> enterprise)
 * 2. Active, unexpired add-on modules (e.g. CANTEEN_POS, LIBRARY_MODULE)
 * 3. Administrative overrides (FORCE_ON / FORCE_OFF)
 * 4. Deterministic fixed-point dependency propagation (disabling deps blocks dependents)
 *
 * @param {string} rawPlanId - Plan ID ('starter', 'standard', 'premium', 'enterprise')
 * @param {object} rawOverrides - Stored overrides (e.g. { 'canteen-pos': 'FORCE_ON' } or boolean)
 * @param {string[]} activeAddons - Array of active addonType strings (e.g. ['CANTEEN_POS', 'LIBRARY_MODULE'])
 * @returns {object} - { planId, effectiveKeys, featureMatrix, stats }
 */
function resolveCollegeFeatures(rawPlanId, rawOverrides = {}, activeAddons = []) {
  const planId = normalizePlanId(rawPlanId);
  const planLvl = PLAN_LEVEL[planId] ?? 0;
  const overrides = (typeof rawOverrides === 'object' && rawOverrides !== null) ? rawOverrides : {};
  const addonsSet = new Set(Array.isArray(activeAddons) ? activeAddons : []);

  const stateMap = new Map();

  for (const feat of FEATURE_REGISTRY) {
    const featLvl = PLAN_LEVEL[feat.startsIn] ?? 0;
    const inPlanBase = planLvl >= featLvl;
    const hasAddon = feat.addonType && addonsSet.has(feat.addonType);
    const inPlan = inPlanBase || hasAddon;

    // Read override (support string 'FORCE_ON' / 'FORCE_OFF' or boolean)
    let overrideVal = overrides[feat.key];
    if (overrideVal === undefined && feat.aliases) {
      for (const alias of feat.aliases) {
        if (overrides[alias] !== undefined) {
          overrideVal = overrides[alias];
          break;
        }
      }
    }

    let override = null;
    if (overrideVal === true || overrideVal === 'FORCE_ON' || overrideVal === 'true') {
      override = true;
    } else if (overrideVal === false || overrideVal === 'FORCE_OFF' || overrideVal === 'false') {
      override = false;
    }

    // Foundation core features are unconditionally active
    if (feat.isCore) {
      stateMap.set(feat.key, {
        ...feat,
        inPlan: true,
        override: null,
        effective: true,
        dependencyBlocked: false,
        blockedBy: [],
        source: 'core_foundation'
      });
      continue;
    }

    let effective = inPlan;
    let source = inPlan ? 'plan_default' : 'plan_excluded';

    if (override === true) {
      effective = true;
      source = inPlan ? 'plan_default' : 'custom_enabled';
    } else if (override === false) {
      effective = false;
      source = 'custom_disabled';
    } else if (hasAddon) {
      effective = true;
      source = 'addon_module';
    }

    stateMap.set(feat.key, {
      ...feat,
      inPlan,
      override,
      effective,
      dependencyBlocked: false,
      blockedBy: [],
      source
    });
  }

  // Fixed-point dependency propagation
  let changed = true;
  let iterations = 0;
  const maxIterations = FEATURE_REGISTRY.length * 2;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (const feat of FEATURE_REGISTRY) {
      const current = stateMap.get(feat.key);
      if (!current || current.isCore) continue;

      if (current.effective && feat.dependsOn && feat.dependsOn.length > 0) {
        const missingDeps = [];
        for (const depKey of feat.dependsOn) {
          const depState = stateMap.get(depKey);
          if (!depState || !depState.effective) {
            missingDeps.push(depKey);
          }
        }

        if (missingDeps.length > 0) {
          current.effective = false;
          current.dependencyBlocked = true;
          current.blockedBy = missingDeps;
          current.source = 'dependency_blocked';
          changed = true;
        }
      }
    }
  }

  const featureMatrix = Array.from(stateMap.values());
  const effectiveKeysSet = new Set(featureMatrix.filter(f => f.effective).map(f => f.key));

  // Add backward-compatible alias keys into effectiveKeys list
  for (const feat of featureMatrix) {
    if (feat.effective && feat.aliases) {
      for (const alias of feat.aliases) {
        effectiveKeysSet.add(alias);
      }
    }
  }

  const effectiveKeys = Array.from(effectiveKeysSet);

  const stats = {
    totalFeatures: featureMatrix.length,
    planIncluded: featureMatrix.filter(f => f.inPlan).length,
    customEnabled: featureMatrix.filter(f => f.override === true).length,
    customDisabled: featureMatrix.filter(f => f.override === false).length,
    dependencyBlocked: featureMatrix.filter(f => f.dependencyBlocked).length,
    effectiveActive: effectiveKeys.length
  };

  return {
    planId,
    effectiveKeys,
    featureMatrix,
    stats
  };
}

// Pre-compute PLAN_FEATURES for fast lookup and legacy compatibility
const PLAN_FEATURES = {};
for (const plan of ['starter', 'basic', 'standard', 'premium', 'enterprise']) {
  const norm = normalizePlanId(plan);
  const lvl = PLAN_LEVEL[norm] ?? 0;
  const keys = [];
  for (const feat of FEATURE_REGISTRY) {
    const featLvl = PLAN_LEVEL[feat.startsIn] ?? 0;
    if (lvl >= featLvl) {
      keys.push(feat.key);
      if (feat.aliases) keys.push(...feat.aliases);
    }
  }
  PLAN_FEATURES[plan] = Array.from(new Set(keys));
}

module.exports = {
  CATEGORIES,
  FEATURE_REGISTRY,
  FEATURE_ALIASES,
  PLAN_FEATURES,
  validateRegistryDAG,
  resolveCollegeFeatures,
  normalizePlanId
};
