'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  console.log('--- Migrating Phase 8A: GroupSeatAllocation & GroupFeeSchedule ---');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GroupSeatAllocation" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id"     TEXT NOT NULL,
      "campus_id"      TEXT,
      "group_id"       TEXT NOT NULL,
      "session_id"     TEXT NOT NULL,
      "maxSeats"       INTEGER NOT NULL,
      "allocatedSeats" INTEGER NOT NULL DEFAULT 0,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "GroupSeatAllocation_college_id_group_id_session_id_key"
    ON "GroupSeatAllocation"("college_id", "group_id", "session_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "GroupSeatAllocation_college_id_session_id_idx"
    ON "GroupSeatAllocation"("college_id", "session_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "GroupFeeSchedule" (
      "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id"      TEXT NOT NULL,
      "campus_id"       TEXT,
      "group_id"        TEXT NOT NULL,
      "session_id"      TEXT NOT NULL,
      "tuitionFeePkr"   DECIMAL(10, 2) NOT NULL,
      "admissionFeePkr" DECIMAL(10, 2) NOT NULL,
      "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "GroupFeeSchedule_college_id_group_id_session_id_key"
    ON "GroupFeeSchedule"("college_id", "group_id", "session_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "GroupFeeSchedule_college_id_session_id_idx"
    ON "GroupFeeSchedule"("college_id", "session_id");
  `);

  console.log('Tables GroupSeatAllocation and GroupFeeSchedule created successfully.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

