/**
 * run_phase6_migration.js
 * Executes Phase 6 raw SQL operations:
 * 1. PlanVersion v1 creation for all 4 plans (starter, standard, premium, enterprise).
 * 2. Backfill College.planVersionId for all live colleges.
 * 3. Normalize transactionId on CollegeSubscriptionPayment.
 * 4. Create partial unique index on CollegeSubscriptionPayment (status NOT IN ('REJECTED', 'CANCELLED')).
 * 5. CollegeEntitlementAudit column migration & immutability trigger.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getSystemClient } = require('../config/prismaManager');
const { PLAN_LIMITS, PLAN_PRICING, CANONICAL_PLANS } = require('../config/planConstants');

async function run() {
  const prisma = getSystemClient();
  console.log('--- Starting Phase 6 Raw SQL & Seed Migration ---');

  try {
    // 1. Seed PlanVersion v1 for all 4 plans
    console.log('[1/5] Seeding PlanVersion v1...');
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
        console.log(`  -> Created PlanVersion v1 for ${planId}`);
      } else {
        console.log(`  -> PlanVersion v1 for ${planId} already exists`);
      }
    }

    // 2. Pin College.planVersionId for all colleges
    console.log('[2/5] Pinning College.planVersionId to PlanVersion v1...');
    const colleges = await prisma.college.findMany({
      select: { id: true, planId: true, planVersionId: true }
    });

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
          console.log(`  -> Pinned college ${col.id} (${col.planId}) to PlanVersion ${pv.id}`);
        }
      }
    }

    // 3. Normalize transactionId on CollegeSubscriptionPayment
    console.log('[3/5] Normalizing CollegeSubscriptionPayment.transactionId...');
    await prisma.$executeRawUnsafe(`
      UPDATE "CollegeSubscriptionPayment"
      SET "transactionId" = REGEXP_REPLACE(UPPER(TRIM("transactionId")), '[^A-Z0-9]', '', 'g')
      WHERE "transactionId" IS NOT NULL;
    `);

    // 4. Drop old index if exists and create partial unique index
    console.log('[4/5] Creating partial unique index on CollegeSubscriptionPayment...');
    await prisma.$executeRawUnsafe(`
      DROP INDEX IF EXISTS "CollegeSubscriptionPayment_paymentMethod_transactionId_key";
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "csp_method_txid_active_unq"
      ON "CollegeSubscriptionPayment" ("paymentMethod", "transactionId")
      WHERE "status" NOT IN ('REJECTED', 'CANCELLED');
    `);
    console.log('  -> Partial unique index csp_method_txid_active_unq ensured.');

    // 5. Immutability trigger on CollegeEntitlementAudit
    console.log('[5/5] Installing immutability trigger on CollegeEntitlementAudit...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION prevent_audit_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'CollegeEntitlementAudit rows are immutable — no UPDATE or DELETE allowed';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS audit_immutable ON "CollegeEntitlementAudit";
      CREATE TRIGGER audit_immutable
      BEFORE UPDATE OR DELETE OR TRUNCATE ON "CollegeEntitlementAudit"
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
    `);
    console.log('  -> Audit trigger audit_immutable installed.');

    console.log('--- Phase 6 Raw SQL & Seed Migration COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
