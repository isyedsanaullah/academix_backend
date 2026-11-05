'use strict';
const { Client } = require('pg');
const assert = require('assert');
require('dotenv').config();

async function testMealTxnImmutability() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('Testing MealAccountTransaction immutability triggers...');
  // 1. Get or create a sample transaction
  const acctRes = await c.query('SELECT "student_id", college_id FROM "StudentMealAccount" LIMIT 1;');
  if (acctRes.rows.length === 0) {
    console.log('No StudentMealAccount in DB to test with. Skipping mutation test.');
    await c.end();
    return;
  }
  const acct = acctRes.rows[0];
  const insertRes = await c.query(`
    INSERT INTO "MealAccountTransaction" (id, college_id, student_id, type, "amountPkr", "balanceAfterPkr", "cashierId", "createdAt")
    VALUES (gen_random_uuid(), $1, $2, 'TOPUP', 500, 500, 'system_test', NOW())
    RETURNING id;
  `, [acct.college_id, acct.student_id]);
  const txnId = insertRes.rows[0].id;

  // 2. Test UPDATE fails
  let updateFailed = false;
  try {
    await c.query('UPDATE "MealAccountTransaction" SET "amountPkr" = 999 WHERE id = $1;', [txnId]);
  } catch (err) {
    updateFailed = true;
    assert.strictEqual(err.code, '55000', `Expected error code 55000, got ${err.code}`);
    console.log('UPDATE blocked as expected:', err.message);
  }
  assert.strictEqual(updateFailed, true, 'UPDATE should have failed');

  // 3. Test DELETE fails
  let deleteFailed = false;
  try {
    await c.query('DELETE FROM "MealAccountTransaction" WHERE id = $1;', [txnId]);
  } catch (err) {
    deleteFailed = true;
    assert.strictEqual(err.code, '55000', `Expected error code 55000, got ${err.code}`);
    console.log('DELETE blocked as expected:', err.message);
  }
  assert.strictEqual(deleteFailed, true, 'DELETE should have failed');

  // 4. Test TRUNCATE fails
  let truncateFailed = false;
  try {
    await c.query('TRUNCATE "MealAccountTransaction";');
  } catch (err) {
    truncateFailed = true;
    assert.strictEqual(err.code, '55000', `Expected error code 55000, got ${err.code}`);
    console.log('TRUNCATE blocked as expected:', err.message);
  }
  assert.strictEqual(truncateFailed, true, 'TRUNCATE should have failed');

  console.log('ALL MealAccountTransaction immutability triggers verified successfully!');
  await c.end();
}

testMealTxnImmutability().catch(err => {
  console.error('Trigger test failed:', err);
  process.exit(1);
});
