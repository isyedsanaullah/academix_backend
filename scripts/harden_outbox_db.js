'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  console.log('Inspecting OutboxEvent columns...');
  const cols = await prisma.$queryRaw`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'OutboxEvent';
  `;
  console.log('Current OutboxEvent columns:', cols.map(c => c.column_name));

  // Add missing columns if they don't exist
  const colNames = cols.map(c => c.column_name);

  if (!colNames.includes('college_id')) {
    console.log('Adding college_id column to OutboxEvent...');
    await prisma.$executeRawUnsafe(`ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "college_id" TEXT;`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OutboxEvent_college_id_idx" ON "OutboxEvent"("college_id");`);
  }

  if (!colNames.includes('retryCount')) {
    console.log('Adding retryCount column to OutboxEvent...');
    await prisma.$executeRawUnsafe(`ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!colNames.includes('failedAt')) {
    console.log('Adding failedAt column to OutboxEvent...');
    await prisma.$executeRawUnsafe(`ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);`);
  }

  console.log('OutboxEvent table hardened successfully.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

