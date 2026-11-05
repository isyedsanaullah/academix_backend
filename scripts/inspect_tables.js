'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  const diaryCols = await prisma.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ClassDiaryEntry';
  `;
  console.log('ClassDiaryEntry cols:', diaryCols);

  const calCols = await prisma.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'AcademicCalendarEvent';
  `;
  console.log('AcademicCalendarEvent cols:', calCols);

  const attCols = await prisma.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ClassDiaryAttachment';
  `;
  console.log('ClassDiaryAttachment cols:', attCols);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

