'use strict';

require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');

/**
 * Phase 3 Database Migration
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Create table "CollegeInvite" (id, college_id, email, token_hash, expires_at, used_at, revoked_at, created_by, created_at, email_status, email_error)
 * 2. Create table "SubscriptionPeriod" (id, college_id, plan, features, starts_at, expires_at, status, amount_note, payment_note, created_by, created_at, reason)
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function runPhase3Migration() {
  const prisma = getSystemClient();
  console.log('🚀 [Phase 3 Migration] Creating CollegeInvite & SubscriptionPeriod tables...');

  // Detect College table name
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND lower(table_name) IN ('college', 'colleges');
  `;
  if (!tables || tables.length === 0) throw new Error('College table not found');
  const collegeTable = tables[0].table_name;

  // 1. CollegeInvite table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CollegeInvite" (
      "id" text PRIMARY KEY,
      "college_id" text NOT NULL REFERENCES "${collegeTable}"("id") ON DELETE CASCADE,
      "email" text NOT NULL,
      "token_hash" text UNIQUE NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "used_at" timestamptz,
      "revoked_at" timestamptz,
      "created_by" text,
      "created_at" timestamptz NOT NULL DEFAULT NOW(),
      "email_status" text NOT NULL DEFAULT 'queued',
      "email_error" text
    );

    CREATE INDEX IF NOT EXISTS "CollegeInvite_college_id_idx" ON "CollegeInvite"("college_id");
    CREATE INDEX IF NOT EXISTS "CollegeInvite_token_hash_idx" ON "CollegeInvite"("token_hash");
    CREATE INDEX IF NOT EXISTS "CollegeInvite_expires_at_idx" ON "CollegeInvite"("expires_at");
  `);
  console.log('✅ CollegeInvite table verified/created.');

  // 2. SubscriptionPeriod table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SubscriptionPeriod" (
      "id" text PRIMARY KEY,
      "college_id" text NOT NULL REFERENCES "${collegeTable}"("id") ON DELETE CASCADE,
      "plan" text NOT NULL,
      "features" jsonb NOT NULL,
      "starts_at" timestamptz NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "status" text NOT NULL DEFAULT 'active',
      "amount_note" text,
      "payment_note" text,
      "created_by" text,
      "created_at" timestamptz NOT NULL DEFAULT NOW(),
      "reason" text
    );

    CREATE INDEX IF NOT EXISTS "SubscriptionPeriod_college_id_idx" ON "SubscriptionPeriod"("college_id");
    CREATE INDEX IF NOT EXISTS "SubscriptionPeriod_status_idx" ON "SubscriptionPeriod"("status");
  `);
  console.log('✅ SubscriptionPeriod table verified/created.');

  console.log('🎉 [Phase 3 Migration] Database schema ready for approval & provisioning!');
}

async function rollbackPhase3Migration() {
  const prisma = getSystemClient();
  console.log('⚠️ [Phase 3 Rollback] Dropping CollegeInvite & SubscriptionPeriod tables...');

  await prisma.$executeRawUnsafe(`
    DROP TABLE IF EXISTS "SubscriptionPeriod";
    DROP TABLE IF EXISTS "CollegeInvite";
  `);
  console.log('✅ Rollback complete.');
}

if (require.main === module) {
  const isDown = process.argv.includes('--down');
  const action = isDown ? rollbackPhase3Migration() : runPhase3Migration();

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
  runPhase3Migration,
  rollbackPhase3Migration
};
