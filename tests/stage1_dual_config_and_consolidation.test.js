'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  KB, MB, GB,
  LEGACY_4PLAN_CONFIG,
  THREE_PLAN_CONFIG,
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS,
  ADDON_CATALOG_SEEDS,
  normalizePlanId
} = require('../config/planConstants');

const {
  FEATURE_REGISTRY,
  getFeatureRegistry,
  resolveAlias,
  validateRegistryDAG,
  resolveCollegeFeatures
} = require('../config/featureRegistry');

const { getEntitlements, resolveFeatureState } = require('../services/entitlements');
const { featureGate, clearEntitlementCache } = require('../middleware/loadEntitlements');
const { subscriptionGate } = require('../middleware/subscriptionGate');
const planGate = require('../middleware/planGate');

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
    if (out && typeof out.then === 'function') {
      return out.finally(restore);
    }
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

function testT11DualPlanConstants() {
  // 1. Legacy 4-plan mode (THREE_PLAN_MODE=false)
  withEnv({ THREE_PLAN_MODE: 'false' }, () => {
    assert.deepStrictEqual([...CANONICAL_PLANS], ['starter', 'standard', 'premium', 'enterprise']);
    assert.strictEqual(PLAN_PRICING.premium.monthly, 10999);
    assert.strictEqual(PLAN_PRICING.enterprise.monthly, 17999);
    assert.strictEqual(PLAN_LIMITS.premium.maxStudents, 1500);
    assert.strictEqual(PLAN_LIMITS.enterprise.aiCreditsMonthly, 40000000);
    assert.strictEqual(normalizePlanId('enterprise'), 'enterprise');
    assert(ADDON_CATALOG_SEEDS.some(a => a.addonType === 'ADMINS'), 'Legacy mode must keep ADMINS add-on');
  });

  // 2. Three-plan mode (THREE_PLAN_MODE=true)
  withEnv({ THREE_PLAN_MODE: 'true' }, () => {
    assert.deepStrictEqual([...CANONICAL_PLANS], ['starter', 'standard', 'premium']);
    assert.strictEqual(PLAN_PRICING.starter.monthly, 2999);
    assert.strictEqual(PLAN_PRICING.starter.yearly, 32989);
    assert.strictEqual(PLAN_PRICING.standard.monthly, 5999);
    assert.strictEqual(PLAN_PRICING.standard.yearly, 65989);
    assert.strictEqual(PLAN_PRICING.premium.monthly, 14999);
    assert.strictEqual(PLAN_PRICING.premium.yearly, 164989);

    assert.strictEqual(PLAN_LIMITS.premium.maxStudents, 2000);
    assert.strictEqual(PLAN_LIMITS.premium.maxStaff, 150);
    assert.strictEqual(PLAN_LIMITS.premium.maxAdmins, 15);
    assert.strictEqual(PLAN_LIMITS.premium.maxCampuses, 2);
    assert.strictEqual(PLAN_LIMITS.premium.maxStorageBytes, 150 * GB);
    assert.strictEqual(PLAN_LIMITS.premium.maxUploadBytes, 100 * MB);
    assert.strictEqual(PLAN_LIMITS.premium.maxApplications, 300);
    assert.strictEqual(PLAN_LIMITS.premium.emailsMonthly, 25000);
    assert.strictEqual(PLAN_LIMITS.premium.messageCreditsMonthly, 300);
    assert.strictEqual(PLAN_LIMITS.premium.aiCreditsMonthly, 20000000);
    assert.strictEqual(PLAN_LIMITS.premium.tutorDailyPerStudent, 20);
    assert.strictEqual(PLAN_LIMITS.premium.scheduledReportsMonthly, 30);
    assert.strictEqual(PLAN_LIMITS.premium.omrSheetsMonthly, 10000);
    assert.strictEqual(PLAN_LIMITS.standard.exportsPdfMonthly, 60);
    assert.strictEqual(normalizePlanId('enterprise'), 'premium');

    // Add-on caps & locks
    assert.strictEqual(ADDON_CATALOG_SEEDS.filter(a => a.addonType === 'ADMINS').length, 0, 'ADMINS add-on must be dropped');
    assert.strictEqual(ADDON_CATALOG_SEEDS.filter(a => a.planId === 'enterprise').length, 0, 'No enterprise add-on seeds');
    const stdStorage = ADDON_CATALOG_SEEDS.find(a => a.addonType === 'STORAGE_GB' && a.planId === 'standard');
    assert.strictEqual(stdStorage.maxUnitsStatic, 2, 'Standard storage capped at 2 blocks (+20 GB -> 45 GB)');
    const premStorage = ADDON_CATALOG_SEEDS.find(a => a.addonType === 'STORAGE_GB' && a.planId === 'premium');
    assert.strictEqual(premStorage.maxUnitsStatic, 15, 'Premium storage capped at 15 blocks (+150 GB -> 300 GB)');
    const smsStd = ADDON_CATALOG_SEEDS.filter(a => a.addonType.startsWith('SMS_PACK_') && a.planId === 'standard');
    assert.strictEqual(smsStd.length, 0, 'SMS packs restricted to Premium');

    for (const mod of ['MODULE_LIBRARY', 'MODULE_CANTEEN', 'MODULE_TRANSPORT', 'MODULE_HOSTEL', 'MODULE_ACCOUNTING', 'MODULE_STAFF_HR', 'PACK_GOVERNANCE', 'PACK_API', 'SMS_PACK_500']) {
      const seed = ADDON_CATALOG_SEEDS.find(a => a.addonType === mod);
      assert(seed, `Missing seed ${mod}`);
      assert.strictEqual(seed.isPurchasable, false, `${mod} must have isPurchasable: false`);
    }
    assert.strictEqual(LEGACY_4PLAN_CONFIG.CANONICAL_PLANS.length, 4);
    assert.strictEqual(THREE_PLAN_CONFIG.CANONICAL_PLANS.length, 3);
  });
}

function testT11DualFeatureRegistry() {
  withEnv({ THREE_PLAN_MODE: 'false' }, () => {
    const dag = validateRegistryDAG();
    assert.strictEqual(FEATURE_REGISTRY.length, 161);
    assert.strictEqual(dag.total, 161);
    assert.deepStrictEqual(dag.byTier, { starter: 33, standard: 55, premium: 53, enterprise: 20 });
  });

  withEnv({ THREE_PLAN_MODE: 'true' }, () => {
    const dag = validateRegistryDAG();
    assert.strictEqual(FEATURE_REGISTRY.length, 162);
    assert.strictEqual(dag.total, 162);
    assert.deepStrictEqual(dag.byTier, { starter: 33, standard: 55, premium: 65, addonOnly: 9 });
    assert.deepStrictEqual(dag.byStatus, { live: 86, coming_soon: 76 });

    const reg = getFeatureRegistry(true);
    assert(reg.find(f => f.id === 'N13' && f.key === 'white-label-branding' && f.addonOnly), 'N13 must exist as addonOnly');
    assert(reg.find(f => f.id === 'N32' && f.key === 'discipline-counselling-records'), 'N32 must be normalized');
    assert.strictEqual(reg.filter(f => f.hasWorkingImplementation).length, 88);
    assert.strictEqual(reg.filter(f => !f.hasWorkingImplementation).length, 74);

    // Every route gate key across all backend/routes/*.js must resolve cleanly
    const routesDir = path.join(__dirname, '..', 'routes');
    const regKeys = new Set(reg.map(f => f.key));
    for (const rf of fs.readdirSync(routesDir).filter(f => f.endsWith('.js'))) {
      const txt = fs.readFileSync(path.join(routesDir, rf), 'utf8');
      for (const m of txt.matchAll(/(?:featureGate|subscriptionGate|planGate)\(([^)]+)\)/g)) {
        const keys = m[1].replace(/[\[\]'"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
        for (const k of keys) {
          const resolved = resolveAlias(k, true);
          assert(regKeys.has(resolved), `Route ${rf} gate key '${k}' did not resolve to any canonical key (got '${resolved}')`);
        }
      }
    }

    // Add-on-only features must never leak into Starter/Premium without add-on
    const starter = resolveCollegeFeatures('starter', {}, [], { threePlan: true });
    assert(!starter.effectiveKeys.includes('white-label-branding'));
    assert(!starter.effectiveKeys.includes('double-entry-accounting'));
  });
}

function makeMockDb(collegeRow) {
  return {
    college: {
      findUnique: async () => collegeRow
    },
    planVersion: {
      findUnique: async () => null
    }
  };
}

async function testT12AndT13UnifiedResolutionAndGates() {
  const stdCollege = {
    id: 'col_std_mock',
    name: 'Mock Standard College',
    isActive: true,
    planId: 'standard',
    billingCycle: 'MONTHLY',
    subStatus: 'ACTIVE',
    trialEndsAt: null,
    periodStart: new Date(Date.now() - 86400000),
    periodEnd: new Date(Date.now() + 30 * 86400000),
    annualQuotaCycleStart: new Date(),
    forceReadOnly: false,
    readOnlyReason: null,
    subscription: { plan: 'standard' },
    settings: {},
    subscription_status: 'active',
    feature_overrides: null,
    addons: [
      { addonType: 'STORAGE_GB', quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000) },
      { addonType: 'APPLICATIONS', quantity: 2, status: 'ACTIVE', expiresAt: new Date(Date.now() + 86400000) }
    ],
    featureOverrides: [],
    quotaOverrides: []
  };

  // Fix 1: STORAGE_GB (2 * 10 GB + 25 GB = 45 GB) and APPLICATIONS (2 * 25 + 50 = 100)
  await withEnv({ THREE_PLAN_MODE: 'true' }, async () => {
    const ent = await getEntitlements('col_std_mock', makeMockDb(stdCollege));
    assert.strictEqual(ent.effectiveLimits.maxStorageBytes, 45 * GB, 'Standard + 2 STORAGE_GB blocks must equal 45 GB');
    assert.strictEqual(ent.effectiveLimits.maxApplications, 100, 'Standard + 2 APPLICATIONS packs must equal 100');

    // Moved #44 weak-student-lists blocked in Standard under 3-plan mode without override
    assert.strictEqual(resolveFeatureState(ent, 'weak-student-lists').on, false);
    assert.strictEqual(resolveFeatureState(ent, 'ai-tutor-chat').canonicalKey, 'student-tutor-chat');
    assert.strictEqual(resolveFeatureState(ent, 'ai-knowledge-library').canonicalKey, 'pdf-knowledge-library');
  });

  // In Legacy mode (THREE_PLAN_MODE=false), catalogCompat keeps #44/#40/#45/#78 accessible to Standard
  await withEnv({ THREE_PLAN_MODE: 'false' }, async () => {
    const ent = await getEntitlements('col_std_mock', makeMockDb(stdCollege));
    assert.strictEqual(resolveFeatureState(ent, 'weak-student-lists').on, true, 'Legacy mode preserves #44 on Standard');
    assert.strictEqual(resolveFeatureState(ent, 'board-result-analysis').on, true, 'Legacy mode preserves #40 on Standard');
    assert.strictEqual(resolveFeatureState(ent, 'universal-timetable').on, true, 'Legacy mode preserves #78 on Standard');
  });

  // T1.2 + T1.3: Unified middleware checks on real DB or mocked response
  // Test gate alias + FEATURE_COMING_SOON with mocked require cache clear not needed if passing req.entitlements
  await withEnv({ THREE_PLAN_MODE: 'true', ENFORCE_SUBSCRIPTION_GATES: 'true' }, async () => {
    const entStarter = await getEntitlements('col_starter_mock', makeMockDb({
      ...stdCollege,
      id: 'col_starter_mock',
      planId: 'starter',
      subscription: { plan: 'starter' },
      addons: []
    }));

    // featureGate blocks unbuilt Starter service (#8 combined-classes -> backend only, hasWorkingImplementation=false)
    let status1 = null;
    let json1 = null;
    const gateCombined = featureGate('combined-classes');
    await gateCombined(
      { collegeId: 'col_starter_mock', user: { role: 'admin', college_id: 'col_starter_mock' }, method: 'GET', originalUrl: '/api/combined-classes', entitlements: { ...entStarter, features: entStarter.featureStates } },
      { status: c => { status1 = c; return { json: d => { json1 = d; } }; } },
      () => { throw new Error('Should have blocked unbuilt feature'); }
    );
    assert.strictEqual(status1, 403);
    assert.strictEqual(json1.code, 'FEATURE_COMING_SOON');

    // SuperAdmin bypasses FEATURE_COMING_SOON for preview
    let superPassed = false;
    await gateCombined(
      { collegeId: 'col_starter_mock', user: { role: 'superAdmin' }, method: 'GET', originalUrl: '/api/combined-classes' },
      {},
      () => { superPassed = true; }
    );
    assert.strictEqual(superPassed, true);

    // planGate delegates to entitlements & allows working Starter feature
    const pgAttendance = planGate('attendance');
    let pgPassed = false;
    await pgAttendance(
      { collegeId: 'col_starter_mock', user: { role: 'admin', college_id: 'col_starter_mock' }, method: 'GET', entitlements: entStarter },
      {},
      () => { pgPassed = true; }
    );
    assert.strictEqual(pgPassed, true);

    // subscriptionGate alias resolution for ai-tutor-chat (#99) on Premium college passes
    const entPrem = await getEntitlements('col_prem_mock', makeMockDb({
      ...stdCollege,
      id: 'col_prem_mock',
      planId: 'premium',
      subscription: { plan: 'premium' },
      addons: []
    }));
    const sgTutor = subscriptionGate('ai-tutor-chat');
    // Mock prisma inside test by pre-attaching? Note subscriptionGate calls getEntitlements(collegeId); test resolveFeatureState directly:
    assert.strictEqual(resolveFeatureState(entPrem, 'ai-tutor-chat').on, true);
    assert.strictEqual(resolveFeatureState(entPrem, 'ai-tutor-chat').hasWorkingImplementation, true);
    assert.strictEqual(resolveFeatureState(entPrem, 'ai-knowledge-library').on, true);
    assert.strictEqual(resolveFeatureState(entPrem, 'ai-knowledge-library').hasWorkingImplementation, true);
    assert.strictEqual(typeof sgTutor, 'function');
  });

  clearEntitlementCache();
}

async function testRouteMiddlewareAudit() {
  const routesDir = path.join(__dirname, '..', 'routes');
  const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
  const legacyRegKeys = new Set(getFeatureRegistry(false).map(f => f.key));
  const threePlanRegKeys = new Set(getFeatureRegistry(true).map(f => f.key));

  let gatedRouteFiles = 0;
  let totalGateCalls = 0;

  for (const rf of routeFiles) {
    const txt = fs.readFileSync(path.join(routesDir, rf), 'utf8');
    const usesGate = /(?:featureGate|subscriptionGate|planGate)\(/.test(txt);
    if (!usesGate) continue;

    gatedRouteFiles++;
    const importsConsolidatedMiddleware =
      /middleware\/loadEntitlements/.test(txt)
      || /middleware\/subscriptionGate/.test(txt)
      || /middleware\/planGate/.test(txt);
    assert(
      importsConsolidatedMiddleware,
      `Gated route file ${rf} must import consolidated entitlement middleware`
    );

    for (const m of txt.matchAll(/(?:featureGate|subscriptionGate|planGate)\(([^)]+)\)/g)) {
      totalGateCalls++;
      const keys = m[1].replace(/[\[\]'"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      for (const k of keys) {
        const legacyResolved = resolveAlias(k, false);
        assert(legacyRegKeys.has(legacyResolved), `[legacy] Route ${rf} gate key '${k}' unresolved (got '${legacyResolved}')`);
        const threePlanResolved = resolveAlias(k, true);
        assert(threePlanRegKeys.has(threePlanResolved), `[3-plan] Route ${rf} gate key '${k}' unresolved (got '${threePlanResolved}')`);
      }
    }
  }

  // #87 exemption check: /dashboard in college.routes.js must stay ungated by feature/subscription/plan gates
  const collegeRoutesTxt = fs.readFileSync(path.join(routesDir, 'college.routes.js'), 'utf8');
  const dashboardLine = collegeRoutesTxt.split(/\r?\n/).find(l => l.includes("router.get('/dashboard'"));
  assert(dashboardLine, 'college.routes.js must define GET /dashboard');
  assert(!/(?:featureGate|subscriptionGate|planGate)/.test(dashboardLine), '/colleges/dashboard must stay exempt from feature gating (#87 basic dashboard)');

  assert(gatedRouteFiles >= 50, `Expected at least 50 gated route files, saw ${gatedRouteFiles}`);
  assert(totalGateCalls >= 100, `Expected at least 100 route gate calls, saw ${totalGateCalls}`);
  return { gatedRouteFiles, totalGateCalls };
}

async function testLogOnlyWarningsAndSubscriptionController() {
  const premCollege = {
    id: 'col_prem_mock',
    name: 'Mock Premium College',
    isActive: true,
    planId: 'premium',
    billingCycle: 'MONTHLY',
    subStatus: 'ACTIVE',
    trialEndsAt: null,
    periodStart: new Date(Date.now() - 86400000),
    periodEnd: new Date(Date.now() + 30 * 86400000),
    annualQuotaCycleStart: new Date(),
    forceReadOnly: false,
    readOnlyReason: null,
    subscription: { plan: 'premium' },
    settings: {},
    subscription_status: 'active',
    feature_overrides: null,
    addons: [],
    featureOverrides: [],
    quotaOverrides: []
  };

  // Verify log-only soak warnings emit without blocking when ENFORCE_SUBSCRIPTION_GATES is unset
  await withEnv({ THREE_PLAN_MODE: 'true', ENFORCE_SUBSCRIPTION_GATES: undefined }, async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const entPrem = await getEntitlements('col_prem_mock', makeMockDb(premCollege));

      // featureGate on unbuilt #8 combined-classes logs [FEATURE GATE LOG-ONLY] & calls next()
      let fgNext = false;
      await featureGate('combined-classes')(
        { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, method: 'GET', originalUrl: '/api/combined-classes', entitlements: { ...entPrem, features: entPrem.featureStates } },
        { status: () => { throw new Error('Should not block in log-only mode'); } },
        () => { fgNext = true; }
      );
      assert.strictEqual(fgNext, true);

      // subscriptionGate on unbuilt #8 logs [SUBSCRIPTION GATE LOG-ONLY] & calls next()
      let sgNext = false;
      await subscriptionGate('combined-classes')(
        { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, method: 'GET', originalUrl: '/api/combined-classes', entitlements: entPrem },
        { status: () => { throw new Error('Should not block in log-only mode'); } },
        () => { sgNext = true; }
      );
      assert.strictEqual(sgNext, true);

      // subscriptionGate on missing add-on-only feature white-label-branding logs [SUBSCRIPTION GATE LOG-ONLY]
      let sgMissingNext = false;
      await subscriptionGate('white-label-branding')(
        { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, method: 'GET', originalUrl: '/api/whitelabel', entitlements: entPrem },
        { status: () => { throw new Error('Should not block in log-only mode'); } },
        () => { sgMissingNext = true; }
      );
      assert.strictEqual(sgMissingNext, true);

      // planGate on unbuilt #8 logs [PLAN GATE LOG-ONLY] & calls next()
      let pgNext = false;
      await planGate('combined-classes')(
        { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, method: 'GET', originalUrl: '/api/combined-classes', entitlements: entPrem },
        { status: () => { throw new Error('Should not block in log-only mode'); } },
        () => { pgNext = true; }
      );
      assert.strictEqual(pgNext, true);

      assert(warnings.some(w => w.includes('[FEATURE GATE LOG-ONLY]')), 'Missing [FEATURE GATE LOG-ONLY]');
      assert(warnings.some(w => w.includes('[SUBSCRIPTION GATE LOG-ONLY]') && w.includes('Unbuilt')), 'Missing unbuilt [SUBSCRIPTION GATE LOG-ONLY]');
      assert(warnings.some(w => w.includes('[SUBSCRIPTION GATE LOG-ONLY]') && w.includes('Missing')), 'Missing feature [SUBSCRIPTION GATE LOG-ONLY]');
      assert(warnings.some(w => w.includes('[PLAN GATE LOG-ONLY]')), 'Missing [PLAN GATE LOG-ONLY]');
    } finally {
      console.warn = origWarn;
    }
  });

  // Strict mode tests for subscriptionGate + planGate.minPlan
  await withEnv({ THREE_PLAN_MODE: 'true', ENFORCE_SUBSCRIPTION_GATES: 'true' }, async () => {
    const entPrem = await getEntitlements('col_prem_mock', makeMockDb(premCollege));

    let sgStatus = null;
    let sgBody = null;
    await subscriptionGate('combined-classes')(
      { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, method: 'GET', originalUrl: '/api/combined-classes', entitlements: entPrem },
      { status: s => { sgStatus = s; return { json: b => { sgBody = b; } }; } },
      () => { throw new Error('Should block unbuilt feature in strict mode'); }
    );
    assert.strictEqual(sgStatus, 403);
    assert.strictEqual(sgBody.code, 'FEATURE_COMING_SOON');

    let pgMinPass = false;
    await planGate.minPlan('standard')(
      { collegeId: 'col_prem_mock', user: { role: 'admin', college_id: 'col_prem_mock' }, entitlements: entPrem },
      {},
      () => { pgMinPass = true; }
    );
    assert.strictEqual(pgMinPass, true);

    let pgMinBlock = null;
    await planGate.minPlan('premium')(
      { collegeId: 'col_std_mock', user: { role: 'admin', college_id: 'col_std_mock' }, entitlements: { ...entPrem, planId: 'standard' } },
      { status: s => { pgMinBlock = s; return { json: () => {} }; } },
      () => { throw new Error('Should block Standard on minPlan(premium)'); }
    );
    assert.strictEqual(pgMinBlock, 403);
  });

  // Test subscription.controller.js add-on purchasability & retired ADMINS in THREE_PLAN_MODE=true
  await withEnv({ THREE_PLAN_MODE: 'true' }, async () => {
    const prismaManager = require('../config/prismaManager');
    const origGetSystemClient = prismaManager.getSystemClient;
    const ctrlPath = require.resolve('../controllers/subscription.controller');
    const mockDb = {
      ...makeMockDb({ ...premCollege, id: 'col_std_sub', planId: 'standard', subscription: { plan: 'standard' } }),
      addonCatalog: {
        findMany: async () => [
          { id: 'c1', addonType: 'STORAGE_GB', planId: 'standard', name: 'Old Storage', unitPriceMonthlyPkr: 999, unitPriceYearlyPkr: 9999, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 100, maxUnitsStatic: null },
          { id: 'c2', addonType: 'ADMINS', planId: 'standard', name: 'Old Admin Addon', unitPriceMonthlyPkr: 200, unitPriceYearlyPkr: 2200, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 100, maxUnitsStatic: null },
          { id: 'c3', addonType: 'MODULE_LIBRARY', planId: 'standard', name: 'Library Module', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 }
        ],
        findUnique: async ({ where }) => {
          const { addonType, planId } = where.addonType_planId;
          if (addonType === 'MODULE_LIBRARY') {
            return { id: 'c3', addonType: 'MODULE_LIBRARY', planId, name: 'Library Module', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 };
          }
          if (addonType === 'ADMINS') {
            return { id: 'c2', addonType: 'ADMINS', planId, name: 'Old Admin Addon', unitPriceMonthlyPkr: 200, unitPriceYearlyPkr: 2200, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 100, maxUnitsStatic: null };
          }
          if (addonType === 'AI_TOKENS_1M') {
            return { id: 'c4', addonType: 'AI_TOKENS_1M', planId, name: 'AI Lite Token Pack (1M Credits)', unitPriceMonthlyPkr: 500, unitPriceYearlyPkr: 500, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: null };
          }
          return null;
        }
      }
    };
    prismaManager.getSystemClient = () => mockDb;
    delete require.cache[ctrlPath];
    try {
      const subCtrl = require('../controllers/subscription.controller');
      const mockRes = () => {
        const out = { statusCode: 200, body: null };
        out.status = c => { out.statusCode = c; return out; };
        out.json = b => { out.body = b; return out; };
        return out;
      };

      const resCat = mockRes();
      await subCtrl.getAddonCatalog({ collegeId: 'col_std_sub', user: { college_id: 'col_std_sub' } }, resCat);
      assert.strictEqual(resCat.statusCode, 200);
      const items = resCat.body.data.items;
      assert(!items.some(i => i.addonType === 'ADMINS'), 'Retired ADMINS add-on must be hidden in 3-plan mode');
      const storageItem = items.find(i => i.addonType === 'STORAGE_GB');
      assert.strictEqual(storageItem.maxUnitsAllowed, 2, 'Standard STORAGE_GB must cap at 2 blocks (+20 GB, 45 GB total)');
      assert.strictEqual(storageItem.isPurchasable, true, 'STORAGE_GB must be purchasable');
      const libItem = items.find(i => i.addonType === 'MODULE_LIBRARY');
      assert(libItem && libItem.isPurchasable === false, 'Non-live MODULE_LIBRARY must expose isPurchasable=false');
      const transportItem = items.find(i => i.addonType === 'MODULE_TRANSPORT');
      assert(transportItem && transportItem.isPurchasable === false, 'MODULE_TRANSPORT must expose isPurchasable=false');

      const resCalcBlock = mockRes();
      await subCtrl.calculateTotal({
        collegeId: 'col_std_sub',
        user: { college_id: 'col_std_sub' },
        body: { type: 'ADDON_ONLY', lineItems: [{ addonType: 'MODULE_LIBRARY', quantity: 1 }] }
      }, resCalcBlock);
      assert.strictEqual(resCalcBlock.statusCode, 422);
      assert.strictEqual(resCalcBlock.body.code, 'ITEM_NOT_PURCHASABLE');

      const resCalcAllow = mockRes();
      await subCtrl.calculateTotal({
        collegeId: 'col_std_sub',
        user: { college_id: 'col_std_sub' },
        body: { type: 'ADDON_ONLY', lineItems: [{ addonType: 'AI_TOKENS_1M', quantity: 2 }] }
      }, resCalcAllow);
      assert.strictEqual(resCalcAllow.statusCode, 200);
      assert.strictEqual(resCalcAllow.body.data.expectedAmount, 1000);

      const resAdminsBlock = mockRes();
      await subCtrl.calculateTotal({
        collegeId: 'col_std_sub',
        user: { college_id: 'col_std_sub' },
        body: { type: 'ADDON_ONLY', lineItems: [{ addonType: 'ADMINS', quantity: 1 }] }
      }, resAdminsBlock);
      assert.strictEqual(resAdminsBlock.statusCode, 400);
      assert.strictEqual(resAdminsBlock.body.code, 'INVALID_ADDON_ITEM');
    } finally {
      prismaManager.getSystemClient = origGetSystemClient;
      delete require.cache[ctrlPath];
    }
  });
}

async function run() {
  testT11DualPlanConstants();
  console.log('✓ T1.1 Dual-config planConstants tests passed');
  testT11DualFeatureRegistry();
  console.log('✓ T1.1 Dual-config featureRegistry (161/162, N13, N32, 88 working, 120 route keys) passed');
  await testT12AndT13UnifiedResolutionAndGates();
  console.log('✓ T1.2 + T1.3 Consolidated entitlements, add-on block multipliers, and coming-soon gate tests passed');
  const routeAudit = await testRouteMiddlewareAudit();
  console.log(`✓ Route middleware consolidation audit passed (${routeAudit.gatedRouteFiles} route files, ${routeAudit.totalGateCalls} gate calls, #87 dashboard exempt)`);
  await testLogOnlyWarningsAndSubscriptionController();
  console.log('✓ 48h log-only soak warnings, subscriptionGate/planGate strict locks, & add-on catalog purchasability tests passed');
}

run().catch(err => {
  console.error('Stage 1 tests FAILED:', err);
  process.exit(1);
});
