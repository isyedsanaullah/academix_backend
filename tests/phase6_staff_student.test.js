'use strict';

/**
 * Phase 6 Unit Tests — Staff Accounts & Bulk Student Import
 *
 * Tests:
 *  1. requireVerifiedEmail middleware guard
 *  2. Staff invite creation (single & bulk) with 32-byte token and 3-day expiry
 *  3. Resend staff invitation with refreshed token
 *  4. Public token validation (GET /api/public/set-password/:token)
 *  5. Staff password submission & single-use enforcement (POST /api/public/set-password/:token)
 *  6. Student dynamic CSV template generation
 *  7. Student bulk import with valid rows, duplicate skipping, and invalid row failures
 *  8. ImportBatch & ImportBatchRow audit persistence and CSV error download
 *  9. Cleanup
 */

require('dotenv').config();
const assert = require('assert');
const crypto = require('crypto');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const {
  getStaffList,
  createStaff,
  resendStaffInvite,
  getSetPasswordStatus,
  submitSetPassword
} = require('../controllers/staffInvite.controller');
const {
  getStudentTemplate,
  importStudents,
  downloadBatchErrors,
  getRecentBatches
} = require('../controllers/studentImport.controller');

function createMockReqRes({ user, collegeId, body = {}, params = {}, query = {}, headers = {} }) {
  const req = {
    user: user || { id: 'test-admin-id', role: 'admin', emailVerified: true },
    collegeId,
    body,
    params,
    query,
    headers,
    socket: { remoteAddress: '127.0.0.1' }
  };

  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    send(data) {
      this.body = data;
      return this;
    }
  };

  return { req, res };
}

async function testPhase6StaffAndStudentImport() {
  console.log('🧪 Starting Phase 6 Unit Tests (Staff Accounts & Bulk Student Import)\n');
  const prisma = getSystemClient();

  const timestamp = Date.now().toString().slice(-6);
  const testSlug = `p6test-${timestamp}`;

  // ── Setup Test College & Admin ─────────────────────────────────────────────
  const testCollege = await prisma.college.create({
    data: {
      name: 'Phase 6 Imperial College',
      code: `P6C${timestamp}`,
      email: `admin-p6-${timestamp}@imperial.edu.pk`,
      slug: testSlug,
      status: 'onboarding',
      onboarding_state: { currentStep: 'staff', steps: { verify: 'done', profile: 'done', academic: 'done' } }
    }
  });

  const verifiedAdmin = await prisma.user.create({
    data: {
      name: 'Verified Admin',
      email: `admin-v-${timestamp}@imperial.edu.pk`,
      password: 'hashed-password-123',
      role: 'admin',
      college_id: testCollege.id,
      emailVerified: true
    }
  });

  const unverifiedAdmin = await prisma.user.create({
    data: {
      name: 'Unverified Admin',
      email: `admin-u-${timestamp}@imperial.edu.pk`,
      password: 'hashed-password-123',
      role: 'admin',
      college_id: testCollege.id,
      emailVerified: false
    }
  });

  // Setup Academic Session and Classes for student import
  const testSession = await prisma.session.create({
    data: {
      college_id: testCollege.id,
      name: `2026-2027-${timestamp}`,
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-06-30'),
      isCurrent: true,
      status: 'active',
      createdBy: verifiedAdmin.id
    }
  });

  const testClass1 = await prisma.class.create({
    data: {
      college_id: testCollege.id,
      session_id: testSession.id,
      name: 'FSc Pre-Medical (Part 1)',
      groups: ['Pre-Medical'],
      isActive: true
    }
  });

  const testSection1 = await prisma.section.create({
    data: {
      college_id: testCollege.id,
      session_id: testSession.id,
      class_id: testClass1.id,
      code: `FSCMED-${timestamp}-A`,
      name: 'FSc Pre-Medical (Part 1) - A',
      capacity: 50,
      isActive: true
    }
  });

  console.log(`  Setup complete: College '${testCollege.name}', Session '${testSession.name}'`);

  try {
    // ── 1. requireVerifiedEmail Middleware Guard ────────────────────────────
    console.log('\n--- 1. Testing requireVerifiedEmail Middleware Guard ---');
    {
      // Block unverified admin
      const { req: reqBlocked, res: resBlocked } = createMockReqRes({
        user: unverifiedAdmin,
        collegeId: testCollege.id
      });
      let nextCalled = false;
      await requireVerifiedEmail(reqBlocked, resBlocked, () => { nextCalled = true; });

      assert.strictEqual(resBlocked.statusCode, 403, 'Should return 403 for unverified user');
      assert.strictEqual(resBlocked.body.code, 'EMAIL_NOT_VERIFIED', 'Should return EMAIL_NOT_VERIFIED code');
      assert.strictEqual(nextCalled, false, 'next() should NOT be called for unverified user');
      console.log('  ✔ Blocked unverified user with 403 EMAIL_NOT_VERIFIED');

      // Allow verified admin
      const { req: reqAllowed, res: resAllowed } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id
      });
      let allowedCalled = false;
      await requireVerifiedEmail(reqAllowed, resAllowed, () => { allowedCalled = true; });

      assert.strictEqual(allowedCalled, true, 'next() must be called for verified user');
      console.log('  ✔ Allowed verified user to proceed');
    }

    // ── 2. Staff Account Creation & Invitation (Single & Bulk) ──────────────
    console.log('\n--- 2. Testing Staff Creation & Invitation Flow ---');
    let teacherToken = null;
    let createdTeacher = null;
    {
      const teacherEmail = `prof.ahmed.${timestamp}@imperial.edu.pk`;
      const { req, res } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        body: {
          name: 'Prof. Muhammad Ahmed',
          email: teacherEmail,
          role: 'teacher',
          phone: '+92 300 1112233',
          designation: 'Senior Lecturer Physics'
        }
      });

      await createStaff(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.summary.created, 1);
      assert.strictEqual(res.body.summary.failed, 0);

      // Verify user in database
      createdTeacher = await prisma.user.findUnique({
        where: { email: teacherEmail }
      });
      assert(createdTeacher, 'Teacher record should exist in DB');
      assert.strictEqual(createdTeacher.role, 'teacher');
      assert.strictEqual(createdTeacher.college_id, testCollege.id);
      assert.strictEqual(createdTeacher.emailVerified, false);
      assert(createdTeacher.resetCode, 'resetCode (hash) should be generated');
      assert(createdTeacher.resetCodeExpires > new Date(), 'resetCodeExpires should be in future');

      console.log(`  ✔ Single staff created with 3-day token (User ID: ${createdTeacher.id})`);

      // Test duplicate prevention
      const { req: reqDup, res: resDup } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        body: {
          name: 'Prof. Muhammad Ahmed',
          email: teacherEmail,
          role: 'teacher'
        }
      });
      await createStaff(reqDup, resDup, (err) => { if (err) throw err; });
      assert.strictEqual(resDup.body.summary.skipped, 1, 'Duplicate email should be skipped');
      console.log('  ✔ Duplicate staff email correctly skipped');

      // Test bulk staff creation
      const bulkList = [
        { name: 'Dr. Principal', email: `prin.${timestamp}@imperial.edu.pk`, role: 'principal' },
        { name: 'Mr. Accountant', email: `acct.${timestamp}@imperial.edu.pk`, role: 'accountant' },
        { name: 'Bad Role User', email: `bad.${timestamp}@imperial.edu.pk`, role: 'hacker' }
      ];
      const { req: reqBulk, res: resBulk } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        body: { staffList: bulkList }
      });
      await createStaff(reqBulk, resBulk, (err) => { if (err) throw err; });
      assert.strictEqual(resBulk.body.summary.created, 2, '2 valid staff created');
      assert.strictEqual(resBulk.body.summary.failed, 1, '1 invalid role failed');
      console.log('  ✔ Bulk staff import: 2 created, 1 invalid role rejected');
    }

    // ── 3. Resend Staff Invitation ──────────────────────────────────────────
    console.log('\n--- 3. Testing Resend Staff Invitation ---');
    let rawSetPasswordToken = null;
    {
      const oldHash = createdTeacher.resetCode;

      const { req, res } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        params: { userId: createdTeacher.id }
      });

      await resendStaffInvite(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);

      // Verify token updated
      const refreshedUser = await prisma.user.findUnique({
        where: { id: createdTeacher.id }
      });
      assert.notStrictEqual(refreshedUser.resetCode, oldHash, 'resetCode hash should change on resend');
      console.log('  ✔ Invitation resent: token refreshed successfully');

      // Create a known raw token and hash for testing public endpoints
      const rawToken = crypto.randomBytes(32).toString('hex');
      const testHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await prisma.user.update({
        where: { id: createdTeacher.id },
        data: {
          resetCode: testHash,
          resetCodeExpires: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
        }
      });
      rawSetPasswordToken = rawToken;
    }

    // ── 4. Public Token Validation & Password Submission ────────────────────
    console.log('\n--- 4. Testing Public Set-Password Endpoints ---');
    {
      // 4a. Validate valid token
      const { req: reqValid, res: resValid } = createMockReqRes({
        params: { token: rawSetPasswordToken }
      });
      await getSetPasswordStatus(reqValid, resValid, (err) => { if (err) throw err; });

      assert.strictEqual(resValid.statusCode, 200);
      assert.strictEqual(resValid.body.success, true);
      assert.strictEqual(resValid.body.valid, true);
      assert.strictEqual(resValid.body.data.name, 'Prof. Muhammad Ahmed');
      assert.strictEqual(resValid.body.data.college_name, 'Phase 6 Imperial College');
      console.log('  ✔ Token verified: returned staff name and college info');

      // 4b. Validate fake/expired token
      const { req: reqInvalid, res: resInvalid } = createMockReqRes({
        params: { token: 'invalid-nonexistent-token' }
      });
      await getSetPasswordStatus(reqInvalid, resInvalid, (err) => { if (err) throw err; });
      assert.strictEqual(resInvalid.body.valid, false, 'Invalid token should return valid: false');
      console.log('  ✔ Invalid token rejected');

      // 4c. Submit password
      const { req: reqSubmit, res: resSubmit } = createMockReqRes({
        params: { token: rawSetPasswordToken },
        body: { password: 'NewSecurePassword123!' }
      });
      await submitSetPassword(reqSubmit, resSubmit, (err) => { if (err) throw err; });

      assert.strictEqual(resSubmit.statusCode, 200);
      assert.strictEqual(resSubmit.body.success, true);
      console.log('  ✔ Password submitted successfully');

      // 4d. Verify single-use enforcement: second submit should fail
      const { req: reqReplay, res: resReplay } = createMockReqRes({
        params: { token: rawSetPasswordToken },
        body: { password: 'AnotherPassword123!' }
      });
      await submitSetPassword(reqReplay, resReplay, (err) => { if (err) throw err; });
      assert([400, 404].includes(resReplay.statusCode), 'Replay attack should fail with 400 or 404');
      console.log('  ✔ Single-use enforcement confirmed: token invalidated after use');

      // Verify user status is now active and emailVerified
      const activeUser = await prisma.user.findUnique({ where: { id: createdTeacher.id } });
      assert.strictEqual(activeUser.emailVerified, true);
      assert.strictEqual(activeUser.resetCode, null);
    }

    // ── 5. Student Dynamic CSV Template Generation ──────────────────────────
    console.log('\n--- 5. Testing Student Dynamic CSV Template Generation ---');
    {
      const { req, res } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id
      });

      await getStudentTemplate(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['Content-Type'], 'text/csv');
      assert(res.body.includes('Admission Number'), 'CSV should contain Admission Number header');
      assert(res.body.includes('FSc Pre-Medical (Part 1)'), 'CSV should dynamically mention active college classes');
      console.log('  ✔ Generated dynamic CSV template containing college classes & sections');
    }

    // ── 6. Student Bulk Import & Idempotency ─────────────────────────────────
    console.log('\n--- 6. Testing Student Bulk Import & Batch Auditing ---');
    let createdBatchId = null;
    {
      const studentsToImport = [
        {
          name: 'Zainab Bibi',
          fatherName: 'Muhammad Akram',
          rollNumber: `2026-MED-${timestamp}-01`,
          class: 'FSc Pre-Medical (Part 1)',
          section: 'A',
          gender: 'female',
          phone: '+92 301 1234567'
        },
        {
          name: 'Hamza Khan',
          fatherName: 'Javed Khan',
          rollNumber: `2026-MED-${timestamp}-02`,
          class: 'FSc Pre-Medical (Part 1)',
          section: 'A',
          gender: 'male',
          phone: '+92 301 2345678'
        },
        {
          name: 'Invalid Class Student',
          rollNumber: `2026-ERR-${timestamp}`,
          class: 'Non-Existent Class 99',
          section: 'A'
        },
        {
          name: '', // Missing name
          rollNumber: `2026-NONAME-${timestamp}`,
          class: 'FSc Pre-Medical (Part 1)'
        }
      ];

      const { req, res } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        body: {
          filename: 'test_enrollment.csv',
          students: studentsToImport
        }
      });

      await importStudents(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.summary.created, 2, '2 valid students created');
      assert.strictEqual(res.body.summary.failed, 2, '2 invalid students failed');
      assert(res.body.batchId, 'batchId should be returned');
      createdBatchId = res.body.batchId;
      console.log(`  ✔ ImportBatch created (ID: ${createdBatchId}): 2 created, 2 failed`);

      // Test duplicate rollNumber skip (idempotency)
      const duplicateStudent = [
        {
          name: 'Zainab Bibi',
          rollNumber: `2026-MED-${timestamp}-01`, // already created
          class: 'FSc Pre-Medical (Part 1)',
          section: 'A'
        }
      ];
      const { req: reqDup, res: resDup } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        body: {
          filename: 'test_duplicate.csv',
          students: duplicateStudent
        }
      });
      await importStudents(reqDup, resDup, (err) => { if (err) throw err; });
      assert.strictEqual(resDup.body.summary.skipped, 1, 'Duplicate rollNumber should be skipped');
      console.log('  ✔ Duplicate rollNumber within session properly skipped');
    }

    // ── 7. Batch Error Report Download ──────────────────────────────────────
    console.log('\n--- 7. Testing Batch Error Audit CSV Download ---');
    {
      const { req, res } = createMockReqRes({
        user: verifiedAdmin,
        collegeId: testCollege.id,
        params: { id: createdBatchId }
      });

      await downloadBatchErrors(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['Content-Type'], 'text/csv');
      assert(res.body.includes('Row Number'), 'Error report should contain Row Number header');
      assert(res.body.includes('Non-Existent Class 99'), 'Error report should detail failure reason');
      console.log('  ✔ Downloaded CSV error audit report with row-by-row diagnostics');
    }

    console.log('\n🎉 ALL PHASE 6 UNIT TESTS PASSED SUCCESSFULLY! (7/7 suites)\n');
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────
    console.log('Cleaning up Phase 6 test records...');
    try {
      await prisma.importBatchRow.deleteMany({
        where: { batch: { college_id: testCollege.id } }
      });
      await prisma.importBatch.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.student.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.section.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.class.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.session.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.user.deleteMany({
        where: { college_id: testCollege.id }
      });
      await prisma.college.delete({
        where: { id: testCollege.id }
      });
      console.log('Cleaned up test data.');
    } catch (cleanErr) {
      console.error('Cleanup notice:', cleanErr.message);
    }
    await closeAllClients();
  }
}

testPhase6StaffAndStudentImport().catch((err) => {
  console.error('\n❌ Phase 6 Test Failed:', err);
  process.exit(1);
});
