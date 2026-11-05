require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function main() {
  const p = getSystemClient();
  try {
    console.log('--- Migrating Database for Sub-Phase 8F: Messaging Layer & GuardianNotification ---');

    // 1. Add isPurchasable to AddonCatalog
    await p.$executeRawUnsafe(`
      ALTER TABLE "AddonCatalog" 
      ADD COLUMN IF NOT EXISTS "isPurchasable" BOOLEAN NOT NULL DEFAULT true;
    `);
    console.log('Added isPurchasable column to AddonCatalog.');

    // 2. Set isPurchasable = false for SMS packs
    const updatedPacks = await p.$executeRawUnsafe(`
      UPDATE "AddonCatalog"
      SET "isPurchasable" = false
      WHERE "addonType" IN ('SMS_PACK_500', 'SMS_PACK_2000', 'SMS_PACK_5000');
    `);
    console.log(`Updated ${updatedPacks} SMS packs to isPurchasable = false.`);

    // 3. Create GuardianNotification table
    await p.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GuardianNotification" (
        "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "college_id" TEXT NOT NULL,
        "campus_id" TEXT,
        "student_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "body" TEXT NOT NULL,
        "refType" TEXT,
        "refId" TEXT,
        "readAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "GuardianNotification_college_id_student_id_createdAt_idx"
        ON "GuardianNotification" ("college_id", "student_id", "createdAt" DESC);
    `);

    await p.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "GuardianNotification_college_id_student_id_readAt_idx"
        ON "GuardianNotification" ("college_id", "student_id", "readAt");
    `);
    console.log('GuardianNotification table and indexes created.');

    console.log('--- Sub-Phase 8F DB migration complete! ---');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}

main();

