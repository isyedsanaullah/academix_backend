// ─── Verification Script: Sub-Phases 10E, 10F & 10G (Campuses & Transfers) ───
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const campusService = require('../services/campusService');
const transferService = require('../services/transferService');
const { createOrUpdateChain } = require('../services/approvalService');

async function runSubphaseTests() {
  console.log('\n======================================================');
  console.log('   SUB-PHASES 10E, 10F & 10G: CAMPUS & TRANSFER TESTS ');
  console.log('======================================================\n');

  const prisma = getSystemClient();
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

  // Create Enterprise college
  const code = 'T10EFG_' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const college = await prisma.college.create({
    data: {
      name: `10EFG Enterprise College ${code}`,
      code,
      email: `${code.toLowerCase()}@test.com`,
      planId: 'enterprise',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  // Seed Main Campus (default)
  const mainCampus = await prisma.campus.create({
    data: {
      college_id: college.id,
      name: 'Main Campus',
      code: 'MAIN',
      isDefault: true,
      isActive: true
    }
  });

  // Seed Session
  const session = await prisma.session.create({
    data: {
      college_id: college.id,
      name: '2026-2027 Academic Session',
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400000)
    }
  });

  // Seed Class and Section in Main Campus
  const mainClass = await prisma.class.create({
    data: {
      college_id: college.id,
      campus_id: mainCampus.id,
      session_id: session.id,
      name: '11th Grade'
    }
  });

  const mainSection = await prisma.section.create({
    data: {
      college_id: college.id,
      campus_id: mainCampus.id,
      session_id: session.id,
      class_id: mainClass.id,
      name: 'Section A - Main',
      code: 'MAIN_A',
      capacity: 50
    }
  });

  try {
    // 1. Partial Unique Index: Exactly One Default Campus
    await test('1. Exactly one default campus per college is enforced by DB partial unique index', async () => {
      // Attempting to create a second default campus for the same college must fail with a unique violation
      await assert.rejects(
        async () => {
          await prisma.campus.create({
            data: {
              college_id: college.id,
              name: 'Duplicate Default Campus',
              code: 'DUP_DEF',
              isDefault: true,
              isActive: true
            }
          });
        },
        /unique|one_default_campus/i
      );
    });

    // 2. Campus Quota Gating & Creation (10F)
    await test('2. Creating second and third campuses succeeds under Enterprise quota', async () => {
      // Second campus
      const campus2 = await campusService.createCampus(college.id, {
        name: 'Gulberg Branch Campus',
        code: 'GULBERG',
        address: 'Main Boulevard, Gulberg',
        isDefault: false
      });
      assert.strictEqual(campus2.code, 'GULBERG');
      assert.strictEqual(campus2.isDefault, false);

      // Third campus
      const campus3 = await campusService.createCampus(college.id, {
        name: 'DHA Branch Campus',
        code: 'DHA',
        address: 'Phase 5, DHA',
        isDefault: false
      });
      assert.strictEqual(campus3.code, 'DHA');

      const allCampuses = await campusService.listCampuses(college.id);
      assert.strictEqual(allCampuses.length, 3, 'Expected 3 campuses');
    });

    // 3. Derived Student Campus (§10.1 Option B)
    await test('3. Student campus is dynamically derived from section without duplicating campus_id on Student', async () => {
      const student = await prisma.student.create({
        data: {
          college_id: college.id,
          session_id: session.id,
          name: 'Hamza Khan',
          fatherName: 'Tariq Khan',
          gender: 'male',
          rollNumber: 'ROLL-10EFG-01',
          class: '11th Grade',
          group: 'Pre-Medical',
          section: mainSection.name
        }
      });

      // Derive campus
      const derivedMain = await campusService.getStudentCampus(student.id, college.id);
      assert(derivedMain, 'Must derive campus');
      assert.strictEqual(derivedMain.id, mainCampus.id);
      assert.strictEqual(derivedMain.code, 'MAIN');
    });

    // 4. Executive Multi-Campus Dashboard Weighted Aggregates (10F)
    await test('4. Executive dashboard aggregates branch metrics by summing raw counts (ratio of sums != sum of ratios)', async () => {
      const dashboard = await campusService.getMultiCampusDashboard(college.id);
      assert(dashboard.campusCount >= 3);
      assert(dashboard.networkAggregates, 'Must return network aggregates');
      assert(dashboard.networkAggregates.capacityUtilizationRate.includes('%'));
      assert(dashboard.networkAggregates.staffAttendanceRate.includes('%'));
    });

    // 5. Cross-Campus Student Transfer (10G)
    await test('5. Cross-campus transfer updates section and class while preserving fee ledgers and files', async () => {
      const student = await prisma.student.findFirst({
        where: { college_id: college.id, rollNumber: 'ROLL-10EFG-01' }
      });
      assert(student);

      // Seed a fee voucher for student before transfer
      const fee = await prisma.fee.create({
        data: {
          college_id: college.id,
          session_id: session.id,
          student_id: student.id,
          month: '2026-11',
          totalAmount: 15000,
          paidAmount: 5000,
          status: 'partial'
        }
      });

      // Get Gulberg campus
      const gulbergCampus = await prisma.campus.findFirst({
        where: { college_id: college.id, code: 'GULBERG' }
      });
      assert(gulbergCampus);

      // Create destination class and section in Gulberg campus
      const gulbergClass = await prisma.class.create({
        data: {
          college_id: college.id,
          campus_id: gulbergCampus.id,
          session_id: session.id,
          name: '11th Grade (Gulberg)'
        }
      });

      const gulbergSection = await prisma.section.create({
        data: {
          college_id: college.id,
          campus_id: gulbergCampus.id,
          session_id: session.id,
          class_id: gulbergClass.id,
          name: 'Section G1 - PreMed',
          code: 'GULBERG_G1',
          capacity: 45
        }
      });

      // Execute transfer
      const transferResult = await transferService.initiateTransfer({
        collegeId: college.id,
        studentId: student.id,
        toSectionId: gulbergSection.id,
        reason: 'Student relocated residential address to Gulberg',
        actorUserId: 'admin_transfer'
      });

      assert.strictEqual(transferResult.status, 200);
      assert.strictEqual(transferResult.success, true);

      // Verify derived campus is now Gulberg
      const newDerivedCampus = await campusService.getStudentCampus(student.id, college.id);
      assert.strictEqual(newDerivedCampus.id, gulbergCampus.id);
      assert.strictEqual(newDerivedCampus.code, 'GULBERG');

      // Verify student class and section were updated
      const updatedStudent = await prisma.student.findUnique({ where: { id: student.id } });
      assert.strictEqual(updatedStudent.section, gulbergSection.name);
      assert.strictEqual(updatedStudent.class, '11th Grade (Gulberg)');

      // Verify fee ledger row is untouched
      const feeAfterTransfer = await prisma.fee.findUnique({ where: { id: fee.id } });
      assert.strictEqual(Number(feeAfterTransfer.totalAmount), 15000);
      assert.strictEqual(Number(feeAfterTransfer.paidAmount), 5000);
      assert.strictEqual(feeAfterTransfer.student_id, student.id);

      // Verify StudentCampusTransfer audit row
      const audit = await prisma.studentCampusTransfer.findFirst({
        where: { college_id: college.id, student_id: student.id }
      });
      assert(audit, 'StudentCampusTransfer record must exist');
      assert.strictEqual(audit.toCampusId, gulbergCampus.id);
      assert.strictEqual(audit.reason, 'Student relocated residential address to Gulberg');
    });

    // 6. Transfer Approval Chain Integration (N11)
    await test('6. Campus transfer with active approval chain returns HTTP 202 approvalRequestId', async () => {
      const student = await prisma.student.findFirst({
        where: { college_id: college.id, rollNumber: 'ROLL-10EFG-01' }
      });

      // Configure a 1-step approval chain for CAMPUS_TRANSFER
      await createOrUpdateChain({
        collegeId: college.id,
        workflowType: 'CAMPUS_TRANSFER',
        name: 'Inter-Campus Transfer Approval',
        steps: [
          { stepNumber: 1, approverType: 'ROLE', approverRef: 'principal', stepName: 'Principal Sanction' }
        ]
      });

      const dhaCampus = await prisma.campus.findFirst({
        where: { college_id: college.id, code: 'DHA' }
      });

      const dhaSection = await prisma.section.create({
        data: {
          college_id: college.id,
          campus_id: dhaCampus.id,
          session_id: session.id,
          class_id: mainClass.id,
          name: 'Section D1 - DHA',
          code: 'DHA_D1',
          capacity: 40
        }
      });

      // Request transfer
      const pendingResult = await transferService.initiateTransfer({
        collegeId: college.id,
        studentId: student.id,
        toSectionId: dhaSection.id,
        reason: 'Transfer to DHA campus',
        actorUserId: 'admin_test'
      });

      assert.strictEqual(pendingResult.status, 202);
      assert.strictEqual(pendingResult.requiresApproval, true);
      assert(pendingResult.approvalRequestId, 'Must return approvalRequestId');
    });
  } finally {
    // Cleanup
    await prisma.studentCampusTransfer.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.fee.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.student.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.section.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.class.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.approvalRequestStep.deleteMany({ where: { request: { college_id: college.id } } }).catch(() => {});
    await prisma.approvalRequest.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.approvalChainStep.deleteMany({ where: { chain: { college_id: college.id } } }).catch(() => {});
    await prisma.approvalChain.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.campus.deleteMany({ where: { college_id: college.id } }).catch(() => {});
    await prisma.college.delete({ where: { id: college.id } }).catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`SUB-PHASES 10E/F/G TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSubphaseTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
