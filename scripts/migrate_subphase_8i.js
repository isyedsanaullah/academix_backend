require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8I: #86 Absence Alerts ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AbsenceAlertLog" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "studentId" TEXT NOT NULL,
        "alertDate" DATE NOT NULL,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AbsenceAlertLog_college_id_studentId_alertDate_key"
        ON "AbsenceAlertLog" ("college_id", "studentId", "alertDate");
    `);

    console.log('AbsenceAlertLog table and unique index created.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

