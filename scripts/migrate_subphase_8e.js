require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8E: Biometric Turnstile Models ---');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BiometricDevice" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "serialNumber" TEXT NOT NULL UNIQUE,
        "deviceName" TEXT NOT NULL,
        "location" TEXT,
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "pushSecretHash" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "lastSeenAt" TIMESTAMP(3)
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "BiometricDevice_college_id_status_idx" 
        ON "BiometricDevice" ("college_id", "status");
    `);
    console.log('BiometricDevice table and indexes created.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BiometricIdentityMap" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "deviceUserId" TEXT NOT NULL,
        "subjectType" TEXT NOT NULL,
        "subjectId" TEXT NOT NULL
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "BiometricIdentityMap_college_id_deviceUserId_key"
        ON "BiometricIdentityMap" ("college_id", "deviceUserId");
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "BiometricIdentityMap_college_id_subjectType_subjectId_idx"
        ON "BiometricIdentityMap" ("college_id", "subjectType", "subjectId");
    `);
    console.log('BiometricIdentityMap table and indexes created.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BiometricPunchLog" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "deviceId" TEXT NOT NULL,
        "deviceUserId" TEXT NOT NULL,
        "punchTime" TIMESTAMP(3) NOT NULL,
        "processed" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "BiometricPunchLog_college_id_deviceId_deviceUserId_punchTime_key"
        ON "BiometricPunchLog" ("college_id", "deviceId", "deviceUserId", "punchTime");
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "BiometricPunchLog_college_id_processed_punchTime_idx"
        ON "BiometricPunchLog" ("college_id", "processed", "punchTime");
    `);
    console.log('BiometricPunchLog table and indexes created.');

    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "UnmappedBiometricPunch" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "deviceId" TEXT NOT NULL,
        "deviceUserId" TEXT NOT NULL,
        "punchTime" TIMESTAMP(3) NOT NULL,
        "resolvedAt" TIMESTAMP(3)
      );
    `);
    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "UnmappedBiometricPunch_college_id_resolvedAt_punchTime_idx"
        ON "UnmappedBiometricPunch" ("college_id", "resolvedAt", "punchTime");
    `);
    console.log('UnmappedBiometricPunch table and indexes created.');

    console.log('--- Sub-Phase 8E DB migration complete! ---');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

