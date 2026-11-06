'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const res = await prisma.$queryRawUnsafe("SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'vector';");
  console.log('Vector extension in DB:', res);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

