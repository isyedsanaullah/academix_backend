/**
 * ensure_phase7_tables.js — Phase 7 Database Schema Provisioning
 * Creates tables, columns, indexes, and constraints for:
 * - 7A: UploadReservation
 * - 7B: Announcement.dispatchedAt, CircularReadReceipt, status normalization
 * - 7C: TimetableProfile, TimetablePeriod, TimetableEntry, TimetableEntrySection (denormalized unique)
 * - 7D: CanteenItem, CashierShift, CanteenOrder, CanteenOrderItem, CashDrawerTransaction,
 *       StudentMealAccount, MealAccountTransaction, partial unique index, balance >= 0 check
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function migrate() {
  const prisma = getSystemClient();
  console.log('[Phase7 Migration] Starting database schema provisioning...');

  // ---------------------------------------------------------------------------
  // 7A: File Vault & Storage Quotas
  // ---------------------------------------------------------------------------
  console.log('[7A] Provisioning UploadReservation table...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "UploadReservation" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "category" TEXT DEFAULT 'general',
      "originalFilename" TEXT NOT NULL,
      "declaredSizeBytes" BIGINT NOT NULL,
      "storageKey" TEXT NOT NULL UNIQUE,
      "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ur_college_status_expires_idx"
    ON "UploadReservation" ("college_id", "status", "expiresAt");
  `);

  // ---------------------------------------------------------------------------
  // 7B: Circulars & Notices
  // ---------------------------------------------------------------------------
  console.log('[7B] Provisioning Circulars improvements...');
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Announcement"
    ADD COLUMN IF NOT EXISTS "dispatchedAt" TIMESTAMP WITH TIME ZONE;
  `);

  // Status casing normalization
  await prisma.$executeRawUnsafe(`
    UPDATE "Announcement"
    SET status = 'DRAFT'
    WHERE status IS NULL OR status = '';
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "Announcement"
    SET status = UPPER(status)
    WHERE status IS NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CircularReadReceipt" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "circularId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "readAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "college_id" TEXT NOT NULL,
      CONSTRAINT "circular_user_read_unq" UNIQUE ("circularId", "userId")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "crr_college_circular_idx"
    ON "CircularReadReceipt" ("college_id", "circularId");
  `);

  // ---------------------------------------------------------------------------
  // 7C: Timetable Multi-Profile Isolation
  // ---------------------------------------------------------------------------
  console.log('[7C] Provisioning TimetableProfile tables...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimetableProfile" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'STANDARD',
      "isActive" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "tp_college_type_active_idx"
    ON "TimetableProfile" ("college_id", "type", "isActive");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimetablePeriod" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "profile_id" TEXT NOT NULL REFERENCES "TimetableProfile"("id") ON DELETE CASCADE,
      "periodNumber" INTEGER NOT NULL,
      "startTime" TEXT NOT NULL,
      "endTime" TEXT NOT NULL,
      "isBreak" BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT "profile_period_unq" UNIQUE ("profile_id", "periodNumber")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimetableEntry" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL,
      "profile_id" TEXT NOT NULL REFERENCES "TimetableProfile"("id") ON DELETE CASCADE,
      "dayOfWeek" INTEGER NOT NULL,
      "periodNumber" INTEGER NOT NULL,
      "subjectId" TEXT NOT NULL,
      "teacherId" TEXT NOT NULL,
      "roomId" TEXT,
      "batchKey" TEXT NOT NULL DEFAULT 'ALL'
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "te_college_profile_day_period_idx"
    ON "TimetableEntry" ("college_id", "profile_id", "dayOfWeek", "periodNumber");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "te_college_teacher_day_period_idx"
    ON "TimetableEntry" ("college_id", "teacherId", "dayOfWeek", "periodNumber");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "TimetableEntrySection" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "entryId" TEXT NOT NULL REFERENCES "TimetableEntry"("id") ON DELETE CASCADE,
      "college_id" TEXT NOT NULL,
      "profile_id" TEXT NOT NULL,
      "section_id" TEXT NOT NULL,
      "dayOfWeek" INTEGER NOT NULL,
      "periodNumber" INTEGER NOT NULL,
      CONSTRAINT "section_clash_unq" UNIQUE ("college_id", "profile_id", "section_id", "dayOfWeek", "periodNumber")
    );
  `);

  // ---------------------------------------------------------------------------
  // 7D: Canteen POS & Sales Ledger
  // ---------------------------------------------------------------------------
  console.log('[7D] Provisioning Canteen POS tables...');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CanteenItem" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "name" TEXT NOT NULL,
      "barcode" TEXT,
      "category" TEXT NOT NULL DEFAULT 'general',
      "sellingPricePkr" INTEGER NOT NULL,
      "costPricePkr" INTEGER NOT NULL,
      "stockQuantity" INTEGER NOT NULL DEFAULT 0,
      "lowStockAlert" INTEGER NOT NULL DEFAULT 10,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ci_college_active_idx"
    ON "CanteenItem" ("college_id", "isActive");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CashierShift" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "cashierId" TEXT NOT NULL,
      "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "closedAt" TIMESTAMP WITH TIME ZONE,
      "openingCashPkr" INTEGER NOT NULL DEFAULT 0,
      "declaredClosingCashPkr" INTEGER,
      "expectedClosingCashPkr" INTEGER,
      "systemCashSalesPkr" INTEGER,
      "systemCashTopupsPkr" INTEGER,
      "systemCashRefundsPkr" INTEGER,
      "discrepancyPkr" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'OPEN',
      "notes" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "one_open_shift_per_cashier"
    ON "CashierShift" ("college_id", "cashierId")
    WHERE status = 'OPEN';
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CanteenOrder" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "clientOrderId" TEXT NOT NULL,
      "orderNumber" TEXT NOT NULL,
      "student_id" TEXT,
      "customerType" TEXT NOT NULL,
      "paymentMethod" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'COMPLETED',
      "subtotalPkr" INTEGER NOT NULL,
      "discountPkr" INTEGER NOT NULL DEFAULT 0,
      "totalPkr" INTEGER NOT NULL,
      "cashTendered" INTEGER,
      "changeGiven" INTEGER,
      "cashierId" TEXT NOT NULL,
      "shiftId" TEXT REFERENCES "CashierShift"("id") ON DELETE SET NULL,
      "voidShiftId" TEXT,
      "voidedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT "canteen_order_client_unq" UNIQUE ("college_id", "clientOrderId")
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "co_college_created_idx"
    ON "CanteenOrder" ("college_id", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "co_shift_idx"
    ON "CanteenOrder" ("shiftId");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CanteenOrderItem" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "order_id" TEXT NOT NULL REFERENCES "CanteenOrder"("id") ON DELETE CASCADE,
      "item_id" TEXT NOT NULL REFERENCES "CanteenItem"("id") ON DELETE RESTRICT,
      "quantity" INTEGER NOT NULL,
      "unitPricePkr" INTEGER NOT NULL,
      "costPricePkr" INTEGER NOT NULL,
      "subtotalPkr" INTEGER NOT NULL
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "coi_order_idx"
    ON "CanteenOrderItem" ("order_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CashDrawerTransaction" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "shiftId" TEXT NOT NULL REFERENCES "CashierShift"("id") ON DELETE RESTRICT,
      "cashierId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "amountPkr" INTEGER NOT NULL,
      "order_id" TEXT,
      "notes" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "cdt_shift_idx"
    ON "CashDrawerTransaction" ("college_id", "shiftId", "createdAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StudentMealAccount" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "student_id" TEXT NOT NULL UNIQUE,
      "balancePkr" INTEGER NOT NULL DEFAULT 0,
      "dailySpendingLimitPkr" INTEGER NOT NULL DEFAULT 1000,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT "check_positive_balance" CHECK ("balancePkr" >= 0)
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MealAccountTransaction" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id" TEXT NOT NULL REFERENCES "College"("id") ON DELETE CASCADE,
      "student_id" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "amountPkr" INTEGER NOT NULL,
      "balanceAfterPkr" INTEGER NOT NULL,
      "order_id" TEXT,
      "cashierId" TEXT NOT NULL,
      "notes" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "mat_student_idx"
    ON "MealAccountTransaction" ("college_id", "student_id", "createdAt");
  `);

  console.log('[Phase7 Migration] Complete! All Phase 7 tables, indexes, and constraints successfully provisioned.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Phase7 Migration] Error:', err);
    process.exit(1);
  });

