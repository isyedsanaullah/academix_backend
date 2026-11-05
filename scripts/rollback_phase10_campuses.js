// ─── Rollback Script: Phase 10 Campus Migration ────────────────────────
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function rollbackCampuses() {
  const prisma = getSystemClient();
  console.log('--- Rolling back Phase 10 Campus Migration ---');

  // 1. Drop index
  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "one_default_campus";`);
  console.log('✅ Dropped index "one_default_campus"');

  // 2. Clear campus_id on Class and Section
  const cRes = await prisma.class.updateMany({ data: { campus_id: null } });
  const sRes = await prisma.section.updateMany({ data: { campus_id: null } });
  const gRes = await prisma.groupSeatAllocation.updateMany({ data: { campus_id: null } });

  console.log(`✅ Cleared campus_id from ${cRes.count} classes, ${sRes.count} sections, ${gRes.count} seat allocations.`);
  console.log('✅ Rollback complete.');
}

rollbackCampuses()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Rollback error:', err);
    process.exit(1);
  });

