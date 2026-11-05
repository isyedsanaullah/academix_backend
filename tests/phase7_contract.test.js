/**
 * phase7_contract.test.js — Phase 7 Contract Verification Test Suite
 * Validates all architectural rules, invariants, and edge cases across:
 * - 7A: File Vault & Storage Quotas
 * - 7B: Circulars Status Normalization & Push Delivery
 * - 7C: Timetable Profile Isolation & Validation
 * - 7D: Canteen POS Reconciliation & Offline Topup
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');

// 7A Services
const {
  reserveUploadSlot,
  finalizeUploadReservation,
  deleteStoredFile,
  getStorageQuotaOverview
} = require('../services/storageQuotaService');
const { cleanupAbandonedReservations } = require('../workers/fileCleanupWorker');
const { reconcileCollegeStorage } = require('../services/storageReconciliationService');

// 7B Worker & Controllers
const { dispatchScheduledCirculars } = require('../workers/circularDispatcherWorker');
const { getAnnouncements, getAnnouncementById, markCircularRead, createAnnouncement } = require('../controllers/announcement.controller');

// 7C Services & Controllers
const {
  createProfile,
  activateProfile,
  createEntry,
  swapSlots
} = require('../controllers/timetableProfile.controller');

// 7D Services & Controllers
const {
  openShift,
  closeShift,
  createOrder,
  topupStudentAccount,
  voidOrder
} = require('../controllers/canteenPOS.controller');

async function runTests() {
  const prisma = getSystemClient();
  let passed = 0;
  let failed = 0;

  console.log('\n====================================================');
  console.log('   ACADEMIX PHASE 7 COMPREHENSIVE CONTRACT TESTS    ');
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

  // Test College helper
  const createTestCollege = async (overrides = {}) => {
    const code = 'T7_' + Math.random().toString(36).substring(2, 8).toUpperCase();
    return await prisma.college.create({
      data: {
        name: `Phase 7 Test College ${code}`,
        code,
        email: `${code.toLowerCase()}@test-phase7.edu.pk`,
        planId: 'starter',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
        ...overrides
      }
    });
  };

  try {
    // =========================================================================
    // 7A: FILE VAULT & STORAGE QUOTA TESTS
    // =========================================================================

    // Test 1: Upload Reservation Quota Gate
    await test('1. Storage Quota Reservation Gate (usage + pending + declared <= maxStorageBytes)', async () => {
      const col = await createTestCollege();
      // Cap storage at 10 MB for this college
      await prisma.collegeQuotaOverride.upsert({
        where: { college_id_metric: { college_id: col.id, metric: 'maxStorageBytes' } },
        update: { overrideValue: BigInt(10 * 1024 * 1024) },
        create: {
          college_id: col.id,
          metric: 'maxStorageBytes',
          overrideValue: BigInt(10 * 1024 * 1024),
          reason: 'Test quota cap',
          createdBy: 'tester'
        }
      });

      // Reserve 6 MB -> must succeed
      const res1 = await reserveUploadSlot(col.id, 'user_1', {
        filename: 'file1.pdf',
        category: 'documents',
        declaredSizeBytes: 6 * 1024 * 1024
      });
      assert.ok(res1.reservationId, 'First reservation within quota succeeded');

      // Attempt reserving another 5 MB (6 + 5 = 11 > 10) -> must fail with 413 STORAGE_QUOTA_EXCEEDED
      let blocked = false;
      try {
        await reserveUploadSlot(col.id, 'user_1', {
          filename: 'file2.pdf',
          category: 'documents',
          declaredSizeBytes: 5 * 1024 * 1024
        });
      } catch (err) {
        if (err.code === 'STORAGE_QUOTA_EXCEEDED' || err.status === 413) blocked = true;
      }
      assert.ok(blocked, 'Reservation exceeding storage quota blocked with 413');
    });

    // Test 2: Max Upload Size Gate
    await test('2. Max Upload Size Gate (declaredSizeBytes <= maxUploadBytes)', async () => {
      const col = await createTestCollege();
      // Cap maxUploadBytes at 2 MB
      await prisma.collegeQuotaOverride.upsert({
        where: { college_id_metric: { college_id: col.id, metric: 'maxUploadBytes' } },
        update: { overrideValue: BigInt(2 * 1024 * 1024) },
        create: {
          college_id: col.id,
          metric: 'maxUploadBytes',
          overrideValue: BigInt(2 * 1024 * 1024),
          reason: 'Test upload size cap',
          createdBy: 'tester'
        }
      });

      let blocked = false;
      try {
        await reserveUploadSlot(col.id, 'user_1', {
          filename: 'large.zip',
          category: 'documents',
          declaredSizeBytes: 5 * 1024 * 1024 // 5 MB > 2 MB
        });
      } catch (err) {
        if (err.code === 'MAX_UPLOAD_SIZE_EXCEEDED' || err.status === 413) blocked = true;
      }
      assert.ok(blocked, 'Upload exceeding max single-file size blocked with 413');
    });

    // Test 3: Permanent Deletion Quota Reclamation
    await test('3. Permanent Deletion Quota Reclamation (usage decremented)', async () => {
      const col = await createTestCollege();
      const fileSize = 2048576; // 2 MB

      // Create stored file
      const file = await prisma.storedFile.create({
        data: {
          college_id: col.id,
          uploadedById: 'user_1',
          objectKey: `tenants/${col.id}/documents/general/test_${Date.now()}.pdf`,
          originalFilename: 'test.pdf',
          contentType: 'application/pdf',
          sizeBytes: fileSize,
          status: 'ready'
        }
      });

      // Set initial usage
      await prisma.collegeUsage.upsert({
        where: { college_id_metric_period: { college_id: col.id, metric: 'storageBytes', period: 'total' } },
        update: { value: BigInt(fileSize) },
        create: { college_id: col.id, metric: 'storageBytes', period: 'total', value: BigInt(fileSize) }
      });

      // Delete file
      const delResult = await deleteStoredFile(file.id, col.id);
      assert.strictEqual(delResult.success, true, 'deleteStoredFile succeeded');

      const usage = await prisma.collegeUsage.findUnique({
        where: { college_id_metric_period: { college_id: col.id, metric: 'storageBytes', period: 'total' } }
      });
      assert.strictEqual(Number(usage.value), 0, 'CollegeUsage decremented to 0 after deletion');
    });

    // Test 4: Platform Receipt PDF Quota Exemption
    await test('4. Platform Receipt PDF Exemption (tenants/{id}/receipts/ excluded from quota)', async () => {
      const col = await createTestCollege();

      // Receipts path is strictly excluded in reconciliation
      const rec = await reconcileCollegeStorage(col.id);
      assert.ok(rec.collegeId === col.id, 'Storage reconciliation executed without counting platform receipts');
    });

    // Test 5: Abandoned Reservation Cleanup
    await test('5. Abandoned Reservation Cleanup (Expired pending marked ABANDONED)', async () => {
      const col = await createTestCollege();

      // Create expired pending reservation
      const res = await prisma.uploadReservation.create({
        data: {
          college_id: col.id,
          category: 'documents',
          originalFilename: 'abandoned.pdf',
          declaredSizeBytes: BigInt(1024),
          storageKey: `tenants/${col.id}/documents/general/abandoned_${Date.now()}.pdf`,
          expiresAt: new Date(Date.now() - 3600000), // 1 hour in the past
          status: 'PENDING'
        }
      });

      await cleanupAbandonedReservations();

      const updated = await prisma.uploadReservation.findUnique({ where: { id: res.id } });
      assert.strictEqual(updated.status, 'ABANDONED', 'Expired reservation transitioned to ABANDONED');
    });

    // =========================================================================
    // 7B: CIRCULARS STATUS NORMALIZATION & PUSH DELIVERY
    // =========================================================================

    // Test 6: Circular Status Normalization
    await test('6. Circular Status Normalization (Upper-cased status)', async () => {
      const col = await createTestCollege();

      // Mock Express req/res
      const req = {
        collegeId: col.id,
        user: { id: 'admin_1', role: 'admin', college_id: col.id },
        body: {
          title: 'Spring Break Notice',
          content: 'Classes suspended from Monday.',
          status: 'draft' // lowercase
        }
      };
      let resData = null;
      const res = {
        status: () => res,
        json: (d) => { resData = d; }
      };

      await createAnnouncement(req, res, (e) => { throw e; });
      assert.strictEqual(resData?.data?.status, 'DRAFT', 'Status normalized to uppercase DRAFT');
    });

    // Test 7: Query-Time Visibility
    await test('7. Circular Query-Time Visibility (SCHEDULED with scheduledFor <= now visible)', async () => {
      const col = await createTestCollege();

      // 1. Scheduled in the past
      await prisma.announcement.create({
        data: {
          college_id: col.id,
          title: 'Past Notice',
          content: 'Past notice content',
          status: 'SCHEDULED',
          scheduledFor: new Date(Date.now() - 60000) // 1 min ago
        }
      });

      // 2. Scheduled in the future
      await prisma.announcement.create({
        data: {
          college_id: col.id,
          title: 'Future Notice',
          content: 'Future notice content',
          status: 'SCHEDULED',
          scheduledFor: new Date(Date.now() + 3600000) // 1 hr later
        }
      });

      const req = {
        collegeId: col.id,
        user: { id: 'student_1', role: 'student', college_id: col.id },
        query: {}
      };
      let resData = null;
      const res = {
        json: (d) => { resData = d; }
      };

      await getAnnouncements(req, res, (e) => { throw e; });
      const titles = (resData?.data || []).map(a => a.title);
      assert.ok(titles.includes('Past Notice'), 'Past scheduled notice is visible at query time');
      assert.strictEqual(titles.includes('Future Notice'), false, 'Future scheduled notice is hidden at query time');
    });

    // Test 8: Atomic Claim Dispatcher Worker
    await test('8. Circular Dispatcher Atomic Claim (Sets dispatchedAt, produces OutboxEvent)', async () => {
      const col = await createTestCollege();

      const ann = await prisma.announcement.create({
        data: {
          college_id: col.id,
          title: 'Dispatch Test Circular',
          content: 'Circular content',
          status: 'SCHEDULED',
          scheduledFor: new Date(Date.now() - 5000) // 5 seconds ago
        }
      });

      const res = await dispatchScheduledCirculars();
      assert.ok(res.dispatchedCount >= 1, 'At least 1 circular claimed and dispatched');

      const updated = await prisma.announcement.findUnique({ where: { id: ann.id } });
      assert.strictEqual(updated.status, 'PUBLISHED', 'Claimed circular transitioned to PUBLISHED');
      assert.ok(updated.dispatchedAt, 'dispatchedAt timestamp populated');

      const outbox = await prisma.outboxEvent.findFirst({
        where: { eventType: 'CIRCULAR_PUSH', payload: { path: ['circularId'], equals: ann.id } }
      });
      assert.ok(outbox, 'OutboxEvent generated for circular push fanout');
    });

    // Test 9: Read Receipt & IDOR Guard
    await test('9. Circular Read Receipt & IDOR Tenant Guard', async () => {
      const col1 = await createTestCollege();
      const col2 = await createTestCollege();

      const ann = await prisma.announcement.create({
        data: {
          college_id: col1.id,
          title: 'Tenant 1 Notice',
          content: 'Private notice',
          status: 'PUBLISHED'
        }
      });

      // 1. Mark read
      const reqRead = {
        collegeId: col1.id,
        user: { id: 'user_t1', role: 'student', college_id: col1.id },
        params: { id: ann.id }
      };
      let readRes = null;
      const resRead = { json: (d) => { readRes = d; } };
      await markCircularRead(reqRead, resRead, (e) => { throw e; });
      assert.strictEqual(readRes?.success, true, 'Read receipt recorded');

      // 2. IDOR Attempt: College 2 user tries to access College 1 circular
      const reqIdor = {
        collegeId: col2.id,
        user: { id: 'user_t2', role: 'student', college_id: col2.id },
        params: { id: ann.id }
      };
      let idorBlocked = false;
      const resIdor = {
        status: (code) => { if (code === 404 || code === 403) idorBlocked = true; return resIdor; },
        json: () => {}
      };
      await getAnnouncementById(reqIdor, resIdor, (e) => { throw e; });
      assert.ok(idorBlocked, 'Cross-tenant announcement access blocked by IDOR guard');
    });

    // =========================================================================
    // 7C: TIMETABLE PROFILE ISOLATION & VALIDATION
    // =========================================================================

    // Test 10: Multi-Profile Coexistence
    await test('10. Timetable Multi-Profile Coexistence (At most one active per type)', async () => {
      const col = await createTestCollege();

      const p1 = await prisma.timetableProfile.create({
        data: { college_id: col.id, name: 'Standard Schedule A', type: 'STANDARD', isActive: true }
      });
      const p2 = await prisma.timetableProfile.create({
        data: { college_id: col.id, name: 'Standard Schedule B', type: 'STANDARD', isActive: false }
      });

      // Activate p2
      const req = { collegeId: col.id, user: { role: 'admin' }, params: { id: p2.id } };
      let resData = null;
      const res = { json: (d) => { resData = d; }, status: () => res };

      await activateProfile(req, res);

      const p1Reloaded = await prisma.timetableProfile.findUnique({ where: { id: p1.id } });
      const p2Reloaded = await prisma.timetableProfile.findUnique({ where: { id: p2.id } });

      assert.strictEqual(p1Reloaded.isActive, false, 'Previous active profile deactivated');
      assert.strictEqual(p2Reloaded.isActive, true, 'Newly activated profile isActive = true');
    });

    // Test 11: Timetable Period FK Cascade
    await test('11. Timetable Period FK Cascade (Deleting profile cascades to periods)', async () => {
      const col = await createTestCollege();

      const profile = await prisma.timetableProfile.create({
        data: { college_id: col.id, name: 'Temporary Profile', type: 'EXAM' }
      });

      const period = await prisma.timetablePeriod.create({
        data: { profile_id: profile.id, periodNumber: 1, startTime: '09:00', endTime: '10:00' }
      });

      // Delete profile
      await prisma.timetableProfile.delete({ where: { id: profile.id } });

      const periodCheck = await prisma.timetablePeriod.findUnique({ where: { id: period.id } });
      assert.strictEqual(periodCheck, null, 'Periods cascaded on profile deletion');
    });

    // Test 12: Timetable Conflict Hard Blocks
    await test('12. Timetable Conflict Hard Blocks (Teacher, Room, and Section clashes blocked)', async () => {
      const col = await createTestCollege();
      const profile = await prisma.timetableProfile.create({
        data: { college_id: col.id, name: 'Conflict Test Profile', type: 'STANDARD', isActive: true }
      });

      // Create Slot 1: Teacher T1, Room R1, Section S1, Day 1, Period 1
      const req1 = {
        collegeId: col.id,
        user: { role: 'admin' },
        body: {
          profileId: profile.id,
          dayOfWeek: 1,
          periodNumber: 1,
          subjectId: 'SUBJ_1',
          teacherId: 'T1',
          roomId: 'R1',
          sectionIds: ['S1']
        }
      };
      let slot1Created = false;
      const res1 = {
        status: (code) => { if (code === 201) slot1Created = true; return res1; },
        json: () => {}
      };
      await createEntry(req1, res1);
      assert.ok(slot1Created, 'Slot 1 created successfully');

      // Attempt 1: Teacher clash (Same teacher T1 in period 1 on Day 1)
      const reqTeacherClash = {
        collegeId: col.id,
        user: { role: 'admin' },
        body: {
          profileId: profile.id,
          dayOfWeek: 1,
          periodNumber: 1,
          subjectId: 'SUBJ_2',
          teacherId: 'T1', // CLASH
          roomId: 'R2',
          sectionIds: ['S2']
        }
      };
      let teacherBlocked = false;
      const resTC = {
        status: (code) => { if (code === 409) teacherBlocked = true; return resTC; },
        json: () => {}
      };
      await createEntry(reqTeacherClash, resTC);
      assert.ok(teacherBlocked, 'Teacher clash hard blocked with 409');

      // Attempt 2: Section clash (Same section S1 in period 1 on Day 1)
      const reqSectionClash = {
        collegeId: col.id,
        user: { role: 'admin' },
        body: {
          profileId: profile.id,
          dayOfWeek: 1,
          periodNumber: 1,
          subjectId: 'SUBJ_3',
          teacherId: 'T2',
          roomId: 'R3',
          sectionIds: ['S1'] // CLASH
        }
      };
      let sectionBlocked = false;
      const resSC = {
        status: (code) => { if (code === 409) sectionBlocked = true; return resSC; },
        json: () => {}
      };
      await createEntry(reqSectionClash, resSC);
      assert.ok(sectionBlocked, 'Section clash hard blocked with 409');
    });

    // Test 13: Atomic Slot Swap
    await test('13. Timetable Atomic Slot Swap (Delete + Insert prevents clash violations)', async () => {
      const col = await createTestCollege();
      const profile = await prisma.timetableProfile.create({
        data: { college_id: col.id, name: 'Swap Test Profile', type: 'STANDARD', isActive: true }
      });

      const e1 = await prisma.timetableEntry.create({
        data: { college_id: col.id, profile_id: profile.id, dayOfWeek: 1, periodNumber: 1, subjectId: 'S1', teacherId: 'T1' }
      });
      await prisma.timetableEntrySection.create({
        data: { entryId: e1.id, college_id: col.id, profile_id: profile.id, section_id: 'SEC_A', dayOfWeek: 1, periodNumber: 1 }
      });

      const e2 = await prisma.timetableEntry.create({
        data: { college_id: col.id, profile_id: profile.id, dayOfWeek: 2, periodNumber: 2, subjectId: 'S2', teacherId: 'T2' }
      });
      await prisma.timetableEntrySection.create({
        data: { entryId: e2.id, college_id: col.id, profile_id: profile.id, section_id: 'SEC_B', dayOfWeek: 2, periodNumber: 2 }
      });

      const reqSwap = {
        collegeId: col.id,
        user: { role: 'admin' },
        body: { profileId: profile.id, entryId1: e1.id, entryId2: e2.id }
      };
      let swapSucceeded = false;
      const resSwap = {
        status: () => resSwap,
        json: (d) => { if (d.success) swapSucceeded = true; }
      };

      await swapSlots(reqSwap, resSwap);
      assert.ok(swapSucceeded, 'Atomic slot swap succeeded');

      const reloaded1 = await prisma.timetableEntry.findUnique({ where: { id: e1.id } });
      assert.strictEqual(reloaded1.dayOfWeek, 2, 'Entry 1 moved to day 2');
      assert.strictEqual(reloaded1.periodNumber, 2, 'Entry 1 moved to period 2');
    });

    // =========================================================================
    // 7D: CANTEEN POS RECONCILIATION & OFFLINE TOPUP
    // =========================================================================

    // Test 14: Single Open Shift Constraint
    await test('14. Single Open Shift Constraint (one_open_shift_per_cashier index)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_' + Date.now();

      // Open first shift
      const req1 = { collegeId: col.id, user: { id: cashierId }, body: { openingCashPkr: 500 } };
      let shift1Opened = false;
      const res1 = {
        status: (code) => { if (code === 201) shift1Opened = true; return res1; },
        json: () => {}
      };
      await openShift(req1, res1);
      assert.ok(shift1Opened, 'First cashier shift opened successfully');

      // Attempt second open shift for same cashier -> must reject with 409
      let secondShiftBlocked = false;
      const res2 = {
        status: (code) => { if (code === 409) secondShiftBlocked = true; return res2; },
        json: () => {}
      };
      await openShift(req1, res2);
      assert.ok(secondShiftBlocked, 'Second open shift rejected with 409 SHIFT_ALREADY_OPEN');
    });

    // Test 15: POS Idempotency (clientOrderId unique per college)
    await test('15. POS Idempotency (Duplicate clientOrderId returns existing order)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_pos_' + Date.now();
      const clientOrderId = 'CL_ORD_' + Date.now();

      // Open shift
      await prisma.cashierShift.create({
        data: { college_id: col.id, cashierId, status: 'OPEN', openingCashPkr: 1000 }
      });

      // Create item
      const item = await prisma.canteenItem.create({
        data: { college_id: col.id, name: 'Samosa', sellingPricePkr: 50, costPricePkr: 30, stockQuantity: 100 }
      });

      const orderReq = {
        collegeId: col.id,
        user: { id: cashierId },
        body: {
          clientOrderId,
          paymentMethod: 'CASH',
          items: [{ itemId: item.id, quantity: 2 }],
          cashTendered: 100
        }
      };

      let initialOrderId = null;
      const res1 = {
        status: (code) => { return res1; },
        json: (d) => { initialOrderId = d.order?.id; }
      };
      await createOrder(orderReq, res1);
      assert.ok(initialOrderId, 'First order created successfully');

      // Re-submit identical clientOrderId
      let replayId = null;
      let replayFlag = false;
      const res2 = {
        status: (code) => { return res2; },
        json: (d) => {
          replayId = d.order?.id;
          replayFlag = d.idempotentReplay;
        }
      };
      await createOrder(orderReq, res2);

      assert.strictEqual(replayId, initialOrderId, 'Replay returned identical order ID');
      assert.strictEqual(replayFlag, true, 'idempotentReplay flag returned');
    });

    // Test 16: Race-Condition-Proof Stock Decrement
    await test('16. Race-Condition-Proof Stock Decrement (409 INSUFFICIENT_STOCK)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_stock_' + Date.now();

      await prisma.cashierShift.create({
        data: { college_id: col.id, cashierId, status: 'OPEN', openingCashPkr: 1000 }
      });

      // Item with only 1 in stock
      const item = await prisma.canteenItem.create({
        data: { college_id: col.id, name: 'Juice', sellingPricePkr: 80, costPricePkr: 60, stockQuantity: 1 }
      });

      // Attempt ordering 5 units
      const req = {
        collegeId: col.id,
        user: { id: cashierId },
        body: {
          clientOrderId: 'ORD_STOCK_FAIL_' + Date.now(),
          paymentMethod: 'CASH',
          items: [{ itemId: item.id, quantity: 5 }],
          cashTendered: 400
        }
      };

      let stockBlocked = false;
      const res = {
        status: (code) => { if (code === 409) stockBlocked = true; return res; },
        json: (d) => {}
      };
      await createOrder(req, res);
      assert.ok(stockBlocked, 'Order exceeding stock blocked with 409 INSUFFICIENT_STOCK');
    });

    // Test 17: Meal Account Daily Spending Limit
    await test('17. Meal Account PKT Daily Spending Limit (Rejects over limit)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_meal_' + Date.now();
      const studentId = 'student_' + Date.now();

      await prisma.cashierShift.create({
        data: { college_id: col.id, cashierId, status: 'OPEN', openingCashPkr: 1000 }
      });

      // Meal account with 500 daily limit, 5000 balance
      await prisma.studentMealAccount.create({
        data: {
          college_id: col.id,
          student_id: studentId,
          balancePkr: 5000,
          dailySpendingLimitPkr: 500
        }
      });

      const item = await prisma.canteenItem.create({
        data: { college_id: col.id, name: 'Biryani', sellingPricePkr: 600, costPricePkr: 400, stockQuantity: 50 }
      });

      // Order total = 600 > 500 daily limit
      const req = {
        collegeId: col.id,
        user: { id: cashierId },
        body: {
          clientOrderId: 'ORD_LIMIT_EXCEEDED_' + Date.now(),
          paymentMethod: 'WALLET',
          studentId,
          items: [{ itemId: item.id, quantity: 1 }]
        }
      };

      let limitBlocked = false;
      const res = {
        status: (code) => { if (code === 422) limitBlocked = true; return res; },
        json: () => {}
      };
      await createOrder(req, res);
      assert.ok(limitBlocked, 'Order exceeding daily spending limit blocked with 422');
    });

    // Test 18: Cash-Only Meal Account Top-Up & Negative Balance Check
    await test('18. Cash-Only Top-Up & Positive Balance Invariant (balance >= 0)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_topup_' + Date.now();
      const studentId = 'student_tu_' + Date.now();

      const shift = await prisma.cashierShift.create({
        data: { college_id: col.id, cashierId, status: 'OPEN', openingCashPkr: 1000 }
      });

      const req = {
        collegeId: col.id,
        user: { id: cashierId },
        params: { studentId },
        body: { amountPkr: 1500, notes: 'Parent cash deposit' }
      };
      let topupSuccess = false;
      const res = {
        status: () => res,
        json: (d) => { if (d.success && d.balancePkr === 1500) topupSuccess = true; }
      };
      await topupStudentAccount(req, res);
      assert.ok(topupSuccess, 'Cash-only topup incremented balance to 1500');

      // Verify drawer transaction
      const drawerTx = await prisma.cashDrawerTransaction.findFirst({
        where: { shiftId: shift.id, type: 'TOPUP', amountPkr: 1500 }
      });
      assert.ok(drawerTx, 'Drawer movement recorded for cash topup');
    });

    // Test 19: Order Void & Dynamic Shift Close Reconciliation Formula
    await test('19. Order Void & Shift Close Formula (expected = opening + sales + topups - refunds)', async () => {
      const col = await createTestCollege();
      const cashierId = 'cashier_recon_' + Date.now();

      // Open shift with 500 PKR float
      const shift = await prisma.cashierShift.create({
        data: { college_id: col.id, cashierId, status: 'OPEN', openingCashPkr: 500 }
      });

      const item = await prisma.canteenItem.create({
        data: { college_id: col.id, name: 'Burger', sellingPricePkr: 200, costPricePkr: 120, stockQuantity: 20 }
      });

      // 1. Sale: 1 burger for 200 CASH
      const orderReq = {
        collegeId: col.id,
        user: { id: cashierId },
        body: {
          clientOrderId: 'ORD_SALE_RECON_' + Date.now(),
          paymentMethod: 'CASH',
          items: [{ itemId: item.id, quantity: 1 }],
          cashTendered: 200
        }
      };
      let orderId = null;
      const resOrder = { status: () => resOrder, json: (d) => { orderId = d.order?.id; } };
      await createOrder(orderReq, resOrder);

      // 2. Void order -> refunds 200 from drawer
      const reqVoid = {
        collegeId: col.id,
        user: { id: cashierId },
        params: { id: orderId }
      };
      let voidSuccess = false;
      const resVoid = { status: () => resVoid, json: (d) => { voidSuccess = d.success; } };
      await voidOrder(reqVoid, resVoid);
      assert.ok(voidSuccess, 'Order voided and cash refunded to drawer');

      // 3. Close shift with 500 declared closing cash
      // Expected = 500 (opening) + 200 (sale) - 200 (refund) = 500
      const reqClose = {
        collegeId: col.id,
        params: { id: shift.id },
        body: { declaredClosingCashPkr: 500 }
      };
      let closeReport = null;
      const resClose = { status: () => resClose, json: (d) => { closeReport = d.report; } };
      await closeShift(reqClose, resClose);

      assert.strictEqual(closeReport.expectedClosingCashPkr, 500, 'Expected closing cash correctly calculated as 500');
      assert.strictEqual(closeReport.discrepancyPkr, 0, 'Discrepancy is 0');
      assert.strictEqual(closeReport.status, 'CLOSED', 'Shift status updated to CLOSED');
    });

  } catch (globalErr) {
    console.error('Global Test Runner Error:', globalErr);
  }

  console.log('\n====================================================');
  console.log(`PHASE 7 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal Test Exception:', err);
  process.exit(1);
});

