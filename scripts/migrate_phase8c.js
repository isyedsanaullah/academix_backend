'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  console.log('--- Migrating Phase 8C: Bulk Data Import Engine Schema ---');

  // 1. Drop old BulkImportJob if empty
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "BulkImportRow" CASCADE;`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "BulkImportJob" CASCADE;`);

  // 2. Create clean BulkImportJob
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "BulkImportJob" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id"     TEXT NOT NULL,
      "campus_id"      TEXT,
      "importType"     TEXT NOT NULL,
      "status"         TEXT NOT NULL DEFAULT 'PENDING',
      "claimedBy"      TEXT,
      "heartbeatAt"    TIMESTAMP(3),
      "totalRows"      INTEGER NOT NULL DEFAULT 0,
      "rowsProcessed"  INTEGER NOT NULL DEFAULT 0,
      "rowsSuccess"    INTEGER NOT NULL DEFAULT 0,
      "rowsFailed"     INTEGER NOT NULL DEFAULT 0,
      "errorCsvUrl"    TEXT,
      "sourceFileKey"  TEXT,
      "createdById"    TEXT NOT NULL,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "BulkImportJob_college_id_status_idx" ON "BulkImportJob"("college_id", "status");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "BulkImportJob_status_heartbeatAt_idx" ON "BulkImportJob"("status", "heartbeatAt");
  `);

  // 3. Create BulkImportRow
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "BulkImportRow" (
      "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "job_id"       TEXT NOT NULL REFERENCES "BulkImportJob"("id") ON DELETE CASCADE,
      "rowNumber"    INTEGER NOT NULL,
      "payloadJson"  JSONB NOT NULL,
      "status"       TEXT NOT NULL DEFAULT 'PENDING',
      "errorMessage" TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "BulkImportRow_job_id_status_idx" ON "BulkImportRow"("job_id", "status");
  `);

  // 4. Add importJobId to Student and User
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "importJobId" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Student_importJobId_idx" ON "Student"("importJobId");
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "importJobId" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "User_importJobId_idx" ON "User"("importJobId");
  `);

  console.log('Phase 8C tables and columns migrated successfully.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

