const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');

async function fixTrigger() {
  const prisma = getSystemClient();
  console.log('Installing audit_immutable trigger...');

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_audit_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'CollegeEntitlementAudit rows are immutable — no UPDATE or DELETE allowed';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_immutable ON "CollegeEntitlementAudit";`);

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER audit_immutable
    BEFORE UPDATE OR DELETE ON "CollegeEntitlementAudit"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
  `);

  console.log('audit_immutable trigger successfully installed!');
  await prisma.$disconnect();
}

fixTrigger().catch(console.error);
