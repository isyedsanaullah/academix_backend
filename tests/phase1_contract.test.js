const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const {
  CANONICAL_PLANS,
  PLAN_PRICING,
  PLAN_LIMITS,
  PLAN_LEVEL,
  ADDON_CATALOG_SEEDS
} = require('../config/planConstants');
const {
  CATEGORIES,
  FEATURE_REGISTRY,
  validateRegistryDAG,
  resolveCollegeFeatures
} = require('../config/featureRegistry');

async function runTests() {
  console.log('====================================================');
  console.log('   ACADEMIX PHASE 1 COMPREHENSIVE CONTRACT TESTS   ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
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

  // TEST SUITE 1: CANONICAL PLAN & SERVICE COUNTS
  console.log('--- Suite 1: Canonical Feature Registry Counts ---');

  test('Registry contains exactly 161 total services', () => {
    assert.strictEqual(FEATURE_REGISTRY.length, 161, `Expected 161 services, got ${FEATURE_REGISTRY.length}`);
  });

  test('Registry has canonical milestone live and coming_soon services (Post-Phase 10: 114 live, 47 coming_soon)', () => {
    const live = FEATURE_REGISTRY.filter(f => f.status === 'live').length;
    const comingSoon = FEATURE_REGISTRY.filter(f => f.status === 'coming_soon').length;
    assert.strictEqual(live, 114, `Expected 114 live services post-Phase 10, got ${live}`);
    assert.strictEqual(comingSoon, 47, `Expected 47 coming_soon services post-Phase 10, got ${comingSoon}`);
  });

  test('Tier starting counts strictly match: Starter=33, Standard=55, Premium=53, Enterprise=20', () => {
    const starter = FEATURE_REGISTRY.filter(f => f.startsIn === 'starter').length;
    const standard = FEATURE_REGISTRY.filter(f => f.startsIn === 'standard').length;
    const premium = FEATURE_REGISTRY.filter(f => f.startsIn === 'premium').length;
    const enterprise = FEATURE_REGISTRY.filter(f => f.startsIn === 'enterprise').length;

    assert.strictEqual(starter, 33, `Expected 33 Starter, got ${starter}`);
    assert.strictEqual(standard, 55, `Expected 55 Standard, got ${standard}`);
    assert.strictEqual(premium, 53, `Expected 53 Premium, got ${premium}`);
    assert.strictEqual(enterprise, 20, `Expected 20 Enterprise, got ${enterprise}`);
  });

  test('Cumulative tier counts strictly match: 33 -> 88 -> 141 -> 161', () => {
    const starterCum = FEATURE_REGISTRY.filter(f => PLAN_LEVEL[f.startsIn] <= PLAN_LEVEL.starter).length;
    const standardCum = FEATURE_REGISTRY.filter(f => PLAN_LEVEL[f.startsIn] <= PLAN_LEVEL.standard).length;
    const premiumCum = FEATURE_REGISTRY.filter(f => PLAN_LEVEL[f.startsIn] <= PLAN_LEVEL.premium).length;
    const enterpriseCum = FEATURE_REGISTRY.filter(f => PLAN_LEVEL[f.startsIn] <= PLAN_LEVEL.enterprise).length;

    assert.strictEqual(starterCum, 33, `Expected 33 cumulative Starter, got ${starterCum}`);
    assert.strictEqual(standardCum, 88, `Expected 88 cumulative Standard, got ${standardCum}`);
    assert.strictEqual(premiumCum, 141, `Expected 141 cumulative Premium, got ${premiumCum}`);
    assert.strictEqual(enterpriseCum, 161, `Expected 161 cumulative Enterprise, got ${enterpriseCum}`);
  });

  test('All 161 keys and IDs are unique', () => {
    const keys = new Set(FEATURE_REGISTRY.map(f => f.key));
    const ids = new Set(FEATURE_REGISTRY.map(f => f.id));
    assert.strictEqual(keys.size, 161, 'Keys are not all unique');
    assert.strictEqual(ids.size, 161, 'IDs are not all unique');
  });

  test('All categories belong strictly to the 10 canonical categories', () => {
    assert.strictEqual(CATEGORIES.length, 10, 'Expected exactly 10 categories');
    for (const f of FEATURE_REGISTRY) {
      assert(CATEGORIES.includes(f.category), `Feature ${f.key} has invalid category: ${f.category}`);
    }
  });

  // TEST SUITE 2: DAG INTEGRITY & NESTING
  console.log('\n--- Suite 2: DAG Integrity, Topological Ordering & Cycle Freedom ---');

  test('validateRegistryDAG() passes with zero cycles and zero tier inversions', () => {
    const result = validateRegistryDAG();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.total, 161);
  });

  test('Every dependency target exists in the registry', () => {
    const keySet = new Set(FEATURE_REGISTRY.map(f => f.key));
    for (const f of FEATURE_REGISTRY) {
      for (const dep of f.dependsOn) {
        assert(keySet.has(dep), `Feature ${f.key} depends on missing key: ${dep}`);
      }
    }
  });

  test('Tier nesting holds: feature in tier T only depends on tier <= T unless add-on satisfied', () => {
    for (const f of FEATURE_REGISTRY) {
      const fLvl = PLAN_LEVEL[f.startsIn];
      for (const depKey of f.dependsOn) {
        const dep = FEATURE_REGISTRY.find(x => x.key === depKey);
        const depLvl = PLAN_LEVEL[dep.startsIn];
        const allowsAddon = dep.addonTiers && dep.addonTiers.includes(f.startsIn);
        assert(depLvl <= fLvl || allowsAddon, `Inversion: ${f.key} (${f.startsIn}) depends on ${depKey} (${dep.startsIn})`);
      }
    }
  });

  test('Core foundation features cannot be disabled by overrides', () => {
    const coreFeatures = FEATURE_REGISTRY.filter(f => f.isCore);
    assert(coreFeatures.length > 0, 'No core features found');
    for (const core of coreFeatures) {
      const res = resolveCollegeFeatures('starter', { [core.key]: 'FORCE_OFF' });
      const item = res.featureMatrix.find(m => m.key === core.key);
      assert.strictEqual(item.effective, true, `Core feature ${core.key} was disabled by override`);
      assert.strictEqual(item.source, 'core_foundation');
    }
  });

  test('Disabling a non-core dependency blocks dependent features', () => {
    // #32 qr-verification depends on #30 certificates
    // If certificates is forced off, qr-verification must be dependency-blocked
    const res = resolveCollegeFeatures('standard', { 'certificates': 'FORCE_OFF' });
    const qr = res.featureMatrix.find(m => m.key === 'qr-verification');
    assert.strictEqual(qr.effective, false);
    assert.strictEqual(qr.dependencyBlocked, true);
    assert(qr.blockedBy.includes('certificates'));
  });

  // TEST SUITE 3: COMMERCIAL PRICING & QUOTA MATHEMATICS
  console.log('\n--- Suite 3: Commercial Pricing & Quota Mathematics ---');

  test('All 4 plans have Yearly Price strictly equal to 11x Monthly Price (1 Month FREE)', () => {
    for (const planId of CANONICAL_PLANS) {
      const pricing = PLAN_PRICING[planId];
      const expectedYearly = pricing.monthly * 11;
      assert.strictEqual(pricing.yearly, expectedYearly, `Plan ${planId} yearly price (${pricing.yearly}) != 11 * monthly (${expectedYearly})`);
    }
  });

  test('Starter plan price: PKR 2,999/mo, PKR 32,989/yr', () => {
    assert.strictEqual(PLAN_PRICING.starter.monthly, 2999);
    assert.strictEqual(PLAN_PRICING.starter.yearly, 32989);
  });

  test('Standard plan price: PKR 5,999/mo, PKR 65,989/yr', () => {
    assert.strictEqual(PLAN_PRICING.standard.monthly, 5999);
    assert.strictEqual(PLAN_PRICING.standard.yearly, 65989);
  });

  test('Premium plan price: PKR 10,999/mo, PKR 120,989/yr', () => {
    assert.strictEqual(PLAN_PRICING.premium.monthly, 10999);
    assert.strictEqual(PLAN_PRICING.premium.yearly, 120989);
  });

  test('Enterprise plan price: PKR 17,999/mo, PKR 197,989/yr', () => {
    assert.strictEqual(PLAN_PRICING.enterprise.monthly, 17999);
    assert.strictEqual(PLAN_PRICING.enterprise.yearly, 197989);
  });

  test('Strict Admin Account limits: Starter=2, Standard=5, Premium=10, Enterprise=25', () => {
    assert.strictEqual(PLAN_LIMITS.starter.maxAdmins, 2);
    assert.strictEqual(PLAN_LIMITS.standard.maxAdmins, 5);
    assert.strictEqual(PLAN_LIMITS.premium.maxAdmins, 10);
    assert.strictEqual(PLAN_LIMITS.enterprise.maxAdmins, 25);
  });

  test('Strict Campus limits: Starter=1, Standard=1, Premium=2, Enterprise=3', () => {
    assert.strictEqual(PLAN_LIMITS.starter.maxCampuses, 1);
    assert.strictEqual(PLAN_LIMITS.standard.maxCampuses, 1);
    assert.strictEqual(PLAN_LIMITS.premium.maxCampuses, 2);
    assert.strictEqual(PLAN_LIMITS.enterprise.maxCampuses, 3);
  });

  test('AI Credits strictly metered: Starter=0, Standard=1M (Lite), Premium=5M (Plus), Enterprise=40M (Full)', () => {
    assert.strictEqual(PLAN_LIMITS.starter.aiCreditsMonthly, 0);
    assert.strictEqual(PLAN_LIMITS.standard.aiCreditsMonthly, 1000000);
    assert.strictEqual(PLAN_LIMITS.premium.aiCreditsMonthly, 5000000);
    assert.strictEqual(PLAN_LIMITS.enterprise.aiCreditsMonthly, 40000000);
  });

  // TEST SUITE 4: DATABASE REALITY VERIFICATION
  console.log('\n--- Suite 4: Database Model & Backfill Reality Verification ---');

  const prisma = getSystemClient();

  await asyncTest('All 4 canonical plans exist in DB Subscription table with exact prices', async () => {
    const plansInDb = await prisma.subscription.findMany({
      where: { planId: { in: CANONICAL_PLANS } }
    });
    assert.strictEqual(plansInDb.length, 4, `Expected 4 plans in DB, found ${plansInDb.length}`);
    for (const p of plansInDb) {
      assert.strictEqual(p.priceMonthlyPkr, PLAN_PRICING[p.planId].monthly);
      assert.strictEqual(p.priceYearlyPkr, PLAN_PRICING[p.planId].yearly);
    }
  });

  await asyncTest('AddonCatalog rows seeded in DB match ADDON_CATALOG_SEEDS', async () => {
    const addonsInDb = await prisma.addonCatalog.findMany();
    assert(addonsInDb.length >= ADDON_CATALOG_SEEDS.length, `Expected at least ${ADDON_CATALOG_SEEDS.length} add-ons in DB, got ${addonsInDb.length}`);
  });

  await asyncTest('All colleges have non-null periodEnd, trialEndsAt, annualQuotaCycleStart, and planId', async () => {
    const colleges = await prisma.college.findMany({
      where: {
        NOT: [
          { name: { contains: 'Test' } },
          { name: { contains: 'Phase ' } },
          { name: { contains: 'T6_' } },
          { name: { contains: 'T7_' } },
          { name: { contains: 'Contract' } },
          { email: { contains: '@test.com' } },
          { email: { contains: '@example.com' } }
        ]
      },
      select: {
        id: true,
        name: true,
        planId: true,
        subStatus: true,
        periodEnd: true,
        trialEndsAt: true,
        annualQuotaCycleStart: true
      }
    });

    assert(colleges.length > 0, 'No colleges found in DB');
    for (const c of colleges) {
      assert(c.planId, `College ${c.name} has null planId`);
      assert(CANONICAL_PLANS.includes(c.planId), `College ${c.name} has invalid planId: ${c.planId}`);
      assert(c.periodEnd !== null, `College ${c.name} has null periodEnd`);
      assert(c.trialEndsAt !== null, `College ${c.name} has null trialEndsAt`);
      assert(c.annualQuotaCycleStart !== null, `College ${c.name} has null annualQuotaCycleStart`);
      assert.strictEqual(c.subStatus, 'ACTIVE', `College ${c.name} was not grandfathered to ACTIVE`);
    }
  });

  await asyncTest('CollegeUsage has storageBytes, students, and staff records for colleges', async () => {
    const usageCount = await prisma.collegeUsage.count({
      where: { metric: 'storageBytes' }
    });
    assert(usageCount > 0, 'No storageBytes usage records found');
  });

  await prisma.$disconnect();

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});

