require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for JobRunLog ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "JobRunLog" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "jobKey" TEXT NOT NULL,
        "runKey" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'RUNNING',
        "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "finishedAt" TIMESTAMP(3),
        "metaJson" JSONB
      );
    `);

    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "JobRunLog_college_id_jobKey_runKey_key"
        ON "JobRunLog" ("college_id", "jobKey", "runKey");
    `);

    console.log('JobRunLog table and unique index created.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

