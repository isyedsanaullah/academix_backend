'use strict';

/**
 * backfill_payment_plan_ids.js
 * 
 * Backfills missing `planId` and `billingCycle` on `CollegeSubscriptionPayment` records.
 * 
 * Sources used in order of precedence:
 * - planId:
 *   1. Nearest SubscriptionPeriod for college around reviewedAt/createdAt
 *   2. College.planId
 *   3. Default 'starter'
 * - billingCycle:
 *   1. College.billingCycle
 *   2. Default 'MONTHLY'
 * 
 * Usage:
 *   node backend/scripts/backfill_payment_plan_ids.js --dry-run
 *   node backend/scripts/backfill_payment_plan_ids.js --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const { normalizePlanId } = require('../config/planConstants');

async function main() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply');
  const isDryRun = !isApply || args.includes('--dry-run');

  console.log('='.repeat(70));
  console.log(`PAYMENT PLAN ID & BILLING CYCLE BACKFILL - Mode: ${isApply ? 'APPLY (LIVE)' : 'DRY-RUN'}`);
  console.log('='.repeat(70));

  const prisma = getSystemClient();

  const paymentsToUpdate = await prisma.collegeSubscriptionPayment.findMany({
    where: {
      OR: [
        { planId: null },
        { billingCycle: null }
      ]
    },
    select: {
      id: true,
      college_id: true,
      type: true,
      status: true,
      planId: true,
      billingCycle: true,
      amountPaid: true,
      createdAt: true,
      reviewedAt: true
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log(`Found ${paymentsToUpdate.length} payments with missing planId or billingCycle.`);

  if (paymentsToUpdate.length === 0) {
    console.log('No backfill needed. Exiting.');
    process.exit(0);
  }

  // Pre-load all relevant colleges and subscription periods in bulk for performance
  const collegeIds = [...new Set(paymentsToUpdate.map(p => p.college_id))];
  const colleges = await prisma.college.findMany({
    where: { id: { in: collegeIds } },
    select: { id: true, name: true, planId: true, billingCycle: true }
  });
  const collegeMap = new Map(colleges.map(c => [c.id, c]));

  const periods = await prisma.subscriptionPeriod.findMany({
    where: { college_id: { in: collegeIds } },
    select: { id: true, college_id: true, plan: true, starts_at: true, expires_at: true, created_at: true },
    orderBy: { starts_at: 'asc' }
  });

  const periodsByCollege = new Map();
  for (const period of periods) {
    if (!periodsByCollege.has(period.college_id)) {
      periodsByCollege.set(period.college_id, []);
    }
    periodsByCollege.get(period.college_id).push(period);
  }

  const updates = [];
  const stats = {
    total: paymentsToUpdate.length,
    planSources: {
      ALREADY_PRESENT: 0,
      SUBSCRIPTION_PERIOD: 0,
      COLLEGE_CURRENT: 0,
      DEFAULT_STARTER: 0
    },
    cycleSources: {
      ALREADY_PRESENT: 0,
      COLLEGE_CYCLE: 0,
      DEFAULT_MONTHLY: 0
    },
    targetPlans: {
      starter: 0,
      standard: 0,
      premium: 0,
      enterprise: 0
    },
    targetCycles: {
      MONTHLY: 0,
      YEARLY: 0
    }
  };

  for (const payment of paymentsToUpdate) {
    const college = collegeMap.get(payment.college_id);
    const paymentDate = payment.reviewedAt || payment.createdAt || new Date();
    const paymentTime = new Date(paymentDate).getTime();

    // 1. Resolve planId
    let resolvedPlan = payment.planId;
    let planSource = 'ALREADY_PRESENT';

    if (!resolvedPlan) {
      const collegePeriods = periodsByCollege.get(payment.college_id) || [];
      // Try finding active period at payment date
      let matchingPeriod = collegePeriods.find(p => {
        const s = p.starts_at ? new Date(p.starts_at).getTime() : 0;
        const e = p.expires_at ? new Date(p.expires_at).getTime() : Infinity;
        return paymentTime >= s && paymentTime <= e;
      });

      // If no strictly active period, find nearest period
      if (!matchingPeriod && collegePeriods.length > 0) {
        matchingPeriod = collegePeriods.reduce((closest, cur) => {
          const curDiff = Math.abs((cur.starts_at ? new Date(cur.starts_at).getTime() : 0) - paymentTime);
          const closestDiff = Math.abs((closest.starts_at ? new Date(closest.starts_at).getTime() : 0) - paymentTime);
          return curDiff < closestDiff ? cur : closest;
        }, collegePeriods[0]);
      }

      if (matchingPeriod && matchingPeriod.plan) {
        resolvedPlan = normalizePlanId(matchingPeriod.plan);
        planSource = 'SUBSCRIPTION_PERIOD';
      } else if (college && college.planId) {
        resolvedPlan = normalizePlanId(college.planId);
        planSource = 'COLLEGE_CURRENT';
      } else {
        resolvedPlan = 'starter';
        planSource = 'DEFAULT_STARTER';
      }
    }

    // 2. Resolve billingCycle
    let resolvedCycle = payment.billingCycle;
    let cycleSource = 'ALREADY_PRESENT';

    if (!resolvedCycle) {
      if (college && college.billingCycle) {
        resolvedCycle = college.billingCycle.toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
        cycleSource = 'COLLEGE_CYCLE';
      } else {
        resolvedCycle = 'MONTHLY';
        cycleSource = 'DEFAULT_MONTHLY';
      }
    }

    stats.planSources[planSource]++;
    stats.cycleSources[cycleSource]++;
    stats.targetPlans[resolvedPlan] = (stats.targetPlans[resolvedPlan] || 0) + 1;
    stats.targetCycles[resolvedCycle] = (stats.targetCycles[resolvedCycle] || 0) + 1;

    updates.push({
      id: payment.id,
      college_id: payment.college_id,
      collegeName: college ? college.name : 'UNKNOWN',
      planId: resolvedPlan,
      billingCycle: resolvedCycle,
      planSource,
      cycleSource
    });
  }

  console.log('\n--- Backfill Statistics ---');
  console.log('Total records to update:', stats.total);
  console.log('Plan ID resolution sources:', stats.planSources);
  console.log('Billing cycle resolution sources:', stats.cycleSources);
  console.log('Resulting plan distribution:', stats.targetPlans);
  console.log('Resulting cycle distribution:', stats.targetCycles);

  console.log('\nSample updates (first 5):');
  for (const u of updates.slice(0, 5)) {
    console.log(`- Payment ${u.id} (${u.collegeName}): planId=${u.planId} [${u.planSource}], cycle=${u.billingCycle} [${u.cycleSource}]`);
  }

  if (isApply) {
    console.log('\nApplying updates in database transaction batches...');
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} items)...`);
      await prisma.$transaction(
        batch.map(u =>
          prisma.collegeSubscriptionPayment.update({
            where: { id: u.id },
            data: {
              planId: u.planId,
              billingCycle: u.billingCycle
            }
          })
        ),
        { timeout: 30000 }
      );
    }
    console.log(`[SUCCESS] Successfully updated ${updates.length} payment records.`);

    // Verify
    const remainingNulls = await prisma.collegeSubscriptionPayment.count({
      where: {
        OR: [
          { planId: null },
          { billingCycle: null }
        ]
      }
    });
    console.log(`Verification: remaining payments with null planId or billingCycle: ${remainingNulls}`);
  } else {
    console.log('\n[DRY-RUN] No changes were written to the database. Run with --apply to execute.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[ERROR] Backfill failed:', err);
  process.exit(1);
});
