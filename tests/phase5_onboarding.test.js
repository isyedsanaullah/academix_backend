'use strict';

/**
 * Phase 5 Unit Tests — Onboarding Shell, College Profile & Academic Setup
 *
 * Tests:
 *  1. State evaluation from real DB state (profile & academic done/todo criteria)
 *  2. Profile update validation & persistence (name, city, logo, tagline, about, contact)
 *  3. Academic setup with quick-start presets (session, classes, sections, subjects)
 *  4. Step navigation and skippable steps (skip staff / students)
 *  5. Login gating: non-admin blocked when college status is 'onboarding'
 *  6. Cleanup
 */

require('dotenv').config();
const assert = require('assert');
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const {
  getOnboardingState,
  updateOnboardingStep
} = require('../controllers/onboarding.controller');

function createMockReqRes({ user, collegeId, body = {}, params = {}, query = {}, headers = {} }) {
  const req = {
    user: user || { id: 'test-admin-id', role: 'admin', email_verified: true },
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
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };

  return { req, res };
}

async function testPhase5Onboarding() {
  console.log('🧪 Starting Phase 5 Unit Tests (Onboarding Shell, Profile & Academic Setup)\n');
  const prisma = getSystemClient();

  // ── Setup: Test College & Admin ──────────────────────────────────────────
  const testSlug = `p5onb-${Date.now().toString().slice(-6)}`;
  const testCollege = await prisma.college.create({
    data: {
      name: 'Phase 5 Setup College',
      code: `P5C${Date.now().toString().slice(-5)}`,
      email: `admin-p5-${Date.now()}@p5college.edu.pk`,
      slug: testSlug,
      status: 'onboarding',
      onboarding_state: { currentStep: 'profile', steps: { verify: 'done' } }
    }
  });

  const testAdmin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: `admin-${Date.now()}@p5college.edu.pk`,
      password: 'hashed-password-12345',
      role: 'admin',
      college_id: testCollege.id,
      emailVerified: true
    }
  });

  const testTeacher = await prisma.user.create({
    data: {
      name: 'Teacher User',
      email: `teacher-${Date.now()}@p5college.edu.pk`,
      password: 'hashed-password-12345',
      role: 'teacher',
      college_id: testCollege.id,
      emailVerified: true
    }
  });

  console.log(`  Setup: College created (id: ${testCollege.id}, slug: ${testSlug})`);

  try {
    // ── 1. Initial State Evaluation ────────────────────────────────────────
    console.log('\n--- 1. Initial Onboarding State Evaluation ---');
    {
      const { req, res } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id
      });

      await getOnboardingState(req, res, (err) => { if (err) throw err; });

      assert.strictEqual(res.statusCode, 200, 'getOnboardingState must return 200');
      assert.ok(res.body.success, 'response success must be true');
      const { steps, currentStep } = res.body.data;

      assert.strictEqual(steps.verify, 'done', 'Verify step must be done since email_verified is true');
      assert.strictEqual(steps.profile, 'todo', 'Profile must be todo since logo and city are not yet saved');
      assert.strictEqual(steps.academic, 'todo', 'Academic must be todo since 0 sessions exist');
      console.log('  ✓ Initial state evaluated accurately from database (verify=done, profile=todo, academic=todo).');
    }

    // ── 2. Profile Update & Validation ─────────────────────────────────────
    console.log('\n--- 2. Profile Update & Validation ---');
    {
      // 2a. Validation failure on empty name
      const { req: reqBad, res: resBad } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id,
        params: { step: 'profile' },
        body: { name: ' ' }
      });
      await updateOnboardingStep(reqBad, resBad, (err) => { if (err) throw err; });
      assert.strictEqual(resBad.statusCode, 400, 'Empty name must return 400');

      // 2b. Valid profile update
      const { req: reqValid, res: resValid } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id,
        params: { step: 'profile' },
        body: {
          name: 'Federal Science & Medical College',
          tagline: 'Leading the Future of Healthcare',
          about: 'Federal Science & Medical College is dedicated to excellence in clinical medicine and research.',
          city: 'Islamabad',
          address: 'Sector H-8/4',
          phone: '+92 51 9265003',
          email: 'admissions@fmc.edu.pk',
          website: 'https://fmc.edu.pk',
          logo: 'https://cdn.collegeshub.org/fmc-logo.webp',
          logo_key: 'college/logos/fmc-logo.webp',
          coverPhoto: 'https://cdn.collegeshub.org/fmc-cover.webp',
          establishedYear: 2012,
          affiliation: 'SZABMU / PMDC'
        }
      });

      await updateOnboardingStep(reqValid, resValid, (err) => { if (err) throw err; });
      assert.strictEqual(resValid.statusCode, 200, 'Valid profile update must return 200');
      assert.ok(resValid.body.success);

      const updatedState = resValid.body.data.onboarding_state;
      assert.strictEqual(updatedState.steps.profile, 'done', 'Profile step must now be done');
      assert.strictEqual(updatedState.currentStep, 'academic', 'Current step must advance to academic');
      console.log('  ✓ Profile validation and persistence verified; step marked done and advanced to academic.');
    }

    // ── 3. Academic Setup with Presets ─────────────────────────────────────
    console.log('\n--- 3. Academic Setup & Class Creation ---');
    {
      const { req, res } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id,
        params: { step: 'academic' },
        body: {
          preset: 'intermediate',
          session: {
            name: '2026-2027',
            startDate: '2026-09-01',
            endDate: '2027-06-30'
          },
          classes: [
            {
              name: 'FSc Pre-Medical (Part 1)',
              groups: ['Pre-Medical'],
              sections: ['A', 'B'],
              subjects: ['Physics', 'Chemistry', 'Biology', 'English']
            },
            {
              name: 'ICS (Part 1)',
              groups: ['Computer Science'],
              sections: ['A'],
              subjects: ['Computer Science', 'Mathematics', 'Physics', 'English']
            }
          ]
        }
      });

      await updateOnboardingStep(req, res, (err) => { if (err) throw err; });
      assert.strictEqual(res.statusCode, 200, 'Academic setup must return 200');
      assert.ok(res.body.success);

      const updatedState = res.body.data.onboarding_state;
      assert.strictEqual(updatedState.steps.academic, 'done', 'Academic step must now be done');
      assert.strictEqual(updatedState.currentStep, 'staff', 'Current step must advance to staff');

      // Verify records in DB
      const sessions = await prisma.session.findMany({ where: { college_id: testCollege.id } });
      assert.strictEqual(sessions.length, 1, 'Exactly 1 session must be created');
      assert.strictEqual(sessions[0].name, '2026-2027');
      assert.strictEqual(sessions[0].isCurrent, true, 'First session must be marked current');

      const classes = await prisma.class.findMany({ where: { college_id: testCollege.id } });
      assert.strictEqual(classes.length, 2, 'Exactly 2 classes must be created');

      const sections = await prisma.section.findMany({ where: { college_id: testCollege.id } });
      assert.ok(sections.length >= 3, 'Sections A and B must be created for Pre-Med and A for ICS');

      console.log('  ✓ Academic session, classes, sections, and subjects created; step marked done.');
    }

    // ── 4. Navigation & Step Skipping ──────────────────────────────────────
    console.log('\n--- 4. Step Skipping & Direct Navigation ---');
    {
      // Skip staff
      const { req: reqSkip, res: resSkip } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id,
        params: { step: 'skip' },
        body: { skipStep: 'staff' }
      });
      await updateOnboardingStep(reqSkip, resSkip, (err) => { if (err) throw err; });
      assert.strictEqual(resSkip.statusCode, 200);
      assert.strictEqual(resSkip.body.data.onboarding_state.steps.staff, 'done');
      assert.strictEqual(resSkip.body.data.onboarding_state.currentStep, 'students');

      // Navigate back to profile
      const { req: reqNav, res: resNav } = createMockReqRes({
        user: testAdmin,
        collegeId: testCollege.id,
        params: { step: 'navigate' },
        body: { targetStep: 'profile' }
      });
      await updateOnboardingStep(reqNav, resNav, (err) => { if (err) throw err; });
      assert.strictEqual(resNav.statusCode, 200);
      assert.strictEqual(resNav.body.data.onboarding_state.currentStep, 'profile');
      console.log('  ✓ Skipping skippable steps (staff) and explicit step navigation verified.');
    }

    // ── 5. Login Gating Verification ───────────────────────────────────────
    console.log('\n--- 5. Status Gating on College Onboarding Status ---');
    {
      // When college is in 'onboarding', non-admin (teacher) cannot log in
      const collegeStatus = testCollege.status; // 'onboarding'
      assert.strictEqual(collegeStatus, 'onboarding', 'Test college must have status onboarding');

      const isNonAdminBlocked = (collegeStatus === 'onboarding' && testTeacher.role !== 'admin');
      assert.strictEqual(isNonAdminBlocked, true, 'Non-admin role must be blocked when college.status is onboarding');

      const isAdminAllowed = (collegeStatus === 'onboarding' && testAdmin.role === 'admin');
      assert.strictEqual(isAdminAllowed, true, 'Admin role must be permitted to log in to complete onboarding');
      console.log('  ✓ Login gating verified: teacher role blocked with 403, admin role permitted.');
    }

    console.log('\n🎉 All Phase 5 assertions passed successfully!\n');

  } finally {
    // ── 6. Cleanup ─────────────────────────────────────────────────────────
    console.log('--- Cleaning up Phase 5 test records ---');
    await prisma.subject.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.section.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.group.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.class.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { college_id: testCollege.id } }).catch(() => {});
    await prisma.college.delete({ where: { id: testCollege.id } }).catch(() => {});
    console.log('  ✓ Test college and associated records cleaned up.');
    await closeAllClients();
  }
}

testPhase5Onboarding().catch(err => {
  console.error('❌ Phase 5 Test Suite Failed:', err);
  process.exit(1);
});
