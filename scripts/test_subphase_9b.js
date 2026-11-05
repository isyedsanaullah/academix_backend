'use strict';

/**
 * test_subphase_9b.js — Test Sub-Phase 9B: N01 Export Center
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const {
  sanitizeCsvCell,
  generateCsv,
  generateXlsx,
  queueExportJob
} = require('../services/exportService');

const { processNextExportJob } = require('../workers/exportWorker');
const { getEntitlements } = require('../services/entitlements');
const { checkQuota, recordUsage, refundQuota } = require('../services/quotaService');
const { PLAN_LIMITS, getMonthlyKey } = require('../config/planConstants');
const XLSX = require('xlsx');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9B: N01 EXPORT CENTER         ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  // 1. Formula Injection Neutralization
  await test('1. Formula Injection Neutralization (CSV prefixing & XLSX string typing)', async () => {
    // Dangerous prefixes
    assert.strictEqual(sanitizeCsvCell('=SUM(A1:B1)'), "'=SUM(A1:B1)");
    assert.strictEqual(sanitizeCsvCell('+12345'), "'+12345");
    assert.strictEqual(sanitizeCsvCell('-500'), "'-500");
    assert.strictEqual(sanitizeCsvCell('@admin'), "'@admin");
    assert.strictEqual(sanitizeCsvCell('\tcmd'), "'\tcmd");
    assert.strictEqual(sanitizeCsvCell('\rcmd'), "\"'\rcmd\"");

    // Safe numbers and strings
    assert.strictEqual(sanitizeCsvCell(1500), '1500');
    assert.strictEqual(sanitizeCsvCell(true), 'TRUE');
    assert.strictEqual(sanitizeCsvCell('Normal Text'), 'Normal Text');

    // XLSX string typing
    const headers = ['Name', 'Formula'];
    const rows = [['Student 1', '=1+2'], ['Student 2', 'Safe']];
    const xlsxBuffer = generateXlsx(headers, rows);
    assert(Buffer.isBuffer(xlsxBuffer));

    const wb = XLSX.read(xlsxBuffer, { type: 'buffer' });
    const sheet = wb.Sheets['Export'];
    // Cell B2 (Formula cell '=1+2') must be typed as string ('s')
    assert.strictEqual(sheet['B2'].t, 's');
    assert(sheet['B2'].v.startsWith("'="));
  });

  // 2. Standardized Metric Keys & Resolver Fallback
  await test('2. Standardized Metric Keys & Resolver Fallback to PLAN_LIMITS', async () => {
    assert.strictEqual(PLAN_LIMITS.starter.exportsCsvMonthly, 3);
    assert.strictEqual(PLAN_LIMITS.starter.exportsPdfMonthly, 0);
    assert.strictEqual(PLAN_LIMITS.starter.exportMaxRows, 1000);

    assert.strictEqual(PLAN_LIMITS.standard.exportsCsvMonthly, 60);
    assert.strictEqual(PLAN_LIMITS.standard.exportsPdfMonthly, 0);
    assert.strictEqual(PLAN_LIMITS.standard.exportMaxRows, 10000);

    assert.strictEqual(PLAN_LIMITS.premium.exportsCsvMonthly, -1);
    assert.strictEqual(PLAN_LIMITS.premium.exportsPdfMonthly, 60);
    assert.strictEqual(PLAN_LIMITS.premium.exportMaxRows, 100000);

    assert.strictEqual(PLAN_LIMITS.enterprise.exportsCsvMonthly, -1);
    assert.strictEqual(PLAN_LIMITS.enterprise.exportsPdfMonthly, -1);
    assert.strictEqual(PLAN_LIMITS.enterprise.exportMaxRows, 1000000);

    const col = await prisma.college.create({
      data: { name: 'Limits College', email: `lim_${Date.now()}@test.com`, code: `LIM_${Date.now()}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    const ent = await getEntitlements(col.id);
    assert.strictEqual(ent.effectiveLimits.exportsCsvMonthly, 3);
    assert.strictEqual(ent.effectiveLimits.exportsPdfMonthly, 0);
    assert.strictEqual(ent.effectiveLimits.exportMaxRows, 1000);
  });

  // 3. Row Cap Enforcement (422 EXPORT_ROW_CAP_EXCEEDED) with Quota Refund
  await test('3. Row Cap Overflow rejects with 422 and refunds quota', async () => {
    const col = await prisma.college.create({
      data: { name: 'Cap College', email: `cap_${Date.now()}@test.com`, code: `CAP_${Date.now()}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    const session = await prisma.session.create({
      data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });

    // Create 1001 students (exceeding Starter 1,000 row cap)
    const studentsData = [];
    for (let i = 1; i <= 1005; i++) {
      studentsData.push({
        college_id: col.id,
        session_id: session.id,
        name: `Student ${i}`,
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `R_${i}_${Date.now()}`,
        class: '11th',
        group: 'Science'
      });
    }
    await prisma.student.createMany({ data: studentsData });

    // Attempting to export STUDENTS must reject with 422 EXPORT_ROW_CAP_EXCEEDED
    try {
      await queueExportJob({
        collegeId: col.id,
        userId: 'admin-1',
        exportType: 'STUDENTS',
        format: 'CSV'
      });
      assert.fail('Should have thrown 422 EXPORT_ROW_CAP_EXCEEDED');
    } catch (err) {
      assert.strictEqual(err.code, 'EXPORT_ROW_CAP_EXCEEDED');
      assert.strictEqual(err.details.limit, 1000);
      assert(err.details.count >= 1005);
    }

    // Verify usage was refunded (not consumed)
    const periodKey = getMonthlyKey(new Date());
    const usage = await prisma.collegeUsage.findUnique({
      where: { college_id_metric_period: { college_id: col.id, metric: 'exportsCsvMonthly', period: periodKey } }
    });
    assert.strictEqual(Number(usage?.value || 0), 0, 'Quota must be refunded after cap overflow');
  });

  // 4. Successful Job Queueing, Worker Processing & Ready State
  await test('4. Export Job Queueing, Worker Execution & Ready State', async () => {
    const col = await prisma.college.create({
      data: { name: 'Work College', email: `work_${Date.now()}@test.com`, code: `WRK_${Date.now()}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    const session = await prisma.session.create({
      data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });

    await prisma.student.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        name: 'Export Student',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `EXP_${Date.now()}`,
        class: '11th',
        group: 'Science'
      }
    });

    const job = await queueExportJob({
      collegeId: col.id,
      userId: 'admin-1',
      exportType: 'STUDENTS',
      format: 'CSV'
    });
    assert.strictEqual(job.status, 'QUEUED');

    // Run worker
    const workerResult = await processNextExportJob();
    assert.strictEqual(workerResult.success, true);
    assert.strictEqual(workerResult.jobId, job.id);
    assert(workerResult.fileKey.endsWith('.csv'));

    const updatedJob = await prisma.exportJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(updatedJob.status, 'READY');
    assert.strictEqual(updatedJob.rowCount, 1);
    assert(updatedJob.sizeBytes > 0n);
  });

  // 5. Atomic Quota Refund on Worker Failure
  await test('5. Atomic Quota Refund on Worker Execution Failure', async () => {
    const col = await prisma.college.create({
      data: { name: 'Fail College', email: `fail_${Date.now()}@test.com`, code: `FL_${Date.now()}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    const periodKey = getMonthlyKey(new Date());

    // Record 1 usage unit
    await recordUsage(col.id, 'exportsCsvMonthly', 1);

    // Create a job that will fail (simulating missing DB table or bad format)
    const job = await prisma.exportJob.create({
      data: {
        college_id: col.id,
        userId: 'admin-1',
        exportType: 'UNKNOWN_TYPE_FAIL',
        format: 'CSV',
        periodKey,
        status: 'QUEUED',
        expiresAt: new Date(Date.now() + 86400000)
      }
    });

    // Run worker
    await processNextExportJob();

    const updatedJob = await prisma.exportJob.findUnique({ where: { id: job.id } });
    assert.strictEqual(updatedJob.status, 'FAILED');
    assert(updatedJob.quotaRefundedAt !== null);

    // Verify usage was refunded to 0
    const usageAfter = await prisma.collegeUsage.findUnique({
      where: { college_id_metric_period: { college_id: col.id, metric: 'exportsCsvMonthly', period: periodKey } }
    });
    assert.strictEqual(Number(usageAfter?.value || 0), 0);
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9B TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`====================================================`);

  if (failed > 0) process.exit(1);
}

runTests()
  .catch(err => {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
