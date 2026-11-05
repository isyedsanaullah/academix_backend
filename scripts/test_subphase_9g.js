'use strict';

/**
 * test_subphase_9g.js — Test Sub-Phase 9G: N08 Faculty & Student Offline PWA
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const staffPwaService = require('../services/staffPwaService');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9G: N08 FACULTY OFFLINE PWA   ');
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

  // 1. Tier Entitlement Gate (Standard+ only, Starter blocked with 403)
  await test('1. Tier Entitlement Gate: Starter receives 403 FEATURE_NOT_IN_PLAN', async () => {
    const starterCol = await prisma.college.create({
      data: { name: 'Starter PWA Col', email: `stpwa_${Date.now()}@test.com`, code: `STP_${Date.now()}`, planId: 'starter', subStatus: 'ACTIVE' }
    });

    const teacher = await prisma.user.create({
      data: { college_id: starterCol.id, email: `stt_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Teacher' }
    });

    try {
      await staffPwaService.getStaffOfflineBundle({
        collegeId: starterCol.id,
        userId: teacher.id
      });
      assert.fail('Starter should be rejected');
    } catch (err) {
      assert.strictEqual(err.code, 'FEATURE_NOT_IN_PLAN');
    }
  });

  // 2. Read-Only Offline Bundle Scoping (Assigned Sections Only, Strict Isolation)
  await test('2. Read-Only Offline Bundle Scoping: Only assigned sections, cross-section data excluded', async () => {
    const stdCol = await prisma.college.create({
      data: { name: 'Std PWA Col', email: `stdpwa_${Date.now()}@test.com`, code: `SDP_${Date.now()}`, planId: 'standard', subStatus: 'ACTIVE' }
    });

    const session = await prisma.session.create({
      data: { college_id: stdCol.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });

    const cls = await prisma.class.create({
      data: { college_id: stdCol.id, session_id: session.id, name: '11th' }
    });

    const teacherA = await prisma.user.create({
      data: { college_id: stdCol.id, email: `ta_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Teacher A' }
    });

    // Section A (Assigned to Teacher A as class teacher)
    const sectionA = await prisma.section.create({
      data: {
        college_id: stdCol.id,
        session_id: session.id,
        class_id: cls.id,
        code: `A_${Date.now()}`,
        name: 'Section Alpha',
        capacity: 40,
        classTeacher: teacherA.id
      }
    });

    // Section B (Assigned to someone else)
    const sectionB = await prisma.section.create({
      data: {
        college_id: stdCol.id,
        session_id: session.id,
        class_id: cls.id,
        code: `B_${Date.now()}`,
        name: 'Section Beta',
        capacity: 40,
        classTeacher: 'other-teacher'
      }
    });

    // Students in Section A
    const stuA = await prisma.student.create({
      data: {
        college_id: stdCol.id,
        session_id: session.id,
        section_id: sectionA.id,
        name: 'Student Alpha',
        fatherName: 'Father A',
        gender: 'male',
        rollNumber: `A_${Date.now()}`,
        class: '11th',
        group: 'Science'
      }
    });

    // Students in Section B
    await prisma.student.create({
      data: {
        college_id: stdCol.id,
        session_id: session.id,
        section_id: sectionB.id,
        name: 'Student Beta (Secret)',
        fatherName: 'Father B',
        gender: 'male',
        rollNumber: `B_${Date.now()}`,
        class: '11th',
        group: 'Science'
      }
    });

    // Fetch offline bundle for Teacher A
    const bundle = await staffPwaService.getStaffOfflineBundle({
      collegeId: stdCol.id,
      userId: teacherA.id
    });

    // Assert assignedSections has ONLY Section A
    assert.strictEqual(bundle.assignedSections.length, 1);
    assert.strictEqual(bundle.assignedSections[0].id, sectionA.id);

    // Assert rosters has ONLY Student Alpha (Student Beta MUST NOT BE PRESENT)
    assert.strictEqual(bundle.rosters.length, 1);
    assert.strictEqual(bundle.rosters[0].name, 'Student Alpha');
    assert.strictEqual(bundle.rosters[0].section_id, sectionA.id);

    // Assert PII protection: no photos, no passwords, no guardian PINs
    assert.strictEqual(bundle.rosters[0].guardianPinHash, undefined);
    assert.strictEqual(bundle.rosters[0].photoUrl, undefined);

    // Cache metadata
    assert.strictEqual(bundle.cacheMetadata.scope, '/staff-app/');
    assert.strictEqual(bundle.cacheMetadata.maxAgeHours, 24);
  });

  // 3. Manifest & Service Worker Scope Isolation
  await test('3. Distinct Scope /staff-app/ and Clear-Site-Data Logout Header', async () => {
    const staffRoutes = require('../routes/staffApp.routes');

    // Test Manifest Response
    let manifestData = null;
    let manifestContentType = null;
    const fakeResManifest = {
      setHeader(k, v) { if (k === 'Content-Type') manifestContentType = v; },
      json(d) { manifestData = d; }
    };

    // Find GET /manifest.json handler
    const manifestRoute = staffRoutes.stack.find(s => s.route && s.route.path === '/manifest.json');
    assert(manifestRoute);
    manifestRoute.route.stack[0].handle({}, fakeResManifest);

    assert.strictEqual(manifestContentType, 'application/manifest+json');
    assert.strictEqual(manifestData.scope, '/staff-app/');
    assert.strictEqual(manifestData.start_url, '/staff-app/');

    // Test Logout Clear-Site-Data
    let clearedHeader = null;
    const fakeResLogout = {
      setHeader(k, v) { if (k === 'Clear-Site-Data') clearedHeader = v; },
      json() {}
    };

    const logoutRoute = staffRoutes.stack.find(s => s.route && s.route.path === '/logout');
    assert(logoutRoute);
    logoutRoute.route.stack[0].handle({}, fakeResLogout);

    assert(clearedHeader.includes('"cache"'));
    assert(clearedHeader.includes('"storage"'));
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9G TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
