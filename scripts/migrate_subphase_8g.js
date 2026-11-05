require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8G: #83 Parent Portal Engine ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GuardianSession" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "studentId" TEXT NOT NULL,
        "pinHash" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "failedAttempts" INTEGER NOT NULL DEFAULT 0,
        "lockedUntil" TIMESTAMP(3),
        "lastLoginAt" TIMESTAMP(3),
        "pinIssuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "pinResetBy" TEXT
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "GuardianSession_college_id_studentId_key"
        ON "GuardianSession" ("college_id", "studentId");
    `);
    console.log('GuardianSession table and index created.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GuardianToken" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "sessionId" TEXT NOT NULL,
        "tokenHash" TEXT NOT NULL UNIQUE,
        "tokenEpoch" INTEGER NOT NULL DEFAULT 0,
        "expiresAt" TIMESTAMP(3) NOT NULL,
        "revokedAt" TIMESTAMP(3)
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "GuardianToken_sessionId_idx"
        ON "GuardianToken" ("sessionId");
    `);
    console.log('GuardianToken table and indexes created.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GuardianLoginAttempt" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "ipHash" TEXT NOT NULL,
        "success" BOOLEAN NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "GuardianLoginAttempt_college_id_ipHash_createdAt_idx"
        ON "GuardianLoginAttempt" ("college_id", "ipHash", "createdAt");
    `);
    console.log('GuardianLoginAttempt table and index created.');

    // Add tokenEpoch column to College if missing
    await p.$executeRawUnsafe(`
      ALTER TABLE "College"
      ADD COLUMN IF NOT EXISTS "tokenEpoch" INTEGER NOT NULL DEFAULT 0;
    `);
    console.log('College.tokenEpoch column verified.');

    console.log('--- Sub-Phase 8G DB migration complete! ---');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

