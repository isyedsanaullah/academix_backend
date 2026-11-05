'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

async function main() {
  console.log('--- Migrating Phase 8B: Cleanly Recreating ClassDiaryEntry, ClassDiaryAttachment, AcademicCalendarEvent ---');

  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ClassDiaryAttachment" CASCADE;`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ClassDiaryEntry" CASCADE;`);
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "AcademicCalendarEvent" CASCADE;`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ClassDiaryEntry" (
      "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id"   TEXT NOT NULL,
      "campus_id"    TEXT,
      "section_id"   TEXT NOT NULL,
      "subject_id"   TEXT NOT NULL,
      "teacher_id"   TEXT NOT NULL,
      "entryDate"    DATE NOT NULL,
      "periodNumber" INTEGER NOT NULL,
      "topicCovered" TEXT NOT NULL,
      "homework"     TEXT,
      "remarks"      TEXT,
      "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX "ClassDiaryEntry_college_id_section_id_subject_id_entryDate_periodNumber_key"
    ON "ClassDiaryEntry"("college_id", "section_id", "subject_id", "entryDate", "periodNumber");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "ClassDiaryEntry_college_id_section_id_entryDate_idx"
    ON "ClassDiaryEntry"("college_id", "section_id", "entryDate");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "ClassDiaryEntry_college_id_teacher_id_entryDate_idx"
    ON "ClassDiaryEntry"("college_id", "teacher_id", "entryDate");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "ClassDiaryAttachment" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "diary_entry_id" TEXT NOT NULL REFERENCES "ClassDiaryEntry"("id") ON DELETE CASCADE,
      "college_id"     TEXT NOT NULL,
      "storedFileId"   TEXT NOT NULL,
      "fileName"       TEXT NOT NULL,
      "fileUrl"        TEXT NOT NULL,
      "storageBytes"   BIGINT NOT NULL DEFAULT 0,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "ClassDiaryAttachment_college_id_diary_entry_id_idx"
    ON "ClassDiaryAttachment"("college_id", "diary_entry_id");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE "AcademicCalendarEvent" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "college_id"     TEXT NOT NULL,
      "campus_id"      TEXT,
      "session_id"     TEXT NOT NULL,
      "title"          TEXT NOT NULL,
      "description"    TEXT,
      "eventType"      TEXT NOT NULL DEFAULT 'GENERAL',
      "startDate"      DATE NOT NULL,
      "endDate"        DATE NOT NULL,
      "isWorkingDay"   BOOLEAN NOT NULL DEFAULT false,
      "targetAudience" TEXT NOT NULL DEFAULT 'ALL',
      "isPublic"       BOOLEAN NOT NULL DEFAULT true,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX "AcademicCalendarEvent_college_id_session_id_startDate_endDate_idx"
    ON "AcademicCalendarEvent"("college_id", "session_id", "startDate", "endDate");
  `);

  console.log('Phase 8B tables cleanly created.');
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
