// ─── Verification Script: Sub-Phase 10D (N20 Message Credit Wallet) ─────
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const creditWalletService = require('../services/creditWalletService');
const { getMonthlyKey } = require('../config/planConstants');
const { getEntitlements } = require('../services/entitlements');

async function runSubphase10dTests() {
  console.log('\n======================================================');
  console.log('   SUB-PHASE 10D: N20 MESSAGE CREDIT WALLET TESTS     ');
  console.log('======================================================\n');

  const prisma = getSystemClient();
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
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

  const codeP = 'T10D_P_' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const codeS = 'T10D_S_' + Math.random().toString(36).substring(2, 6).toUpperCase();

  const premiumCollege = await prisma.college.create({
    data: {
      name: `10D Premium College ${codeP}`,
      code: codeP,
      email: `${codeP.toLowerCase()}@test.com`,
      planId: 'premium',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  const starterCollege = await prisma.college.create({
    data: {
      name: `10D Starter College ${codeS}`,
      code: codeS,
      email: `${codeS.toLowerCase()}@test.com`,
      planId: 'starter',
      subStatus: 'ACTIVE',
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 86400000)
    }
  });

  try {
    // 1. Gating Check
    await test('1. Tier entitlement: Starter plan lacks message-credit-wallet, Premium has it', async () => {
      const starterEnt = await getEntitlements(starterCollege.id);
      assert.strictEqual(
        starterEnt.features.includes('message-credit-wallet'),
        false,
        'Starter plan must NOT have message-credit-wallet'
      );

      const premiumEnt = await getEntitlements(premiumCollege.id);
      assert.strictEqual(
        premiumEnt.features.includes('message-credit-wallet'),
        true,
        'Premium plan must have message-credit-wallet'
      );
    });

    // 2. Wallet Overview with Dual Buckets
    await test('2. Wallet overview separates PLAN and PURCHASED buckets and disables top-up', async () => {
      const currentPeriodKey = getMonthlyKey(new Date());

      // Seed a PLAN bucket grant (500 credits)
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: premiumCollege.id,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: 500,
          type: 'MONTHLY_GRANT',
          balanceAfter: 500
        }
      });

      // Seed a PURCHASED bucket entry (1000 credits)
      await prisma.messageCreditLedgerEntry.create({
        data: {
          college_id: premiumCollege.id,
          bucket: 'PURCHASED',
          periodKey: null,
          delta: 1000,
          type: 'PURCHASE',
          balanceAfter: 1000
        }
      });

      const overview = await creditWalletService.getWalletOverview(premiumCollege.id);

      assert.strictEqual(overview.balances.plan.balance, 500);
      assert.strictEqual(overview.balances.purchased.balance, 1000);
      assert.strictEqual(overview.balances.total, 1500);
      assert.strictEqual(overview.topUpStatus.isPurchasable, false);
      assert(overview.topUpStatus.notice.includes('SMS and WhatsApp delivery is not active yet'));
      assert.strictEqual(overview.consumption30Days.inAppCreditsBilled, 0);
    });

    // 3. Paged Ledger Query & Filtering
    await test('3. Ledger endpoint supports paged retrieval and bucket filtering', async () => {
      // Query all entries
      const allResult = await creditWalletService.getLedgerEntries(premiumCollege.id, { page: 1, limit: 10 });
      assert(allResult.entries.length >= 2, 'Expected at least 2 entries');
      assert.strictEqual(allResult.pagination.total >= 2, true);

      // Filter by PLAN bucket only
      const planResult = await creditWalletService.getLedgerEntries(premiumCollege.id, {
        page: 1,
        limit: 10,
        bucket: 'PLAN'
      });
      assert(planResult.entries.length >= 1, 'Expected PLAN entry');
      for (const entry of planResult.entries) {
        assert.strictEqual(entry.bucket, 'PLAN');
      }

      // Filter by PURCHASED bucket only
      const purchasedResult = await creditWalletService.getLedgerEntries(premiumCollege.id, {
        page: 1,
        limit: 10,
        bucket: 'PURCHASED'
      });
      assert(purchasedResult.entries.length >= 1, 'Expected PURCHASED entry');
      for (const entry of purchasedResult.entries) {
        assert.strictEqual(entry.bucket, 'PURCHASED');
      }
    });
  } finally {
    // Cleanup
    await prisma.messageCreditLedgerEntry.deleteMany({
      where: { college_id: { in: [premiumCollege.id, starterCollege.id] } }
    }).catch(() => {});
    await prisma.college.deleteMany({
      where: { id: { in: [premiumCollege.id, starterCollege.id] } }
    }).catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`SUB-PHASE 10D TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runSubphase10dTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

