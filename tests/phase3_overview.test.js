'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getAccountingOverview, getNavCounts, clearOverviewCache } = require('../modules/superAdminFinance/services/overview.service');
const { closeAllClients } = require('../config/prismaManager');

async function runTests() {
  console.log('='.repeat(70));
  console.log('RUNNING PHASE 3: ACCOUNTING OVERVIEW & NAV COUNTS CONTRACT TESTS');
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

  try {
    clearOverviewCache();

    // 1. Navigation Badges (Lightweight counts)
    console.log('\n--- 1. Testing getNavCounts ---');
    const startNav = Date.now();
    const navCountsWithoutTest = await getNavCounts(false);
    const navElapsed = Date.now() - startNav;
    console.log('Nav counts (includeTest=false):', navCountsWithoutTest, `in ${navElapsed}ms`);

    assert('getNavCounts returns valid numbers without test data',
      typeof navCountsWithoutTest.paymentsHistory === 'number' &&
      typeof navCountsWithoutTest.perCollegeBilling === 'number' &&
      typeof navCountsWithoutTest.accountantDetails === 'number' &&
      typeof navCountsWithoutTest.billingQueue === 'number'
    );

    const navCountsWithTest = await getNavCounts(true);
    console.log('Nav counts (includeTest=true):', navCountsWithTest);
    assert('getNavCounts with includeTest=true matches DB totals',
      navCountsWithTest.paymentsHistory === 200 &&
      navCountsWithTest.perCollegeBilling === 641 &&
      navCountsWithTest.accountantDetails === 10
    );

    // 2. Accounting Overview (Live calculation without test data)
    console.log('\n--- 2. Testing getAccountingOverview (includeTest=false) ---');
    const overviewWithoutTest = await getAccountingOverview({ includeTest: false });

    assert('Cards structure is complete',
      overviewWithoutTest.cards &&
      typeof overviewWithoutTest.cards.totalRevenueCollected === 'number' &&
      typeof overviewWithoutTest.cards.pendingAmount === 'number' &&
      overviewWithoutTest.cards.billingQueue &&
      overviewWithoutTest.cards.thisMonthVsLastMonth &&
      overviewWithoutTest.cards.revenueByPlan
    );

    console.log('Cards summary (without test):', {
      totalRevenueCollected: overviewWithoutTest.cards.totalRevenueCollected,
      pendingAmount: overviewWithoutTest.cards.pendingAmount,
      billingQueue: overviewWithoutTest.cards.billingQueue,
      thisMonthVsLastMonth: overviewWithoutTest.cards.thisMonthVsLastMonth
    });

    assert('Test college payments excluded from total revenue by default',
      overviewWithoutTest.cards.totalRevenueCollected < 10000000 // Test colleges had 120M
    );

    // Verify revenueByPlan zero-filling
    const planBreakdown = overviewWithoutTest.cards.revenueByPlan;
    const expectedKeys = ['starter', 'standard', 'premium', 'enterprise', 'addons_credits'];
    assert('revenueByPlan contains all 5 required buckets zero-filled',
      expectedKeys.every(k => k in planBreakdown && typeof planBreakdown[k].amount === 'number' && typeof planBreakdown[k].count === 'number')
    );

    // Verify Charts structure
    assert('revenueTrend contains 6 zero-filled months',
      Array.isArray(overviewWithoutTest.charts.revenueTrend) &&
      overviewWithoutTest.charts.revenueTrend.length === 6 &&
      overviewWithoutTest.charts.revenueTrend.every(m => m.month && typeof m.amount === 'number')
    );

    assert('monthlyComparison contains 31 zero-filled days',
      Array.isArray(overviewWithoutTest.charts.monthlyComparison) &&
      overviewWithoutTest.charts.monthlyComparison.length === 31 &&
      overviewWithoutTest.charts.monthlyComparison.every(d => typeof d.day === 'number' && typeof d.currentMonth === 'number')
    );

    assert('planDistribution contains 5 canonical items',
      Array.isArray(overviewWithoutTest.charts.planDistribution) &&
      overviewWithoutTest.charts.planDistribution.length === 5
    );

    assert('statusDistribution contains APPROVED, PENDING, REJECTED',
      Array.isArray(overviewWithoutTest.charts.statusDistribution) &&
      overviewWithoutTest.charts.statusDistribution.length === 3
    );

    // 3. Accounting Overview with includeTest = true
    console.log('\n--- 3. Testing getAccountingOverview (includeTest=true) ---');
    const overviewWithTest = await getAccountingOverview({ includeTest: true });
    console.log('Cards summary (with test):', {
      totalRevenueCollected: overviewWithTest.cards.totalRevenueCollected,
      pendingAmount: overviewWithTest.cards.pendingAmount,
      billingQueue: overviewWithTest.cards.billingQueue
    });
    assert('includeTest=true includes test revenue (> 100M)',
      overviewWithTest.cards.totalRevenueCollected > 100000000
    );

    // 4. In-memory Cache Performance
    console.log('\n--- 4. Testing In-Memory Cache Performance ---');
    const t0 = Date.now();
    const cachedOverview = await getAccountingOverview({ includeTest: false });
    const cacheElapsed = Date.now() - t0;
    console.log(`Cache hit elapsed time: ${cacheElapsed}ms`);
    assert('Cache hit returns identical data in under 20ms',
      cacheElapsed < 20 &&
      cachedOverview.cards.totalRevenueCollected === overviewWithoutTest.cards.totalRevenueCollected
    );

  } catch (err) {
    console.error('Test execution error:', err);
    failed++;
  } finally {
    await closeAllClients();
  }

  console.log('\n' + '='.repeat(70));
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('='.repeat(70));

  if (failed > 0) process.exit(1);
}

runTests();

