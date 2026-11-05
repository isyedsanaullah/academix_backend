// ─── Phase 10 Campus Migration & Backfill (§10.1 Option B) ─────────────
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function migrateCampuses() {
  const prisma = getSystemClient();
  const startTime = Date.now();
  console.log('--- Step 1: Applying partial unique index for exactly one default campus ---');

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "one_default_campus"
    ON "Campus"(college_id)
    WHERE "isDefault" = true;
  `);
  console.log('✅ Partial unique index "one_default_campus" is active.');

  console.log('\n--- Step 2: Atomic set-based backfill of default "Main Campus" per college ---');

  // Insert default campus for all colleges that do not yet have one
  const insertedCampuses = await prisma.$executeRawUnsafe(`
    INSERT INTO "Campus" (id, college_id, name, code, address, "isDefault", "isActive", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      c.id,
      'Main Campus',
      'MAIN',
      'Main Campus Premises',
      true,
      true,
      NOW(),
      NOW()
    FROM "College" c
    LEFT JOIN "Campus" camp ON camp.college_id = c.id AND camp."isDefault" = true
    WHERE camp.id IS NULL
    ON CONFLICT DO NOTHING;
  `);
  console.log(`✅ Default campuses created/verified (batch count: ${insertedCampuses}).`);

  // Update Class rows with NULL campus_id
  const updatedClasses = await prisma.$executeRawUnsafe(`
    UPDATE "Class" cl
    SET campus_id = camp.id
    FROM "Campus" camp
    WHERE cl.college_id = camp.college_id
      AND camp."isDefault" = true
      AND cl.campus_id IS NULL;
  `);
  console.log(`✅ Classes backfilled: ${updatedClasses}`);

  // Update Section rows with NULL campus_id
  const updatedSections = await prisma.$executeRawUnsafe(`
    UPDATE "Section" s
    SET campus_id = camp.id
    FROM "Campus" camp
    WHERE s.college_id = camp.college_id
      AND camp."isDefault" = true
      AND s.campus_id IS NULL;
  `);
  console.log(`✅ Sections backfilled: ${updatedSections}`);

  // Update GroupSeatAllocation rows with NULL campus_id
  const updatedAllocations = await prisma.$executeRawUnsafe(`
    UPDATE "GroupSeatAllocation" g
    SET campus_id = camp.id
    FROM "Campus" camp
    WHERE g.college_id = camp.college_id
      AND camp."isDefault" = true
      AND g.campus_id IS NULL;
  `);
  console.log(`✅ GroupSeatAllocations backfilled: ${updatedAllocations}`);

  console.log('\n--- Step 3: Verification of zero null campus_id records ---');
  const nullClasses = await prisma.class.count({ where: { campus_id: null } });
  const nullSections = await prisma.section.count({ where: { campus_id: null } });

  console.log(`Verification: NULL Class.campus_id = ${nullClasses}, NULL Section.campus_id = ${nullSections}`);
  if (nullClasses > 0 || nullSections > 0) {
    throw new Error('Migration failed verification: NULL campus_id records detected');
  }

  const durationMs = Date.now() - startTime;
  console.log(`✅ Phase 10 Campus Migration completed successfully in ${durationMs}ms with 0 NULLs!\n`);
}

migrateCampuses()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });
