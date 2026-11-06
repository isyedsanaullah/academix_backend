'use strict';

/**
 * phase12_contract.test.js
 * Master Contract Test Suite for Phase 12: Campus Operations & Auxiliary Modules
 * 
 * Verifies all 7 Phase 12 services:
 * 12A: N35 Library Management Module (Premium / Add-on on Standard)
 * 12B: N36 Transport Management Module (Enterprise / Add-on on Standard & Premium)
 * 12C: N37 Hostel Management Module (Enterprise / Add-on on Standard & Premium)
 * 12D: N38 Inventory & Fixed Asset Register (Premium)
 * 12E: N39 Purchase Requests & Vendor Accounts Payable (Premium)
 * 12F: N40 Double-Entry Accounting & General Ledger (Enterprise)
 * 12G: N41 Departmental Budgets & Cost Centres (Enterprise)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');

const { getSystemClient } = require('../config/prismaManager');
const {
  FEATURE_REGISTRY,
  validateRegistryDAG,
  resolveCollegeFeatures,
} = require('../config/featureRegistry');

// Service imports
const libraryService = require('../services/libraryService');
const transportService = require('../services/transportService');
const hostelService = require('../services/hostelService');
const assetService = require('../services/assetService');
const purchaseOrderService = require('../services/purchaseOrderService');
const accountingService = require('../services/accountingService');
const budgetService = require('../services/budgetService');
const { createOrUpdateChain, approveStep } = require('../services/approvalService');

const prisma = getSystemClient();

async function runPhase12ContractTests() {
  console.log('====================================================');
  console.log('    PHASE 12 MASTER CONTRACT VERIFICATION SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  // Setup test tenant fixture
  const collegeId = `col_phase12_${Date.now()}`;
  let college = null;
  let session = null;
  let adminUser = null;
  let teacherUser = null;
  let student1 = null;
  let student2 = null;

  try {
    // 0. Setup test fixtures
    college = await prisma.college.create({
      data: {
        id: collegeId,
        name: 'Phase 12 Operations Model College',
        email: `p12_${collegeId}@test.com`,
        code: `P12-${Date.now().toString().slice(-4)}`,
        planId: 'enterprise',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });

    session = await prisma.session.create({
      data: {
        college_id: collegeId,
        name: '2026-2027',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
        isCurrent: true,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        college_id: collegeId,
        email: `admin-${collegeId}@test.com`,
        password: 'hash',
        name: 'Operations Director',
        role: 'admin',
      },
    });

    teacherUser = await prisma.user.create({
      data: {
        college_id: collegeId,
        email: `teacher-${collegeId}@test.com`,
        password: 'hash',
        name: 'Faculty Member',
        role: 'teacher',
      },
    });

    student1 = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Ahmed Khan',
        fatherName: 'Tariq Khan',
        gender: 'Male',
        class: 'FSc Part 1',
        section: 'A',
        group: 'Pre-Engineering',
        rollNumber: `P12-STU1-${Date.now()}`,
        status: 'active',
      },
    });

    student2 = await prisma.student.create({
      data: {
        college_id: collegeId,
        session_id: session.id,
        name: 'Fatima Noor',
        fatherName: 'Noor Muhammad',
        gender: 'Female',
        class: 'FSc Part 1',
        section: 'B',
        group: 'Pre-Medical',
        rollNumber: `P12-STU2-${Date.now()}`,
        status: 'active',
      },
    });

    // -------------------------------------------------------------
    // Test 1: Feature Registry Milestone Counts & DAG Validation
    // -------------------------------------------------------------
    try {
      assert.strictEqual(FEATURE_REGISTRY.length, 161, 'Registry total must be 161 services');

      const liveCount = FEATURE_REGISTRY.filter((f) => f.status === 'live').length;
      const comingSoonCount = FEATURE_REGISTRY.filter((f) => f.status === 'coming_soon').length;

      assert.ok(liveCount >= 136, `Live count must be at least 136 (got ${liveCount})`);
      assert.ok(comingSoonCount <= 25, `Coming soon count must be at most 25 (got ${comingSoonCount})`);

      const dagResult = validateRegistryDAG();
      assert.strictEqual(dagResult.valid, true, 'DAG must have zero circular dependencies');

      const phase12Keys = [
        'library-management',               // N35
        'transport-management',             // N36
        'hostel-management',                // N37
        'inventory-asset-register',         // N38
        'purchase-requests-vendor-ledger',  // N39
        'double-entry-accounting',          // N40
        'department-budgets-cost-centers',  // N41
      ];

      for (const k of phase12Keys) {
        const feat = FEATURE_REGISTRY.find((f) => f.key === k);
        assert.ok(feat, `Feature key ${k} must exist in registry`);
        assert.strictEqual(feat.status, 'live', `Feature ${k} must have status: 'live'`);
      }

      // Assert N12 and N14 remain coming_soon, N13 permanently removed
      const n12 = FEATURE_REGISTRY.find((f) => f.key === 'custom-domain');
      const n14 = FEATURE_REGISTRY.find((f) => f.key === 'single-sign-on');
      const n13 = FEATURE_REGISTRY.find((f) => f.key === 'white-label-branding' || f.id === 'N13');
      assert.strictEqual(n12.status, 'coming_soon', 'N12 must remain coming_soon');
      assert.strictEqual(n14.status, 'coming_soon', 'N14 must remain coming_soon');
      assert.strictEqual(n13, undefined, 'N13 must remain permanently removed');

      console.log('✓ Test 1 Passed: Feature registry milestone: 136 Live + 25 Roadmap = 161 Total, DAG valid');
      passed++;
    } catch (err) {
      console.error('✗ Test 1 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 2: N35 Library Circulation & Overdue Fine Calculation
    // -------------------------------------------------------------
    try {
      const title = await libraryService.createTitle({
        collegeId,
        title: 'Halliday & Resnick Fundamentals of Physics',
        author: 'David Halliday',
        edition: '10th',
        category: 'SCIENCES',
        totalCopies: 2,
      });

      const copy1 = await libraryService.addCopy({
        collegeId,
        titleId: title.id,
        accessionNumber: `ACC-${Date.now()}-1`,
        barcode: `BC-${Date.now()}-1`,
      });

      const copy2 = await libraryService.addCopy({
        collegeId,
        titleId: title.id,
        accessionNumber: `ACC-${Date.now()}-2`,
        barcode: `BC-${Date.now()}-2`,
      });

      // Verify availability
      const availBefore = await libraryService.getTitleWithAvailability({ collegeId, titleId: title.id });
      assert.strictEqual(availBefore.availableCopies, 2);

      // Set max active loans per student to 1
      await prisma.college.update({
        where: { id: collegeId },
        data: { settings: { maxBooksPerStudent: 1, libraryFinePerDay: 15 } },
      });

      // Issue 1st copy to student1
      const issue1 = await libraryService.issueBook({
        collegeId,
        copyId: copy1.id,
        studentId: student1.id,
        daysToReturn: 7,
        issuedById: adminUser.id,
      });
      assert.ok(issue1.id);

      // Attempt 2nd copy to same student -> must throw MAX_LOANS_EXCEEDED
      let limitErr = null;
      try {
        await libraryService.issueBook({
          collegeId,
          copyId: copy2.id,
          studentId: student1.id,
          daysToReturn: 7,
          issuedById: adminUser.id,
        });
      } catch (err) {
        limitErr = err;
      }
      assert.ok(limitErr, 'Issuing beyond student loan limit must throw error');
      assert.strictEqual(limitErr.code, 'MAX_LOANS_EXCEEDED');

      // Return copy 1 with overdue returnDate (+10 days beyond due date)
      const overdueReturnDate = new Date(issue1.dueDate);
      overdueReturnDate.setDate(overdueReturnDate.getDate() + 3); // 3 days late

      const returned = await libraryService.returnBook({
        collegeId,
        issueRecordId: issue1.id,
        returnDate: overdueReturnDate,
      });

      // Overdue fine = 3 days * PKR 15 = PKR 45
      assert.strictEqual(returned.fineAmountPkr, 45);
      assert.strictEqual(returned.fineStatus, 'PENDING');

      // Verify copy availability restored
      const availAfter = await libraryService.getTitleWithAvailability({ collegeId, titleId: title.id });
      assert.strictEqual(availAfter.availableCopies, 2);

      console.log('✓ Test 2 Passed: N35 Library book loan enforces maxBooksPerStudent cap and calculates overdue fines');
      passed++;
    } catch (err) {
      console.error('✗ Test 2 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 3: N36 Transport Fleet & Auto Monthly Fee Generation
    // -------------------------------------------------------------
    try {
      const route = await transportService.createRoute({
        collegeId,
        routeNumber: `Express Route ${Date.now()}`,
        monthlyFarePkr: 2500,
      });

      const stop = await transportService.addStop({
        routeId: route.id,
        stopName: 'Kalma Chowk',
        pickupTime: '07:15',
        dropTime: '14:15',
        stopOrder: 1,
      });

      await transportService.addVehicle({
        collegeId,
        routeId: route.id,
        registrationNo: `LEA-${Date.now().toString().slice(-4)}`,
        seatCapacity: 30,
        driverName: 'Muhammad Aslam',
        driverPhone: '03001234567',
      });

      // Allocate student1 to route
      const alloc = await transportService.allocateStudent({
        collegeId,
        studentId: student1.id,
        sessionId: session.id,
        routeId: route.id,
        stopId: stop.id,
      });
      assert.strictEqual(alloc.isActive, true);

      // Generate transport monthly fees
      const feeRes = await transportService.applyTransportFeesToVoucher({
        collegeId,
        sessionId: session.id,
        month: 'November 2026',
        studentId: student1.id,
      });

      assert.strictEqual(feeRes.appliedCount, 1);
      assert.strictEqual(feeRes.totalPkr, 2500);

      // Verify Fee table contains transport fee
      const createdFee = await prisma.fee.findFirst({
        where: {
          college_id: collegeId,
          student_id: student1.id,
          month: 'November 2026',
        },
      });
      assert.ok(createdFee);
      assert.strictEqual(Number(createdFee.totalAmount), 2500);

      console.log('✓ Test 3 Passed: N36 Student monthly fee generation automatically includes active transport fare');
      passed++;
    } catch (err) {
      console.error('✗ Test 3 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 4: N37 Hostel Bed Allotment & Capacity Constraints
    // -------------------------------------------------------------
    try {
      const building = await hostelService.createBuilding({
        collegeId,
        name: `Allama Iqbal Hostel ${Date.now()}`,
        gender: 'MALE',
        wardenId: adminUser.id,
        totalRooms: 10,
      });

      const room = await hostelService.addRoom({
        buildingId: building.id,
        roomNumber: '101',
        capacity: 2, // 2 beds only
        monthlyRentPkr: 8000,
      });

      // Allot Bed 1 to student1 -> succeeds
      const alloc1 = await hostelService.allotBed({
        collegeId,
        studentId: student1.id,
        sessionId: session.id,
        roomId: room.id,
        bedNumber: 1,
      });
      assert.strictEqual(alloc1.bedNumber, 1);

      // Attempt to allot Bed 1 to student2 -> must fail with BED_ALREADY_OCCUPIED
      let bedOccupiedErr = null;
      try {
        await hostelService.allotBed({
          collegeId,
          studentId: student2.id,
          sessionId: session.id,
          roomId: room.id,
          bedNumber: 1,
        });
      } catch (err) {
        bedOccupiedErr = err;
      }
      assert.ok(bedOccupiedErr, 'Allotting occupied bed must fail');
      assert.strictEqual(bedOccupiedErr.code, 'BED_ALREADY_OCCUPIED');

      // Attempt to allot Bed 3 (capacity is 2) -> must fail with INVALID_BED_NUMBER
      let invalidBedErr = null;
      try {
        await hostelService.allotBed({
          collegeId,
          studentId: student2.id,
          sessionId: session.id,
          roomId: room.id,
          bedNumber: 3,
        });
      } catch (err) {
        invalidBedErr = err;
      }
      assert.ok(invalidBedErr, 'Allotting bed exceeding room capacity must fail');
      assert.strictEqual(invalidBedErr.code, 'INVALID_BED_NUMBER');

      // Allot Bed 2 to student2 -> succeeds
      const alloc2 = await hostelService.allotBed({
        collegeId,
        studentId: student2.id,
        sessionId: session.id,
        roomId: room.id,
        bedNumber: 2,
      });
      assert.strictEqual(alloc2.bedNumber, 2);

      console.log('✓ Test 4 Passed: N37 Hostel bed allotment enforces physical bed capacity unique constraints');
      passed++;
    } catch (err) {
      console.error('✗ Test 4 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 5: N37 Hostel Curfew Breach Outbox Notification
    // -------------------------------------------------------------
    try {
      const building = await prisma.hostelBuilding.findFirst({
        where: { college_id: collegeId },
      });

      // 1. Mark student1 PRESENT -> No outbox alert
      await hostelService.markNightAttendance({
        collegeId,
        buildingId: building.id,
        studentId: student1.id,
        date: '2026-11-20',
        status: 'PRESENT',
        markedById: adminUser.id,
      });

      const outboxPresent = await prisma.outboxEvent.findFirst({
        where: {
          college_id: collegeId,
          eventType: 'HOSTEL_CURFEW_BREACH',
          payload: { path: ['studentId'], equals: student1.id },
        },
      });
      assert.strictEqual(outboxPresent, null, 'PRESENT status must not trigger curfew breach');

      // 2. Mark student2 ABSENT -> MUST trigger HOSTEL_CURFEW_BREACH outbox event
      await hostelService.markNightAttendance({
        collegeId,
        buildingId: building.id,
        studentId: student2.id,
        date: '2026-11-20',
        status: 'ABSENT',
        markedById: adminUser.id,
        remarks: 'Unaccounted absence at 21:00 curfew lock',
      });

      const outboxAbsent = await prisma.outboxEvent.findFirst({
        where: {
          college_id: collegeId,
          eventType: 'HOSTEL_CURFEW_BREACH',
          payload: { path: ['studentId'], equals: student2.id },
        },
      });

      assert.ok(outboxAbsent, 'ABSENT curfew status must trigger OutboxEvent');
      assert.strictEqual(outboxAbsent.payload.status, 'ABSENT');

      console.log('✓ Test 5 Passed: N37 Curfew absence triggers parent notification outbox event');
      passed++;
    } catch (err) {
      console.error('✗ Test 5 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 6: N38 Fixed Asset Register & Straight-Line Depreciation
    // -------------------------------------------------------------
    try {
      const purchaseDate = new Date();
      purchaseDate.setFullYear(purchaseDate.getFullYear() - 2); // 2 years ago

      const asset = await assetService.registerAsset({
        collegeId,
        assetCode: `AST-GEN-${Date.now()}`,
        name: 'Cummins 100kVA Diesel Generator',
        category: 'ELECTRICAL',
        location: 'Main Powerhouse Ground Floor',
        purchaseDate,
        purchaseCostPkr: 100000,
        salvageValuePkr: 10000,
        usefulLifeYears: 5, // (100k - 10k) / 5 = 18k / yr = 18%
      });

      assert.strictEqual(asset.depreciationRate, 18);

      // Net book value after 2 years: 100,000 - (2 * 18,000) = 64,000
      const calculation = assetService.calculateNetBookValue(asset, new Date());
      assert.strictEqual(calculation.netBookValuePkr, 64000);
      assert.strictEqual(calculation.accumulatedDepreciationPkr, 36000);

      // Log maintenance
      const maint = await assetService.logMaintenance({
        collegeId,
        assetId: asset.id,
        serviceDate: new Date(),
        costPkr: 4500,
        description: 'Oil filter replacement and engine coolant flush',
        servicedBy: 'Cummins Certified Support PK',
      });
      assert.ok(maint.id);

      console.log('✓ Test 6 Passed: N38 Fixed asset straight-line depreciation calculated accurately based on useful life');
      passed++;
    } catch (err) {
      console.error('✗ Test 6 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 7: N39 Purchase Orders & N11 Approval Workflow Integration
    // -------------------------------------------------------------
    try {
      const vendor = await purchaseOrderService.createVendor({
        collegeId,
        name: `Crown Scientific Supplies ${Date.now()}`,
        phone: '042-35889900',
        contactPerson: 'Zubair Sheikh',
      });

      // Set threshold to 25,000 PKR
      await prisma.college.update({
        where: { id: collegeId },
        data: { settings: { poApprovalThresholdPkr: 25000 } },
      });

      // Setup N11 approval chain for PURCHASE_ORDER
      await createOrUpdateChain({
        collegeId,
        workflowType: 'PURCHASE_ORDER',
        name: 'Procurement PO Approval Chain',
        steps: [
          { stepNumber: 1, approverType: 'ROLE', approverRef: 'admin', stepName: 'Principal Sanction' },
        ],
      });

      // Create PO of PKR 60,000 (> 25k threshold)
      const poRes = await purchaseOrderService.createPurchaseOrder({
        collegeId,
        vendorId: vendor.id,
        poNumber: `PO-2026-${Date.now().toString().slice(-4)}`,
        createdById: teacherUser.id,
        creatorUser: teacherUser,
        items: [
          { description: 'Compound Optical Microscopes', quantity: 2, unitPricePkr: 30000 },
        ],
      });

      assert.strictEqual(poRes.requiresApproval, true);
      assert.strictEqual(poRes.po.status, 'IN_REVIEW');
      assert.ok(poRes.approvalRequestId);

      // Approve step via admin user
      await approveStep({
        collegeId,
        requestId: poRes.approvalRequestId,
        actorUser: adminUser,
        note: 'Procurement approved within science lab grant.',
      });

      // Verify PO status is now APPROVED
      const approvedPo = await prisma.purchaseOrder.findUnique({
        where: { id: poRes.po.id },
      });
      assert.strictEqual(approvedPo.status, 'APPROVED');

      console.log('✓ Test 7 Passed: N39 Purchase orders exceeding threshold create N11 approval workflows');
      passed++;
    } catch (err) {
      console.error('✗ Test 7 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 8: N40 Double-Entry General Ledger & Immutability Trigger
    // -------------------------------------------------------------
    try {
      // 1. Unbalanced voucher test (Debit 5000, Credit 4000)
      let unbalErr = null;
      try {
        await accountingService.postJournalVoucher({
          collegeId,
          voucherNo: `JV-ERR-${Date.now()}`,
          createdById: adminUser.id,
          lines: [
            { accountCode: '1010', debitPkr: 5000, creditPkr: 0 },
            { accountCode: '4010', debitPkr: 0, creditPkr: 4000 },
          ],
        });
      } catch (err) {
        unbalErr = err;
      }
      assert.ok(unbalErr, 'Unbalanced voucher must throw UNBALANCED_JOURNAL_VOUCHER');
      assert.strictEqual(unbalErr.code, 'UNBALANCED_JOURNAL_VOUCHER');

      // 2. Ensure account codes exist
      await accountingService.seedChartOfAccounts(collegeId);

      // 3. Balanced voucher test (Debit 10,000, Credit 10,000)
      const validVoucher = await accountingService.postJournalVoucher({
        collegeId,
        voucherNo: `JV-BAL-${Date.now()}`,
        narration: 'Student cash fee deposit',
        createdById: adminUser.id,
        lines: [
          { accountCode: '1010', debitPkr: 10000, creditPkr: 0, narration: 'Cash in hand received' },
          { accountCode: '4010', debitPkr: 0, creditPkr: 10000, narration: 'Tuition revenue recognized' },
        ],
      });
      assert.ok(validVoucher.id);
      assert.strictEqual(validVoucher.lines.length, 2);

      // 4. Test Immutability Trigger on JournalLineItem (UPDATE or DELETE forbidden)
      let triggerErr = null;
      try {
        await prisma.journalLineItem.delete({
          where: { id: validVoucher.lines[0].id },
        });
      } catch (err) {
        triggerErr = err;
      }
      assert.ok(triggerErr, 'Direct DELETE on JournalLineItem must be rejected by PostgreSQL trigger');
      assert.ok(triggerErr.message.includes('forbidden') || triggerErr.message.includes('append-only'));

      console.log('✓ Test 8 Passed: N40 Double-entry journal voucher strictly rejects unbalanced debits and credits & enforces trigger immutability');
      passed++;
    } catch (err) {
      console.error('✗ Test 8 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 9: N40 Chart of Accounts Seeding & Trial Balance
    // -------------------------------------------------------------
    try {
      // Create Phase 9 N04 mapping
      await prisma.accountHeadMapping.upsert({
        where: {
          college_id_sourceType_sourceKey: {
            college_id: collegeId,
            sourceType: 'PAYMENT_METHOD',
            sourceKey: 'RAAST_MEEZAN',
          },
        },
        create: {
          college_id: collegeId,
          sourceType: 'PAYMENT_METHOD',
          sourceKey: 'RAAST_MEEZAN',
          accountCode: '1025',
          accountName: 'Meezan Bank Raast Digital Account',
        },
        update: {},
      });

      // Seed Chart of Accounts
      const seedRes = await accountingService.seedChartOfAccounts(collegeId);
      assert.ok(seedRes.totalHeads >= 19);

      const seededMapped = await prisma.accountHead.findUnique({
        where: { college_id_code: { college_id: collegeId, code: '1025' } },
      });
      assert.ok(seededMapped, 'Mapped account 1025 must be initialized');
      assert.strictEqual(seededMapped.name, 'Meezan Bank Raast Digital Account');

      // Generate Trial Balance
      const trialBalance = await accountingService.getTrialBalance({ collegeId });
      assert.strictEqual(trialBalance.isBalanced, true, 'Trial balance debits must equal credits');

      console.log('✓ Test 9 Passed: N40 Chart of Accounts initialized from Phase 9 N04 account mappings & trial balance balances');
      passed++;
    } catch (err) {
      console.error('✗ Test 9 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 10: N41 Departmental Budgets & PO Overspend Blocking
    // -------------------------------------------------------------
    try {
      const budget = await budgetService.allocateBudget({
        collegeId,
        fiscalYear: '2026-2027',
        department: 'Physics Department',
        allocatedPkr: 50000,
      });

      assert.strictEqual(budget.allocatedPkr, 50000);

      // Commit 35,000 PKR
      const commit1 = await budgetService.checkAndCommitBudget({
        collegeId,
        budgetId: budget.id,
        amountPkr: 35000,
        referenceType: 'PURCHASE_ORDER',
        referenceId: 'PO-TEST-1',
      });
      assert.ok(commit1.id);

      // Attempt to commit 20,000 PKR (Remaining is 15,000) -> must throw DEPARTMENT_BUDGET_EXCEEDED
      let budgetExceededErr = null;
      try {
        await budgetService.checkAndCommitBudget({
          collegeId,
          budgetId: budget.id,
          amountPkr: 20000,
          referenceType: 'PURCHASE_ORDER',
          referenceId: 'PO-TEST-2',
        });
      } catch (err) {
        budgetExceededErr = err;
      }
      assert.ok(budgetExceededErr, 'Exceeding department budget must throw error');
      assert.strictEqual(budgetExceededErr.code, 'DEPARTMENT_BUDGET_EXCEEDED');

      // Settle commit1
      const settled = await budgetService.settleCommitment({ commitmentId: commit1.id });
      assert.strictEqual(settled.status, 'SETTLED');

      const summary = await budgetService.getDepartmentBudgetSummary({
        collegeId,
        fiscalYear: '2026-2027',
      });
      const deptBudget = summary.find((b) => b.department === 'Physics Department');
      assert.strictEqual(deptBudget.consumedPkr, 35000);
      assert.strictEqual(deptBudget.blockedPkr, 0);
      assert.strictEqual(deptBudget.remainingPkr, 15000);

      console.log('✓ Test 10 Passed: N41 Purchase order blocked when department budget cap would be exceeded');
      passed++;
    } catch (err) {
      console.error('✗ Test 10 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 11: N41 / N18 Multi-Campus Budget Isolation
    // -------------------------------------------------------------
    try {
      const campusA = await prisma.campus.create({
        data: {
          college_id: collegeId,
          name: 'Gulberg Branch Campus',
          code: `GLB-${Date.now().toString().slice(-4)}`,
        },
      });

      const campusB = await prisma.campus.create({
        data: {
          college_id: collegeId,
          name: 'Johar Town Branch Campus',
          code: `JT-${Date.now().toString().slice(-4)}`,
        },
      });

      const budgetA = await budgetService.allocateBudget({
        collegeId,
        campusId: campusA.id,
        fiscalYear: '2026-2027',
        department: 'Sports',
        allocatedPkr: 60000,
      });

      const budgetB = await budgetService.allocateBudget({
        collegeId,
        campusId: campusB.id,
        fiscalYear: '2026-2027',
        department: 'Sports',
        allocatedPkr: 90000,
      });

      // Commit full 60,000 on Campus A
      await budgetService.checkAndCommitBudget({
        collegeId,
        budgetId: budgetA.id,
        amountPkr: 60000,
        referenceType: 'PURCHASE_ORDER',
        referenceId: 'PO-CAMPUS-A',
      });

      // Verify Campus B remains untouched (full 90,000 available)
      const summaryB = await budgetService.getDepartmentBudgetSummary({
        collegeId,
        fiscalYear: '2026-2027',
        campusId: campusB.id,
      });
      assert.strictEqual(summaryB[0].remainingPkr, 90000);
      assert.strictEqual(summaryB[0].consumedPkr, 0);

      console.log('✓ Test 11 Passed: N41 / N18 Campus-specific budget allocation isolates spending between branch campuses');
      passed++;
    } catch (err) {
      console.error('✗ Test 11 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 12: Modular Add-on Gating (N35, N36, N37)
    // -------------------------------------------------------------
    try {
      // Test Standard tier without add-on
      const resolvedWithoutAddon = resolveCollegeFeatures('standard');
      assert.strictEqual(resolvedWithoutAddon.effectiveKeys.includes('library-management'), false);
      assert.strictEqual(resolvedWithoutAddon.effectiveKeys.includes('transport-management'), false);
      assert.strictEqual(resolvedWithoutAddon.effectiveKeys.includes('hostel-management'), false);

      // Test Standard tier with LIBRARY_MODULE add-on
      const resolvedWithAddon = resolveCollegeFeatures('standard', {}, ['LIBRARY_MODULE']);
      assert.strictEqual(resolvedWithAddon.effectiveKeys.includes('library-management'), true);
      assert.strictEqual(resolvedWithAddon.effectiveKeys.includes('transport-management'), false);

      // Test Standard tier with TRANSPORT_MODULE add-on
      const resolvedWithTransport = resolveCollegeFeatures('standard', {}, ['TRANSPORT_MODULE']);
      assert.strictEqual(resolvedWithTransport.effectiveKeys.includes('transport-management'), true);

      // Test Standard tier with HOSTEL_MODULE add-on
      const resolvedWithHostel = resolveCollegeFeatures('standard', {}, ['HOSTEL_MODULE']);
      assert.strictEqual(resolvedWithHostel.effectiveKeys.includes('hostel-management'), true);

      console.log('✓ Test 12 Passed: Modular add-on tier protection enforces plan and add-on gates');
      passed++;
    } catch (err) {
      console.error('✗ Test 12 Failed:', err.message);
      failed++;
    }

  } finally {
    // Teardown / Cleanup
    try {
      await prisma.budgetExpenseCommitment.deleteMany({ where: { budget: { college_id: collegeId } } });
      await prisma.departmentBudget.deleteMany({ where: { college_id: collegeId } });
      await prisma.journalLineItem.deleteMany({ where: { college_id: collegeId } });
      await prisma.journalVoucher.deleteMany({ where: { college_id: collegeId } });
      await prisma.accountHead.deleteMany({ where: { college_id: collegeId } });
      await prisma.accountHeadMapping.deleteMany({ where: { college_id: collegeId } });
      await prisma.purchaseOrderItem.deleteMany({ where: { po: { college_id: collegeId } } });
      await prisma.purchaseOrder.deleteMany({ where: { college_id: collegeId } });
      await prisma.vendor.deleteMany({ where: { college_id: collegeId } });
      await prisma.assetMaintenanceLog.deleteMany({ where: { college_id: collegeId } });
      await prisma.fixedAsset.deleteMany({ where: { college_id: collegeId } });
      await prisma.hostelNightAttendance.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentHostelAllotment.deleteMany({ where: { college_id: collegeId } });
      await prisma.hostelRoom.deleteMany({ where: { building: { college_id: collegeId } } });
      await prisma.hostelBuilding.deleteMany({ where: { college_id: collegeId } });
      await prisma.studentTransportAllocation.deleteMany({ where: { college_id: collegeId } });
      await prisma.transportVehicle.deleteMany({ where: { college_id: collegeId } });
      await prisma.transportStop.deleteMany({ where: { route: { college_id: collegeId } } });
      await prisma.transportRoute.deleteMany({ where: { college_id: collegeId } });
      await prisma.bookIssueRecord.deleteMany({ where: { college_id: collegeId } });
      await prisma.bookCopy.deleteMany({ where: { title: { college_id: collegeId } } });
      await prisma.bookTitle.deleteMany({ where: { college_id: collegeId } });
      await prisma.fee.deleteMany({ where: { college_id: collegeId } });
      await prisma.campus.deleteMany({ where: { college_id: collegeId } });
      await prisma.student.deleteMany({ where: { college_id: collegeId } });
      await prisma.user.deleteMany({ where: { college_id: collegeId } });
      await prisma.session.deleteMany({ where: { college_id: collegeId } });
      await prisma.college.deleteMany({ where: { id: collegeId } });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
  }

  console.log('\n====================================================');
  console.log(`Phase 12 Tests Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase12ContractTests();
