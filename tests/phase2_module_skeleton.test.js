'use strict';

const path = require('path');
const {
  calcMoM,
  getSettledAmount,
  resolvePlanBucket,
  createZeroFilledPlanBreakdown,
  CANONICAL_PLANS,
  PAYMENT_STATUSES
} = require('../modules/superAdminFinance/definitions');

const {
  validateOverviewQuery,
  validatePaymentsQuery,
  validatePlanChange,
  validateApproval,
  validateRejection
} = require('../modules/superAdminFinance/validators/finance.schemas');

const { buildPaymentWhere } = require('../modules/superAdminFinance/utils/buildPaymentWhere');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 2: MODULE SKELETON CONTRACT TESTS');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  function assert(desc, condition) {
    if (condition) {
      console.log(`[PASS] ${desc}`);
      passed++;
    } else {
      console.error(`[FAIL] ${desc}`);
      failed++;
    }
  }

  // 1. definitions.js: calcMoM
  const momGrowth = calcMoM(150, 100);
  assert('calcMoM standard growth: +50%', momGrowth.percentage === 50 && !momGrowth.isNewBaseline && momGrowth.diff === 50);

  const momDecline = calcMoM(80, 100);
  assert('calcMoM decline: -20%', momDecline.percentage === -20 && !momDecline.isNewBaseline && momDecline.diff === -20);

  const momNew = calcMoM(5000, 0);
  assert('calcMoM new baseline: isNewBaseline=true, percentage=null', momNew.percentage === null && momNew.isNewBaseline === true && momNew.diff === 5000);

  const momZero = calcMoM(0, 0);
  assert('calcMoM zero baseline: percentage=0, isNewBaseline=false', momZero.percentage === 0 && !momZero.isNewBaseline && momZero.diff === 0);

  // 2. definitions.js: getSettledAmount
  const settled1 = getSettledAmount({ status: 'APPROVED', amountPaid: 5000, verifiedAmount: 4800 });
  assert('getSettledAmount uses verifiedAmount when present on APPROVED', settled1 === 4800);

  const settled2 = getSettledAmount({ status: 'APPROVED', amountPaid: 5000, verifiedAmount: null });
  assert('getSettledAmount falls back to amountPaid on APPROVED', settled2 === 5000);

  const settled3 = getSettledAmount({ status: 'PENDING', amountPaid: 5000 });
  assert('getSettledAmount returns 0 for non-APPROVED status', settled3 === 0);

  // 3. definitions.js: resolvePlanBucket
  const bucketAddon = resolvePlanBucket({ type: 'ADDON_ORDER' });
  assert('resolvePlanBucket maps ADDON_ORDER to ADDONS_CREDITS', bucketAddon === 'ADDONS_CREDITS');

  const bucketCredit = resolvePlanBucket({ type: 'CREDIT_ORDER' });
  assert('resolvePlanBucket maps CREDIT_ORDER to ADDONS_CREDITS', bucketCredit === 'ADDONS_CREDITS');

  const bucketPlan = resolvePlanBucket({ type: 'RENEWAL', planId: 'premium' });
  assert('resolvePlanBucket maps RENEWAL to canonical planId', bucketPlan === 'premium');

  const breakdown = createZeroFilledPlanBreakdown();
  assert('createZeroFilledPlanBreakdown contains all canonical tiers and addons_credits',
    ['starter', 'standard', 'premium', 'enterprise', 'addons_credits'].every(k => k in breakdown)
  );

  // 4. validators/finance.schemas.js
  const validChange = validatePlanChange({ targetPlanId: 'premium', reason: 'College upgraded campus capacity' });
  assert('validatePlanChange accepts valid canonical plan and reason', validChange.isValid);

  const invalidChange = validatePlanChange({ targetPlanId: 'gold_super', reason: 'bad' });
  assert('validatePlanChange rejects non-canonical plan and short reason', !invalidChange.isValid && invalidChange.errors.length === 2);

  const validPaymentsQuery = validatePaymentsQuery({
    page: '2',
    limit: '50',
    status: ['pending', 'APPROVED'],
    duplicateOnly: 'true',
    includeTest: '0'
  });
  assert('validatePaymentsQuery parses and coerces integers and enums properly',
    validPaymentsQuery.page === 2 &&
    validPaymentsQuery.limit === 50 &&
    validPaymentsQuery.duplicateOnly === true &&
    validPaymentsQuery.includeTest === false &&
    validPaymentsQuery.status.length === 2
  );

  // 5. utils/buildPaymentWhere.js
  const whereDefault = buildPaymentWhere({ includeTest: false, status: 'APPROVED' });
  assert('buildPaymentWhere isolates test colleges by default',
    whereDefault.AND && whereDefault.AND.some(c => c.college && c.college.isTest === false)
  );

  const whereWithTest = buildPaymentWhere({ includeTest: true, status: 'APPROVED' });
  assert('buildPaymentWhere allows includeTest=true',
    !whereWithTest.AND || !whereWithTest.AND.some(c => c.college && c.college.isTest === false)
  );

  const whereSearch = buildPaymentWhere({ q: 'TX123' });
  assert('buildPaymentWhere constructs OR condition for search query q',
    whereSearch.AND && whereSearch.AND.some(c => Array.isArray(c.OR))
  );

  // 6. Router mounting verification
  try {
    const superAdminRoutes = require('../routes/superAdmin.routes');
    assert('superAdmin.routes.js loads and has routes mounted without error', typeof superAdminRoutes === 'function');
  } catch (err) {
    console.error('Router import error:', err);
    assert('superAdmin.routes.js loads successfully', false);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests();

