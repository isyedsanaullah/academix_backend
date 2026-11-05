'use strict';
/**
 * Phase 8 Raw SQL Table Creation Script
 * Run with: node scripts/ensure_phase8_tables.js
 *
 * Creates tables for Phase 8 services:
 *  8A: BulkImportJob
 *  8B: ClassDiaryEntry, AcademicCalendarEvent
 *  8C: AcademicGroup (groups already exist in some form - check first)
 *  8D: BiometricDevice, BiometricPunchLog
 *  8E: StaffAttendance
 *  8F: AttendanceShortageNotice
 *  8G: FeePaymentProof (payment gateway mock)
 *  8H: ParentAccessToken
 *  8I: MessagingCreditLedger, MessagingOutboxEntry
 *  8J: (uses existing DailyAttendance)
 *  8K: (uses existing models for aggregation)
 */

const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Neon PostgreSQL');

  const queries = [
    // ── 8A: Bulk Import Job ────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "BulkImportJob" (
      "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"      UUID NOT NULL,
      "importType"      TEXT NOT NULL,  -- 'students' | 'staff' | 'fees'
      "status"          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | VALIDATING | VALIDATED | COMMITTING | DONE | FAILED
      "originalFilename" TEXT NOT NULL,
      "r2Key"           TEXT,
      "totalRows"       INT  NOT NULL DEFAULT 0,
      "validRows"       INT  NOT NULL DEFAULT 0,
      "errorRows"       INT  NOT NULL DEFAULT 0,
      "committedRows"   INT  NOT NULL DEFAULT 0,
      "headerMappingJson" JSONB,
      "errorReportJson"   JSONB,
      "createdById"     UUID NOT NULL,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_bulk_import_college" ON "BulkImportJob"("college_id", "createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "idx_bulk_import_status"  ON "BulkImportJob"("college_id", "status")`,

    // ── 8B: Class Diary Entry ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "ClassDiaryEntry" (
      "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"   UUID NOT NULL,
      "sectionId"    UUID NOT NULL,
      "subjectId"    UUID,
      "teacherId"    UUID NOT NULL,
      "entryDate"    DATE NOT NULL,
      "topicCovered" TEXT NOT NULL,
      "homework"     TEXT,
      "remarks"      TEXT,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "diary_section_date_subject_unq"
       ON "ClassDiaryEntry"("college_id","sectionId","subjectId","entryDate")`,
    `CREATE INDEX IF NOT EXISTS "idx_diary_section_date" ON "ClassDiaryEntry"("college_id","sectionId","entryDate" DESC)`,

    // ── 8B: Academic Calendar Event ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "AcademicCalendarEvent" (
      "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"  UUID NOT NULL,
      "title"       TEXT NOT NULL,
      "description" TEXT,
      "eventType"   TEXT NOT NULL DEFAULT 'GENERAL',  -- GENERAL | EXAM | HOLIDAY | TEST | SPORTS
      "startDate"   DATE NOT NULL,
      "endDate"     DATE NOT NULL,
      "isPublic"    BOOLEAN NOT NULL DEFAULT true,
      "targetAudience" TEXT NOT NULL DEFAULT 'ALL',  -- ALL | STUDENTS | STAFF | PARENTS
      "createdById" UUID NOT NULL,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_cal_event_college_date" ON "AcademicCalendarEvent"("college_id","startDate","endDate")`,

    // ── 8D: Biometric Device ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "BiometricDevice" (
      "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"  UUID NOT NULL,
      "deviceName"  TEXT NOT NULL,
      "deviceIp"    TEXT,
      "location"    TEXT,
      "deviceType"  TEXT NOT NULL DEFAULT 'ZK_ATTENDANCE',
      "isActive"    BOOLEAN NOT NULL DEFAULT true,
      "lastSyncAt"  TIMESTAMPTZ,
      "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "biometric_device_name_college_unq"
       ON "BiometricDevice"("college_id","deviceName")`,

    // ── 8D: Biometric Punch Log ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "BiometricPunchLog" (
      "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"   UUID NOT NULL,
      "deviceId"     UUID REFERENCES "BiometricDevice"("id"),
      "deviceUserId" TEXT NOT NULL,  -- employee ID on device
      "userId"       UUID,           -- resolved Academix userId (nullable until matched)
      "punchTime"    TIMESTAMPTZ NOT NULL,
      "punchType"    TEXT NOT NULL DEFAULT 'AUTO',  -- AUTO | IN | OUT
      "processed"    BOOLEAN NOT NULL DEFAULT false,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "biometric_punch_idempotency_unq"
       ON "BiometricPunchLog"("college_id","deviceUserId","punchTime")`,
    `CREATE INDEX IF NOT EXISTS "idx_biometric_unprocessed"
       ON "BiometricPunchLog"("college_id","processed") WHERE "processed" = false`,

    // ── 8E: Staff Attendance ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "StaffAttendance" (
      "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"   UUID NOT NULL,
      "userId"       UUID NOT NULL,
      "date"         DATE NOT NULL,
      "status"       TEXT NOT NULL DEFAULT 'PRESENT',  -- PRESENT | ABSENT | LATE | HALF_DAY | LEAVE
      "checkInTime"  TIMESTAMPTZ,
      "checkOutTime" TIMESTAMPTZ,
      "minutesLate"  INT  NOT NULL DEFAULT 0,
      "source"       TEXT NOT NULL DEFAULT 'MANUAL',   -- MANUAL | BIOMETRIC
      "remarks"      TEXT,
      "markedById"   UUID,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "staff_att_college_user_date_unq"
       ON "StaffAttendance"("college_id","userId","date")`,
    `CREATE INDEX IF NOT EXISTS "idx_staff_att_college_date"
       ON "StaffAttendance"("college_id","date" DESC)`,

    // ── 8F: Attendance Shortage Notice ────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "AttendanceShortageNotice" (
      "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"      UUID NOT NULL,
      "studentId"       UUID NOT NULL,
      "sectionId"       UUID,
      "attendancePercent" NUMERIC(5,2) NOT NULL,
      "threshold"       NUMERIC(5,2) NOT NULL DEFAULT 75.00,
      "totalClasses"    INT  NOT NULL,
      "attendedClasses" INT  NOT NULL,
      "scanRunDate"     DATE NOT NULL,
      "notified"        BOOLEAN NOT NULL DEFAULT false,
      "notificationSentAt" TIMESTAMPTZ,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "shortage_student_scan_date_unq"
       ON "AttendanceShortageNotice"("college_id","studentId","scanRunDate")`,

    // ── 8G: Fee Payment Proof (Gateway Mock) ──────────────────────────────
    `CREATE TABLE IF NOT EXISTS "FeePaymentProof" (
      "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"      UUID NOT NULL,
      "studentId"       UUID NOT NULL,
      "feeRecordId"     UUID,
      "amountPaid"      NUMERIC(12,2) NOT NULL,
      "paymentMethod"   TEXT NOT NULL DEFAULT 'SCREENSHOT',  -- SCREENSHOT | BANK_SLIP | RECEIPT
      "proofR2Key"      TEXT NOT NULL,
      "originalFilename" TEXT NOT NULL,
      "status"          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | VERIFIED | REJECTED
      "reviewedById"    UUID,
      "reviewedAt"      TIMESTAMPTZ,
      "reviewNote"      TEXT,
      "submittedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_proof_college_status"
       ON "FeePaymentProof"("college_id","status","submittedAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "idx_proof_student"
       ON "FeePaymentProof"("college_id","studentId")`,

    // ── 8H: Parent Access Token (OTP / PIN auth) ──────────────────────────
    `CREATE TABLE IF NOT EXISTS "ParentAccessToken" (
      "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"   UUID NOT NULL,
      "studentId"    UUID NOT NULL,
      "phone"        TEXT NOT NULL,
      "pinHash"      TEXT,
      "otpHash"      TEXT,
      "otpExpiresAt" TIMESTAMPTZ,
      "isActive"     BOOLEAN NOT NULL DEFAULT true,
      "lastLoginAt"  TIMESTAMPTZ,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "parent_token_student_phone_unq"
       ON "ParentAccessToken"("college_id","studentId","phone")`,

    // ── 8I: Messaging Credit Ledger ───────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "MessagingCreditLedger" (
      "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"  UUID NOT NULL UNIQUE,
      "smsCreditsPurchased"    INT NOT NULL DEFAULT 0,
      "smsCreditsConsumed"     INT NOT NULL DEFAULT 0,
      "whatsappCreditsPurchased" INT NOT NULL DEFAULT 0,
      "whatsappCreditsConsumed"  INT NOT NULL DEFAULT 0,
      "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ── 8I: Messaging Outbox Entry ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS "MessagingOutboxEntry" (
      "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "college_id"   UUID NOT NULL,
      "channel"      TEXT NOT NULL,  -- 'SMS' | 'WHATSAPP' | 'IN_APP'
      "recipientPhone" TEXT,
      "recipientUserId" UUID,
      "messageBody"  TEXT NOT NULL,
      "status"       TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED | SENT | FAILED | IN_APP_DELIVERED
      "driver"       TEXT NOT NULL DEFAULT 'IN_APP',  -- IN_APP | TWILIO | META_WHATSAPP
      "creditsUsed"  INT  NOT NULL DEFAULT 0,
      "sentAt"       TIMESTAMPTZ,
      "failureReason" TEXT,
      "metadata"     JSONB,
      "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_messaging_outbox_college_status"
       ON "MessagingOutboxEntry"("college_id","status","createdAt" DESC)`,
    `CREATE INDEX IF NOT EXISTS "idx_messaging_outbox_recipient"
       ON "MessagingOutboxEntry"("college_id","recipientUserId")`,
  ];

  let success = 0;
  let failed = 0;
  for (const sql of queries) {
    const tableMatch = sql.match(/(?:CREATE TABLE IF NOT EXISTS|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS)\s+"?(\w+)"?/i);
    const name = tableMatch ? tableMatch[1] : sql.substring(0, 60);
    try {
      await client.query(sql);
      console.log(`  ✅ ${name}`);
      success++;
    } catch (err) {
      console.error(`  ❌ ${name}: ${err.message}`);
      failed++;
    }
  }

  await client.end();
  console.log(`\nPhase 8 tables: ${success} succeeded, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });

