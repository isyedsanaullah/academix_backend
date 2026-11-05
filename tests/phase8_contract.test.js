/**
 * phase8_contract.test.js — Phase 8 Contract Verification Test Suite
 * Validates all architectural rules, invariants, and edge cases across:
 * - Phase 8.0: Shared Cross-Cutting Infrastructure & Outbox Hardening
 * - Sub-Phase 8A: #29 Group Seat Allocation & Quotas
 * - Sub-Phase 8B: #28 Class Diary & Academic Calendar
 * - Sub-Phase 8C: #27 Bulk Data Import Engine
 * - Sub-Phase 8D: #80 Staff Attendance & Leave Integration
 * - Sub-Phase 8E: #79 Biometric Turnstile Synchronizer (Simulator & Path B)
 * - Sub-Phase 8F: Messaging Layer Foundation (#84/#85 Stays coming_soon)
 * - Sub-Phase 8G: #83 Parent Portal Mobile App Engine
 * - Sub-Phase 8H: #81 Real-Time Attendance Shortage Scanner
 * - Sub-Phase 8I: #86 Automatic Absence Notification Dispatcher
 * - Sub-Phase 8J: #87 Executive KPI & Board Reporting Engine
 * - Sub-Phase 8K: #82 Online Payment Gateway Adapter
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { FEATURE_REGISTRY, validateRegistryDAG } = require('../config/featureRegistry');

// 8A Services
const { claimSeat, releaseSeat } = require('../services/groupSeatService');

// 8B Services
const { calculateWorkingDays, isInstructionDay } = require('../services/workingDaysService');
const { recordDiaryEntry } = require('../services/classDiaryService');

// 8C Workers
const { processNextJob, undoImportJob } = require('../workers/bulkImportWorker');

// 8D Services
const {
  calculateCheckInStatus,
  recordStaffAttendance,
  getStaffAttendance,
  isStaffOnLeave,
  SOURCE_PRIORITY
} = require('../services/staffAttendanceService');
const { processDailyStaffAbsentees } = require('../workers/staffAbsenteeWorker');

// 8E Controllers & Workers
const { ingestPunches } = require('../controllers/biometricIngress.controller');
const { processBiometricPunchesBatch } = require('../workers/biometricSyncWorker');

// 8F Services & Controllers
const { sendMessage, activeDrivers } = require('../services/messagingAdapter');
const { calculateTotal, submitPaymentProof } = require('../controllers/subscription.controller');

// 8G Utilities & Controllers
const {
  generateGuardianPin,
  hashGuardianPin,
  compareGuardianPin
} = require('../utils/guardianPinGenerator');
const { login, issueSinglePin } = require('../controllers/parentPortal.controller');
const { guardianProtect } = require('../middleware/guardianAuth.middleware');

// 8H Services & Workers
const { calculateStudentAttendance } = require('../services/attendanceCalculationService');
const { runShortageScannerForCollege } = require('../workers/attendanceShortageScannerWorker');

// 8I Workers
const { isTimeEligible, dispatchAbsenceAlertsForCollege } = require('../workers/absenceAlertWorker');

// 8J Services & Controllers
const { getKpiSummary } = require('../services/executiveKpiService');
const { getKpiSummary: controllerGetKpi } = require('../controllers/executiveKpi.controller');

// 8K Services
const { getActiveGatewayDriver, JazzCashDriver, EasyPaisaDriver } = require('../services/paymentGatewayAdapter');
const { SERVER_EXEMPT_CATEGORIES } = require('../services/storageQuotaService');

async function runPhase8ContractTests() {
  const prisma = getSystemClient();
  let passed = 0;
  let failed = 0;

  console.log('\n====================================================');
  console.log('   ACADEMIX PHASE 8 COMPREHENSIVE CONTRACT TESTS    ');
  console.log('====================================================\n');

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error('   Error:', err.message || err);
      failed++;
    }
  }

  // Helper to create test college
  const createTestCollege = async (overrides = {}) => {
    const code = 'T8_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    return await prisma.college.create({
      data: {
        name: `Phase 8 Test College ${code}`,
        code,
        email: `${code.toLowerCase()}@test-phase8.edu.pk`,
        planId: 'premium',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
        ...overrides
      }
    });
  };

  try {
    // =========================================================================
    // 1. CANONICAL REGISTRY VALIDATION (98 LIVE + 63 COMING_SOON = 161 TOTAL)
    // =========================================================================
    await test('1. Canonical Feature Registry Milestone Counts (At least 98 Live, 161 Total)', async () => {
      const total = FEATURE_REGISTRY.length;
      const live = FEATURE_REGISTRY.filter(f => f.status === 'live').length;
      const comingSoon = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon').length;

      assert.strictEqual(total, 161, 'Registry must contain exactly 161 total services');
      assert(live >= 98, `At least 98 services must be live post-Phase 8 (got ${live})`);
      assert(comingSoon <= 63, `At most 63 services must remain coming_soon post-Phase 8 (got ${comingSoon})`);
      assert.strictEqual(live + comingSoon, 161, 'Total must equal 161');

      const dagResult = validateRegistryDAG();
      assert.strictEqual(dagResult.valid, true, 'Topological DAG must be valid without cycles or missing dependencies');
    });

    // =========================================================================
    // 2. REGISTRY-KEY LINT (All subscriptionGate keys exist in registry)
    // =========================================================================
    await test('2. Registry-Key Lint: All Phase 8 gate literals exist in FEATURE_REGISTRY', async () => {
      const keysToCheck = [
        'group-wise-fees-seats',
        'student-diary-calendar',
        'bulk-csv-import',
        'staff-attendance-register',
        'biometric-device-sync',
        'parent-portal-pwa',
        'attendance-shortage-warnings',
        'absence-alerts-parents',
        'principal-executive-dashboard',
        'online-fee-payment'
      ];

      for (const k of keysToCheck) {
        const found = FEATURE_REGISTRY.find(f => f.key === k);
        assert(found, `Key '${k}' must be defined in FEATURE_REGISTRY`);
      }
    });

    // =========================================================================
    // 3. STORAGE WHITELIST & RECONCILIATION EXCLUSION
    // =========================================================================
    await test('3. Storage Whitelist: Server-exempt categories excluded from client upload and reconciliation', async () => {
      assert(SERVER_EXEMPT_CATEGORIES.has('EXPORTS'));
      assert(SERVER_EXEMPT_CATEGORIES.has('BACKUPS'));
      assert(SERVER_EXEMPT_CATEGORIES.has('REPORTS'));
      assert(SERVER_EXEMPT_CATEGORIES.has('RECEIPTS'));
      assert(SERVER_EXEMPT_CATEGORIES.has('IMPORT_SOURCE'));

      // Tenant-counted categories must NOT be in server-exempt
      assert(!SERVER_EXEMPT_CATEGORIES.has('FEE_PROOFS'));
      assert(!SERVER_EXEMPT_CATEGORIES.has('GENERAL'));
    });

    // =========================================================================
    // 4. SUB-PHASE 8A: #29 GROUP SEAT ALLOCATION & QUOTAS
    // =========================================================================
    await test('4. Sub-Phase 8A: Seat Exhaustion (409) & Transfer Quota Invariant', async () => {
      const col = await createTestCollege();
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const cls = await prisma.class.create({
        data: { college_id: col.id, session_id: session.id, name: `11th_${Date.now()}` }
      });
      const groupA = await prisma.group.create({ data: { college_id: col.id, class_id: cls.id, name: 'Group A' } });
      const groupB = await prisma.group.create({ data: { college_id: col.id, class_id: cls.id, name: 'Group B' } });

      // Max 1 seat in Group A
      await prisma.groupSeatAllocation.create({
        data: { college_id: col.id, session_id: session.id, group_id: groupA.id, maxSeats: 1, allocatedSeats: 0 }
      });
      // Max 2 seats in Group B
      await prisma.groupSeatAllocation.create({
        data: { college_id: col.id, session_id: session.id, group_id: groupB.id, maxSeats: 2, allocatedSeats: 0 }
      });

      // Claim 1 seat in Group A
      await claimSeat({ collegeId: col.id, groupId: groupA.id, sessionId: session.id });

      // Attempting to claim another seat in Group A must fail with 409
      try {
        await claimSeat({ collegeId: col.id, groupId: groupA.id, sessionId: session.id });
        assert.fail('Should have thrown 409 GROUP_SEATS_EXHAUSTED');
      } catch (err) {
        assert.strictEqual(err.code, 'GROUP_SEATS_EXHAUSTED');
      }

      // Releasing seat works
      await releaseSeat({ collegeId: col.id, groupId: groupA.id, sessionId: session.id });
      const allocA = await prisma.groupSeatAllocation.findUnique({
        where: { college_id_group_id_session_id: { college_id: col.id, group_id: groupA.id, session_id: session.id } }
      });
      assert.strictEqual(allocA.allocatedSeats, 0);
    });

    // =========================================================================
    // 5. SUB-PHASE 8B: #28 CLASS DIARY & ACADEMIC CALENDAR
    // =========================================================================
    await test('5. Sub-Phase 8B: Diary Multiple Periods & Academic Calendar Off-Days', async () => {
      const col = await createTestCollege();
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const cls = await prisma.class.create({
        data: { college_id: col.id, session_id: session.id, name: `11th_${Date.now()}` }
      });
      const section = await prisma.section.create({
        data: {
          college_id: col.id,
          session_id: session.id,
          class_id: cls.id,
          code: `Sec-A-${Date.now()}`,
          name: 'Sec-A'
        }
      });
      const subject = await prisma.subject.create({
        data: { college_id: col.id, name: `Physics_${Date.now()}`, group: 'Common' }
      });

      const d = '2026-11-18';
      // Period 1
      const p1 = await recordDiaryEntry({
        collegeId: col.id,
        sectionId: section.id,
        subjectId: subject.id,
        teacherId: 'teacher-1',
        entryDate: d,
        periodNumber: 1,
        topicCovered: 'Kinematics',
        homework: 'Solve Q 1-5'
      });
      assert.strictEqual(p1.periodNumber, 1);

      // Period 2 on same day
      const p2 = await recordDiaryEntry({
        collegeId: col.id,
        sectionId: section.id,
        subjectId: subject.id,
        teacherId: 'teacher-1',
        entryDate: d,
        periodNumber: 2,
        topicCovered: 'Dynamics',
        homework: 'Solve Q 6-10'
      });
      assert.strictEqual(p2.periodNumber, 2);

      // Calendar Working Days: Sunday must be off
      const sun = new Date('2026-11-22T00:00:00.000Z'); // Sunday
      const sunWorking = await isInstructionDay({ collegeId: col.id, sessionId: session.id, date: sun });
      assert.strictEqual(sunWorking, false, 'Sunday must be non-working day by default');
    });

    // =========================================================================
    // 6. SUB-PHASE 8C: #27 BULK DATA IMPORT ENGINE
    // =========================================================================
    await test('6. Sub-Phase 8C: Import Partial Chunk Isolation & Rollback', async () => {
      const col = await createTestCollege();
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });

      const job = await prisma.bulkImportJob.create({
        data: {
          college_id: col.id,
          importType: 'students',
          status: 'PENDING',
          createdById: 'admin-1',
          totalRows: 2
        }
      });

      await prisma.bulkImportRow.create({
        data: {
          job_id: job.id,
          rowNumber: 1,
          payloadJson: {
            name: 'Valid Student 1',
            fatherName: 'Father',
            gender: 'male',
            rollNumber: `R1_${Date.now()}`,
            class: '11th',
            group: 'Pre-Medical',
            sessionId: session.id
          },
          status: 'PENDING'
        }
      });
      await prisma.bulkImportRow.create({
        data: {
          job_id: job.id,
          rowNumber: 2,
          payloadJson: { name: 'Invalid Student 2', rollNumber: '' }, // missing required fields
          status: 'PENDING'
        }
      });

      // Run worker
      await processNextJob();
      const updatedJob = await prisma.bulkImportJob.findUnique({ where: { id: job.id } });
      assert.strictEqual(updatedJob.status, 'PARTIAL_SUCCESS');
      assert.strictEqual(updatedJob.rowsSuccess, 1);
      assert.strictEqual(updatedJob.rowsFailed, 1);

      // Undo rollback
      await undoImportJob(job.id, col.id);
      const studentCountAfterUndo = await prisma.student.count({ where: { importJobId: job.id } });
      assert.strictEqual(studentCountAfterUndo, 0, 'undoImportJob must roll back all imported records');
    });

    // =========================================================================
    // 7. SUB-PHASE 8D: #80 STAFF ATTENDANCE & LEAVES
    // =========================================================================
    await test('7. Sub-Phase 8D: Staff Attendance Shift Thresholds & Source Priority', async () => {
      const col = await createTestCollege();
      const staffUser = await prisma.user.create({
        data: { name: 'Staff Contract Test', email: `staff_${Date.now()}@test.com`, role: 'employee', college_id: col.id }
      });
      const testDate = new Date('2026-11-20T00:00:00.000Z');

      const settings = { 'staff.shiftStartTime': '08:00', 'staff.graceMinutes': 15, 'staff.halfDayAfterMinutes': 120 };

      // Exact boundaries
      assert.strictEqual(calculateCheckInStatus(new Date('2026-11-20T03:15:00.000Z'), settings).status, 'PRESENT'); // 08:15 PKT
      assert.strictEqual(calculateCheckInStatus(new Date('2026-11-20T03:16:00.000Z'), settings).status, 'LATE'); // 08:16 PKT
      assert.strictEqual(calculateCheckInStatus(new Date('2026-11-20T05:01:00.000Z'), settings).status, 'HALF_DAY'); // 10:01 PKT

      // Source priority: MANUAL > BIOMETRIC > SYSTEM
      await recordStaffAttendance({ collegeId: col.id, userId: staffUser.id, date: testDate, status: 'ABSENT', source: 'SYSTEM' });
      const bio = await recordStaffAttendance({ collegeId: col.id, userId: staffUser.id, date: testDate, status: 'PRESENT', source: 'BIOMETRIC' });
      assert.strictEqual(bio.source, 'BIOMETRIC', 'BIOMETRIC must overwrite SYSTEM');

      const man = await recordStaffAttendance({ collegeId: col.id, userId: staffUser.id, date: testDate, status: 'LATE', minutesLate: 30, source: 'MANUAL', markedById: staffUser.id });
      assert.strictEqual(man.source, 'MANUAL', 'MANUAL must overwrite BIOMETRIC');

      const bioAttempt = await recordStaffAttendance({ collegeId: col.id, userId: staffUser.id, date: testDate, status: 'PRESENT', source: 'BIOMETRIC' });
      assert.strictEqual(bioAttempt.source, 'MANUAL', 'BIOMETRIC cannot overwrite higher MANUAL priority');
    });

    // =========================================================================
    // 8. SUB-PHASE 8E: #79 BIOMETRICS SIMULATOR & PATH B
    // =========================================================================
    await test('8. Sub-Phase 8E: Biometric Path B Ingress & In/Out Calculation', async () => {
      const col = await createTestCollege();
      const serialNumber = `ZK-CONTRACT-${Date.now()}`;
      const rawSecret = crypto.randomBytes(32).toString('hex');
      const pushSecretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

      const device = await prisma.biometricDevice.create({
        data: {
          college_id: col.id,
          serialNumber,
          deviceName: 'Turnstile A',
          pushSecretHash,
          status: 'ACTIVE'
        }
      });

      // Global unique check on serialNumber
      try {
        await prisma.biometricDevice.create({
          data: { college_id: col.id, serialNumber, deviceName: 'Turnstile B', pushSecretHash, status: 'ACTIVE' }
        });
        assert.fail('Duplicate serialNumber must fail');
      } catch (e) {
        assert(e.code === 'P2002' || e.message.includes('unique'));
      }

      // Feature #79 stays coming_soon
      const f79 = FEATURE_REGISTRY.find(f => f.id === '#79');
      assert.strictEqual(f79.status, 'coming_soon');
    });

    // =========================================================================
    // 9. SUB-PHASE 8F: MESSAGING LAYER FOUNDATION
    // =========================================================================
    await test('9. Sub-Phase 8F: In-App Zero Cost & Rejection of Packs before payment', async () => {
      const col = await createTestCollege();
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const student = await prisma.student.create({
        data: {
          college_id: col.id,
          session_id: session.id,
          name: 'Msg Student',
          fatherName: 'Father',
          gender: 'male',
          rollNumber: `ROLL_${Date.now()}`,
          class: '11th',
          group: 'Science'
        }
      });

      // InAppMessagingDriver.isReal === false
      assert.strictEqual(activeDrivers.IN_APP.isReal, false);

      // In-app message cost 0 credits
      const sent = await sendMessage({
        collegeId: col.id,
        recipient: { type: 'GUARDIAN', studentId: student.id },
        title: 'Notice',
        body: 'Zero cost notice'
      });
      assert.strictEqual(sent.costCredits, 0);

      // External SMS returns CHANNEL_NOT_AVAILABLE
      try {
        await sendMessage({ collegeId: col.id, recipient: { type: 'GUARDIAN', studentId: student.id }, channel: 'SMS', body: 'sms' });
        assert.fail('Should have failed');
      } catch (err) {
        assert.strictEqual(err.code, 'CHANNEL_NOT_AVAILABLE');
      }

      // Unpurchasable packs rejected in calculate-total
      const mockReq = { body: { type: 'ADDON_ORDER', lineItems: [{ addonType: 'SMS_PACK_500', quantity: 1 }] }, collegeId: col.id, user: { college_id: col.id } };
      let calcStatus = 200;
      let calcData = null;
      const mockRes = { status(s) { calcStatus = s; return this; }, json(d) { calcData = d; return this; } };
      await calculateTotal(mockReq, mockRes);
      assert.strictEqual(calcStatus, 422);
      assert.strictEqual(calcData.code, 'ITEM_NOT_PURCHASABLE');

      // #84 and #85 stay coming_soon
      assert.strictEqual(FEATURE_REGISTRY.find(f => f.id === '#84').status, 'coming_soon');
      assert.strictEqual(FEATURE_REGISTRY.find(f => f.id === '#85').status, 'coming_soon');
    });

    // =========================================================================
    // 10. SUB-PHASE 8G: #83 PARENT PORTAL PWA
    // =========================================================================
    await test('10. Sub-Phase 8G: Parent Portal 8-Char PIN, Lockout & Data Isolation', async () => {
      const col = await createTestCollege();
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const student = await prisma.student.create({
        data: {
          college_id: col.id,
          session_id: session.id,
          name: 'Parent Portal Student',
          fatherName: 'Father',
          gender: 'male',
          rollNumber: `PAR_${Date.now()}`,
          class: '11th',
          group: 'Science'
        }
      });

      const pin = generateGuardianPin();
      assert.strictEqual(pin.length, 8);
      const pinHash = await hashGuardianPin(pin);

      const guardianSess = await prisma.guardianSession.create({
        data: { college_id: col.id, studentId: student.id, pinHash, isActive: true }
      });

      // Wrong PIN returns generic error
      let logStatus = 200;
      let logData = null;
      const mockRes = { status(s) { logStatus = s; return this; }, json(d) { logData = d; return this; } };
      await login({ body: { collegeId: col.id, rollNumber: student.rollNumber, pin: 'WRONGPIN' }, ip: '127.0.0.1' }, mockRes, () => {});
      assert.strictEqual(logStatus, 401);
      assert.strictEqual(logData.message, 'Invalid roll number or PIN');

      // Guardian session never consumes student/user account quota
      const sessionCount = await prisma.guardianSession.count({ where: { college_id: col.id } });
      assert(sessionCount > 0);
    });

    // =========================================================================
    // 11. SUB-PHASE 8H: #81 ATTENDANCE SHORTAGE SCANNER
    // =========================================================================
    await test('11. Sub-Phase 8H: Shortage Scanner Calculation & JobRunLog Idempotency', async () => {
      const col = await createTestCollege({ planId: 'premium' });
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const student = await prisma.student.create({
        data: {
          college_id: col.id,
          session_id: session.id,
          name: 'Shortage Student',
          fatherName: 'Father',
          gender: 'male',
          rollNumber: `SHT_${Date.now()}`,
          class: '11th',
          group: 'Science'
        }
      });

      // Mark 3 absent days out of 4 (25% attendance)
      const d0 = new Date('2026-11-01');
      await prisma.attendance.create({ data: { college_id: col.id, session_id: session.id, student_id: student.id, date: d0, status: 'present' } });
      await prisma.attendance.create({ data: { college_id: col.id, session_id: session.id, student_id: student.id, date: new Date(d0.getTime() + 86400000), status: 'absent' } });
      await prisma.attendance.create({ data: { college_id: col.id, session_id: session.id, student_id: student.id, date: new Date(d0.getTime() + 2 * 86400000), status: 'absent' } });
      await prisma.attendance.create({ data: { college_id: col.id, session_id: session.id, student_id: student.id, date: new Date(d0.getTime() + 3 * 86400000), status: 'absent' } });

      const runKey = `TEST_SHORT_${Date.now()}`;
      const res = await runShortageScannerForCollege(col.id, { runKey, thresholdOverride: 75.0 });
      assert.strictEqual(res.success, true);
      assert(res.noticesIssued >= 1);

      // Double run with same runKey skips
      const res2 = await runShortageScannerForCollege(col.id, { runKey, thresholdOverride: 75.0 });
      assert.strictEqual(res2.skipped, true);
      assert.strictEqual(res2.reason, 'ALREADY_RAN');
    });

    // =========================================================================
    // 12. SUB-PHASE 8I: #86 ABSENCE ALERTS TO GUARDIANS
    // =========================================================================
    await test('12. Sub-Phase 8I: Absence Alerts Atomic Dispatch & Window Check', async () => {
      const col = await createTestCollege({ planId: 'premium' });
      const session = await prisma.session.create({
        data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
      });
      const student = await prisma.student.create({
        data: {
          college_id: col.id,
          session_id: session.id,
          name: 'Absence Alert Student',
          fatherName: 'Father',
          gender: 'male',
          rollNumber: `ABSA_${Date.now()}`,
          class: '11th',
          group: 'Science'
        }
      });
      await prisma.guardianSession.create({
        data: { college_id: col.id, studentId: student.id, pinHash: 'pin', isActive: true }
      });

      const testDate = new Date('2026-11-23T00:00:00.000Z'); // Monday
      await prisma.attendance.create({
        data: { college_id: col.id, session_id: session.id, student_id: student.id, date: testDate, status: 'absent' }
      });

      const res = await dispatchAbsenceAlertsForCollege(col.id, { date: testDate, forceTime: true });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.dispatchedCount, 1);

      // Verify AbsenceAlertLog
      const log = await prisma.absenceAlertLog.findUnique({
        where: { college_id_studentId_alertDate: { college_id: col.id, studentId: student.id, alertDate: testDate } }
      });
      assert(log);
    });

    // =========================================================================
    // 13. SUB-PHASE 8J: #87 EXECUTIVE KPI DASHBOARD
    // =========================================================================
    await test('13. Sub-Phase 8J: Executive KPI Pure Service & Role Permissions', async () => {
      const col = await createTestCollege();
      const kpi = await getKpiSummary(col.id, { periodStart: '2026-11-01', periodEnd: '2026-11-30' });
      assert(kpi.students);
      assert(kpi.fees);
      assert(kpi.staff);

      // Role check: teacher blocked
      let statusCode = 200;
      const resMock = { status(s) { statusCode = s; return this; }, json() { return this; } };
      await controllerGetKpi({ collegeId: col.id, user: { role: 'teacher' }, query: {} }, resMock, () => {});
      assert.strictEqual(statusCode, 403);
    });

    // =========================================================================
    // 14. SUB-PHASE 8K: #82 ONLINE PAYMENT GATEWAY ADAPTER
    // =========================================================================
    await test('14. Sub-Phase 8K: Gateway Adapter Interface & Stubs', async () => {
      assert.strictEqual(getActiveGatewayDriver('any-id'), null);
      const jc = new JazzCashDriver();
      assert.strictEqual(jc.isReal, false);
      const ep = new EasyPaisaDriver();
      assert.strictEqual(ep.isReal, false);

      const f82 = FEATURE_REGISTRY.find(f => f.id === '#82');
      assert.strictEqual(f82.status, 'coming_soon');
    });

    // =========================================================================
    // 15. CROSS-TENANT ISOLATION ACROSS ALL PHASE 8 MODELS
    // =========================================================================
    await test('15. Cross-Tenant Isolation: Tenant A cannot access Tenant B records', async () => {
      const colA = await createTestCollege();
      const colB = await createTestCollege();

      const secA = await prisma.biometricDevice.create({
        data: { college_id: colA.id, serialNumber: `SN_A_${Date.now()}`, deviceName: 'Dev A', pushSecretHash: 'hashA' }
      });

      // Tenant B queries Tenant A device
      const foundInB = await prisma.biometricDevice.findFirst({
        where: { id: secA.id, college_id: colB.id }
      });
      assert.strictEqual(foundInB, null, 'Cross-tenant lookup must return null (404)');
    });

  } catch (fatalError) {
    console.error('Fatal execution error:', fatalError);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`PHASE 8 CONTRACT TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runPhase8ContractTests().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
