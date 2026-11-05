'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const jobCols = await prisma.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'BulkImportJob';
  `;
  console.log('BulkImportJob cols in DB:', jobCols);

  const rowCols = await prisma.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'BulkImportRow';
  `;
  console.log('BulkImportRow cols in DB:', rowCols);

  const studentCols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'Student' AND column_name = 'importJobId';
  `;
  console.log('Student.importJobId col in DB:', studentCols);

  const userCols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'importJobId';
  `;
  console.log('User.importJobId col in DB:', userCols);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

