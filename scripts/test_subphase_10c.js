// ─── Verification Script: Sub-Phase 10C (N16 Data Retention & Legal Hold) ───
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const legalHoldService = require('../services/legalHoldService');
const { deleteStoredFile } = require('../services/storageQuotaService');
const { STEP_UP_SECRET } = require('../middleware/stepUpAuth');

async function runSubphase10cTests() {
  console.log('\n======================================================');
  console.log('   SUB-PHASE 10C: N16 DATA RETENTION & LEGAL HOLD     ');
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

  // Create test colleges
  const codeE = 'T10C_E_' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const codeP = 'T10C_P_' + Math.random().toString(36).substring(2, 6).toUpperCase();

  const enterpriseCollege = await prisma.college.create({
    data: {
      name: `10C Enterprise College ${codeE}`,
      code: codeE,
      email: `${codeE.toLowerCase()}@test.com`,
      planId: 'enterprise',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  const premiumCollege = await prisma.college.create({
    data: {
      name: `10C Premium College ${codeP}`,
      code: codeP,
      email: `${codeP.toLowerCase()}@test.com`,
      planId: 'premium',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  // Create academic session and student
  const session = await prisma.session.create({
    data: {
      college_id: enterpriseCollege.id,
      name: '2026-2027 Academic Year',
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400000)
    }
  });

  const student = await prisma.student.create({
    data: {
      college_id: enterpriseCollege.id,
      session_id: session.id,
      name: 'Ali Raza',
      fatherName: 'Raza Ahmad',
      gender: 'male',
      rollNumber: 'ROLL-10C-001',
      class: '11th',
      group: 'Pre-Engineering'
    }
  });

  try {
    // 1. Scope-to-entity Mapping & Placement
    await test('1. Placing legal hold supports STUDENT, SESSION, and ALL_STUDENTS scopes', async () => {
      // 1a. Student Scope
      const studentHold = await legalHoldService.placeLegalHold(enterpriseCollege.id, {
        title: 'Disputed Enrollment - Ali Raza',
        reason: 'Pending fee embezzlement investigation',
        scopeType: 'STUDENT',
        targetId: student.id,
        placedBy: 'admin_audit'
      });
      assert.strictEqual(studentHold.scopeType, 'STUDENT');
      assert.strictEqual(studentHold.isActive, true);

      // Verify active hold matches student
      const activeHold = await legalHoldService.getActiveLegalHold(enterpriseCollege.id, { studentId: student.id });
      assert(activeHold, 'Active legal hold must match student');
      assert.strictEqual(activeHold.id, studentHold.id);

      // 1b. Session Scope
      const sessionHold = await legalHoldService.placeLegalHold(enterpriseCollege.id, {
        title: 'Session 2026 Board Scrutiny',
        reason: 'Board exam re-evaluation across full session',
        scopeType: 'SESSION',
        targetId: session.id,
        placedBy: 'admin_audit'
      });
      assert.strictEqual(sessionHold.scopeType, 'SESSION');

      // 1c. All Students Scope
      const allHold = await legalHoldService.placeLegalHold(enterpriseCollege.id, {
        title: 'Institutional Statutory Audit',
        reason: 'High Court judicial inquiry',
        scopeType: 'ALL_STUDENTS',
        placedBy: 'admin_audit'
      });
      assert.strictEqual(allHold.scopeType, 'ALL_STUDENTS');
    });

    // 2. Cross-Tenant ID Rejection
    await test('2. Cross-tenant targetId lookup is rejected with 404', async () => {
      await assert.rejects(
        async () => {
          // Attempting to place hold in premiumCollege using enterpriseCollege's student
          await legalHoldService.placeLegalHold(premiumCollege.id, {
            title: 'Cross Tenant Hack',
            reason: 'Testing boundary',
            scopeType: 'STUDENT',
            targetId: student.id,
            placedBy: 'admin_bad'
          });
        },
        err => err.statusCode === 404
      );
    });

    // 3. Delete Protection: assertNoLegalHold & deleteStoredFile
    await test('3. Deletion of record or file under legal hold is blocked with 403 LEGAL_HOLD_ACTIVE', async () => {
      // Create a test file linked to student
      const file = await prisma.storedFile.create({
        data: {
          college_id: enterpriseCollege.id,
          uploadedById: 'admin_test',
          objectKey: `tenants/${enterpriseCollege.id}/files/evidence_doc.pdf`,
          originalFilename: 'evidence_doc.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1024,
          category: 'document',
          entityType: 'Student',
          entityId: student.id,
          status: 'ready'
        }
      });

      // Attempting to delete stored file under hold must be blocked with 403
      await assert.rejects(
        async () => {
          await deleteStoredFile(file.id, enterpriseCollege.id);
        },
        err => err.code === 'LEGAL_HOLD_ACTIVE' && err.statusCode === 403
      );

      // Student deletion assertion
      await assert.rejects(
        async () => {
          await legalHoldService.assertNoLegalHold(enterpriseCollege.id, { studentId: student.id });
        },
        err => err.code === 'LEGAL_HOLD_ACTIVE'
      );
    });

    // 4. Release Legal Hold with Audit Trail
    await test('4. Releasing a legal hold records releaseReason and releasedBy without deleting the hold row', async () => {
      // Find the active student hold
      const activeStudentHold = await prisma.legalHold.findFirst({
        where: { college_id: enterpriseCollege.id, targetId: student.id, isActive: true }
      });
      assert(activeStudentHold, 'Expected student hold');

      // Release without reason fails with 422
      await assert.rejects(
        async () => {
          await legalHoldService.releaseLegalHold(enterpriseCollege.id, activeStudentHold.id, {
            releasedBy: 'counsel_jane',
            releaseReason: '' // Empty reason
          });
        },
        err => err.statusCode === 422
      );

      // Release with valid reason
      const released = await legalHoldService.releaseLegalHold(enterpriseCollege.id, activeStudentHold.id, {
        releasedBy: 'counsel_jane',
        releaseReason: 'Inquiry resolved with clean report; hold lifted by legal counsel'
      });

      assert.strictEqual(released.isActive, false);
      assert.strictEqual(released.releasedBy, 'counsel_jane');
      assert.strictEqual(released.releaseReason, 'Inquiry resolved with clean report; hold lifted by legal counsel');
      assert(released.releasedAt !== null);

      // Row still exists in DB
      const inDb = await prisma.legalHold.findUnique({ where: { id: activeStudentHold.id } });
      assert(inDb, 'Hold record must remain in DB for audit trail');
    });

    // 5. Retention Policy Platform Floors
    await test('5. Retention policies strictly enforce platform floors (TRASHED_STUDENT >= 7, STORED_FILE >= 30)', async () => {
      // 5a: Trashed student below floor (3 days) -> REJECTED (422)
      await assert.rejects(
        async () => {
          await legalHoldService.setRetentionPolicy(enterpriseCollege.id, {
            entityType: 'TRASHED_STUDENT',
            retainDays: 3
          });
        },
        err => err.code === 'RETENTION_BELOW_FLOOR' && err.statusCode === 422
      );

      // 5b: Stored file below floor (15 days) -> REJECTED (422)
      await assert.rejects(
        async () => {
          await legalHoldService.setRetentionPolicy(enterpriseCollege.id, {
            entityType: 'STORED_FILE',
            retainDays: 15
          });
        },
        err => err.code === 'RETENTION_BELOW_FLOOR' && err.statusCode === 422
      );

      // 5c: Valid retention policy above floor (180 days) -> ACCEPTED
      const policy = await legalHoldService.setRetentionPolicy(enterpriseCollege.id, {
        entityType: 'STORED_FILE',
        retainDays: 180
      });
      assert.strictEqual(policy.retainDays, 180);

      const effective = await legalHoldService.getEffectiveRetentionDays(enterpriseCollege.id, 'STORED_FILE');
      assert.strictEqual(effective, 180);
    });
  } finally {
    // Cleanup
    await prisma.storedFile.deleteMany({ where: { college_id: enterpriseCollege.id } }).catch(() => {});
    await prisma.student.deleteMany({ where: { college_id: enterpriseCollege.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { college_id: enterpriseCollege.id } }).catch(() => {});
    await prisma.legalHold.deleteMany({ where: { college_id: { in: [enterpriseCollege.id, premiumCollege.id] } } }).catch(() => {});
    await prisma.retentionPolicy.deleteMany({ where: { college_id: enterpriseCollege.id } }).catch(() => {});
    await prisma.college.deleteMany({ where: { id: { in: [enterpriseCollege.id, premiumCollege.id] } } }).catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`SUB-PHASE 10C TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSubphase10cTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
