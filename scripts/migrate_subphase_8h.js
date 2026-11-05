require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8H: #81 Attendance Shortage Scanner ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AttendanceShortageNotice" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "studentId" TEXT NOT NULL,
        "sectionId" TEXT,
        "termKey" TEXT NOT NULL,
        "markedDays" INTEGER NOT NULL,
        "attendedDays" INTEGER NOT NULL,
        "attendancePercent" DECIMAL(5, 2) NOT NULL,
        "thresholdPct" DECIMAL(5, 2) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'ISSUED',
        "lastNotifiedPct" DECIMAL(5, 2),
        "notifyCount" INTEGER NOT NULL DEFAULT 0,
        "firstIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceShortageNotice_college_id_studentId_termKey_key"
        ON "AttendanceShortageNotice" ("college_id", "studentId", "termKey");
    `);

    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AttendanceShortageNotice_college_id_status_idx"
        ON "AttendanceShortageNotice" ("college_id", "status");
    `);
    console.log('AttendanceShortageNotice table and indexes created.');

    console.log('--- Sub-Phase 8H DB migration complete! ---');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

