'use strict';
const { Client } = require('pg');
require('dotenv').config();

async function runStep0Fixes() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  await c.connect();

  console.log('=== Checking existing indexes on SubscriptionReminderLog ===');
  const idxRes = await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='SubscriptionReminderLog';");
  console.log(idxRes.rows);

  console.log('=== Step 0.1: Fix SubscriptionReminderLog schema ===');
  // 1. Add periodEndDate column if it does not exist
  await c.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='SubscriptionReminderLog' AND column_name='periodEndDate'
      ) THEN
        ALTER TABLE "SubscriptionReminderLog" ADD COLUMN "periodEndDate" DATE;
      END IF;
    END $$;
  `);

  // 2. Backfill periodEndDate for existing rows using sentDate if null
  await c.query(`
    UPDATE "SubscriptionReminderLog"
    SET "periodEndDate" = "sentDate"
    WHERE "periodEndDate" IS NULL;
  `);

  // 3. Drop old unique constraint on (college_id, eventType, sentDate)
  await c.query(`
    ALTER TABLE "SubscriptionReminderLog" 
    DROP CONSTRAINT IF EXISTS "SubscriptionReminderLog_college_id_eventType_sentDate_key" CASCADE;
  `);

  // 4. Create new unique index on (college_id, eventType, periodEndDate)
  await c.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionReminderLog_college_id_eventType_periodEndDate_key"
    ON "SubscriptionReminderLog" ("college_id", "eventType", "periodEndDate");
  `);
  console.log('SubscriptionReminderLog updated successfully.');

  console.log('=== Step 0.2: Fix MealAccountTransaction immutability triggers ===');
  // 1. Create function
  await c.query(`
    CREATE OR REPLACE FUNCTION prevent_meal_txn_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'MealAccountTransaction is append-only: updates, deletions, and truncations are forbidden'
        USING ERRCODE = '55000';
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // 2. Drop any legacy triggers
  await c.query(`
    DROP TRIGGER IF EXISTS trg_meal_txn_immutable ON "MealAccountTransaction";
    DROP TRIGGER IF EXISTS trg_meal_txn_no_truncate ON "MealAccountTransaction";
  `);

  // 3. Create row-level trigger for UPDATE or DELETE
  await c.query(`
    CREATE TRIGGER trg_meal_txn_immutable
    BEFORE UPDATE OR DELETE ON "MealAccountTransaction"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_meal_txn_mutation();
  `);

  // 4. Create statement-level trigger for TRUNCATE
  await c.query(`
    CREATE TRIGGER trg_meal_txn_no_truncate
    BEFORE TRUNCATE ON "MealAccountTransaction"
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_meal_txn_mutation();
  `);
  console.log('MealAccountTransaction triggers created successfully.');

  // Verification
  console.log('\n=== Verification ===');
  const verCols = await c.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='SubscriptionReminderLog';");
  console.log('SubscriptionReminderLog columns:', verCols.rows.map(r => r.column_name));

  const verIdx = await c.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='SubscriptionReminderLog';");
  console.log('SubscriptionReminderLog indexes:', verIdx.rows);

  const verTrig = await c.query(`
    SELECT trigger_name, event_manipulation, action_statement, action_orientation
    FROM information_schema.triggers
    WHERE event_object_table = 'MealAccountTransaction';
  `);
  console.log('MealAccountTransaction triggers:', verTrig.rows);

  await c.end();
  console.log('=== Step 0 DB Fixes Complete ===');
}

runStep0Fixes().catch(err => {
  console.error('Error in step0 fixes:', err);
  process.exit(1);
});
