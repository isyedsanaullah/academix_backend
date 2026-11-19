'use strict';

/**
 * Trial Configuration — Single Source of Truth
 * Change TRIAL_ENTITLEMENT_PLAN here (or via env) to adjust which plan's
 * features & UI capabilities newly registered trial colleges receive.
 * Quantitative quotas during Free Trial are intentionally capped low
 * via TRIAL_QUOTA_LIMITS (enough for onboarding & evaluation without abuse).
 */
const MB = 1024 * 1024;

const TRIAL_DAYS = Math.max(1, parseInt(process.env.TRIAL_DAYS || '14', 10) || 14);
const TRIAL_ENTITLEMENT_PLAN = (process.env.TRIAL_ENTITLEMENT_PLAN || 'standard').toLowerCase().trim();

const intEnv = (key, fallback) => {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const TRIAL_QUOTA_LIMITS = Object.freeze({
  maxStudents: intEnv('TRIAL_MAX_STUDENTS', 50),
  maxStaff: intEnv('TRIAL_MAX_STAFF', 10),
  maxAdmins: intEnv('TRIAL_MAX_ADMINS', 2),
  maxCampuses: 1,
  maxStorageBytes: intEnv('TRIAL_MAX_STORAGE_MB', 512) * MB,
  maxUploadBytes: 10 * MB,
  maxApplications: intEnv('TRIAL_MAX_APPLICATIONS', 20),
  messageCreditsMonthly: 0,
  aiCreditsMonthly: intEnv('TRIAL_AI_CREDITS', 50000),
  tutorDailyPerStudent: 3,
  aiQuizGenerationsMonthly: 5,
  aiNotesMonthly: 5,
  documentOcrMonthly: 5,
  noticeTranslationMonthly: 5,
  askYourDataMonthly: 3,
  exportsCsvMonthly: 5,
  exportsPdfMonthly: 5,
  exportMaxRows: 500,
  exportsMonthly: { csv: 5, maxCsvRows: 500, pdf: 5 },
  apiCallsMonthly: 0,
  backupZipMonthly: 0,
  emailsMonthly: intEnv('TRIAL_EMAILS_MONTHLY', 200),
  scheduledReportsMonthly: 0,
  omrSheetsMonthly: 0,
  bulkImportMaxRows: 100,
});

module.exports = {
  TRIAL_DAYS,
  TRIAL_ENTITLEMENT_PLAN,
  TRIAL_QUOTA_LIMITS,
};
