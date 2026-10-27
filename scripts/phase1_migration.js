'use strict';

require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

/**
 * Phase 1 Database Migration & Backfill
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Additive columns to SubscriptionRequest:
 *    - contacted_at: timestamptz
 *    - contacted_by: text
 *    - rejected_at: timestamptz
 *    - rejected_by: text
 *    - rejection_reason: text
 *    - internal_notes: text
 *
 * 2. Backfill existing SubscriptionRequests:
 *    - Ensure status is one of ('new', 'contacted', 'approved', 'rejected')
 *    - Map legacy statuses: 'in_review' -> 'contacted', 'converted' -> 'approved'
 *    - Default any unknown/null to 'new'
 *
 * 3. Create table SubscriptionRequestEvent (id, request_id, type, from_status, to_status, note, actor_id, actor_name, created_at)
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function runPhase1Migration() {
  const prisma = getSystemClient();
  console.log('🚀 [Phase 1 Migration] Starting SubscriptionRequest schema migration...');

  // 1. Detect actual table names
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND lower(table_name) IN ('subscriptionrequest', 'subscription_requests', 'subscription_request');
  `;

  if (!tables || tables.length === 0) {
    throw new Error('SubscriptionRequest table not found in public schema!');
  }

  const reqTableName = tables[0].table_name;
  console.log(`📌 Found SubscriptionRequest table: "${reqTableName}"`);

  // 2. Add columns additively
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "${reqTableName}"
      ADD COLUMN IF NOT EXISTS "contacted_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "contacted_by" text,
      ADD COLUMN IF NOT EXISTS "rejected_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "rejected_by" text,
      ADD COLUMN IF NOT EXISTS "rejection_reason" text,
      ADD COLUMN IF NOT EXISTS "internal_notes" text;
  `);
  console.log('✅ Additive columns verified/added to SubscriptionRequest.');

  // 3. Create SubscriptionRequestEvent table if not exists
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SubscriptionRequestEvent" (
      "id" text PRIMARY KEY,
      "request_id" text NOT NULL REFERENCES "${reqTableName}"("id") ON DELETE CASCADE,
      "type" text NOT NULL,
      "from_status" text,
      "to_status" text,
      "note" text,
      "actor_id" text,
      "actor_name" text,
      "created_at" timestamptz NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS "SubscriptionRequestEvent_request_id_idx" 
      ON "SubscriptionRequestEvent" ("request_id");

    CREATE INDEX IF NOT EXISTS "SubscriptionRequestEvent_created_at_idx" 
      ON "SubscriptionRequestEvent" ("created_at");
  `);
  console.log('✅ SubscriptionRequestEvent table verified/created.');

  // 4. Backfill existing subscription requests
  await prisma.$executeRawUnsafe(`
    UPDATE "${reqTableName}"
    SET "status" = CASE
      WHEN "status" = 'in_review' THEN 'contacted'
      WHEN "status" = 'converted' THEN 'approved'
      WHEN "status" IN ('new', 'contacted', 'approved', 'rejected') THEN "status"
      ELSE 'new'
    END
    WHERE "status" IS NULL OR "status" NOT IN ('new', 'contacted', 'approved', 'rejected');
  `);

  // Add constraint for status
  const constraintCheck = await prisma.$queryRaw`
    SELECT conname 
    FROM pg_constraint 
    WHERE conname = 'subscription_requests_status_check';
  `;

  if (constraintCheck.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "${reqTableName}"
      ADD CONSTRAINT subscription_requests_status_check
      CHECK ("status" IN ('new', 'contacted', 'approved', 'rejected'));
    `);
    console.log('✅ Added subscription_requests_status_check constraint.');
  }

  console.log('🎉 [Phase 1 Migration] SubscriptionRequest schema and events table ready!');
}

async function rollbackPhase1Migration() {
  const prisma = getSystemClient();
  console.log('⚠️ [Phase 1 Rollback] Rolling back SubscriptionRequest schema...');

  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND lower(table_name) IN ('subscriptionrequest', 'subscription_requests', 'subscription_request');
  `;
  if (!tables || tables.length === 0) return;
  const reqTableName = tables[0].table_name;

  await prisma.$executeRawUnsafe(`
    DROP TABLE IF EXISTS "SubscriptionRequestEvent";
    ALTER TABLE "${reqTableName}" DROP CONSTRAINT IF EXISTS subscription_requests_status_check;
    ALTER TABLE "${reqTableName}"
      DROP COLUMN IF EXISTS "contacted_at",
      DROP COLUMN IF EXISTS "contacted_by",
      DROP COLUMN IF EXISTS "rejected_at",
      DROP COLUMN IF EXISTS "rejected_by",
      DROP COLUMN IF EXISTS "rejection_reason",
      DROP COLUMN IF EXISTS "internal_notes";
  `);

  console.log('✅ Rollback complete.');
}

if (require.main === module) {
  const isDown = process.argv.includes('--down');
  const action = isDown ? rollbackPhase1Migration() : runPhase1Migration();

  action
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await closeAllClients();
    });
}

module.exports = {
  runPhase1Migration,
  rollbackPhase1Migration
};
