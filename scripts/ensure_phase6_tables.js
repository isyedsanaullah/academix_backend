const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_LIMITS, PLAN_PRICING, CANONICAL_PLANS } = require('../config/planConstants');

async function ensureSchema() {
  const prisma = getSystemClient();
  console.log('--- Applying Phase 6 DDL Directly to Neon PostgreSQL ---');

  const statements = [
    // 1. New Models
    `CREATE TABLE IF NOT EXISTS "PlanVersion" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "planId" TEXT NOT NULL,
      "version" INTEGER NOT NULL,
      "pricesJson" JSONB NOT NULL,
      "limitsJson" JSONB NOT NULL,
      "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdBy" TEXT NOT NULL,
      CONSTRAINT "PlanVersion_planId_version_key" UNIQUE ("planId", "version")
    );`,
    `CREATE INDEX IF NOT EXISTS "PlanVersion_planId_effectiveFrom_idx" ON "PlanVersion"("planId", "effectiveFrom" DESC);`,

    `CREATE TABLE IF NOT EXISTS "CollegeQuotaOverride" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "metric" TEXT NOT NULL,
      "overrideValue" BIGINT NOT NULL,
      "reason" TEXT NOT NULL,
      "createdBy" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CollegeQuotaOverride_college_id_metric_key" UNIQUE ("college_id", "metric")
    );`,
    `CREATE INDEX IF NOT EXISTS "CollegeQuotaOverride_college_id_idx" ON "CollegeQuotaOverride"("college_id");`,

    `CREATE TABLE IF NOT EXISTS "ReceiptCounter" (
      "year" INTEGER PRIMARY KEY,
      "lastSeq" INTEGER NOT NULL DEFAULT 0
    );`,

    `CREATE TABLE IF NOT EXISTS "OutboxEvent" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "eventType" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastError" TEXT,
      "processedAt" TIMESTAMP(3),
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,
    `CREATE INDEX IF NOT EXISTS "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");`,

    `CREATE TABLE IF NOT EXISTS "SubscriptionReminderLog" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL,
      "eventType" TEXT NOT NULL,
      "sentDate" DATE NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SubscriptionReminderLog_college_id_eventType_sentDate_key" UNIQUE ("college_id", "eventType", "sentDate")
    );`,
    `CREATE INDEX IF NOT EXISTS "SubscriptionReminderLog_college_id_idx" ON "SubscriptionReminderLog"("college_id");`,

    `CREATE TABLE IF NOT EXISTS "UsedStepUpToken" (
      "jti" TEXT PRIMARY KEY,
      "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3) NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS "UsedStepUpToken_expiresAt_idx" ON "UsedStepUpToken"("expiresAt");`,

    // 2. Additive College columns
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "preSuspendStatus" TEXT;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "trialExtensionCount" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "readOnlyReason" TEXT;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "tokenEpoch" INTEGER NOT NULL DEFAULT 0;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "planVersionId" TEXT;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "pendingDowngradePlanId" TEXT;`,
    `ALTER TABLE "College" ADD COLUMN IF NOT EXISTS "pendingDowngradeBillingCycle" TEXT;`,

    // 3. Additive CollegeSubscriptionPayment columns
    `ALTER TABLE "CollegeSubscriptionPayment" ADD COLUMN IF NOT EXISTS "verifiedAmount" INTEGER;`,
    `ALTER TABLE "CollegeSubscriptionPayment" ADD COLUMN IF NOT EXISTS "receiptNumber" TEXT;`,
    `ALTER TABLE "CollegeSubscriptionPayment" ADD COLUMN IF NOT EXISTS "taxAmountPkr" INTEGER;`,
    `ALTER TABLE "CollegeSubscriptionPayment" ADD COLUMN IF NOT EXISTS "isDuplicateSuspected" BOOLEAN NOT NULL DEFAULT FALSE;`,

    // 4. Additive CollegeEntitlementAudit columns
    `ALTER TABLE "CollegeEntitlementAudit" ADD COLUMN IF NOT EXISTS "beforeStateJson" JSONB;`,
    `ALTER TABLE "CollegeEntitlementAudit" ADD COLUMN IF NOT EXISTS "afterStateJson" JSONB;`,
    `ALTER TABLE "CollegeEntitlementAudit" ADD COLUMN IF NOT EXISTS "paymentId" TEXT;`,
    `ALTER TABLE "CollegeEntitlementAudit" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;`,

    // 5. Normalization backfill on transactionId
    `UPDATE "CollegeSubscriptionPayment"
     SET "transactionId" = REGEXP_REPLACE(UPPER(TRIM("transactionId")), '[^A-Z0-9]', '', 'g')
     WHERE "transactionId" IS NOT NULL;`,

    // 6. Partial unique index on CollegeSubscriptionPayment
    `DROP INDEX IF EXISTS "CollegeSubscriptionPayment_paymentMethod_transactionId_key";`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "csp_method_txid_active_unq"
     ON "CollegeSubscriptionPayment" ("paymentMethod", "transactionId")
     WHERE "status" NOT IN ('REJECTED', 'CANCELLED');`
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('SQL statement warning:', e.message);
    }
  }
  console.log('All DDL statements executed.');

  // Now seed PlanVersion v1
  console.log('Seeding PlanVersion v1 for 4 plans...');
  for (const planId of CANONICAL_PLANS) {
    const existing = await prisma.planVersion.findUnique({
      where: { planId_version: { planId, version: 1 } }
    });
    if (!existing) {
      const pricesJson = {
        monthlyPkr: PLAN_PRICING[planId].monthly,
        yearlyPkr: PLAN_PRICING[planId].yearly
      };
      const limitsJson = PLAN_LIMITS[planId];
      await prisma.planVersion.create({
        data: {
          planId,
          version: 1,
          pricesJson,
          limitsJson,
          createdBy: 'SYSTEM_MIGRATION'
        }
      });
      console.log(`  -> PlanVersion v1 created for ${planId}`);
    } else {
      console.log(`  -> PlanVersion v1 exists for ${planId}`);
    }
  }

  // Backfill College.planVersionId
  console.log('Backfilling College.planVersionId...');
  const colleges = await prisma.college.findMany({ select: { id: true, planId: true, planVersionId: true } });
  for (const col of colleges) {
    if (!col.planVersionId) {
      const pv = await prisma.planVersion.findUnique({
        where: { planId_version: { planId: col.planId || 'starter', version: 1 } }
      });
      if (pv) {
        await prisma.college.update({
          where: { id: col.id },
          data: { planVersionId: pv.id }
        });
        console.log(`  -> College ${col.id} pinned to PlanVersion ${pv.id}`);
      }
    }
  }

  console.log('--- Phase 6 DDL & Seed Completed Successfully ---');
  await prisma.$disconnect();
}

ensureSchema().catch(err => {
  console.error('Fatal ensureSchema error:', err);
  process.exit(1);
});

