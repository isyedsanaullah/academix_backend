'use strict';

/**
 * T3.1 — Idempotent Three-Plan Catalog & PlanVersion Seeder
 * Usage:
 *   node scripts/seed_three_plan_catalog.js --dry-run
 *   node scripts/seed_three_plan_catalog.js --apply
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getSystemClient } = require('../config/prismaManager');
const { THREE_PLAN_CONFIG } = require('../config/planConstants');
const { getFeatureRegistry, PLAN_LEVEL } = require('../config/featureRegistry');

function sanitizeJsonLimits(limits) {
  const out = {};
  for (const [k, v] of Object.entries(limits || {})) {
    if (v === Infinity) out[k] = -1;
    else if (typeof v === 'bigint') out[k] = Number(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = sanitizeJsonLimits(v);
    else out[k] = v;
  }
  return out;
}

async function seedThreePlanCatalog({ prisma = null, dryRun = true, actor = 'THREE_PLAN_SEEDER' } = {}) {
  const db = prisma || getSystemClient();
  const plans = THREE_PLAN_CONFIG.CANONICAL_PLANS;
  const reg3 = getFeatureRegistry(true);
  const levelMap = THREE_PLAN_CONFIG.PLAN_LEVEL;

  const summary = {
    dryRun,
    subscriptionsUpserted: 0,
    planVersionsCreated: 0,
    addonRowsUpserted: 0,
    retiredAddonRowsDisabled: 0,
    enterpriseDeactivated: false,
  };

  for (const planId of plans) {
    const pricing = THREE_PLAN_CONFIG.PLAN_PRICING[planId];
    const limitsJson = sanitizeJsonLimits(THREE_PLAN_CONFIG.PLAN_LIMITS[planId]);
    const targetLevel = levelMap[planId] ?? 0;
    const featureKeys = reg3
      .filter(f => !f.addonOnly && f.startsIn && (levelMap[f.startsIn] ?? 99) <= targetLevel)
      .map(f => f.key);
    const displayName = planId === 'starter' ? 'Starter' : planId === 'standard' ? 'Standard' : 'Premium';

    if (!dryRun) {
      await db.subscription.upsert({
        where: { planId },
        update: {
          name: displayName,
          features: featureKeys,
          limits: limitsJson,
          price: { monthly: pricing.monthly, yearly: pricing.yearly, currency: 'PKR' },
          priceMonthlyPkr: pricing.monthly,
          priceYearlyPkr: pricing.yearly,
          isAI: planId !== 'starter',
          isActive: true,
        },
        create: {
          planId,
          name: displayName,
          description: `Academix Three-Plan Architecture — ${displayName}`,
          features: featureKeys,
          restrictions: [],
          limits: limitsJson,
          price: { monthly: pricing.monthly, yearly: pricing.yearly, currency: 'PKR' },
          priceMonthlyPkr: pricing.monthly,
          priceYearlyPkr: pricing.yearly,
          isAI: planId !== 'starter',
          isActive: true,
        },
      });
    }
    summary.subscriptionsUpserted++;

    const latestPv = await db.planVersion.findFirst({
      where: { planId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = latestPv ? latestPv.version + 1 : 1;
    const samePrices = latestPv
      && latestPv.pricesJson?.monthlyPkr === pricing.monthly
      && latestPv.pricesJson?.yearlyPkr === pricing.yearly
      && JSON.stringify(latestPv.limitsJson) === JSON.stringify(limitsJson);

    if (!samePrices) {
      if (!dryRun) {
        await db.planVersion.create({
          data: {
            planId,
            version: nextVersion,
            pricesJson: { monthlyPkr: pricing.monthly, yearlyPkr: pricing.yearly },
            limitsJson,
            createdBy: actor,
          },
        });
      }
      summary.planVersionsCreated++;
    }
  }

  // Mark retired enterprise plan row inactive without deleting historical FK integrity
  if (!dryRun) {
    const res = await db.subscription.updateMany({
      where: { planId: 'enterprise' },
      data: { isActive: false },
    });
    summary.enterpriseDeactivated = res.count > 0;
  } else {
    summary.enterpriseDeactivated = true;
  }

  // Upsert 3-plan AddonCatalog seeds
  for (const seed of THREE_PLAN_CONFIG.ADDON_CATALOG_SEEDS) {
    if (!dryRun) {
      await db.addonCatalog.upsert({
        where: { addonType_planId: { addonType: seed.addonType, planId: seed.planId } },
        update: {
          name: seed.name,
          unitPriceMonthlyPkr: seed.unitPriceMonthlyPkr,
          unitPriceYearlyPkr: seed.unitPriceYearlyPkr,
          isAvailable: seed.isAvailable !== false,
          isPurchasable: seed.isPurchasable !== false,
          maxCapPercentOfBase: seed.maxCapPercentOfBase,
          maxUnitsStatic: seed.maxUnitsStatic,
        },
        create: {
          addonType: seed.addonType,
          planId: seed.planId,
          name: seed.name,
          unitPriceMonthlyPkr: seed.unitPriceMonthlyPkr,
          unitPriceYearlyPkr: seed.unitPriceYearlyPkr,
          isAvailable: seed.isAvailable !== false,
          isPurchasable: seed.isPurchasable !== false,
          maxCapPercentOfBase: seed.maxCapPercentOfBase,
          maxUnitsStatic: seed.maxUnitsStatic,
        },
      });
    }
    summary.addonRowsUpserted++;
  }

  // Disable retired ADMINS, enterprise add-on rows, and Standard SMS_PACK_*
  if (!dryRun) {
    const disabledRes = await db.addonCatalog.updateMany({
      where: {
        OR: [
          { addonType: 'ADMINS' },
          { planId: 'enterprise' },
          { planId: 'standard', addonType: { in: ['SMS_PACK_500', 'SMS_PACK_2000', 'SMS_PACK_5000', 'CAMPUS'] } },
        ],
      },
      data: { isAvailable: false, isPurchasable: false },
    });
    summary.retiredAddonRowsDisabled = disabledRes.count;
  }

  return summary;
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  seedThreePlanCatalog({ dryRun: !apply })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed_three_plan_catalog] Error:', err);
      process.exit(1);
    });
}

module.exports = {
  seedThreePlanCatalog,
  sanitizeJsonLimits,
};
