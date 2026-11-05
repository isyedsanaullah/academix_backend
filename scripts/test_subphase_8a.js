'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();
const groupSeatService = require('../services/groupSeatService');

async function testPhase8A() {
  console.log('--- Testing Sub-Phase 8A: #29 Group Seat Allocation & Quotas ---');

  // 1. Find or create a college, session, and group
  const college = await prisma.college.findFirst();
  assert.ok(college, 'College exists');

  let session = await prisma.session.findFirst({ where: { college_id: college.id } });
  if (!session) {
    session = await prisma.session.create({
      data: {
        college_id: college.id,
        name: 'Test Session ' + Date.now(),
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-06-30'),
        isCurrent: true
      }
    });
  }

  let group = await prisma.group.findFirst({ where: { college_id: college.id } });
  if (!group) {
    group = await prisma.group.create({
      data: {
        college_id: college.id,
        class_id: 'class_test_part1',
        name: 'Engineering ' + Date.now(),
      }
    });
  }

  console.log(`Using College: ${college.id}, Session: ${session.id}, Group: ${group.id}`);

  // 2. Configure Seat Allocation (maxSeats: 2)
  console.log('2. Setting seat allocation to 2 seats...');
  const setResult = await groupSeatService.setSeatAllocation({
    collegeId: college.id,
    groupId: group.id,
    sessionId: session.id,
    maxSeats: 2
  });
  assert.strictEqual(setResult.allocation.maxSeats, 2);
  console.log('   PASS: Seat allocation set successfully.');

  // 3. Query Seat Allocation
  console.log('3. Querying seat allocation...');
  const queryResult = await groupSeatService.getSeatAllocation({
    collegeId: college.id,
    groupId: group.id,
    sessionId: session.id
  });
  assert.strictEqual(queryResult.maxSeats, 2);
  assert.strictEqual(queryResult.groupId, group.id);
  console.log('   PASS: Seat allocation retrieved with correct maxSeats.');

  // 4. Test atomic claiming and exhaustion
  console.log('4. Testing atomic seat claiming...');
  // Ensure starting at 0
  await prisma.groupSeatAllocation.update({
    where: { id: setResult.allocation.id },
    data: { allocatedSeats: 0 }
  });

  // Claim 1
  const claim1 = await groupSeatService.claimSeat({ collegeId: college.id, groupId: group.id, sessionId: session.id });
  assert.strictEqual(claim1.allocation.allocatedSeats, 1);

  // Claim 2
  const claim2 = await groupSeatService.claimSeat({ collegeId: college.id, groupId: group.id, sessionId: session.id });
  assert.strictEqual(claim2.allocation.allocatedSeats, 2);

  // Claim 3 - Should fail with 409 GROUP_SEATS_EXHAUSTED
  let claim3Failed = false;
  try {
    await groupSeatService.claimSeat({ collegeId: college.id, groupId: group.id, sessionId: session.id });
  } catch (err) {
    claim3Failed = true;
    assert.strictEqual(err.code, 'GROUP_SEATS_EXHAUSTED');
    assert.strictEqual(err.status, 409);
  }
  assert.ok(claim3Failed, 'Claim 3 was rejected with GROUP_SEATS_EXHAUSTED');
  console.log('   PASS: Seat claim 3 blocked with 409 GROUP_SEATS_EXHAUSTED.');

  // 5. Test seat release
  console.log('5. Testing seat release...');
  await groupSeatService.releaseSeat({ collegeId: college.id, groupId: group.id, sessionId: session.id });
  const afterRelease = await prisma.groupSeatAllocation.findUnique({ where: { id: setResult.allocation.id } });
  assert.strictEqual(afterRelease.allocatedSeats, 1);
  console.log('   PASS: Seat release decremented allocatedSeats from 2 to 1.');

  // 6. Test Fee Schedule
  console.log('6. Testing Group Fee Schedule...');
  const feeResult = await groupSeatService.setFeeSchedule({
    collegeId: college.id,
    groupId: group.id,
    sessionId: session.id,
    tuitionFeePkr: 15000,
    admissionFeePkr: 5000
  });
  assert.strictEqual(Number(feeResult.tuitionFeePkr), 15000);
  assert.strictEqual(Number(feeResult.admissionFeePkr), 5000);

  const getFee = await groupSeatService.getFeeSchedule({
    collegeId: college.id,
    groupId: group.id,
    sessionId: session.id
  });
  assert.strictEqual(Number(getFee.tuitionFeePkr), 15000);
  assert.strictEqual(Number(getFee.admissionFeePkr), 5000);
  console.log('   PASS: Fee schedule set and queried successfully.');

  // Clean up test data
  await prisma.groupFeeSchedule.delete({ where: { id: feeResult.id } });
  await prisma.groupSeatAllocation.delete({ where: { id: setResult.allocation.id } });

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8A TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');

  await prisma.$disconnect();
}

testPhase8A().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

