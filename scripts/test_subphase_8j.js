require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const { getKpiSummary } = require('../services/executiveKpiService');
const { getKpiSummary: controllerGetKpi } = require('../controllers/executiveKpi.controller');

async function runTests() {
  console.log('--- Testing Sub-Phase 8J: #87 Principal & Executive KPI Dashboard ---');
  const prisma = getSystemClient();

  const college = await prisma.college.findFirst();
  assert(college, 'A test college must exist');
  const collegeId = college.id;

  // 1. Pure service execution
  console.log('1. Testing pure service execution and structure...');
  const kpi = await getKpiSummary(collegeId, {
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30'
  });

  assert(kpi.period, 'kpi must contain period info');
  assert(kpi.students, 'kpi must contain students block');
  assert(kpi.staff, 'kpi must contain staff block');
  assert(kpi.fees, 'kpi must contain fees block');

  assert(typeof kpi.students.studentAttendancePct === 'number');
  assert(typeof kpi.students.totalStudentMarked === 'number');
  assert(typeof kpi.students.studentAttendanceCoverage === 'number');
  assert(typeof kpi.students.lowCoverage === 'boolean');

  assert(typeof kpi.fees.feeRecoveryRate === 'number');
  assert(typeof kpi.fees.billedCohortPkr === 'number');
  assert(typeof kpi.fees.collectedCohortPkr === 'number');
  console.log('   PASS: Pure service returned structured numerators and denominators.');

  // 2. Role Access Restrictions in Controller
  console.log('2. Testing Role Access Restrictions in Controller...');
  function mockReqRes(role) {
    let statusCode = 200;
    let responseData = null;
    const req = {
      collegeId,
      user: { id: 'test-user', role },
      query: { periodStart: '2026-11-01', periodEnd: '2026-11-30' }
    };
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };
    return { req, res, getStatus: () => statusCode, getData: () => responseData };
  }

  // Teacher blocked with 403
  const teacherMock = mockReqRes('teacher');
  await controllerGetKpi(teacherMock.req, teacherMock.res, () => {});
  assert.strictEqual(teacherMock.getStatus(), 403, 'Teacher role must receive 403');
  assert.strictEqual(teacherMock.getData().code, 'FORBIDDEN');
  console.log('   PASS: Teacher access correctly blocked with 403.');

  // Accountant blocked with 403
  const accountantMock = mockReqRes('accountant');
  await controllerGetKpi(accountantMock.req, accountantMock.res, () => {});
  assert.strictEqual(accountantMock.getStatus(), 403, 'Accountant role must receive 403');
  console.log('   PASS: Accountant access correctly blocked with 403.');

  // Admin allowed with 200
  const adminMock = mockReqRes('admin');
  await controllerGetKpi(adminMock.req, adminMock.res, () => {});
  assert.strictEqual(adminMock.getStatus(), 200, 'Admin role must receive 200');
  console.log('   PASS: Admin access correctly permitted with 200.');

  // Principal allowed with 200
  const principalMock = mockReqRes('principal');
  await controllerGetKpi(principalMock.req, principalMock.res, () => {});
  assert.strictEqual(principalMock.getStatus(), 200, 'Principal role must receive 200');
  console.log('   PASS: Principal access correctly permitted with 200.');

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8J TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});

