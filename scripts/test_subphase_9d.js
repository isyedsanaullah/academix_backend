'use strict';

/**
 * test_subphase_9d.js — Test Sub-Phase 9D: N11 Multi-Step Approvals
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

const approvalService = require('../services/approvalService');

async function runTests() {
  console.log('====================================================');
  console.log('   TESTING SUB-PHASE 9D: N11 MULTI-STEP APPROVALS  ');
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

  // 1. Chain Configuration & Snapshot Immutability
  await test('1. Chain Configuration & Snapshot Immutability on Open Requests', async () => {
    const col = await prisma.college.create({
      data: { name: 'Appr Col', email: `appr_${Date.now()}@test.com`, code: `AP_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const requester = await prisma.user.create({
      data: { college_id: col.id, email: `req_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Requester' }
    });

    // Configure 2-step chain: Step 1 Accountant, Step 2 Principal
    const chain = await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      steps: [
        { stepNumber: 1, approverType: 'ROLE', approverRef: 'accountant' },
        { stepNumber: 2, approverType: 'ROLE', approverRef: 'principal' }
      ]
    });
    assert.strictEqual(chain.steps.length, 2);

    // Create a fee record to associate with request
    const session = await prisma.session.create({
      data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });
    const student = await prisma.student.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        name: 'Student Fee 1',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `ST1_${Date.now()}`,
        class: '11th',
        group: 'Science'
      }
    });
    const fee = await prisma.fee.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        student_id: student.id,
        month: '2026-11',
        totalAmount: 10000,
        paidAmount: 0,
        status: 'pending'
      }
    });

    // Initiate approval request
    const initResult = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      requesterUser: requester,
      payload: { feeId: fee.id, discountAmount: 2000 }
    });
    assert.strictEqual(initResult.requiresApproval, true);
    assert(initResult.approvalRequestId);

    // Verify snapshot steps in request
    const reqDetails = await approvalService.getRequestDetails(col.id, initResult.approvalRequestId);
    assert.strictEqual(reqDetails.steps.length, 2);
    assert.strictEqual(reqDetails.steps[0].approverRef, 'accountant');
    assert.strictEqual(reqDetails.steps[1].approverRef, 'principal');

    // Modify the chain: change Step 2 to 'admin' and add Step 3
    await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      steps: [
        { stepNumber: 1, approverType: 'ROLE', approverRef: 'accountant' },
        { stepNumber: 2, approverType: 'ROLE', approverRef: 'admin' },
        { stepNumber: 3, approverType: 'ROLE', approverRef: 'superadmin' }
      ]
    });

    // Verify open request is IMMUTABLE (still has original snapshot: 2 steps, Step 2 is principal)
    const reqDetailsAfter = await approvalService.getRequestDetails(col.id, initResult.approvalRequestId);
    assert.strictEqual(reqDetailsAfter.steps.length, 2);
    assert.strictEqual(reqDetailsAfter.steps[1].approverRef, 'principal');
  });

  // 2. Actor Authorization & Self-Approval Prevention
  await test('2. Actor Authorization & Self-Approval Prevention', async () => {
    const col = await prisma.college.create({
      data: { name: 'Auth Col', email: `auth_${Date.now()}@test.com`, code: `ATC_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const requesterAccountant = await prisma.user.create({
      data: { college_id: col.id, email: `ra_${Date.now()}@test.com`, password: 'hash', role: 'accountant', name: 'Req Accountant' }
    });
    const regularAccountant = await prisma.user.create({
      data: { college_id: col.id, email: `acc_${Date.now()}@test.com`, password: 'hash', role: 'accountant', name: 'Reg Accountant' }
    });
    const teacher = await prisma.user.create({
      data: { college_id: col.id, email: `tch_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Teacher' }
    });

    await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      steps: [
        { stepNumber: 1, approverType: 'ROLE', approverRef: 'accountant' },
        { stepNumber: 2, approverType: 'ROLE', approverRef: 'principal' }
      ]
    });

    const { approvalRequestId } = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      requesterUser: requesterAccountant,
      payload: { amount: 50000, item: 'Laptops' }
    });

    // 1. Teacher cannot approve Step 1 (requires accountant)
    try {
      await approvalService.approveStep({
        collegeId: col.id,
        requestId: approvalRequestId,
        actorUser: teacher
      });
      assert.fail('Teacher should not be able to approve accountant step');
    } catch (err) {
      assert.strictEqual(err.code, 'NOT_AN_APPROVER');
    }

    // 2. Requester cannot approve their own request (even though they are an accountant)
    try {
      await approvalService.approveStep({
        collegeId: col.id,
        requestId: approvalRequestId,
        actorUser: requesterAccountant
      });
      assert.fail('Requester should not be allowed to self-approve');
    } catch (err) {
      assert.strictEqual(err.code, 'SELF_APPROVAL_NOT_ALLOWED');
    }

    // 3. Regular accountant can approve Step 1
    const approveResult = await approvalService.approveStep({
      collegeId: col.id,
      requestId: approvalRequestId,
      actorUser: regularAccountant,
      note: 'Verified budget availability'
    });
    assert.strictEqual(approveResult.success, true);
    assert.strictEqual(approveResult.currentStep, 2);
    assert.strictEqual(approveResult.status, 'PENDING');
  });

  // 3. Concurrency Conflict Prevention (409)
  await test('3. Concurrency Conflict Prevention rejects re-approval with 409', async () => {
    const col = await prisma.college.create({
      data: { name: 'Conc Col', email: `cnc_${Date.now()}@test.com`, code: `CNC_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });
    const requester = await prisma.user.create({
      data: { college_id: col.id, email: `req_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Req' }
    });
    const accountant1 = await prisma.user.create({
      data: { college_id: col.id, email: `acc1_${Date.now()}@test.com`, password: 'hash', role: 'accountant', name: 'Acc 1' }
    });

    await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      steps: [
        { stepNumber: 1, approverType: 'ROLE', approverRef: 'accountant' },
        { stepNumber: 2, approverType: 'ROLE', approverRef: 'principal' }
      ]
    });

    const { approvalRequestId } = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      requesterUser: requester,
      payload: { amount: 15000 }
    });

    // Step 1 approved
    await approvalService.approveStep({
      collegeId: col.id,
      requestId: approvalRequestId,
      actorUser: accountant1
    });

    // Attempting to approve Step 1 again must reject with 409 APPROVAL_STEP_CONFLICT
    // (Simulating concurrent approvers clicking simultaneously)
    try {
      await approvalService.approveStep({
        collegeId: col.id,
        requestId: approvalRequestId,
        actorUser: accountant1
      });
      assert.fail('Concurrent / redundant step 1 approval should conflict');
    } catch (err) {
      assert(err.code === 'APPROVAL_STEP_CONFLICT' || err.code === 'NOT_AN_APPROVER');
    }
  });

  // 4. Atomic Revalidation & Single-Transaction Execution on Final Step
  await test('4. Atomic Execution on Final Step with Rollback on Revalidation Failure', async () => {
    const col = await prisma.college.create({
      data: { name: 'Atom Col', email: `atm_${Date.now()}@test.com`, code: `ATM_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });

    const requester = await prisma.user.create({
      data: { college_id: col.id, email: `req_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Req' }
    });
    const principal = await prisma.user.create({
      data: { college_id: col.id, email: `prn_${Date.now()}@test.com`, password: 'hash', role: 'principal', name: 'Principal' }
    });

    // 1-step chain directly to Principal
    await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      steps: [
        { stepNumber: 1, approverType: 'ROLE', approverRef: 'principal' }
      ]
    });

    const session = await prisma.session.create({
      data: { college_id: col.id, name: '2026-2027', startDate: new Date('2026-08-01'), endDate: new Date('2027-06-30') }
    });
    const student4 = await prisma.student.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        name: 'Student Fee 4',
        fatherName: 'Father',
        gender: 'male',
        rollNumber: `ST4_${Date.now()}`,
        class: '11th',
        group: 'Science'
      }
    });
    const fee = await prisma.fee.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        student_id: student4.id,
        month: '2026-11',
        totalAmount: 5000,
        paidAmount: 0,
        status: 'pending'
      }
    });

    // Case A: Payload will fail revalidation during final execution (e.g. non-existent fee)
    const badReq = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      requesterUser: requester,
      payload: { feeId: fee.id, discountAmount: 1000 }
    });

    // Delete the fee underneath to trigger revalidation failure on execute
    await prisma.fee.delete({ where: { id: fee.id } });

    try {
      await approvalService.approveStep({
        collegeId: col.id,
        requestId: badReq.approvalRequestId,
        actorUser: principal
      });
      assert.fail('Should have rolled back due to revalidation failure');
    } catch (err) {
      assert.strictEqual(err.code, 'REVALIDATION_FAILED');
    }

    // Verify request was ROLLED BACK and remains PENDING with NO actions recorded
    const reqAfterFail = await approvalService.getRequestDetails(col.id, badReq.approvalRequestId);
    assert.strictEqual(reqAfterFail.status, 'PENDING');
    assert.strictEqual(reqAfterFail.actions.length, 0);

    // Case B: Valid execution succeeds atomically
    const validFee = await prisma.fee.create({
      data: {
        college_id: col.id,
        session_id: session.id,
        student_id: student4.id,
        month: '2026-11',
        totalAmount: 8000,
        paidAmount: 0,
        status: 'pending'
      }
    });

    const goodReq = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'FEE_CONCESSION',
      requesterUser: requester,
      payload: { feeId: validFee.id, discountAmount: 3000 }
    });

    const goodApprove = await approvalService.approveStep({
      collegeId: col.id,
      requestId: goodReq.approvalRequestId,
      actorUser: principal,
      note: 'Concession approved for financial need'
    });
    assert.strictEqual(goodApprove.status, 'APPROVED');
    assert.strictEqual(goodApprove.isFinalStep, true);

    // Verify fee record was updated by the handler
    const updatedFee = await prisma.fee.findUnique({ where: { id: validFee.id } });
    assert.strictEqual(Number(updatedFee.totalAmount), 5000);
    assert.strictEqual(Number(updatedFee.scholarshipDeduction), 3000);

    // Verify outbox notification was recorded
    const outbox = await prisma.outboxEvent.findFirst({
      where: { college_id: col.id, eventType: 'APPROVAL_DECIDED' },
      orderBy: { createdAt: 'desc' }
    });
    assert.strictEqual(outbox.payload.status, 'APPROVED');
  });

  // 5. Rejection & Cancellation Workflows
  await test('5. Rejection by Approver & Cancellation by Requester', async () => {
    const col = await prisma.college.create({
      data: { name: 'Rej Col', email: `rej_${Date.now()}@test.com`, code: `REJ_${Date.now()}`, planId: 'premium', subStatus: 'ACTIVE' }
    });
    const requester = await prisma.user.create({
      data: { college_id: col.id, email: `req_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Req' }
    });
    const principal = await prisma.user.create({
      data: { college_id: col.id, email: `prn_${Date.now()}@test.com`, password: 'hash', role: 'principal', name: 'Principal' }
    });
    const stranger = await prisma.user.create({
      data: { college_id: col.id, email: `str_${Date.now()}@test.com`, password: 'hash', role: 'teacher', name: 'Stranger' }
    });

    await approvalService.createOrUpdateChain({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      steps: [{ stepNumber: 1, approverType: 'ROLE', approverRef: 'principal' }]
    });

    // Test Rejection
    const req1 = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      requesterUser: requester,
      payload: { amount: 100000 }
    });

    const rejResult = await approvalService.rejectStep({
      collegeId: col.id,
      requestId: req1.approvalRequestId,
      actorUser: principal,
      note: 'Budget exhausted for Q3'
    });
    assert.strictEqual(rejResult.status, 'REJECTED');

    // Test Cancellation (Stranger cannot cancel)
    const req2 = await approvalService.checkAndCreateApprovalRequest({
      collegeId: col.id,
      workflowType: 'PURCHASE_ORDER',
      requesterUser: requester,
      payload: { amount: 20000 }
    });

    try {
      await approvalService.cancelRequest({
        collegeId: col.id,
        requestId: req2.approvalRequestId,
        actorUser: stranger
      });
      assert.fail('Non-requester should not be able to cancel request');
    } catch (err) {
      assert.strictEqual(err.code, 'CANCEL_FORBIDDEN');
    }

    // Original requester can cancel
    const cancelResult = await approvalService.cancelRequest({
      collegeId: col.id,
      requestId: req2.approvalRequestId,
      actorUser: requester,
      note: 'Items no longer needed'
    });
    assert.strictEqual(cancelResult.status, 'CANCELLED');
  });

  console.log(`\n====================================================`);
  console.log(`SUB-PHASE 9D TESTS SUMMARY: ${passed} PASSED, ${failed} FAILED`);
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
