'use strict';

/**
 * T3.2 — Stage 3 Migration Script: Legacy 4-Plan -> Three-Plan Architecture
 *
 * Idempotent & reversible within 24 hours:
 *  1. Enterprise -> Premium (keeps subStatus='ACTIVE', sets grandfatheredUntil = max(periodEnd, +90d),
 *     writes all 14 legacy limit CollegeQuotaOverride rows, sets isCustomQuote ONLY when
 *     students > 3,000 OR campuses >= 4, and flags >2,300 student pricing review in notes).
 *  2. Existing Standard -> Option 1 expiring CollegeFeatureOverride ('FORCE_ON') for live moved
 *     analytics (#40 pass-percentage-analytics, #44 weak-student-lists, #45 subject-teacher-comparison)
 *     until max(periodEnd, +90d).
 *  3. Rollback (--rollback --snapshot <path>) restores prior state within 24h window.
 *
 * Usage:
 *   node scripts/migrate_to_three_plans.js --dry-run
 *   node scripts/migrate_to_three_plans.js --apply
 *   node scripts/migrate_to_three_plans.js --rollback --snapshot backups/three_plan_migration_<ts>.json
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getSystemClient } = require('../config/prismaManager');
const { GB } = require('../config/planConstants');

const ACTOR_ID = 'THREE_PLAN_MIGRATION_T3_2';
const ROLLBACK_WINDOW_HOURS = 24;
const ENTERPRISE_GF_REASON = 'ENTERPRISE_RETIREMENT_GRANDFATHER';

const ENTERPRISE_GRANDFATHER_QUOTAS = {
  maxStudents: 3000,
  maxStaff: 200,
  maxAdmins: 25,
  maxCampuses: 3,
  maxStorageBytes: 300 * GB,
  maxApplications: 400,
  emailsMonthly: 50000,
  messageCreditsMonthly: 600,
  aiCreditsMonthly: 40000000,
  tutorDailyPerStudent: 30,
  scheduledReportsMonthly: 50,
  omrSheetsMonthly: 20000,
  apiCallsMonthly: 100000,
  exportMaxRows: 1000000,
};

const MOVED_STANDARD_LIVE_KEYS = [
  'pass-percentage-analytics',   // #40
  'weak-student-lists',          // #44
  'subject-teacher-comparison',  // #45
];

function computeGrandfatherWindow(periodEnd, now = new Date()) {
  const ninetyDaysFromNow = now.getTime() + 90 * 86400000;
  const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : 0;
  return new Date(Math.max(ninetyDaysFromNow, Number.isFinite(periodEndMs) ? periodEndMs : 0));
}

async function getLiveCountsForCollege(db, collegeId) {
  let students = 0;
  let campuses = 1;
  if (db.collegeUsage?.findUnique) {
    const u = await db.collegeUsage.findUnique({
      where: { college_id_metric_period: { college_id: collegeId, metric: 'students', period: 'total' } },
    });
    if (u) students = Number(u.value || 0);
  }
  if (!students && db.student?.count) {
    students = await db.student.count({ where: { college_id: collegeId } }).catch(() => 0);
  }
  if (db.campus?.count) {
    const cCount = await db.campus.count({ where: { college_id: collegeId } }).catch(() => 0);
    if (cCount > 0) campuses = cCount;
  }
  return { students, campuses };
}

async function migrateToThreePlans({
  prisma = null,
  dryRun = true,
  now = new Date(),
  snapshotDir = path.join(__dirname, '..', 'backups'),
} = {}) {
  const db = prisma || getSystemClient();

  const colleges = await db.college.findMany({
    where: {
      OR: [
        { planId: 'enterprise' },
        { planId: 'standard' },
      ],
    },
  });

  const targetPremiumPv = await db.planVersion?.findFirst?.({
    where: { planId: 'premium' },
    orderBy: { version: 'desc' },
  }) || null;

  const snapshot = {
    version: 'T3.2-v1',
    migratedAt: now.toISOString(),
    rollbackExpiresAt: new Date(now.getTime() + ROLLBACK_WINDOW_HOURS * 3600 * 1000).toISOString(),
    dryRun,
    colleges: [],
  };

  const summary = {
    dryRun,
    enterpriseMigrated: 0,
    customQuoteFlagged: 0,
    above2300PricingRiskFlagged: 0,
    standardOption1Protected: 0,
    snapshotFile: null,
    details: [],
  };

  for (const col of colleges) {
    const planLower = String(col.planId || '').toLowerCase();

    if (planLower === 'enterprise') {
      const gfUntil = computeGrandfatherWindow(col.periodEnd, now);
      const { students, campuses } = await getLiveCountsForCollege(db, col.id);
      // 3 campuses allowed with CAMPUS add-on; Custom Quote triggers strictly at >3,000 students OR >=4 campuses
      const isCustomQuote = students > 3000 || campuses >= 4;
      const pricingRisk = students > 2300;
      const customQuoteNotes = isCustomQuote
        ? `Auto-flagged during T3.2 migration (students=${students}, campuses=${campuses}). Assign manual Custom Quote.`
        : (pricingRisk
            ? `Pricing review: >2,300 students (${students}) exceeds legacy PKR 17,999 under PKR 14,999 + PKR 10/student; review flat Custom Quote at renewal.`
            : col.customQuoteNotes || null);

      snapshot.colleges.push({
        id: col.id,
        previousPlanId: col.planId,
        previousSubStatus: col.subStatus,
        previousPlanVersionId: col.planVersionId || null,
        previousIsCustomQuote: Boolean(col.isCustomQuote),
        previousCustomQuoteNotes: col.customQuoteNotes || null,
        previousGrandfatheredUntil: col.grandfatheredUntil ? new Date(col.grandfatheredUntil).toISOString() : null,
        previousGrandfatherReason: col.grandfatherReason || null,
        kind: 'ENTERPRISE_TO_PREMIUM',
      });

      if (!dryRun) {
        await db.$transaction(async (tx) => {
          await tx.college.update({
            where: { id: col.id },
            data: {
              planId: 'premium',
              planVersionId: targetPremiumPv?.id || col.planVersionId || null,
              // Keep subStatus untouched (ACTIVE stays ACTIVE)
              grandfatheredUntil: gfUntil,
              grandfatherReason: 'ENTERPRISE_RETIREMENT',
              isCustomQuote,
              customQuoteNotes,
            },
          });

          for (const [metric, val] of Object.entries(ENTERPRISE_GRANDFATHER_QUOTAS)) {
            await tx.collegeQuotaOverride.upsert({
              where: { college_id_metric: { college_id: col.id, metric } },
              update: {
                overrideValue: BigInt(Math.round(val)),
                reason: ENTERPRISE_GF_REASON,
                createdBy: ACTOR_ID,
              },
              create: {
                college_id: col.id,
                metric,
                overrideValue: BigInt(Math.round(val)),
                reason: ENTERPRISE_GF_REASON,
                createdBy: ACTOR_ID,
              },
            });
          }

          if (tx.subscriptionPeriod?.updateMany) {
            await tx.subscriptionPeriod.updateMany({
              where: { college_id: col.id, planCode: 'enterprise', status: 'ACTIVE' },
              data: { planCode: 'premium' },
            });
          }
        });
      }

      summary.enterpriseMigrated++;
      if (isCustomQuote) summary.customQuoteFlagged++;
      if (pricingRisk) summary.above2300PricingRiskFlagged++;
      summary.details.push({
        collegeId: col.id,
        action: 'ENTERPRISE_TO_PREMIUM',
        grandfatheredUntil: gfUntil.toISOString(),
        students,
        campuses,
        isCustomQuote,
        pricingRisk,
      });
    } else if (planLower === 'standard' && col.subStatus === 'ACTIVE') {
      const option1ExpiresAt = computeGrandfatherWindow(col.periodEnd, now);
      snapshot.colleges.push({
        id: col.id,
        previousPlanId: col.planId,
        kind: 'STANDARD_OPTION1_OVERRIDES',
        featureKeys: MOVED_STANDARD_LIVE_KEYS,
      });

      if (!dryRun) {
        for (const featureKey of MOVED_STANDARD_LIVE_KEYS) {
          await db.collegeFeatureOverride.upsert({
            where: { college_id_featureKey: { college_id: col.id, featureKey } },
            update: {
              state: 'FORCE_ON',
              expiresAt: option1ExpiresAt,
              reason: 'THREE_PLAN_OPTION1_STD_TRANSITION',
              createdBy: ACTOR_ID,
            },
            create: {
              college_id: col.id,
              featureKey,
              state: 'FORCE_ON',
              expiresAt: option1ExpiresAt,
              reason: 'THREE_PLAN_OPTION1_STD_TRANSITION',
              createdBy: ACTOR_ID,
            },
          });
        }
      }

      summary.standardOption1Protected++;
      summary.details.push({
        collegeId: col.id,
        action: 'STANDARD_OPTION1_PROTECTED',
        expiresAt: option1ExpiresAt.toISOString(),
        features: MOVED_STANDARD_LIVE_KEYS,
      });
    }
  }

  if (!dryRun) {
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
    const snapshotFile = path.join(snapshotDir, `three_plan_migration_${now.getTime()}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), 'utf8');
    summary.snapshotFile = snapshotFile;
  }

  return summary;
}

async function rollbackThreePlanMigration({
  snapshotFile,
  prisma = null,
  force = false,
  now = new Date(),
}) {
  const db = prisma || getSystemClient();
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  const migratedAt = new Date(snapshot.migratedAt);
  const elapsedHours = (now.getTime() - migratedAt.getTime()) / (3600 * 1000);

  if (elapsedHours > ROLLBACK_WINDOW_HOURS && !force) {
    throw Object.assign(
      new Error(`Three-plan migration rollback window (${ROLLBACK_WINDOW_HOURS}h) has expired (${elapsedHours.toFixed(1)}h elapsed). Use forward fixes instead.`),
      { code: 'ROLLBACK_WINDOW_EXPIRED' }
    );
  }

  let restoredCount = 0;
  for (const entry of snapshot.colleges || []) {
    if (entry.kind === 'ENTERPRISE_TO_PREMIUM') {
      await db.$transaction(async (tx) => {
        await tx.college.update({
          where: { id: entry.id },
          data: {
            planId: entry.previousPlanId,
            planVersionId: entry.previousPlanVersionId,
            isCustomQuote: entry.previousIsCustomQuote,
            customQuoteNotes: entry.previousCustomQuoteNotes,
            grandfatheredUntil: entry.previousGrandfatheredUntil ? new Date(entry.previousGrandfatheredUntil) : null,
            grandfatherReason: entry.previousGrandfatherReason,
          },
        });
        await tx.collegeQuotaOverride.deleteMany({
          where: { college_id: entry.id, createdBy: ACTOR_ID },
        });
        if (tx.subscriptionPeriod?.updateMany) {
          await tx.subscriptionPeriod.updateMany({
            where: { college_id: entry.id, planCode: 'premium', status: 'ACTIVE' },
            data: { planCode: 'enterprise' },
          });
        }
      });
      restoredCount++;
    } else if (entry.kind === 'STANDARD_OPTION1_OVERRIDES') {
      await db.collegeFeatureOverride.deleteMany({
        where: { college_id: entry.id, createdBy: ACTOR_ID },
      });
      restoredCount++;
    }
  }

  return { rolledBack: true, restoredColleges: restoredCount, elapsedHours: Math.round(elapsedHours * 100) / 100 };
}

if (require.main === module) {
  const isRollback = process.argv.includes('--rollback');
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const snapIdx = process.argv.indexOf('--snapshot');
  const snapshotFile = snapIdx !== -1 ? process.argv[snapIdx + 1] : '';

  const runner = isRollback
    ? rollbackThreePlanMigration({ snapshotFile, force })
    : migrateToThreePlans({ dryRun: !apply });

  runner
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate_to_three_plans] Error:', err);
      process.exit(1);
    });
}

module.exports = {
  ENTERPRISE_GRANDFATHER_QUOTAS,
  MOVED_STANDARD_LIVE_KEYS,
  computeGrandfatherWindow,
  migrateToThreePlans,
  rollbackThreePlanMigration,
};
