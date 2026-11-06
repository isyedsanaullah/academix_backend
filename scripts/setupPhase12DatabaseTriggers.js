'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function setupPhase12Database() {
  console.log('=== Step 1: Partial Unique Indexes for Transport & Hostel ===');
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "StudentTransport_active_key"
    ON "StudentTransportAllocation" (college_id, student_id, session_id)
    WHERE "isActive" = true;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "HostelAllotment_active_bed_key"
    ON "StudentHostelAllotment" ("roomId", "bedNumber")
    WHERE "isActive" = true;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "HostelAllotment_active_student_key"
    ON "StudentHostelAllotment" (college_id, student_id, session_id)
    WHERE "isActive" = true;
  `);
  console.log('✓ Partial unique indexes created.');

  console.log('=== Step 2: Check Constraint on JournalLineItem ===');
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_line_debit_credit'
      ) THEN
        ALTER TABLE "JournalLineItem"
        ADD CONSTRAINT chk_journal_line_debit_credit
        CHECK (("debitPkr" = 0 AND "creditPkr" > 0) OR ("debitPkr" > 0 AND "creditPkr" = 0));
      END IF;
    END $$;
  `);
  console.log('✓ JournalLineItem debit/credit check constraint ensured.');

  console.log('=== Step 3: Immutability Triggers for JournalLineItem & JournalVoucher ===');
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_journal_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Journal records are append-only: updates, deletions, and truncations are forbidden'
        USING ERRCODE = '55000';
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Drop triggers if they exist
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS trg_journal_line_immutable ON "JournalLineItem";
    DROP TRIGGER IF EXISTS trg_journal_line_no_truncate ON "JournalLineItem";
    DROP TRIGGER IF EXISTS trg_journal_voucher_immutable ON "JournalVoucher";
    DROP TRIGGER IF EXISTS trg_journal_voucher_no_truncate ON "JournalVoucher";
  `);

  // JournalLineItem triggers
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_journal_line_immutable
    BEFORE UPDATE OR DELETE ON "JournalLineItem"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_journal_mutation();
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_journal_line_no_truncate
    BEFORE TRUNCATE ON "JournalLineItem"
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_journal_mutation();
  `);

  // JournalVoucher triggers (blocking DELETE and TRUNCATE)
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_journal_voucher_immutable
    BEFORE DELETE ON "JournalVoucher"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_journal_mutation();
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_journal_voucher_no_truncate
    BEFORE TRUNCATE ON "JournalVoucher"
    FOR EACH STATEMENT
    EXECUTE FUNCTION prevent_journal_mutation();
  `);
  console.log('✓ Journal immutability triggers established.');

  console.log('=== Phase 12 Database Configuration Completed Successfully ===');
  process.exit(0);
}

setupPhase12Database().catch(err => {
  console.error('Fatal setup error:', err);
  process.exit(1);
});
