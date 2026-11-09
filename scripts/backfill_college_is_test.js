'use strict';

/**
 * backfill_college_is_test.js
 * Flags test/seeded colleges with isTest = true based on escaped prefixes.
 * Supports --dry-run (default) and --apply flags.
 * Runs modifications inside an atomic transaction.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`=== Backfill College.isTest [Mode: ${isApply ? 'APPLY (LIVE WRITE)' : 'DRY-RUN (READ-ONLY)'}] ===\n`);

  const prisma = getSystemClient();

  try {
    // 1. Query matching colleges with escaped underscores
    const matchingColleges = await prisma.$queryRaw`
      SELECT id, code, name, "planId", "subStatus"
      FROM "College"
      WHERE code ILIKE 'T6\_%' ESCAPE '\'
         OR code ILIKE 'T7\_%' ESCAPE '\'
         OR code ILIKE 'TEST\_%' ESCAPE '\'
         OR name ILIKE 'Phase % Test College%'
      ORDER BY code ASC;
    `;

    console.log(`Found ${matchingColleges.length} colleges matching test criteria.`);

    // 2. Identify the 3 large payments
    const largePayments = await prisma.collegeSubscriptionPayment.findMany({
      where: { verifiedAmount: { gt: 1000000 } },
      select: {
        id: true,
        verifiedAmount: true,
        amountPaid: true,
        transactionId: true,
        college_id: true,
        college: { select: { id: true, code: true, name: true } }
      }
    });

    console.log('\n--- Large Test Payments Audit ---');
    largePayments.forEach((p, idx) => {
      const isMatched = matchingColleges.some((c) => c.id === p.college_id);
      console.log(`  [${idx + 1}] Payment ID: ${p.id}`);
      console.log(`      Verified Amount: PKR ${p.verifiedAmount?.toLocaleString()}`);
      console.log(`      Transaction ID : ${p.transactionId}`);
      console.log(`      College Code   : ${p.college?.code}`);
      console.log(`      College Name   : ${p.college?.name}`);
      console.log(`      Will be Flagged as isTest: ${isMatched ? 'YES' : 'NO'}`);
    });

    if (!isApply) {
      console.log('\n[DRY-RUN COMPLETE] No database changes were made. Pass --apply to execute.');
      return { count: matchingColleges.length, colleges: matchingColleges };
    }

    // 3. Apply inside an atomic transaction
    console.log('\nApplying updates inside atomic transaction...');
    const result = await prisma.$transaction(async (tx) => {
      const updatedCount = await tx.$executeRaw`
        UPDATE "College"
        SET "isTest" = true
        WHERE code ILIKE 'T6\_%' ESCAPE '\'
           OR code ILIKE 'T7\_%' ESCAPE '\'
           OR code ILIKE 'TEST\_%' ESCAPE '\'
           OR name ILIKE 'Phase % Test College%';
      `;
      return updatedCount;
    });

    console.log(`✅ Successfully updated ${result} colleges with isTest = true inside transaction.`);
    return { count: result, colleges: matchingColleges };

  } catch (err) {
    console.error('❌ Error during backfill:', err);
    throw err;
  } finally {
    await closeAllClients();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { main };

