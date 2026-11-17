'use strict';

/**
 * backend/scripts/reconcile_services.js — Stage 0.5 (T0.5)
 * Strictly READ-ONLY repository reconciliation across all 162 services (#1-#111, N01-N51).
 * Connects to NO database. Inspects source spec, featureRegistry.js, capabilityCatalog.js,
 * featureMatrix.js, backend/routes/*, backend/controllers/*, backend/services/*,
 * backend/prisma/schema.prisma, and client-next UI files.
 *
 * Outputs (in ../reconciliation/):
 *   - service_reconciliation.csv
 *   - service_reconciliation.md
 *   - summary.md
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const SOURCE_MD_PATH = path.join(ROOT_DIR, 'new work', 'Academix_Plans_and_Services_Split_-_Three_Plans.md');
const RECON_DIR = path.join(ROOT_DIR, 'reconciliation');

const { FEATURE_REGISTRY, FEATURE_ALIASES } = require('../config/featureRegistry');
const { FEATURES: CAP_FEATURES, LEGACY_KEY_MAP } = require('../services/capabilityCatalog');

// ---------------------------------------------------------------------------
// 1. Parse all 162 services from Source of Truth Markdown
// ---------------------------------------------------------------------------
function parseSourceServices() {
  const txt = fs.readFileSync(SOURCE_MD_PATH, 'utf8');
  const lines = txt.split(/\r?\n/);
  let section = '';
  const list = [];

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^### Starts in Starter/i.test(l)) section = 'Starter';
    else if (/^### Starts in Standard/i.test(l)) section = 'Standard';
    else if (/^### Starts in Premium/i.test(l)) section = 'Premium';
    else if (/^### Services sold only as add-ons/i.test(l)) section = 'AddonOnlySection';
    else if (/^### (Data and exports|Security and platform|Multi-campus|Academics|Optional modules|Finance, HR|AI)/i.test(l)) section = 'NewSection';

    if (/^\| \d+ \|/.test(l)) {
      const cols = l.split('|').map(x => x.trim());
      list.push({
        id: '#' + cols[1],
        numSort: parseInt(cols[1], 10),
        name: cols[2],
        sourcePlan: section,
        sourceStatus: cols[3], // Live | In progress | Roadmap
        sourceChange: cols[4],
        sourceNotes: cols[5] || '',
      });
    } else if (/^\| N\d{2} \|/.test(l) && section !== 'AddonOnlySection') {
      const cols = l.split('|').map(x => x.trim());
      const rawPlan = cols[4] || '';
      const planLabel = /add-on only/i.test(rawPlan) ? 'Add-on only' : rawPlan;
      list.push({
        id: cols[1],
        numSort: 1000 + parseInt(cols[1].slice(1), 10),
        name: cols[2],
        sourcePlan: planLabel,
        sourceStatus: 'Roadmap', // Per source file L30: "the 51 new services are not built yet"
        sourceChange: 'New',
        sourceNotes: cols[3] || '',
      });
    }
  }

  return list;
}

// ---------------------------------------------------------------------------
// 2. Index codebase artifacts statically (routes, controllers, services, schema, UI)
// ---------------------------------------------------------------------------
function walkFiles(dir, exts = ['.js', '.jsx', '.ts', '.tsx']) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', 'out', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some(e => entry.name.endsWith(e)) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

function indexSchemaModels() {
  const schemaPath = path.join(ROOT_DIR, 'backend', 'prisma', 'schema.prisma');
  const lines = fs.readFileSync(schemaPath, 'utf8').split(/\r?\n/);
  const map = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^model\s+(\w+)\s*\{/);
    if (m) map.set(m[1], i + 1);
  }
  return map;
}

function indexRoutesAndServer() {
  const serverPath = path.join(ROOT_DIR, 'backend', 'server.js');
  const srvTxt = fs.readFileSync(serverPath, 'utf8');
  const routeToMount = new Map();
  srvTxt.split(/\r?\n/).forEach((l, idx) => {
    const m = l.match(/app\.use\(['"]([^'"]+)['"],\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/);
    if (m) {
      const rName = m[2].endsWith('.js') ? m[2] : `${m[2]}.js`;
      if (!routeToMount.has(rName)) routeToMount.set(rName, []);
      routeToMount.get(rName).push({ mount: m[1], line: idx + 1 });
    }
  });

  const routesDir = path.join(ROOT_DIR, 'backend', 'routes');
  const routeInfo = new Map();
  for (const fname of fs.readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
    const full = path.join(routesDir, fname);
    const txt = fs.readFileSync(full, 'utf8');
    const lines = txt.split(/\r?\n/);
    const gates = [];
    const ctrls = [];
    let firstEpLine = null;
    lines.forEach((l, idx) => {
      const gRe = /(subscriptionGate|featureGate|planGate)\((?:\[([^\]]+)\]|['"]([^'"]+)['"])\)/g;
      let gm;
      while ((gm = gRe.exec(l))) {
        const keys = gm[3]
          ? [gm[3]]
          : gm[2].split(',').map(s => s.replace(/['"\s]/g, '')).filter(Boolean);
        keys.forEach(k => gates.push({ fn: gm[1], key: k, line: idx + 1 }));
      }
      const cm = l.match(/require\(['"].*controllers\/([^'"]+)['"]\)/);
      if (cm) ctrls.push(`backend/controllers/${cm[1].endsWith('.js') ? cm[1] : cm[1] + '.js'}`);
      const sm = l.match(/require\(['"].*services\/([^'"]+)['"]\)/);
      if (sm) ctrls.push(`backend/services/${sm[1].endsWith('.js') ? sm[1] : sm[1] + '.js'}`);
      if (firstEpLine === null && /router\.(get|post|put|patch|delete|route)\(/i.test(l)) {
        firstEpLine = idx + 1;
      }
    });
    routeInfo.set(fname, {
      file: `backend/routes/${fname}`,
      mounts: routeToMount.get(fname) || [],
      gates,
      ctrls,
      firstEpLine: firstEpLine || 1,
      txt,
    });
  }
  return routeInfo;
}

function indexUiFiles() {
  const clientDir = path.join(ROOT_DIR, 'client-next');
  const uiPaths = [
    ...walkFiles(path.join(clientDir, 'app')),
    ...walkFiles(path.join(clientDir, 'legacy-pages')),
    ...walkFiles(path.join(clientDir, 'components')),
    ...walkFiles(path.join(clientDir, 'services')),
    ...walkFiles(path.join(clientDir, 'features')),
  ];
  return uiPaths.map(p => ({
    rel: path.relative(ROOT_DIR, p).replace(/\\/g, '/'),
    txt: fs.readFileSync(p, 'utf8'),
  }));
}

function parseFeatureMatrixKeys() {
  const fmPath = path.join(ROOT_DIR, 'client-next', 'lib', 'featureMatrix.js');
  const txt = fs.readFileSync(fmPath, 'utf8');
  const plansBlock = txt.slice(0, txt.indexOf('export function computeReactiveFeatureMatrix'));
  const keys = new Set();
  const re = /'([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(plansBlock))) {
    if (!['starter', 'basic', 'standard', 'premium', 'enterprise'].includes(m[1])) keys.add(m[1]);
  }
  return Array.from(keys);
}

// ---------------------------------------------------------------------------
// 3. Explicit Evidence Mapping per Source ID (grounded strictly in real files)
//    Format: { routes, ctrls, models, ui, capKey, note, forcePartial, forceNo, noModelNeeded }
//    If a file/symbol does not exist on disk, verification prints "not found"!
// ---------------------------------------------------------------------------
const EVIDENCE_SPECS = {
  '#1': { cap: 'core-academic', routes: ['session.routes.js', 'class.routes.js', 'group.routes.js', 'section.routes.js', 'subject.routes.js'], ctrls: ['session.controller.js', 'class.controller.js', 'group.controller.js', 'section.controller.js', 'subject.controller.js'], models: ['Session', 'Class', 'Group', 'Section', 'Subject'], ui: ['ClassesAndSections.jsx', 'Sessions.jsx', 'Subjects.jsx'] },
  '#2': { cap: 'students', routes: ['student.routes.js'], ctrls: ['student.controller.js'], models: ['Student'], ui: ['admin/students/page.js', 'admin/Students.jsx'] },
  '#3': { cap: 'attendance', routes: ['attendance.routes.js'], ctrls: ['attendance.controller.js'], models: ['Attendance'], ui: ['admin/Attendance.jsx', 'teacher/TeacherAttendance.jsx'] },
  '#4': { cap: 'timetable', routes: ['timetable.routes.js'], ctrls: ['timetable.controller.js'], models: ['Timetable'], ui: ['admin/TimetablePage.jsx'] },
  '#5': { cap: 'exams-results', routes: ['exam.routes.js', 'result.routes.js'], ctrls: ['exam.controller.js', 'result.controller.js'], models: ['Exam', 'Result'], ui: ['admin/Exams.jsx', 'admin/Results.jsx', 'admin/RollSlips.jsx'] },
  '#6': { cap: 'announcements', routes: ['announcement.routes.js', 'notification.routes.js'], ctrls: ['announcement.controller.js', 'notification.controller.js'], models: ['Announcement', 'Notification'], ui: ['admin/Announcements.jsx'] },
  '#7': { cap: 'groups-subjects', routes: ['group.routes.js', 'subject.routes.js'], ctrls: ['groupSubject.controller.js'], models: ['GroupSubject', 'StudentSubject'], ui: ['admin/GroupSubjects.jsx'] },
  '#8': { cap: 'combined-classes', routes: ['combinedClass.routes.js'], ctrls: ['batch.controller.js'], models: ['CombinedClass'], ui: [] },
  '#9': { cap: 'group-transfer', routes: ['student.routes.js'], ctrls: ['groupSubject.controller.js'], models: ['Student', 'Group'], ui: ['admin/Students.jsx', 'GroupSubjects.jsx'] },
  '#10': { cap: 'session-batches', routes: ['batch.routes.js'], ctrls: ['batch.controller.js'], models: ['Batch', 'StudentPromotion'], ui: ['admin/Promotions.jsx'] },
  '#11': { cap: 'internal-tests', routes: ['exam.routes.js'], ctrls: ['exam.controller.js'], models: ['Exam', 'Result'], ui: ['admin/Exams.jsx'] },
  '#12': { cap: 'admission-matric-capture', routes: ['public.routes.js', 'registrar.routes.js'], ctrls: ['public.controller.js', 'admissions.controller.js'], models: ['Application'], ui: ['apply/[code]/_client.js'] },
  '#13': { cap: 'fees-basic', routes: ['fee.routes.js'], ctrls: ['fee.controller.js'], models: ['Fee', 'FeeStructure', 'StudentFee'], ui: ['admin/Fees.jsx'] },
  '#14': { cap: 'gate-manual-log', routes: ['guard.routes.js'], ctrls: ['guard.controller.js'], models: ['GateLog'], ui: ['employee/GuardDashboard.jsx'] },
  '#15': { cap: 'assignments', routes: ['assignment.routes.js'], ctrls: ['assignment.controller.js'], models: ['Assignment'], ui: ['admin/Assignments.jsx', 'teacher/TeacherAssignments.jsx'] },
  '#16': { cap: 'college-branding', routes: ['college.routes.js'], ctrls: ['college.controller.js'], models: ['College'], ui: ['admin/Settings.jsx'] },
  '#17': { cap: 'student-photo', routes: ['student.routes.js'], ctrls: ['student.controller.js'], models: ['Student'], ui: ['admin/Students.jsx', 'IDCardPrint.jsx'] },
  '#18': { cap: 'teacher-subjects', routes: ['timetable.routes.js'], ctrls: ['timetable.controller.js'], models: ['Teacher', 'TeacherSubject'], ui: ['teacher/Dashboard.jsx'] },
  '#19': { cap: 'student-timetable', routes: ['timetable.routes.js'], ctrls: ['timetable.controller.js'], models: ['Timetable'], ui: ['student/StudentTimetable.jsx'] },
  '#20': { cap: 'teacher-today', routes: ['timetable.routes.js'], ctrls: ['timetable.controller.js'], models: ['Timetable'], ui: ['teacher/TeacherTimetable.jsx', 'teacher/Dashboard.jsx'] },
  '#21': { cap: 'role-themes', routes: [], ctrls: [], models: [], ui: ['styles/globals.css', 'components/layout/Sidebar.jsx'], noModelNeeded: true, noBackendNeeded: true, note: 'Frontend theme tokens per role panel (phase17 CSS vars + Sidebar)' },
  '#22': { cap: 'media-optimization', routes: ['files.routes.js'], ctrls: ['svc:mediaOptimizer.js', 'svc:fileCleanupScheduler.js'], models: ['StoredFile'], ui: ['services/fileUpload.service.js'] },
  '#23': { cap: 'audit-logs', routes: ['activityLog.routes.js', 'auditLog.routes.js'], ctrls: ['activityLog.controller.js', 'auditLog.controller.js'], models: ['ActivityLog', 'AuditLog'], ui: ['admin/activity-log/page.js'] },
  '#24': { cap: 'trash', routes: ['trash.routes.js'], ctrls: ['trash.controller.js', 'svc:trashService.js'], models: ['Announcement', 'Assignment'], ui: ['admin/trash/page.js', 'services/trash.service.js'] },
  '#25': { cap: 'circulars', routes: ['announcement.routes.js'], ctrls: ['announcement.controller.js'], models: ['Announcement', 'CircularReadReceipt'], ui: ['admin/Announcements.jsx'], note: 'Partial read-receipt support in Announcement' },
  '#26': { cap: 'file-vault', routes: ['files.routes.js'], ctrls: ['svc:storageQuotaService.js', 'svc:storageService.js'], models: ['StoredFile', 'UploadReservation'], ui: ['services/fileUpload.service.js'], note: 'Backend upload reservation & quota exists; standalone File Vault admin UI not found' },
  '#27': { cap: 'bulk-import', routes: ['bulkImport.routes.js', 'onboarding.routes.js'], ctrls: ['bulkImport.controller.js', 'studentImport.controller.js'], models: ['BulkImportJob', 'BulkImportRow', 'ImportBatch'], ui: ['app/onboarding/page.js'] },
  '#28': { cap: 'notice-board', routes: ['classDiary.routes.js'], ctrls: ['classDiary.controller.js', 'svc:classDiaryService.js'], models: ['ClassDiaryEntry', 'AcademicCalendarEvent'], ui: [], note: 'Routes & models exist; zero client-next UI for class-diary/academic-calendar' },
  '#29': { cap: 'group-fee-seats', routes: ['group.routes.js'], ctrls: ['svc:groupSeatService.js'], models: ['GroupSeatAllocation', 'GroupFeeSchedule'], ui: [], note: 'groupSeatService exists; zero dedicated seat/fee cap UI' },
  '#30': { cap: 'certificates', routes: ['certificate.routes.js', 'document.routes.js'], ctrls: ['certificate.controller.js', 'document.controller.js'], models: ['Certificate'], ui: ['admin/Certificates.jsx'] },
  '#31': { cap: 'id-cards', routes: ['document.routes.js', 'student.routes.js'], ctrls: ['document.controller.js'], models: ['Student'], ui: ['admin/IDCardPrint.jsx'] },
  '#32': { cap: 'qr-verify', routes: ['public.routes.js'], ctrls: ['verify.controller.js'], models: ['VerifyToken', 'VerifyLog'], ui: ['app/verify/[token]/_client.js'] },
  '#33': { cap: 'attendance-qr', routes: ['attendance.routes.js', 'guard.routes.js'], ctrls: ['guard.controller.js', 'attendance.controller.js'], models: ['Attendance', 'GateLog'], ui: ['employee/GuardDashboard.jsx'] },
  '#34': { cap: 'board-registration', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardForm'], ui: ['admin/BoardManagement.jsx'] },
  '#35': { cap: 'board-exam-forms', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardForm'], ui: ['admin/BoardManagement.jsx'] },
  '#36': { cap: 'board-private-candidates', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardForm'], ui: ['admin/BoardManagement.jsx'] },
  '#37': { cap: 'board-slips', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardDatesheet'], ui: ['admin/BoardManagement.jsx'] },
  '#38': { cap: 'board-results', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardResult'], ui: ['admin/BoardManagement.jsx'] },
  '#39': { cap: 'board-result-import', routes: ['board.routes.js'], ctrls: ['board.controller.js', 'svc:boardGazetteService.js'], models: ['BoardResultImport'], ui: ['admin/BoardManagement.jsx'] },
  '#40': { cap: 'board-result-analysis', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardResult'], ui: ['admin/BoardManagement.jsx'] },
  '#41': { cap: 'board-attendance-check', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardForm', 'Attendance'], ui: ['admin/BoardManagement.jsx'] },
  '#42': { cap: 'send-up-exams', routes: ['exam.routes.js'], ctrls: ['exam.controller.js'], models: ['Exam'], ui: ['admin/Exams.jsx'] },
  '#43': { cap: 'eligibility-lists', routes: ['eligibility.routes.js'], ctrls: ['eligibility.controller.js'], models: ['EligibilityRule', 'EligibilityRecord'], ui: ['admin/EligibilityManagement.jsx'] },
  '#44': { cap: 'weak-student-lists', routes: ['exam.routes.js', 'examAnalytics.routes.js'], ctrls: ['examAnalytics.controller.js'], models: ['Result'], ui: ['admin/ExamAnalytics.jsx'] },
  '#45': { cap: 'result-comparison', routes: ['exam.routes.js', 'examAnalytics.routes.js'], ctrls: ['examAnalytics.controller.js'], models: ['Result'], ui: ['admin/ExamAnalytics.jsx'] },
  '#46': { cap: 'practicals', routes: ['practical.routes.js'], ctrls: ['practical.controller.js'], models: ['PracticalSession', 'PracticalMark'], ui: ['admin/PracticalManagement.jsx'] },
  '#47': { cap: 'lab-journals', routes: ['practical.routes.js'], ctrls: ['practical.controller.js'], models: ['LabJournal'], ui: ['admin/PracticalManagement.jsx'] },
  '#48': { cap: 'board-practicals', routes: ['practical.routes.js'], ctrls: ['practical.controller.js'], models: ['BoardPracticalExaminer'], ui: ['admin/PracticalManagement.jsx'] },
  '#49': { cap: 'admissions', routes: ['admissions.routes.js', 'registrar.routes.js'], ctrls: ['admissions.controller.js', 'registrar.controller.js'], models: ['Application', 'AdmissionSeason'], ui: ['registrar/Applications.jsx', 'registrar/AdmissionSeasons.jsx'] },
  '#50': { cap: 'admissions-online', routes: ['public.routes.js'], ctrls: ['public.controller.js'], models: ['Application'], ui: ['app/apply/[code]/_client.js'] },
  '#51': { cap: 'equivalence', routes: ['admissions.routes.js'], ctrls: ['admissions.controller.js'], models: ['Application'], ui: ['registrar/Applications.jsx'] },
  '#52': { cap: 'merit-scholarship-tiers', routes: ['admissions.routes.js'], ctrls: ['admissions.controller.js'], models: ['ScholarshipTier'], ui: ['registrar/Applications.jsx'] },
  '#53': { cap: 'quotas', routes: ['admissions.routes.js'], ctrls: ['admissions.controller.js'], models: ['QuotaRule'], ui: ['registrar/Applications.jsx'] },
  '#54': { cap: 'enquiry-leads', routes: ['lead.routes.js'], ctrls: ['admissions.controller.js'], models: ['EnquiryLead'], ui: [] },
  '#55': { cap: 'bank-challans', routes: ['fee.routes.js'], ctrls: ['fee.controller.js'], models: ['Fee'], ui: ['admin/Fees.jsx'] },
  '#56': { cap: 'defaulters-dues', routes: ['fee.routes.js', 'accountant.routes.js'], ctrls: ['fee.controller.js', 'accountant.controller.js'], models: ['Fee'], ui: ['admin/Defaulters.jsx', 'accountant/DuesReport.jsx'] },
  '#57': { cap: 'treasury-ledger', routes: ['fee.routes.js', 'accountant.routes.js'], ctrls: ['accountant.controller.js'], models: ['Transaction'], ui: ['accountant/Treasury.jsx'] },
  '#58': { cap: 'fines', routes: ['fine.routes.js'], ctrls: ['fine.controller.js'], models: ['Fine'], ui: ['student/MyFines.jsx', 'teacher/FineStudent.jsx'] },
  '#59': { cap: 'fee-college-types', routes: ['fee.routes.js'], ctrls: ['fee.controller.js'], models: ['FeeStructure', 'Fee'], ui: ['components/fees/FeeStructureModal.jsx'] },
  '#60': { cap: 'fee-discounts', routes: ['fee.routes.js'], ctrls: ['fee.controller.js'], models: ['ScholarshipTier', 'Fee'], ui: ['admin/Fees.jsx'] },
  '#61': { cap: 'fee-refunds', routes: ['fee.routes.js'], ctrls: ['fee.controller.js'], models: ['FeeRefund'], ui: ['admin/Fees.jsx'] },
  '#62': { cap: 'fee-board-alert', routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardForm', 'Notification'], ui: ['admin/BoardManagement.jsx'] },
  '#63': { cap: 'employees', routes: ['employee.routes.js', 'leaveApplication.routes.js'], ctrls: ['employee.controller.js', 'leaveApplication.controller.js'], models: ['Employee', 'LeaveApplication'], ui: ['admin/Employees.jsx', 'admin/LeaveManagement.jsx'] },
  '#64': { cap: 'payroll', routes: ['accountant.routes.js'], ctrls: ['accountant.controller.js'], models: ['PaySlip', 'Employee'], ui: ['accountant/Payroll.jsx'] },
  '#65': { cap: 'gate-scanner', routes: ['guard.routes.js'], ctrls: ['guard.controller.js'], models: ['GateLog'], ui: ['employee/GuardDashboard.jsx'] },
  '#66': { cap: 'early-exit', routes: ['guard.routes.js'], ctrls: ['guard.controller.js'], models: ['EarlyExitRequest'], ui: ['common/EarlyExitPage.jsx', 'principal/PrincipalEarlyExit.jsx'] },
  '#67': { cap: 'visitors', routes: ['visitor.routes.js'], ctrls: ['visitor.controller.js'], models: ['VisitorLog'], ui: ['admin/Visitors.jsx'] },
  '#68': { cap: 'ptm', routes: ['guidance.routes.js'], ctrls: ['guidance.controller.js'], models: ['ParentMeeting'], ui: ['admin/GuidanceManagement.jsx'] },
  '#69': { cap: 'feedback-box', routes: ['guidance.routes.js'], ctrls: ['guidance.controller.js'], models: ['StudentFeedback'], ui: ['admin/GuidanceManagement.jsx'] },
  '#70': { cap: 'quizzes', routes: ['quiz.routes.js'], ctrls: ['quiz.controller.js'], models: ['Quiz', 'QuestionBank', 'QuizAttempt'], ui: ['admin/Quizzes.jsx', 'components/quiz/QuizPlayer.jsx'] },
  '#71': { cap: 'doc-templates', routes: ['document.routes.js'], ctrls: ['document.controller.js'], models: ['Certificate'], ui: ['admin/TemplatePreview.jsx'] },
  '#72': { cap: 'paid-receipt', routes: ['document.routes.js', 'fee.routes.js'], ctrls: ['document.controller.js'], models: ['Fee'], ui: ['admin/FeeReceipt.jsx'] },
  '#73': { cap: 'voucher-verify', routes: ['public.routes.js'], ctrls: ['verify.controller.js'], models: ['Fee', 'VerifyToken'], ui: ['app/verify/[token]/_client.js'] },
  '#74': { cap: 'student-reports', routes: ['report.routes.js'], ctrls: ['report.controller.js', 'svc:studentReport.service.js'], models: ['Student', 'Result', 'Fee'], ui: ['principal/ReportCenter.jsx'] },
  '#75': { cap: 'payment-proof', routes: ['paymentProof.routes.js'], ctrls: ['paymentProof.controller.js', 'svc:paymentProof.service.js'], models: ['PaymentProof'], ui: ['accountant/PaymentProofsQueue.jsx'] },
  '#76': { cap: 'substitutions', routes: ['substitution.routes.js'], ctrls: ['substitution.controller.js'], models: ['TimetableSubstitution'], ui: [] },
  '#77': { cap: 'analytics-reports', routes: ['report.routes.js', 'analytics.routes.js'], ctrls: ['report.controller.js', 'analytics.controller.js'], models: ['Exam', 'Fee'], ui: ['principal/ReportCenter.jsx'] },
  '#78': { cap: 'universal-timetable', routes: ['universalTimetable.routes.js'], ctrls: ['universalTimetable.controller.js'], models: ['UniversalTimetable', 'TimetableProfile'], ui: ['admin/TimetablePage.jsx'] },
  '#79': { cap: 'attendance-biometric', routes: ['biometric.routes.js'], ctrls: ['biometricIngress.controller.js'], models: ['BiometricDevice', 'BiometricPunchLog'], ui: [] },
  '#80': { cap: 'faculty-attendance', routes: ['staffAttendance.routes.js'], ctrls: ['staffAttendance.controller.js'], models: ['StaffAttendance'], ui: [] },
  '#81': { cap: 'attendance-shortage', routes: ['attendanceShortage.routes.js'], ctrls: ['attendanceShortage.controller.js'], models: ['AttendanceShortageNotice'], ui: [] },
  '#82': { cap: 'fees-online-payments', routes: [], ctrls: ['svc:paymentGatewayAdapter.js'], models: ['Payment'], ui: [], forcePartial: true, note: 'paymentGatewayAdapter.js is explicitly an adapter interface & stub; no live gateway controller/route' },
  '#83': { cap: 'parent-portal', routes: ['parent.routes.js', 'parentAdmin.routes.js'], ctrls: ['parentPortal.controller.js'], models: ['GuardianToken', 'GuardianSession', 'GuardianNotification'], ui: [] },
  '#84': { cap: 'sms-alerts', routes: [], ctrls: ['creditWallet.controller.js', 'svc:messagingAdapter.js'], models: ['MessageDelivery', 'MessageCreditLedgerEntry'], ui: [], forcePartial: true, note: 'messagingAdapter.js throws Error("Not implemented")' },
  '#85': { cap: 'whatsapp-alerts', routes: [], ctrls: ['svc:messagingAdapter.js'], models: ['MessageDelivery', 'MessageCreditLedgerEntry'], ui: [], forcePartial: true, note: 'messagingAdapter.js throws Error("Not implemented")' },
  '#86': { cap: 'absence-alerts', routes: ['cron.routes.js'], ctrls: ['cronJobs.controller.js', 'svc:messagingAdapter.js'], models: ['AbsenceAlertLog'], ui: [], forcePartial: true, note: 'No SMS/WA live delivery; zero dedicated UI' },
  '#87': { cap: 'principal-dashboard', routes: ['executiveKpi.routes.js', 'college.routes.js'], ctrls: ['executiveKpi.controller.js', 'svc:executiveKpiService.js'], models: ['CollegeUsage', 'Fee', 'Student'], ui: ['admin/PrincipalDashboard.jsx'], note: 'PrincipalDashboard calls /colleges/dashboard; /executive has no UI' },
  '#88': { cap: 'teacher-evaluation', routes: ['evaluation.routes.js'], ctrls: ['evaluation.controller.js'], models: ['EvaluationSeason', 'Evaluation'], ui: ['principal/EvaluationSeasons.jsx', 'student/TeacherEvaluation.jsx'] },
  '#89': { cap: 'lab-stock', routes: ['practical.routes.js'], ctrls: ['practical.controller.js'], models: ['LabStockItem', 'LabStockMovement'], ui: ['admin/PracticalManagement.jsx'] },
  '#90': { cap: 'mcq-bank', routes: ['entryTest.routes.js'], ctrls: ['entryTest.controller.js'], models: ['McqQuestion'], ui: ['admin/EntryTestManagement.jsx'] },
  '#91': { cap: 'mock-tests', routes: ['entryTest.routes.js'], ctrls: ['entryTest.controller.js'], models: ['MockTest', 'MockAttempt'], ui: ['admin/EntryTestManagement.jsx'] },
  '#92': { cap: 'omr-scan', routes: ['entryTest.routes.js'], ctrls: ['entryTest.controller.js'], models: ['MockAttempt'], ui: ['admin/EntryTestManagement.jsx'] },
  '#93': { cap: 'aggregate-calc', routes: ['entryTest.routes.js'], ctrls: ['entryTest.controller.js'], models: ['AggregateFormula'], ui: ['admin/EntryTestManagement.jsx'] },
  '#94': { cap: 'entry-reg-tracking', routes: ['entryTest.routes.js'], ctrls: ['entryTest.controller.js'], models: ['EntryTestRegistration'], ui: ['admin/EntryTestManagement.jsx'] },
  '#95': { cap: 'career-counselling', routes: ['guidance.routes.js'], ctrls: ['guidance.controller.js'], models: ['CareerCounselling'], ui: ['admin/GuidanceManagement.jsx'] },
  '#96': { cap: 'scholarship-tracking', routes: ['guidance.routes.js'], ctrls: ['guidance.controller.js'], models: ['ScholarshipRecord'], ui: ['admin/GuidanceManagement.jsx'] },
  '#97': { cap: 'timetable-generator', routes: ['timetableGenerator.routes.js'], ctrls: ['timetableGenerator.controller.js', 'svc:timetableGenerator.service.js'], models: ['TimetableConstraint', 'TimetableDraft'], ui: ['admin/TimetablePage.jsx'] },
  '#98': { cap: 'canteen', routes: ['canteen.routes.js'], ctrls: ['canteen.controller.js', 'canteenPOS.controller.js'], models: ['CanteenTransaction', 'CanteenItem', 'CanteenOrder', 'CashierShift'], ui: [], note: 'Backend POS routes/models exist; no counter UI in client-next' },
  '#99': { cap: 'ai-chat', routes: ['aiChat.routes.js', 'ai.routes.js'], ctrls: ['aiChat.controller.js', 'svc:aiTutorService.js'], models: ['ChatHistory', 'StudentTutorDailyUsage'], ui: ['ai/AIChat.jsx', 'app/student/ai/chat/page.js'] },
  '#100': { cap: 'ai-pdf-chat', routes: ['pdf.routes.js', 'ai.routes.js'], ctrls: ['pdfUpload.controller.js', 'svc:ragKnowledgeService.js'], models: ['PDFDocument', 'DocumentChunk', 'KnowledgeBook'], ui: ['teacher/PDFLibrary.jsx', 'student/StudentMaterials.jsx'] },
  '#101': { cap: 'ai-assessment-gen', routes: ['aiGenerator.routes.js'], ctrls: ['aiGenerator.controller.js', 'svc:aiService.js'], models: ['AIUsageLog'], ui: ['ai/AIQuizGenerator.jsx', 'ai/AIPaperGenerator.jsx', 'ai/AIMCQGenerator.jsx'] },
  '#102': { cap: 'ai-timetable-assist', routes: ['timetableGenerator.routes.js'], ctrls: ['timetableGenerator.controller.js'], models: ['TimetableDraft', 'TimetableConstraint'], ui: ['admin/TimetablePage.jsx'] },
  '#103': { cap: 'ai-pedagogy-gen', routes: ['aiGenerator.routes.js'], ctrls: ['aiGenerator.controller.js', 'svc:aiService.js'], models: ['AIUsageLog'], ui: ['ai/AINotesGenerator.jsx', 'ai/AIAssignmentGenerator.jsx', 'ai/AISyllabusGenerator.jsx'] },
  '#104': { cap: 'ai-board-mcq', routes: [], ctrls: [], models: ['McqQuestion'], ui: [], note: 'No dedicated board-syllabus MCQ AI route/controller' },
  '#105': { cap: 'ai-weak-topic', routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:aiDiagnosticService.js'], models: ['WeakTopicAnalysis'], ui: [] },
  '#106': { cap: 'ai-study-plan', routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:aiDiagnosticService.js'], models: ['StudentStudyPlan'], ui: [] },
  '#107': { cap: 'ai-ocr-docs', routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:aiVisionOcrService.js'], models: ['Application'], ui: [] },
  '#108': { cap: 'ai-whatsapp-bot', routes: [], ctrls: ['svc:messagingAdapter.js'], models: ['EnquiryLead'], ui: [], forceNo: true, note: 'No WA chatbot route/controller or UI found' },
  '#109': { cap: 'ai-urdu-translate', routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:i18nService.js'], models: ['Announcement'], ui: [] },
  '#110': { cap: 'ai-at-risk', routes: [], ctrls: ['svc:aiDiagnosticService.js'], models: ['WeakTopicAnalysis'], ui: [] },
  '#111': { cap: 'ai-payment-ocr', routes: ['paymentProof.routes.js', 'ai.routes.js'], ctrls: ['paymentProof.controller.js', 'svc:aiVisionOcrService.js'], models: ['PaymentProof'], ui: [], note: 'paymentProof.controller:646 exports stubPaymentOcr (501); aiVisionOcrService accepts mockData; no UI' },

  // N01-N51 (New services)
  'N01': { routes: ['export.routes.js'], ctrls: ['export.controller.js', 'svc:exportService.js'], models: ['ExportJob'], ui: [] },
  'N02': { routes: ['board.routes.js'], ctrls: ['board.controller.js'], models: ['BoardExportProfile'], ui: [] },
  'N03': { routes: ['digest.routes.js'], ctrls: ['svc:digestService.js'], models: ['DigestConfig'], ui: [] },
  'N04': { routes: ['accountHeadMapping.routes.js'], ctrls: ['accountHeadMapping.controller.js', 'svc:accountantJournalService.js'], models: ['AccountHeadMapping'], ui: [] },
  'N05': { routes: ['backup.routes.js'], ctrls: ['backup.controller.js', 'svc:backupService.js'], models: ['BackupJob'], ui: [] },
  'N06': { routes: ['apiKey.routes.js', 'webhook.routes.js', 'v1.routes.js'], ctrls: ['svc:apiKeyService.js', 'svc:webhookService.js'], models: ['ApiKey', 'WebhookSubscription', 'ApiUsageWindow'], ui: [] },
  'N07': { routes: ['auth.routes.js'], ctrls: ['twoFactor.controller.js', 'svc:twoFactorService.js'], models: ['KnownDevice', 'UsedStepUpToken'], ui: ['app/login/page.js'] },
  'N08': { routes: ['staffApp.routes.js'], ctrls: ['svc:staffPwaService.js'], models: ['User'], ui: [], note: 'No dedicated PWA manifest/SW or install prompt verified' },
  'N09': { routes: [], ctrls: ['svc:i18nService.js'], models: [], ui: [], noModelNeeded: true, forcePartial: true, note: 'i18nService exists; zero RTL screen wiring found in client-next' },
  'N10': { routes: ['customRole.routes.js'], ctrls: ['customRole.controller.js', 'svc:customRoleService.js'], models: ['CustomRole', 'UserCustomRole'], ui: [] },
  'N11': { routes: ['approvalWorkflow.routes.js'], ctrls: ['approvalWorkflow.controller.js'], models: ['ApprovalChain', 'ApprovalRequest'], ui: [] },
  'N12': { routes: [], ctrls: ['svc:firebaseDomains.service.js'], models: [], ui: [] },
  'N13': { routes: [], ctrls: [], models: [], ui: [], forceNo: true, note: 'Missing from featureRegistry.js too; white-label login/theme not built' },
  'N14': { routes: [], ctrls: [], models: [], ui: [], forceNo: true, note: 'Google Firebase login exists on root, but Enterprise tenant Google/Microsoft SSO not built' },
  'N15': { routes: ['ipAllowlist.routes.js'], ctrls: ['ipAllowlist.controller.js', 'svc:ipAllowlistService.js'], models: ['IpAllowlistRule', 'IpAllowlistViolation'], ui: [] },
  'N16': { routes: ['legalHold.routes.js'], ctrls: ['legalHold.controller.js', 'svc:legalHoldService.js'], models: ['LegalHold', 'RetentionPolicy'], ui: [] },
  'N17': { routes: ['auditLog.routes.js'], ctrls: ['auditLog.controller.js'], models: ['AuditLog'], ui: [] },
  'N18': { routes: ['campus.routes.js'], ctrls: ['campus.controller.js', 'svc:campusService.js'], models: ['Campus'], ui: [] },
  'N19': { routes: ['transfer.routes.js', 'budget.routes.js'], ctrls: ['transfer.controller.js', 'svc:transferService.js'], models: ['StudentCampusTransfer', 'DepartmentBudget'], ui: [] },
  'N20': { routes: ['subscription.routes.js'], ctrls: ['creditWallet.controller.js', 'svc:creditWalletService.js'], models: ['MessageCreditLedgerEntry'], ui: ['app/admin/subscription/_client.js'], note: 'isPurchasable=false in creditWalletService; UI wallet placeholder' },
  'N21': { routes: ['announcement.routes.js', 'noticeTemplate.routes.js'], ctrls: ['noticeTemplate.controller.js', 'svc:noticeTemplateService.js'], models: ['AnnouncementTemplate'], ui: [] },
  'N22': { routes: ['parentAdmin.routes.js'], ctrls: ['parentPortal.controller.js', 'svc:guardianPushService.js'], models: ['GuardianPushSubscription'], ui: [] },
  'N23': { routes: ['syllabus.routes.js'], ctrls: ['syllabus.controller.js', 'svc:syllabusService.js'], models: ['SyllabusBreakdown', 'TeacherSyllabusProgress'], ui: [] },
  'N24': { routes: ['leaveApplication.routes.js'], ctrls: ['leaveApplication.controller.js', 'svc:studentLeaveService.js'], models: ['LeaveApplication'], ui: ['student/LeaveApplication.jsx'] },
  'N25': { routes: ['exam.routes.js'], ctrls: ['examOperations.controller.js', 'svc:examSeatingService.js'], models: ['ExamSeatingPlan', 'ExamInvigilationDuty'], ui: [] },
  'N26': { routes: ['exam.routes.js'], ctrls: ['examOperations.controller.js', 'svc:examPaperService.js'], models: ['QuestionPaperDraft', 'QuestionPaperRevision'], ui: [] },
  'N27': { routes: ['exam.routes.js'], ctrls: ['examOperations.controller.js', 'svc:resultRecheckService.js'], models: ['ResultRecheckRequest'], ui: [] },
  'N28': { routes: ['report.routes.js'], ctrls: ['report.controller.js', 'svc:reportCardService.js'], models: ['StudentReportCardRemark'], ui: [] },
  'N29': { routes: ['clearance.routes.js'], ctrls: ['clearance.controller.js', 'svc:clearanceService.js'], models: ['ClearanceHead', 'StudentClearanceProcess', 'LeavingCertificateRecord'], ui: [] },
  'N30': { routes: ['liveClasses.routes.js'], ctrls: ['liveClasses.controller.js', 'svc:liveClassService.js'], models: ['LiveClassSchedule', 'DigitalLectureRecording'], ui: [] },
  'N31': { routes: ['forum.routes.js'], ctrls: ['forum.controller.js', 'svc:forumService.js'], models: ['ForumQuestion', 'ForumAnswer'], ui: [] },
  'N32': { routes: ['discipline.routes.js'], ctrls: ['discipline.controller.js', 'svc:disciplineService.js'], models: ['DisciplinaryIncident', 'StudentCounselingLog'], ui: [] },
  'N33': { routes: ['clubs.routes.js'], ctrls: ['clubs.controller.js', 'svc:clubService.js'], models: ['StudentClub', 'ClubEvent'], ui: [] },
  'N34': { routes: ['alumni.routes.js'], ctrls: ['alumni.controller.js', 'svc:alumniService.js'], models: ['AlumniProfile'], ui: [] },
  'N35': { routes: ['library.routes.js'], ctrls: ['library.controller.js', 'svc:libraryService.js'], models: ['BookTitle', 'BookCopy', 'BookIssueRecord'], ui: [] },
  'N36': { routes: ['transport.routes.js'], ctrls: ['transport.controller.js', 'svc:transportService.js'], models: ['TransportRoute', 'TransportVehicle', 'StudentTransportAllocation'], ui: [] },
  'N37': { routes: ['hostel.routes.js'], ctrls: ['hostel.controller.js', 'svc:hostelService.js'], models: ['HostelBuilding', 'HostelRoom', 'StudentHostelAllotment'], ui: [] },
  'N38': { routes: ['inventory.routes.js'], ctrls: ['inventory.controller.js', 'svc:assetService.js'], models: ['FixedAsset', 'AssetMaintenanceLog'], ui: [] },
  'N39': { routes: ['purchase.routes.js'], ctrls: ['purchase.controller.js', 'svc:purchaseOrderService.js'], models: ['Vendor', 'PurchaseOrder'], ui: [] },
  'N40': { routes: ['accounting.routes.js'], ctrls: ['accounting.controller.js', 'svc:accountingService.js'], models: ['AccountHead', 'JournalVoucher', 'JournalLineItem'], ui: [] },
  'N41': { routes: ['budget.routes.js'], ctrls: ['budget.controller.js', 'svc:budgetService.js'], models: ['DepartmentBudget', 'BudgetExpenseCommitment'], ui: [] },
  'N42': { routes: [], ctrls: [], models: [], ui: [], forceNo: true, note: 'No appraisal, contract-expiry, or recruitment pipeline routes/models/UI exist' },
  'N43': { routes: ['ai.routes.js'], ctrls: ['ai.controller.js'], models: ['PaymentProof'], ui: [] },
  'N44': { routes: ['aiChat.routes.js'], ctrls: ['aiChat.controller.js'], models: ['ChatHistory'], ui: ['ai/AIChat.jsx'] },
  'N45': { routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:aiAutonomousAgentService.js'], models: ['PendingAgentAction'], ui: [], forcePartial: true, note: 'approveAndExecuteAction updates status without executing real mutations; no UI' },
  'N46': { routes: ['ai.routes.js'], ctrls: ['ai.controller.js', 'svc:aiAskYourDataService.js'], models: ['AIUsageLog'], ui: [] },
  'N47': { routes: [], ctrls: [], models: ['StudentReportCardRemark'], ui: [] },
  'N48': { routes: [], ctrls: [], models: [], ui: [] },
  'N49': { routes: [], ctrls: [], models: [], ui: [] },
  'N50': { routes: [], ctrls: [], models: [], ui: [] },
  'N51': { routes: [], ctrls: [], models: ['EnquiryLead'], ui: [] },
};

// ---------------------------------------------------------------------------
// 4. Inspect File Evidence & Determine hasWorkingImplementation
// ---------------------------------------------------------------------------
function firstMatchLine(filePath, patterns) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some(p => p.test(lines[i]))) return i + 1;
  }
  return 1;
}

function checkControllerRealness(ctrlRelList, serviceId = '') {
  const results = [];
  let hasRealLogic = false;
  let onlyStub = false;
  for (const rel of ctrlRelList) {
    const cleanRel = rel.startsWith('svc:')
      ? `backend/services/${rel.slice(4)}`
      : rel.startsWith('backend/')
      ? rel
      : `backend/controllers/${rel}`;
    const full = path.join(ROOT_DIR, cleanRel);
    if (!fs.existsSync(full)) continue;
    const txt = fs.readFileSync(full, 'utf8');
    const linesCount = txt.split(/\r?\n/).length;
    const hasRealImpl = /prisma\.|tenantDb\.|getSystemClient|archiver|pdfkit|PDFDocument|XLSX|sharp|zlib|GoogleGenerativeAI|generateFromTemplate/i.test(txt);
    // stubPaymentOcr in paymentProof.controller.js ONLY affects #111 OCR, not #75 manual proof upload
    const isStubFile =
      /throw new Error\(['"]Not implemented['"]\)|adapter interface & stub definitions/i.test(txt) ||
      (serviceId === '#111' && /exports\.stubPaymentOcr/i.test(txt));
    const firstFn = firstMatchLine(full, [/exports\.\w+|async function \w+|function \w+/]);
    results.push(`${cleanRel}:L${firstFn}${isStubFile ? '(stub)' : ''}`);
    if (hasRealImpl && linesCount >= 20 && !isStubFile) hasRealLogic = true;
    else if (isStubFile && !hasRealLogic) onlyStub = true;
  }
  return { results, hasRealLogic, onlyStub };
}

function findUiHit(uiTargets, uiFiles) {
  const hits = [];
  for (const target of uiTargets) {
    const found = uiFiles.find(u => u.rel.endsWith(target) || u.rel.includes(target));
    if (found) hits.push(`${found.rel}:L1`);
  }
  return hits;
}

function mapSourceStatus(srcStatus) {
  const s = (srcStatus || '').toLowerCase();
  if (s === 'live') return 'live';
  if (s === 'in progress') return 'partial';
  return 'roadmap';
}

function compareStatus(srcStatus, workingImpl) {
  const s = mapSourceStatus(srcStatus); // live | partial | roadmap
  if (s === 'live') return workingImpl === 'yes' ? 'match' : 'source ahead of code';
  if (s === 'partial') {
    if (workingImpl === 'partial') return 'match';
    return workingImpl === 'yes' ? 'code ahead of source' : 'source ahead of code';
  }
  // roadmap
  return workingImpl === 'no' ? 'match' : 'code ahead of source';
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// 5. Run Reconciliation
// ---------------------------------------------------------------------------
function main() {
  const sourceList = parseSourceServices().sort((a, b) => a.numSort - b.numSort);
  const schemaModels = indexSchemaModels();
  const routeMap = indexRoutesAndServer();
  const uiFiles = indexUiFiles();
  const matrixKeys = new Set(parseFeatureMatrixKeys());

  const regById = new Map();
  for (const r of FEATURE_REGISTRY) {
    const normId = r.id === '#32_N32' ? 'N32' : r.id;
    regById.set(normId, r);
  }
  const capByKey = new Map(CAP_FEATURES.map(c => [c.key, c]));

  const rows = [];
  const counts = { yes: 0, partial: 0, no: 0, match: 0, codeAhead: 0, sourceAhead: 0, sourceLive: 0 };

  for (const src of sourceList) {
    if (src.sourceStatus.toLowerCase() === 'live') counts.sourceLive++;
    const spec = EVIDENCE_SPECS[src.id] || { routes: [], ctrls: [], models: [], ui: [] };
    const reg = regById.get(src.id);
    const cap = spec.cap ? capByKey.get(spec.cap) : null;

    // Resolve Route Info & Route Gates
    const routeEvidence = [];
    const routeKeysForService = new Set();
    for (const rf of spec.routes || []) {
      const info = routeMap.get(rf);
      if (info) {
        routeEvidence.push(`${info.file}:L${info.firstEpLine}`);
        info.gates.forEach(g => routeKeysForService.add(`${rf}:${g.key}`));
      }
    }
    // Also catch any route file explicitly gating on reg.key or cap.key
    for (const [rf, info] of routeMap.entries()) {
      for (const g of info.gates) {
        if ((reg && g.key === reg.key) || (cap && g.key === cap.key) || (reg && (reg.aliases || []).includes(g.key))) {
          routeKeysForService.add(`${rf}:${g.key}`);
        }
      }
    }

    const ctrlCheck = checkControllerRealness(spec.ctrls || [], src.id);
    const modelEvidence = [];
    for (const m of spec.models || []) {
      const line = schemaModels.get(m);
      if (line) modelEvidence.push(`backend/prisma/schema.prisma:L${line} (${m})`);
    }
    const uiEvidence = findUiHit(spec.ui || [], uiFiles);

    // Determine 4-pillar verdict strictly
    const hasRoute = routeEvidence.length > 0 || Boolean(spec.noBackendNeeded);
    const hasCtrl = ctrlCheck.hasRealLogic || Boolean(spec.noBackendNeeded);
    const hasModel = modelEvidence.length > 0 || Boolean(spec.noModelNeeded);
    const hasUi = uiEvidence.length > 0;

    let working = 'no';
    if (spec.forceNo) {
      working = 'no';
    } else if (spec.forcePartial) {
      working = 'partial';
    } else if (hasRoute && hasCtrl && hasModel && hasUi) {
      working = 'yes';
    } else if (hasRoute || hasCtrl || modelEvidence.length > 0 || hasUi) {
      working = 'partial';
    } else {
      working = 'no';
    }

    counts[working]++;
    const statusMatch = compareStatus(src.sourceStatus, working);
    if (statusMatch === 'match') counts.match++;
    else if (statusMatch === 'code ahead of source') counts.codeAhead++;
    else counts.sourceAhead++;

    const codeEvidenceParts = [
      `Route: ${routeEvidence.length ? routeEvidence.join(', ') : (spec.noBackendNeeded ? 'n/a (UI only)' : 'not found')}`,
      `Controller/Svc: ${ctrlCheck.results.length ? ctrlCheck.results.join(', ') : (spec.noBackendNeeded ? 'n/a' : 'not found')}`,
      `Model: ${modelEvidence.length ? modelEvidence.join(', ') : (spec.noModelNeeded ? 'not needed (stateless)' : 'not found')}`,
      `UI: ${uiEvidence.length ? uiEvidence.join(', ') : 'not found'}`,
    ];
    if (spec.note) codeEvidenceParts.push(`Note: ${spec.note}`);

    rows.push({
      sourceIdAndName: `${src.id} — ${src.name}`,
      sourceId: src.id,
      sourceName: src.name,
      sourcePlan: src.sourcePlan,
      sourceStatus: src.sourceStatus,
      sourcePlanAndStatus: `${src.sourcePlan} (${src.sourceStatus})`,
      sourceChange: src.sourceChange || '-',
      regCol: reg ? `${reg.key} | ${reg.status} | ${reg.startsIn}` : 'MISSING_IN_REGISTRY',
      capCol: cap ? `${cap.key} | ${cap.status}` : 'none',
      routeKeys: routeKeysForService.size ? Array.from(routeKeysForService).join('; ') : 'none',
      codeEvidence: codeEvidenceParts.join(' || '),
      hasWorkingImplementation: working,
      matchesSourceStatus: statusMatch,
      regKey: reg ? reg.key : null,
      regStatus: reg ? reg.status : null,
      regStartsIn: reg ? reg.startsIn : null,
      capKey: cap ? cap.key : null,
      capStatus: cap ? cap.status : null,
    });
  }

  // Analyze broken route keys & key mismatches for Output 2
  const regKeys = new Set(FEATURE_REGISTRY.map(x => x.key));
  const regAliases = new Set(Object.keys(FEATURE_ALIASES || {}));
  FEATURE_REGISTRY.forEach(x => (x.aliases || []).forEach(a => regAliases.add(a)));
  const capKeys = new Set(CAP_FEATURES.map(c => c.key));
  const legKeys = new Set(Object.keys(LEGACY_KEY_MAP || {}));

  const unresolvedRoutes = [];
  for (const [rf, info] of routeMap.entries()) {
    for (const g of info.gates) {
      const inReg = regKeys.has(g.key) || regAliases.has(g.key);
      const inCap = capKeys.has(g.key) || legKeys.has(g.key);
      let brokenInCurrent = false;
      if (g.fn === 'subscriptionGate' && !inReg) brokenInCurrent = true;
      if (g.fn === 'featureGate' && !inCap) brokenInCurrent = true;
      if (!inReg && !inCap) unresolvedRoutes.push({ route: info.file, line: g.line, fn: g.fn, key: g.key, reason: 'Unresolved in BOTH featureRegistry and capabilityCatalog' });
      else if (brokenInCurrent) unresolvedRoutes.push({ route: info.file, line: g.line, fn: g.fn, key: g.key, reason: `${g.fn} looks up ${g.fn === 'featureGate' ? 'capabilityCatalog' : 'featureRegistry'}, where '${g.key}' is missing` });
    }
  }

  const keyMismatches = [];
  for (const row of rows) {
    if (row.regKey && row.capKey && row.regKey !== row.capKey) {
      keyMismatches.push({ id: row.sourceId, regKey: row.regKey, capKey: row.capKey, inFeatureMatrix: matrixKeys.has(row.capKey) || matrixKeys.has(row.regKey) });
    }
  }

  // Write Outputs
  if (!fs.existsSync(RECON_DIR)) fs.mkdirSync(RECON_DIR, { recursive: true });

  // 1A. CSV
  const csvHeaders = [
    'Source ID and name',
    'Source plan and status',
    'Source change',
    'featureRegistry.js key, status and startsIn',
    'capabilityCatalog.js key and status',
    'Route keys',
    'Code evidence',
    'hasWorkingImplementation',
    'Matches source status?',
  ];
  const csvLines = [csvHeaders.map(csvEscape).join(',')];
  for (const r of rows) {
    csvLines.push([
      r.sourceIdAndName,
      r.sourcePlanAndStatus,
      r.sourceChange,
      r.regCol,
      r.capCol,
      r.routeKeys,
      r.codeEvidence,
      r.hasWorkingImplementation,
      r.matchesSourceStatus,
    ].map(csvEscape).join(','));
  }
  fs.writeFileSync(path.join(RECON_DIR, 'service_reconciliation.csv'), csvLines.join('\n'), 'utf8');

  // 1B. Markdown Table
  const mdLines = [
    '# Academix — 162-Service Reconciliation Matrix (Stage 0.5 / T0.5)',
    '',
    'Generated read-only by `backend/scripts/reconcile_services.js`. Strictly checks 4 pillars for `hasWorkingImplementation`: **(1) Registered Route, (2) Real Controller/Service Logic, (3) Prisma Model (if needed), (4) Reachable UI Page/Client**.',
    '',
    '| Source ID & Name | Source Plan & Status | Source Change | featureRegistry.js (key \\| status \\| startsIn) | capabilityCatalog.js (key \\| status) | Route Keys | Code Evidence | hasWorkingImplementation | Matches Source Status? |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :--- |',
  ];
  for (const r of rows) {
    const esc = s => String(s).replace(/\|/g, '\\|');
    mdLines.push(`| ${esc(r.sourceIdAndName)} | ${esc(r.sourcePlanAndStatus)} | ${esc(r.sourceChange)} | \`${esc(r.regCol)}\` | \`${esc(r.capCol)}\` | ${esc(r.routeKeys)} | ${esc(r.codeEvidence)} | **${r.hasWorkingImplementation}** | ${r.matchesSourceStatus} |`);
  }
  fs.writeFileSync(path.join(RECON_DIR, 'service_reconciliation.md'), mdLines.join('\n'), 'utf8');

  // 2. summary.md
  const codeAheadList = rows.filter(r => r.matchesSourceStatus === 'code ahead of source');
  const sourceAheadList = rows.filter(r => r.matchesSourceStatus === 'source ahead of code');
  const changedList = rows.filter(r => /Was /i.test(r.sourceChange));

  const sumLines = [
    '# Stage 0.5 (T0.5) Reconciliation Summary',
    '',
    '## 1. Overall Implementation Counts (All 162 Services)',
    `- **Total Source Services Audited:** **${rows.length}** (111 original + 51 new \`N01–N51\`)`,
    `- **\`hasWorkingImplementation = yes\` (All 4 pillars present incl. UI):** **${counts.yes}**`,
    `- **\`hasWorkingImplementation = partial\` (Some pillars exist; e.g. backend exists with no UI, or adapter stub):** **${counts.partial}**`,
    `- **\`hasWorkingImplementation = no\` (None or placeholder only):** **${counts.no}**`,
    `- **Comparison vs Source File's 86 Live:**`,
    `  - Source file claims **${counts.sourceLive}** services are \`Live\`.`,
    `  - \`Matches source status? = match\`: **${counts.match}**`,
    `  - \`code ahead of source\`: **${counts.codeAhead}** (mostly Phase 11–13 backend routes/models built for Roadmap services, awaiting UI)`,
    `  - \`source ahead of code\`: **${counts.sourceAhead}** (services marked \`Live\` in source whose standalone frontend screen or full backend/UI pairing is partial or missing)`,
    '',
    '## 2. Services Where Code Is Ahead of Source (`code ahead of source`)',
    '*(Note: Almost all of these are backend-complete Phase 9–13 routes/models whose `client-next` UI has not been built yet, so they score `partial`, while 2 services — `#78 Universal master timetable` and `N24 Student leave applications` — have both backend & UI!)*',
    '',
    '| ID | Name | Source Status | Code Verdict | Evidence Summary |',
    '| :--- | :--- | :--- | :---: | :--- |',
    ...codeAheadList.map(r => `| ${r.sourceId} | ${r.sourceName} | ${r.sourceStatus} | **${r.hasWorkingImplementation}** | ${r.codeEvidence.replace(/\|/g, '\\|')} |`),
    '',
    '## 3. Services Where Source Is Ahead of Code (`source ahead of code`)',
    '',
    '| ID | Name | Source Status | Code Verdict | Missing Pillars / Reason |',
    '| :--- | :--- | :--- | :---: | :--- |',
    ...sourceAheadList.map(r => `| ${r.sourceId} | ${r.sourceName} | ${r.sourceStatus} | **${r.hasWorkingImplementation}** | ${r.codeEvidence.replace(/\|/g, '\\|')} |`),
    '',
    '## 4. All 22 Services Marked `"Was ..."` in Source File',
    '',
    '| ID | Name | New Plan | Source Change | Live Status in Code | Plan Impact |',
    '| :--- | :--- | :--- | :--- | :---: | :--- |',
    ...changedList.map(r => {
      let impact = r.sourceChange;
      if (/Was Standard/i.test(r.sourceChange) && r.sourcePlan === 'Starter') impact = 'Starter GAINS access';
      else if (/Was Standard/i.test(r.sourceChange) && r.sourcePlan === 'Premium') impact = 'Existing Standard LOSES access without override';
      else if (/Was Starter/i.test(r.sourceChange) && r.sourcePlan === 'Standard') impact = 'Existing Starter LOSES access without override';
      else if (/Was Enterprise/i.test(r.sourceChange)) impact = `${r.sourcePlan} GAINS access`;
      return `| ${r.sourceId} | ${r.sourceName} | ${r.sourcePlan} | ${r.sourceChange} | **${r.hasWorkingImplementation}** (${r.capStatus || 'none'}) | ${impact} |`;
    }),
    '',
    '## 5. Route Gate Keys Unresolved in Current Registry Middleware',
    '',
    '| Route File | Line | Middleware | Gate Key | Resolution Failure Reason |',
    '| :--- | :---: | :--- | :--- | :--- |',
    ...unresolvedRoutes.map(u => `| \`${u.route}\` | L${u.line} | \`${u.fn}\` | \`${u.key}\` | ${u.reason} |`),
    '',
    `Total failing route gate calls today: **${unresolvedRoutes.length}**`,
    '',
    '## 6. Key Mismatches Between `featureRegistry.js`, `capabilityCatalog.js` & `featureMatrix.js` (For T1.2 Aliasing)',
    `- Total \`capabilityCatalog.js\` keys differing from \`featureRegistry.js\`: **${keyMismatches.length}**`,
    `- Missing in \`featureRegistry.js\` altogether: **\`N13\` (white-label-branding)**`,
    `- Malformed ID in \`featureRegistry.js\`: **\`#32_N32\` (\`discipline-counselling-records\`)** -> normalize to \`N32\``,
    `- Unmapped strings in \`client-next/lib/featureMatrix.js\`: \`multi-campus\` (plan quota + \`N18\`), \`advanced\`, \`custom-roles\` (\`N10\`), \`audit-logs\` (\`#23\`), \`api-access\` (\`N06\`), \`ai-study-assistant\`, \`ai-paper-generator\`, \`ai-quiz-generator\`, \`ai-assignment-generator\`, \`ai-notes-generator\`, \`ai-syllabus-generator\`, \`ai-mcq-generator\`.`,
    '',
    '| Source ID | `featureRegistry.js` Key | `capabilityCatalog.js` Key | In `featureMatrix.js`? |',
    '| :--- | :--- | :--- | :---: |',
    ...keyMismatches.map(m => `| ${m.id} | \`${m.regKey}\` | \`${m.capKey}\` | ${m.inFeatureMatrix ? 'yes' : 'no'} |`),
  ];
  fs.writeFileSync(path.join(RECON_DIR, 'summary.md'), sumLines.join('\n'), 'utf8');

  console.log('Reconciliation complete:', counts, 'unresolvedRoutes:', unresolvedRoutes.length, 'keyMismatches:', keyMismatches.length);
}

main();
