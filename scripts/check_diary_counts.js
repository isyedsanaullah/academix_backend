'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const diaryCount = await prisma.$queryRaw`SELECT count(*) FROM "ClassDiaryEntry";`;
  console.log('ClassDiaryEntry row count:', diaryCount);

  const calCount = await prisma.$queryRaw`SELECT count(*) FROM "AcademicCalendarEvent";`;
  console.log('AcademicCalendarEvent row count:', calCount);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

