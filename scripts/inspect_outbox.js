'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const sample = await prisma.outboxEvent.findFirst();
  console.log('Sample OutboxEvent:', sample);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

