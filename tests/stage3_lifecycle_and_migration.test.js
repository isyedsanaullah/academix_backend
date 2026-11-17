'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withEnv(vars, fn) {
  const backup = {};
  for (const k of Object.keys(vars)) {
    backup[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  const restore = () => {
    for (const k of Object.keys(vars)) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

async function testT31LifecycleAndAdminOptionCAndSchemas() {
  const { validatePlanChange } = require('../modules/superAdminFinance/validators/finance.schemas');
  const { assertAdminSlotAvailable } = require('../services/customRoleService');

  // finance.schemas validates 4 plans when legacy, 3 plans when THREE_PLAN_MODE=true
  withEnv({ THREE_PLAN_MODE: 'false' }, () => {
    assert.strictEqual(validatePlanChange({ targetPlanId: 'enterprise', reason: 'Legacy check' }).isValid, true);
  });
  withEnv({ THREE_PLAN_MODE: 'true' }, () => {
    assert.strictEqual(validatePlanChange({ targetPlanId: 'enterprise', reason: 'Retired check' }).isValid, false);
    assert.strictEqual(validatePlanChange({ targetPlanId: 'premium', reason: 'Valid 3-plan' }).isValid, true);
  });

  // Option (c) admin cap: >15 existing admins on expired grandfathering blocks new admin (429), existing stay operational
  await withEnv({ THREE_PLAN_MODE: 'true' }, async () => {
    const admins18 = Array.from({ length: 18 }, (_, i) => ({ id: `adm-${i}` }));
    const mockDb = {
      user: { findMany: async () => admins18 },
      college: {
        findUnique: async () => ({
          id: 'col_gf_exp',
          isActive: true,
          planId: 'premium',
          subStatus: 'ACTIVE',
          grandfatheredUntil: new Date(Date.now() - 86400000), // Expired yesterday
          subscription: { plan: 'premium' },
          addons: [],
          featureOverrides: [],
          quotaOverrides: [
            { metric: 'maxAdmins', overrideValue: 25n, reason: 'ENTERPRISE_RETIREMENT_GRANDFATHER' }
          ]
        })
      },
      planVersion: { findUnique: async () => null },
      userCustomRole: { findMany: async () => [] }
    };

    let adminCapErr = null;
    try {
      await assertAdminSlotAvailable('col_gf_exp', mockDb);
    } catch (e) {
      adminCapErr = e;
    }
    assert(adminCapErr && adminCapErr.status === 429 && adminCapErr.code === 'QUOTA_EXCEEDED');
    assert.strictEqual(adminCapErr.details.current, 18);
    assert.strictEqual(adminCapErr.details.limit, 15);
    assert.strictEqual(adminCapErr.details.customQuoteRecommended, true);

    // Non-expired grandfathering still honors 25 admin limit
    const activeGfDb = {
      ...mockDb,
      college: {
        findUnique: async () => ({
          id: 'col_gf_act',
          isActive: true,
          planId: 'premium',
          subStatus: 'ACTIVE',
          grandfatheredUntil: new Date(Date.now() + 90 * 86400000),
          subscription: { plan: 'premium' },
          addons: [],
          featureOverrides: [],
          quotaOverrides: [
            { metric: 'maxAdmins', overrideValue: 25n, reason: 'ENTERPRISE_RETIREMENT_GRANDFATHER' }
          ]
        })
      }
    };
    const slotOk = await assertAdminSlotAvailable('col_gf_act', activeGfDb);
    assert.strictEqual(slotOk.maxAdmins, 25);
    assert.strictEqual(slotOk.currentCount, 18);
  });

  // Lifecycle worker: GRANDFATHER_* alerts trigger strictly when grandfatheredUntil != null
  await withEnv({ THREE_PLAN_MODE: 'true' }, async () => {
    const prismaManager = require('../config/prismaManager');
    const origGetSystemClient = prismaManager.getSystemClient;
    const workerPath = require.resolve('../workers/subscriptionLifecycleWorker');
    const createdLogs = [];
    const mockTx = {
      $queryRaw: async () => [{ locked: true }],
      college: {
        findMany: async () => [
          { id: 'c_no_gf', subStatus: 'ACTIVE', grandfatheredUntil: null, periodEnd: new Date(Date.now() + 60 * 86400000) },
          { id: 'c_yes_gf', subStatus: 'ACTIVE', grandfatheredUntil: new Date(Date.now() + 25 * 86400000), periodEnd: new Date(Date.now() + 60 * 86400000) }
        ],
        update: async () => ({})
      },
      subscriptionReminderLog: {
        findMany: async () => [],
        createMany: async ({ data }) => { createdLogs.push(...data); }
      },
      planVersion: { findMany: async () => [] },
      outboxEvent: { createMany: async () => ({}) }
    };
    const mockDb = {
      $transaction: async (fn) => await fn(mockTx)
    };
    prismaManager.getSystemClient = () => mockDb;
    delete require.cache[workerPath];
    try {
      const { runLifecycleWorker } = require('../workers/subscriptionLifecycleWorker');
      const res = await runLifecycleWorker();
      assert.strictEqual(res.processedCount, 2);
      assert(!createdLogs.some(l => l.college_id === 'c_no_gf' && l.eventType.startsWith('GRANDFATHER_')), 'Non-grandfathered college must NEVER receive GRANDFATHER_* alert');
      assert(createdLogs.some(l => l.college_id === 'c_yes_gf' && l.eventType === 'GRANDFATHER_30D'), 'Grandfathered college within 30d must receive GRANDFATHER_30D alert');
    } finally {
      prismaManager.getSystemClient = origGetSystemClient;
      delete require.cache[workerPath];
    }
  });
}

async function testT32MigrationSeederAnd24hRollback() {
  const { seedThreePlanCatalog } = require('../scripts/seed_three_plan_catalog');
  const {
    ENTERPRISE_GRANDFATHER_QUOTAS,
    MOVED_STANDARD_LIVE_KEYS,
    computeGrandfatherWindow,
    migrateToThreePlans,
    rollbackThreePlanMigration
  } = require('../scripts/migrate_to_three_plans');

  assert.strictEqual(Object.keys(ENTERPRISE_GRANDFATHER_QUOTAS).length, 14, 'All 14 Enterprise grandfathering quotas required');
  assert.deepStrictEqual(MOVED_STANDARD_LIVE_KEYS, [
    'pass-percentage-analytics',
    'weak-student-lists',
    'subject-teacher-comparison'
  ]);

  // Seeder dry-run & apply
  const upsertedAddons = [];
  let entDeactivated = false;
  const mockSeedDb = {
    subscription: {
      upsert: async () => ({}),
      updateMany: async ({ where }) => {
        if (where.planId === 'enterprise') entDeactivated = true;
        return { count: 1 };
      }
    },
    planVersion: {
      findFirst: async () => null,
      create: async () => ({})
    },
    addonCatalog: {
      upsert: async ({ where }) => { upsertedAddons.push(where.addonType_planId); return {}; },
      updateMany: async () => ({ count: 4 })
    }
  };
  const seedRes = await seedThreePlanCatalog({ prisma: mockSeedDb, dryRun: false });
  assert.strictEqual(seedRes.subscriptionsUpserted, 3);
  assert.strictEqual(seedRes.planVersionsCreated, 3);
  assert.strictEqual(seedRes.enterpriseDeactivated, true);
  assert.strictEqual(entDeactivated, true);
  assert.strictEqual(upsertedAddons.length, seedRes.addonRowsUpserted);

  // Migration dry-run, apply, idempotency, and 24h rollback
  const now = new Date('2026-11-18T00:00:00.000Z');
  const periodPlus120d = new Date(now.getTime() + 120 * 86400000);
  const state = {
    colleges: [
      { id: 'c_ent_small', planId: 'enterprise', subStatus: 'ACTIVE', periodEnd: new Date(now.getTime() + 30 * 86400000), isCustomQuote: false },
      { id: 'c_ent_2500', planId: 'enterprise', subStatus: 'ACTIVE', periodEnd: periodPlus120d, isCustomQuote: false },
      { id: 'c_ent_4camp', planId: 'enterprise', subStatus: 'ACTIVE', periodEnd: null, isCustomQuote: false },
      { id: 'c_std_1', planId: 'standard', subStatus: 'ACTIVE', periodEnd: new Date(now.getTime() + 20 * 86400000), isCustomQuote: false }
    ],
    quotaOverrides: new Map(),
    featureOverrides: new Map()
  };
  const usageStudents = { c_ent_small: 1800, c_ent_2500: 2500, c_ent_4camp: 2900 };
  const campusCounts = { c_ent_small: 3, c_ent_2500: 2, c_ent_4camp: 4 };

  const makeMigDb = () => ({
    college: {
      findMany: async () => state.colleges.filter(c => c.planId === 'enterprise' || c.planId === 'standard'),
      update: async ({ where, data }) => {
        const c = state.colleges.find(x => x.id === where.id);
        Object.assign(c, data);
        return c;
      }
    },
    planVersion: { findFirst: async () => ({ id: 'pv_prem_v2' }) },
    collegeUsage: {
      findUnique: async ({ where }) => ({ value: BigInt(usageStudents[where.college_id_metric_period.college_id] || 0) })
    },
    campus: {
      count: async ({ where }) => campusCounts[where.college_id] || 1
    },
    collegeQuotaOverride: {
      upsert: async ({ where, create, update }) => {
        const k = `${where.college_id_metric.college_id}:${where.college_id_metric.metric}`;
        state.quotaOverrides.set(k, create || update);
      },
      deleteMany: async ({ where }) => {
        for (const k of Array.from(state.quotaOverrides.keys())) {
          if (k.startsWith(`${where.college_id}:`)) state.quotaOverrides.delete(k);
        }
      }
    },
    collegeFeatureOverride: {
      upsert: async ({ where, create }) => {
        const k = `${where.college_id_featureKey.college_id}:${where.college_id_featureKey.featureKey}`;
        state.featureOverrides.set(k, create);
      },
      deleteMany: async ({ where }) => {
        for (const k of Array.from(state.featureOverrides.keys())) {
          if (k.startsWith(`${where.college_id}:`)) state.featureOverrides.delete(k);
        }
      }
    },
    subscriptionPeriod: { updateMany: async () => ({ count: 1 }) },
    $transaction: async (fn) => await fn(makeMigDb())
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't32-'));
  const db = makeMigDb();

  // Dry run touches nothing
  const dry = await migrateToThreePlans({ prisma: db, dryRun: true, now, snapshotDir: tmpDir });
  assert.strictEqual(dry.enterpriseMigrated, 3);
  assert.strictEqual(dry.standardOption1Protected, 1);
  assert.strictEqual(state.colleges.find(c => c.id === 'c_ent_small').planId, 'enterprise');

  // Apply
  const applied = await migrateToThreePlans({ prisma: db, dryRun: false, now, snapshotDir: tmpDir });
  assert.strictEqual(applied.enterpriseMigrated, 3);
  assert.strictEqual(applied.customQuoteFlagged, 1, 'Only 4+ campuses (or >3,000 students) sets isCustomQuote');
  assert.strictEqual(applied.above2300PricingRiskFlagged, 2, '2,500 and 2,900 student colleges flagged >2,300 pricing review');
  assert.strictEqual(state.colleges.find(c => c.id === 'c_ent_small').planId, 'premium');
  assert.strictEqual(state.colleges.find(c => c.id === 'c_ent_small').subStatus, 'ACTIVE');
  assert.strictEqual(state.colleges.find(c => c.id === 'c_ent_small').isCustomQuote, false, '3 campuses must NOT set isCustomQuote');
  assert.strictEqual(
    state.colleges.find(c => c.id === 'c_ent_2500').grandfatheredUntil.getTime(),
    periodPlus120d.getTime(),
    'grandfatheredUntil must equal max(periodEnd, +90d)'
  );
  assert.strictEqual(state.quotaOverrides.size, 42, '3 enterprise colleges x 14 quota overrides = 42 rows');
  assert.strictEqual(state.featureOverrides.size, 3, '1 standard college x 3 Option 1 overrides (#40/#44/#45)');

  // Past-24h rollback blocked without --force
  let expiredErr = null;
  try {
    await rollbackThreePlanMigration({
      snapshotFile: applied.snapshotFile,
      prisma: db,
      now: new Date(now.getTime() + 25 * 3600 * 1000)
    });
  } catch (e) {
    expiredErr = e;
  }
  assert(expiredErr && expiredErr.code === 'ROLLBACK_WINDOW_EXPIRED');

  // Within-24h rollback restores everything
  const rb = await rollbackThreePlanMigration({
    snapshotFile: applied.snapshotFile,
    prisma: db,
    now: new Date(now.getTime() + 2 * 3600 * 1000)
  });
  assert.strictEqual(rb.rolledBack, true);
  assert.strictEqual(rb.restoredColleges, 4);
  assert.strictEqual(state.colleges.find(c => c.id === 'c_ent_small').planId, 'enterprise');
  assert.strictEqual(state.quotaOverrides.size, 0);
  assert.strictEqual(state.featureOverrides.size, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function run() {
  await testT31LifecycleAndAdminOptionCAndSchemas();
  console.log('✓ T3.1 Finance schemas, Option (c) admin cap, & grandfathering lifecycle worker tests passed');
  await testT32MigrationSeederAnd24hRollback();
  console.log('✓ T3.1 + T3.2 Seeder, Enterprise->Premium migration (14 overrides, 4+ campuses, Option 1, 24h rollback) passed');
}

run().catch(err => {
  console.error('Stage 3 tests FAILED:', err);
  process.exit(1);
});
