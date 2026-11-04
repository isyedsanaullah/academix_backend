const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS,
  ADDON_CATALOG_SEEDS,
  normalizePlanId,
  getMonthlyKey
} = require('../config/planConstants');
const { FEATURE_REGISTRY, validateRegistryDAG } = require('../config/featureRegistry');

async function runPhase1Backfill() {
  console.log('=== STARTING PHASE 1 MIGRATION & BACKFILL ===');
  const prisma = getSystemClient();

  // Step 0: Validate Feature Registry DAG
  console.log('Validating Feature Registry DAG...');
  const dagResult = validateRegistryDAG();
  console.log(`DAG valid: ${dagResult.total} services verified across ${Object.keys(dagResult.byTier).length} tiers.`);

  // Step 1: Upsert Canonical Plans into Subscription table
  console.log('\n--- Step 1: Upserting Canonical Plans into Subscription table ---');
  for (const planId of CANONICAL_PLANS) {
    const pricing = PLAN_PRICING[planId];
    const limits = PLAN_LIMITS[planId];
    const isAI = limits.aiCreditsMonthly > 0;
    const planName = planId.charAt(0).toUpperCase() + planId.slice(1);

    // Compute cumulative features for this plan tier
    const PLAN_LEVEL = { starter: 0, standard: 1, premium: 2, enterprise: 3 };
    const targetLvl = PLAN_LEVEL[planId];
    const featureKeys = FEATURE_REGISTRY
      .filter(f => PLAN_LEVEL[f.startsIn] <= targetLvl)
      .map(f => f.key);

    const upserted = await prisma.subscription.upsert({
      where: { planId },
      update: {
        name: planName,
        priceMonthlyPkr: pricing.monthly,
        priceYearlyPkr: pricing.yearly,
        limits: limits,
        features: featureKeys,
        isAI: isAI,
        isActive: true,
        version: 1
      },
      create: {
        planId,
        name: planName,
        priceMonthlyPkr: pricing.monthly,
        priceYearlyPkr: pricing.yearly,
        limits: limits,
        features: featureKeys,
        isAI: isAI,
        isActive: true,
        version: 1
      }
    });

    console.log(`✓ Plan [${planId}] upserted: Monthly PKR ${upserted.priceMonthlyPkr}, Yearly PKR ${upserted.priceYearlyPkr}, Features: ${upserted.features.length}`);
  }

  // Step 2: Upsert AddonCatalog seeds
  console.log('\n--- Step 2: Upserting AddonCatalog Seeds ---');
  let addonCount = 0;
  for (const seed of ADDON_CATALOG_SEEDS) {
    await prisma.addonCatalog.upsert({
      where: {
        addonType_planId: {
          addonType: seed.addonType,
          planId: seed.planId
        }
      },
      update: {
        name: seed.name,
        unitPriceMonthlyPkr: seed.unitPriceMonthlyPkr,
        unitPriceYearlyPkr: seed.unitPriceYearlyPkr,
        isAvailable: seed.isAvailable,
        maxCapPercentOfBase: seed.maxCapPercentOfBase,
        maxUnitsStatic: seed.maxUnitsStatic
      },
      create: {
        addonType: seed.addonType,
        planId: seed.planId,
        name: seed.name,
        unitPriceMonthlyPkr: seed.unitPriceMonthlyPkr,
        unitPriceYearlyPkr: seed.unitPriceYearlyPkr,
        isAvailable: seed.isAvailable,
        maxCapPercentOfBase: seed.maxCapPercentOfBase,
        maxUnitsStatic: seed.maxUnitsStatic
      }
    });
    addonCount++;
  }
  console.log(`✓ Seeded/Updated ${addonCount} AddonCatalog rows across all plans.`);

  // Step 3: Grandfather existing Colleges
  console.log('\n--- Step 3: Grandfathering Existing Colleges ---');
  const colleges = await prisma.college.findMany();
  console.log(`Found ${colleges.length} colleges to process.`);

  const now = new Date();
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  for (const college of colleges) {
    // Resolve legacy plan from column or JSON payload
    let rawPlan = college.planId;
    if (!rawPlan || rawPlan === 'starter') {
      if (college.subscription && typeof college.subscription === 'object' && college.subscription.planId) {
        rawPlan = college.subscription.planId;
      }
    }
    const normPlan = normalizePlanId(rawPlan || 'starter');

    const updated = await prisma.college.update({
      where: { id: college.id },
      data: {
        planId: normPlan,
        billingCycle: college.billingCycle || 'MONTHLY',
        subStatus: 'ACTIVE', // Grandfather existing active institutions
        periodStart: college.periodStart || now,
        periodEnd: college.periodEnd || ninetyDaysFromNow,
        trialEndsAt: college.trialEndsAt || fourteenDaysFromNow,
        annualQuotaCycleStart: college.annualQuotaCycleStart || now,
        forceReadOnly: false
      }
    });

    console.log(`✓ College [${college.name}] (${college.id.slice(0, 8)}...): plan=${updated.planId}, subStatus=${updated.subStatus}, periodEnd=${updated.periodEnd.toISOString()}`);
  }

  // Step 4: Backfill Lifetime Storage & Student/Staff Counts into CollegeUsage
  console.log('\n--- Step 4: Backfilling Lifetime Quota Counters into CollegeUsage ---');
  for (const college of colleges) {
    // 4.1 Storage from StoredFile
    const fileAgg = await prisma.storedFile.aggregate({
      where: {
        college_id: college.id,
        deletedAt: null
      },
      _sum: {
        sizeBytes: true
      }
    });
    const totalStorageBytes = BigInt(fileAgg._sum.sizeBytes || 0);

    await prisma.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: college.id,
          metric: 'storageBytes',
          period: 'total'
        }
      },
      update: { value: totalStorageBytes },
      create: {
        college_id: college.id,
        metric: 'storageBytes',
        period: 'total',
        value: totalStorageBytes
      }
    });

    // 4.2 Active Student Count from Student table
    const studentCount = await prisma.student.count({
      where: {
        college_id: college.id,
        status: { notIn: ['dropped', 'expelled', 'graduated'] }
      }
    });

    await prisma.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: college.id,
          metric: 'students',
          period: 'total'
        }
      },
      update: { value: BigInt(studentCount) },
      create: {
        college_id: college.id,
        metric: 'students',
        period: 'total',
        value: BigInt(studentCount)
      }
    });

    // 4.3 Active Staff Count from Employee table
    const staffCount = await prisma.employee.count({
      where: {
        college_id: college.id,
        status: { notIn: ['resigned', 'terminated'] }
      }
    });

    await prisma.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: college.id,
          metric: 'staff',
          period: 'total'
        }
      },
      update: { value: BigInt(staffCount) },
      create: {
        college_id: college.id,
        metric: 'staff',
        period: 'total',
        value: BigInt(staffCount)
      }
    });

    console.log(`✓ Usage for [${college.name}]: Storage=${totalStorageBytes.toString()} B, Students=${studentCount}, Staff=${staffCount}`);
  }

  // Step 5: Lazy Monthly Credit Grant for Current Month
  console.log('\n--- Step 5: Seeding Lazy Monthly Credit Grant for Current Month ---');
  const currentPeriodKey = getMonthlyKey(now); // e.g. '2026-11'
  console.log(`Period Key: ${currentPeriodKey}`);

  for (const college of colleges) {
    const limits = PLAN_LIMITS[college.planId || 'starter'];

    // Message Credits
    if (limits && limits.messageCreditsMonthly > 0) {
      const grant = limits.messageCreditsMonthly;
      await prisma.messageCreditLedgerEntry.upsert({
        where: {
          college_id_bucket_periodKey: {
            college_id: college.id,
            bucket: 'PLAN',
            periodKey: currentPeriodKey
          }
        },
        update: {},
        create: {
          college_id: college.id,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: grant,
          type: 'MONTHLY_GRANT',
          balanceAfter: grant,
          referenceId: `MONTHLY_GRANT_${currentPeriodKey}`
        }
      });
      console.log(`✓ Granted ${grant} SMS/WA credits to [${college.name}]`);
    }

    // AI Credits
    if (limits && limits.aiCreditsMonthly > 0) {
      const grant = limits.aiCreditsMonthly;
      await prisma.aICreditLedgerEntry.upsert({
        where: {
          college_id_bucket_periodKey: {
            college_id: college.id,
            bucket: 'PLAN',
            periodKey: currentPeriodKey
          }
        },
        update: {},
        create: {
          college_id: college.id,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: grant,
          type: 'MONTHLY_GRANT',
          balanceAfter: grant,
          taskType: 'MONTHLY_GRANT'
        }
      });
      console.log(`✓ Granted ${grant} AI credits to [${college.name}]`);
    }
  }

  console.log('\n=== PHASE 1 BACKFILL SUCCESSFULLY COMPLETED ===');
  await prisma.$disconnect();
}

runPhase1Backfill().catch(err => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
