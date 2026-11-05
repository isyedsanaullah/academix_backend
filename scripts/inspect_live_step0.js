'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function inspectStep0() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('--- 1. Check SubscriptionReminderLog columns and rows ---');
  const srlCols = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='SubscriptionReminderLog';");
  console.log('SubscriptionReminderLog cols:', srlCols.rows);

  const srlRows = await c.query("SELECT * FROM \"SubscriptionReminderLog\";");
  console.log('SubscriptionReminderLog count:', srlRows.rows.length);
  console.log('SubscriptionReminderLog rows:', srlRows.rows);

  console.log('\n--- 2. Check MealAccountTransaction triggers ---');
  const trigs = await c.query(`
    SELECT trigger_name, event_manipulation, action_statement, action_orientation
    FROM information_schema.triggers
    WHERE event_object_table = 'MealAccountTransaction';
  `);
  console.log('MealAccountTransaction triggers:', trigs.rows);

  const func = await c.query(`
    SELECT proname, prosrc FROM pg_proc WHERE proname = 'prevent_meal_txn_mutation';
  `);
  console.log('prevent_meal_txn_mutation function:', func.rows);

  console.log('\n--- 3. Check Grandfathered Colleges ---');
  const colleges = await c.query("SELECT id, name, slug, \"subStatus\", \"planId\", \"periodEnd\", \"createdAt\" FROM \"College\" LIMIT 15;");
  console.log('Colleges in DB:', colleges.rows);

  await c.end();
}

inspectStep0().catch(err => {
  console.error(err);
  process.exit(1);
});

