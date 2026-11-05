require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8D: Staff Attendance & Leaves ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "StaffAttendance" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "userId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "checkInTime" TIMESTAMP(3),
        "checkOutTime" TIMESTAMP(3),
        "status" TEXT NOT NULL,
        "minutesLate" INTEGER NOT NULL DEFAULT 0,
        "source" TEXT NOT NULL,
        "markedById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Table StaffAttendance created or verified.');

    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "StaffAttendance_college_id_userId_date_key" 
        ON "StaffAttendance" ("college_id", "userId", "date");
    `);

    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "StaffAttendance_college_id_date_idx" 
        ON "StaffAttendance" ("college_id", "date" DESC);
    `);
    console.log('StaffAttendance indexes created or verified.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "StaffLeave" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "user_id" TEXT NOT NULL,
        "leaveType" TEXT NOT NULL,
        "startDate" DATE NOT NULL,
        "endDate" DATE NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "reason" TEXT,
        "approvedById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "StaffLeave_college_id_user_id_startDate_endDate_idx"
        ON "StaffLeave" ("college_id", "user_id", "startDate", "endDate");
    `);
    console.log('StaffLeave table and indexes created or verified.');

    console.log('--- Sub-Phase 8D DB migration complete! ---');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

