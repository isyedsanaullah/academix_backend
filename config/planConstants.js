'use strict';

/**
 * Academix Master Plan Constants & Quota Definitions
 * Single source of truth for canonical tiers, pricing, quotas, limits and add-on catalogs.
 *
 * Dual-config architecture controlled by `THREE_PLAN_MODE` (config/featureFlags.js):
 *  - `THREE_PLAN_MODE=false` (Stages 0-2): `LEGACY_4PLAN_CONFIG` (starter, standard, premium, enterprise)
 *  - `THREE_PLAN_MODE=true`  (Stage 3+):   `THREE_PLAN_CONFIG` (starter, standard, premium)
 */

const { isThreePlanMode } = require('./featureFlags');

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

// =============================================================================
// 1. LEGACY 4-PLAN CONFIG (Stages 0-2, THREE_PLAN_MODE=false)
// =============================================================================

const LEGACY_CANONICAL_PLANS = ['starter', 'standard', 'premium', 'enterprise'];

const LEGACY_PLAN_LEVEL = {
  starter: 0,
  basic: 0, // legacy alias
  standard: 1,
  premium: 2,
  enterprise: 3
};

const LEGACY_PLAN_PRICING = {
  starter: { monthly: 2999, yearly: 32989 },
  standard: { monthly: 5999, yearly: 65989 },
  premium: { monthly: 10999, yearly: 120989 },
  enterprise: { monthly: 17999, yearly: 197989 }
};

const LEGACY_PLAN_LIMITS = {
  starter: {
    maxStudents: 300,
    maxStaff: 20,
    maxAdmins: 2,
    maxCampuses: 1,
    maxStorageBytes: 5 * GB,
    maxUploadBytes: 10 * MB,
    maxApplications: 0,
    messageCreditsMonthly: 0,
    aiCreditsMonthly: 0,
    tutorDailyPerStudent: 0,
    aiQuizGenerationsMonthly: 0,
    aiNotesMonthly: 0,
    documentOcrMonthly: 0,
    noticeTranslationMonthly: 0,
    askYourDataMonthly: 0,
    exportsCsvMonthly: 3,
    exportsPdfMonthly: 0,
    exportMaxRows: 1000,
    exportsMonthly: { csv: 3, maxCsvRows: 1000, pdf: 0 },
    apiCallsMonthly: 0,
    backupZipMonthly: 0
  },
  standard: {
    maxStudents: 750,
    maxStaff: 50,
    maxAdmins: 5,
    maxCampuses: 1,
    maxStorageBytes: 25 * GB,
    maxUploadBytes: 25 * MB,
    maxApplications: 50,
    messageCreditsMonthly: 0,
    aiCreditsMonthly: 1000000,
    tutorDailyPerStudent: 0,
    aiQuizGenerationsMonthly: 20,
    aiNotesMonthly: 0,
    documentOcrMonthly: 0,
    noticeTranslationMonthly: 30,
    askYourDataMonthly: 0,
    exportsCsvMonthly: 60,
    exportsPdfMonthly: 0,
    exportMaxRows: 10000,
    exportsMonthly: { csv: 60, maxCsvRows: 10000, pdf: 0 },
    apiCallsMonthly: 0,
    backupZipMonthly: 0
  },
  premium: {
    maxStudents: 1500,
    maxStaff: 100,
    maxAdmins: 10,
    maxCampuses: 2,
    maxStorageBytes: 100 * GB,
    maxUploadBytes: 50 * MB,
    maxApplications: 150,
    messageCreditsMonthly: 200,
    aiCreditsMonthly: 5000000,
    tutorDailyPerStudent: 10,
    aiQuizGenerationsMonthly: 150,
    aiNotesMonthly: 100,
    documentOcrMonthly: 150,
    noticeTranslationMonthly: 300,
    askYourDataMonthly: 50,
    exportsCsvMonthly: -1,
    exportsPdfMonthly: 60,
    exportMaxRows: 100000,
    exportsMonthly: { csv: Infinity, maxCsvRows: 100000, pdf: 60 },
    apiCallsMonthly: 0,
    backupZipMonthly: 0
  },
  enterprise: {
    maxStudents: 3000,
    maxStaff: 200,
    maxAdmins: 25,
    maxCampuses: 3,
    maxStorageBytes: 300 * GB,
    maxUploadBytes: 100 * MB,
    maxApplications: 400,
    messageCreditsMonthly: 600,
    aiCreditsMonthly: 40000000,
    tutorDailyPerStudent: 30,
    aiQuizGenerationsMonthly: Infinity,
    aiNotesMonthly: Infinity,
    documentOcrMonthly: Infinity,
    noticeTranslationMonthly: Infinity,
    askYourDataMonthly: Infinity,
    exportsCsvMonthly: -1,
    exportsPdfMonthly: -1,
    exportMaxRows: 1000000,
    exportsMonthly: { csv: Infinity, maxCsvRows: 1000000, pdf: Infinity },
    apiCallsMonthly: 100000,
    backupZipMonthly: 1
  }
};

const LEGACY_ADDON_CATALOG_SEEDS = [
  { addonType: 'STUDENTS', planId: 'standard', name: 'Extra Student Capacity (Standard)', unitPriceMonthlyPkr: 15, unitPriceYearlyPkr: 165, isAvailable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STUDENTS', planId: 'premium', name: 'Extra Student Capacity (Premium)', unitPriceMonthlyPkr: 12, unitPriceYearlyPkr: 132, isAvailable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STUDENTS', planId: 'enterprise', name: 'Extra Student Capacity (Enterprise)', unitPriceMonthlyPkr: 8, unitPriceYearlyPkr: 88, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'STAFF', planId: 'standard', name: 'Extra Staff Account (Standard)', unitPriceMonthlyPkr: 120, unitPriceYearlyPkr: 1320, isAvailable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STAFF', planId: 'premium', name: 'Extra Staff Account (Premium)', unitPriceMonthlyPkr: 100, unitPriceYearlyPkr: 1100, isAvailable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STAFF', planId: 'enterprise', name: 'Extra Staff Account (Enterprise)', unitPriceMonthlyPkr: 80, unitPriceYearlyPkr: 880, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'ADMINS', planId: 'standard', name: 'Extra Administrator Account (Standard)', unitPriceMonthlyPkr: 400, unitPriceYearlyPkr: 4400, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 2 },
  { addonType: 'ADMINS', planId: 'premium', name: 'Extra Administrator Account (Premium)', unitPriceMonthlyPkr: 350, unitPriceYearlyPkr: 3850, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 5 },
  { addonType: 'ADMINS', planId: 'enterprise', name: 'Extra Administrator Account (Enterprise)', unitPriceMonthlyPkr: 250, unitPriceYearlyPkr: 2750, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'STORAGE_GB', planId: 'starter', name: 'Extra 10 GB Storage Block (Starter)', unitPriceMonthlyPkr: 600, unitPriceYearlyPkr: 6600, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'STORAGE_GB', planId: 'standard', name: 'Extra 10 GB Storage Block (Standard)', unitPriceMonthlyPkr: 500, unitPriceYearlyPkr: 5500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 2 },
  { addonType: 'STORAGE_GB', planId: 'premium', name: 'Extra 10 GB Storage Block (Premium)', unitPriceMonthlyPkr: 450, unitPriceYearlyPkr: 4950, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 10 },
  { addonType: 'STORAGE_GB', planId: 'enterprise', name: 'Extra 10 GB Storage Block (Enterprise)', unitPriceMonthlyPkr: 400, unitPriceYearlyPkr: 4400, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'APPLICATIONS', planId: 'standard', name: '25 Online Applications Pack (Standard)', unitPriceMonthlyPkr: 2500, unitPriceYearlyPkr: 2500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 2 },
  { addonType: 'APPLICATIONS', planId: 'premium', name: '25 Online Applications Pack (Premium)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 6 },
  { addonType: 'APPLICATIONS', planId: 'enterprise', name: '25 Online Applications Pack (Enterprise)', unitPriceMonthlyPkr: 1500, unitPriceYearlyPkr: 1500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'CAMPUS', planId: 'enterprise', name: 'Extra Campus Slot (Enterprise)', unitPriceMonthlyPkr: 3000, unitPriceYearlyPkr: 33000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_500', planId: 'standard', name: 'Small Message Pack (500 Credits)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_2000', planId: 'standard', name: 'Medium Message Pack (2,000 Credits)', unitPriceMonthlyPkr: 7500, unitPriceYearlyPkr: 7500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_5000', planId: 'standard', name: 'Large Message Pack (5,000 Credits)', unitPriceMonthlyPkr: 18000, unitPriceYearlyPkr: 18000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_500', planId: 'premium', name: 'Small Message Pack (500 Credits)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_2000', planId: 'premium', name: 'Medium Message Pack (2,000 Credits)', unitPriceMonthlyPkr: 7500, unitPriceYearlyPkr: 7500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_5000', planId: 'premium', name: 'Large Message Pack (5,000 Credits)', unitPriceMonthlyPkr: 18000, unitPriceYearlyPkr: 18000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_500', planId: 'enterprise', name: 'Small Message Pack (500 Credits)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_2000', planId: 'enterprise', name: 'Medium Message Pack (2,000 Credits)', unitPriceMonthlyPkr: 7500, unitPriceYearlyPkr: 7500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_5000', planId: 'enterprise', name: 'Large Message Pack (5,000 Credits)', unitPriceMonthlyPkr: 18000, unitPriceYearlyPkr: 18000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'AI_TOKENS_1M', planId: 'standard', name: 'AI Lite Token Pack (1M Credits)', unitPriceMonthlyPkr: 500, unitPriceYearlyPkr: 500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'AI_TOKENS_5M', planId: 'premium', name: 'AI Plus Token Pack (5M Credits)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'AI_TOKENS_5M', planId: 'enterprise', name: 'AI Full Token Pack (5M Credits)', unitPriceMonthlyPkr: 1500, unitPriceYearlyPkr: 1500, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'MODULE_LIBRARY', planId: 'standard', name: 'Library Management Module (Add-on)', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_CANTEEN', planId: 'standard', name: 'Canteen POS & Sales Ledger (Add-on)', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_TRANSPORT', planId: 'standard', name: 'Transport Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_TRANSPORT', planId: 'premium', name: 'Transport Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_HOSTEL', planId: 'standard', name: 'Hostel Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_HOSTEL', planId: 'premium', name: 'Hostel Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 }
];

const LEGACY_4PLAN_CONFIG = {
  CANONICAL_PLANS: LEGACY_CANONICAL_PLANS,
  PLAN_LEVEL: LEGACY_PLAN_LEVEL,
  PLAN_PRICING: LEGACY_PLAN_PRICING,
  PLAN_LIMITS: LEGACY_PLAN_LIMITS,
  ADDON_CATALOG_SEEDS: LEGACY_ADDON_CATALOG_SEEDS
};

// =============================================================================
// 2. THREE-PLAN CONFIG (Stage 3+, THREE_PLAN_MODE=true)
// =============================================================================

const THREE_PLAN_CANONICAL_PLANS = ['starter', 'standard', 'premium'];

const THREE_PLAN_LEVEL = {
  starter: 0,
  basic: 0,
  standard: 1,
  premium: 2,
  enterprise: 2 // retired tier aliases upward to expanded Premium
};

const THREE_PLAN_PRICING = {
  starter: { monthly: 2999, yearly: 32989 },
  standard: { monthly: 5999, yearly: 65989 },
  premium: { monthly: 14999, yearly: 164989 }
};

const THREE_PLAN_LIMITS = {
  starter: {
    maxStudents: 300,
    maxStaff: 20,
    maxAdmins: 2,
    maxCampuses: 1,
    maxStorageBytes: 5 * GB,
    maxUploadBytes: 10 * MB,
    maxApplications: 0,
    messageCreditsMonthly: 0,
    aiCreditsMonthly: 0,
    tutorDailyPerStudent: 0,
    aiQuizGenerationsMonthly: 0,
    aiNotesMonthly: 0,
    documentOcrMonthly: 0,
    noticeTranslationMonthly: 0,
    askYourDataMonthly: 0,
    exportsCsvMonthly: 3,
    exportsPdfMonthly: 0,
    exportMaxRows: 1000,
    exportsMonthly: { csv: 3, maxCsvRows: 1000, pdf: 0 },
    apiCallsMonthly: 0,
    backupZipMonthly: 0,
    emailsMonthly: 3000,
    auditRetentionDays: 30,
    trashRetentionDays: 30,
    fileRetentionMonths: 12,
    customReportTemplatesMax: 0,
    customRolesAllowed: false,
    scheduledReportsMonthly: 0,
    omrSheetsMonthly: 0,
    bulkImportMaxRows: 1000
  },
  standard: {
    maxStudents: 750,
    maxStaff: 50,
    maxAdmins: 5,
    maxCampuses: 1,
    maxStorageBytes: 25 * GB,
    maxUploadBytes: 25 * MB,
    maxApplications: 50,
    messageCreditsMonthly: 0,
    aiCreditsMonthly: 1000000,
    tutorDailyPerStudent: 0,
    aiQuizGenerationsMonthly: 20,
    aiNotesMonthly: 0,
    documentOcrMonthly: 0,
    noticeTranslationMonthly: 30,
    askYourDataMonthly: 0,
    exportsCsvMonthly: 60,
    exportsPdfMonthly: 60,
    exportMaxRows: 10000,
    exportsMonthly: { csv: 60, maxCsvRows: 10000, pdf: 60 },
    apiCallsMonthly: 0,
    backupZipMonthly: 0,
    emailsMonthly: 10000,
    auditRetentionDays: 90,
    trashRetentionDays: 30,
    fileRetentionMonths: 24,
    customReportTemplatesMax: 5,
    customRolesAllowed: false,
    scheduledReportsMonthly: 0,
    omrSheetsMonthly: 0,
    bulkImportMaxRows: 5000
  },
  premium: {
    maxStudents: 2000,
    maxStaff: 150,
    maxAdmins: 15,
    maxCampuses: 2,
    maxStorageBytes: 150 * GB,
    maxUploadBytes: 100 * MB,
    maxApplications: 300,
    messageCreditsMonthly: 300,
    aiCreditsMonthly: 20000000,
    tutorDailyPerStudent: 20,
    aiQuizGenerationsMonthly: -1,
    aiNotesMonthly: -1,
    documentOcrMonthly: -1,
    noticeTranslationMonthly: -1,
    askYourDataMonthly: -1,
    exportsCsvMonthly: -1,
    exportsPdfMonthly: -1,
    exportMaxRows: 100000, // Proposed by the plan (fair-use ceiling)
    exportsMonthly: { csv: Infinity, maxCsvRows: 100000, pdf: Infinity },
    apiCallsMonthly: 0, // 100,000 when PACK_API is active
    backupZipMonthly: 1,
    emailsMonthly: 25000,
    auditRetentionDays: 365,
    trashRetentionDays: 90,
    fileRetentionMonths: -1,
    customReportTemplatesMax: -1,
    customRolesAllowed: true,
    scheduledReportsMonthly: 30,
    omrSheetsMonthly: 10000,
    bulkImportMaxRows: 50000
  }
};

const THREE_PLAN_ADDON_CATALOG_SEEDS = [
  // Capacity: Extra Students (50% cap)
  { addonType: 'STUDENTS', planId: 'standard', name: 'Extra Student Capacity (Standard)', unitPriceMonthlyPkr: 15, unitPriceYearlyPkr: 165, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STUDENTS', planId: 'premium', name: 'Extra Student Capacity (Premium)', unitPriceMonthlyPkr: 10, unitPriceYearlyPkr: 110, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },

  // Capacity: Extra Staff (50% cap)
  { addonType: 'STAFF', planId: 'standard', name: 'Extra Staff Account (Standard)', unitPriceMonthlyPkr: 120, unitPriceYearlyPkr: 1320, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },
  { addonType: 'STAFF', planId: 'premium', name: 'Extra Staff Account (Premium)', unitPriceMonthlyPkr: 90, unitPriceYearlyPkr: 990, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: 50, maxUnitsStatic: null },

  // Capacity: Extra Storage (10 GB blocks; 100% cap: 15 / 45 / 300 GB)
  { addonType: 'STORAGE_GB', planId: 'starter', name: 'Extra 10 GB Storage Block (Starter)', unitPriceMonthlyPkr: 600, unitPriceYearlyPkr: 6600, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'STORAGE_GB', planId: 'standard', name: 'Extra 10 GB Storage Block (Standard)', unitPriceMonthlyPkr: 500, unitPriceYearlyPkr: 5500, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 2 },
  { addonType: 'STORAGE_GB', planId: 'premium', name: 'Extra 10 GB Storage Block (Premium)', unitPriceMonthlyPkr: 400, unitPriceYearlyPkr: 4400, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 15 },

  // Capacity: Online Applications (packs of 25/year; 100% cap)
  { addonType: 'APPLICATIONS', planId: 'standard', name: '25 Online Applications Pack (Standard)', unitPriceMonthlyPkr: 2500, unitPriceYearlyPkr: 2500, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 2 },
  { addonType: 'APPLICATIONS', planId: 'premium', name: '25 Online Applications Pack (Premium)', unitPriceMonthlyPkr: 1800, unitPriceYearlyPkr: 1800, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 12 },

  // Multi-Campus: Extra Campus Slot (Premium only: +1 => 3 max)
  { addonType: 'CAMPUS', planId: 'premium', name: 'Extra Campus Slot (Premium)', unitPriceMonthlyPkr: 3000, unitPriceYearlyPkr: 33000, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: 1 },

  // Credit Packs: AI Tokens (Live)
  { addonType: 'AI_TOKENS_1M', planId: 'standard', name: 'AI Lite Token Pack (1M Credits)', unitPriceMonthlyPkr: 500, unitPriceYearlyPkr: 500, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'AI_TOKENS_5M', planId: 'premium', name: 'AI Full Token Pack (5M Credits)', unitPriceMonthlyPkr: 1800, unitPriceYearlyPkr: 1800, isAvailable: true, isPurchasable: true, maxCapPercentOfBase: null, maxUnitsStatic: null },

  // Credit Packs: Message Credits (Premium-only, Coming soon until carrier gateway live)
  { addonType: 'SMS_PACK_500', planId: 'premium', name: 'Small Message Pack (500 Credits)', unitPriceMonthlyPkr: 2000, unitPriceYearlyPkr: 2000, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_2000', planId: 'premium', name: 'Medium Message Pack (2,000 Credits)', unitPriceMonthlyPkr: 7500, unitPriceYearlyPkr: 7500, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: null },
  { addonType: 'SMS_PACK_5000', planId: 'premium', name: 'Large Message Pack (5,000 Credits)', unitPriceMonthlyPkr: 18000, unitPriceYearlyPkr: 18000, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: null },

  // Optional Modules & Control Packs (Coming soon — isPurchasable: false until built/live)
  { addonType: 'MODULE_LIBRARY', planId: 'standard', name: 'Library Management Module (Add-on)', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_CANTEEN', planId: 'standard', name: 'Canteen POS & Sales Ledger (Add-on)', unitPriceMonthlyPkr: 800, unitPriceYearlyPkr: 8800, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_TRANSPORT', planId: 'standard', name: 'Transport Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_TRANSPORT', planId: 'premium', name: 'Transport Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_HOSTEL', planId: 'standard', name: 'Hostel Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_HOSTEL', planId: 'premium', name: 'Hostel Management Module (Add-on)', unitPriceMonthlyPkr: 1200, unitPriceYearlyPkr: 13200, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_ACCOUNTING', planId: 'premium', name: 'Double-Entry Accounting Module (Add-on)', unitPriceMonthlyPkr: 2500, unitPriceYearlyPkr: 27500, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'MODULE_STAFF_HR', planId: 'premium', name: 'Staff Appraisal & HR Module (Add-on)', unitPriceMonthlyPkr: 1500, unitPriceYearlyPkr: 16500, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'PACK_GOVERNANCE', planId: 'premium', name: 'Governance & Branding Pack (Add-on)', unitPriceMonthlyPkr: 4000, unitPriceYearlyPkr: 44000, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 },
  { addonType: 'PACK_API', planId: 'premium', name: 'Public API & Webhooks Pack (Add-on)', unitPriceMonthlyPkr: 2500, unitPriceYearlyPkr: 27500, isAvailable: true, isPurchasable: false, maxCapPercentOfBase: null, maxUnitsStatic: 1 }
];

const THREE_PLAN_CONFIG = {
  CANONICAL_PLANS: THREE_PLAN_CANONICAL_PLANS,
  PLAN_LEVEL: THREE_PLAN_LEVEL,
  PLAN_PRICING: THREE_PLAN_PRICING,
  PLAN_LIMITS: THREE_PLAN_LIMITS,
  ADDON_CATALOG_SEEDS: THREE_PLAN_ADDON_CATALOG_SEEDS
};

// =============================================================================
// 3. RUNTIME CONFIG SELECTION & DYNAMIC PROXIES
// =============================================================================

function getPlanConfig() {
  return THREE_PLAN_CONFIG;
}

function getPlanLimits(rawPlan) {
  const id = normalizePlanId(rawPlan);
  return THREE_PLAN_CONFIG.PLAN_LIMITS[id] || THREE_PLAN_CONFIG.PLAN_LIMITS.starter;
}

function makeDynamicObjectProxy(selectObj) {
  return new Proxy({}, {
    get(_t, prop) {
      const target = selectObj();
      const val = Reflect.get(target, prop);
      return typeof val === 'function' ? val.bind(target) : val;
    },
    has(_t, prop) {
      return Reflect.has(selectObj(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(selectObj());
    },
    getOwnPropertyDescriptor(_t, prop) {
      return Reflect.getOwnPropertyDescriptor(selectObj(), prop);
    }
  });
}

function makeDynamicArrayProxy(selectArr) {
  return new Proxy([], {
    get(_t, prop) {
      const target = selectArr();
      const val = Reflect.get(target, prop);
      return typeof val === 'function' ? val.bind(target) : val;
    },
    has(_t, prop) {
      return Reflect.has(selectArr(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(selectArr());
    },
    getOwnPropertyDescriptor(_t, prop) {
      return Reflect.getOwnPropertyDescriptor(selectArr(), prop);
    }
  });
}

/**
 * Normalizes raw plan string to canonical 3-plan ID ('starter' | 'standard' | 'premium').
 * Legacy 'enterprise' aliases upward to 'premium'.
 */
const normalizePlanId = (rawPlan) => {
  if (!rawPlan || typeof rawPlan !== 'string') return 'starter';
  const clean = rawPlan.toLowerCase().trim();
  if (clean.startsWith('ent') || clean.startsWith('prem')) return 'premium';
  if (clean.startsWith('stand')) return 'standard';
  return 'starter'; // maps 'basic', 'free', etc.
};

const getDailyKey = (date = new Date()) => date.toISOString().slice(0, 10);
const getMonthlyKey = (date = new Date()) => date.toISOString().slice(0, 7);
const getCycleKey = (anchorDate = new Date()) => `cycle_${anchorDate.toISOString().slice(0, 10)}`;

const serializeUsage = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(serializeUsage);
  if (typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = typeof v === 'bigint' ? Number(v) : serializeUsage(v);
    }
    return res;
  }
  return obj;
};

module.exports = {
  KB,
  MB,
  GB,
  LEGACY_4PLAN_CONFIG,
  THREE_PLAN_CONFIG,
  getPlanConfig,
  getPlanLimits,
  CANONICAL_PLANS: makeDynamicArrayProxy(() => getPlanConfig().CANONICAL_PLANS),
  PLAN_LEVEL: makeDynamicObjectProxy(() => getPlanConfig().PLAN_LEVEL),
  PLAN_PRICING: makeDynamicObjectProxy(() => getPlanConfig().PLAN_PRICING),
  PLAN_LIMITS: makeDynamicObjectProxy(() => getPlanConfig().PLAN_LIMITS),
  ADDON_CATALOG_SEEDS: makeDynamicArrayProxy(() => getPlanConfig().ADDON_CATALOG_SEEDS),
  normalizePlanId,
  getDailyKey,
  getMonthlyKey,
  getCycleKey,
  serializeUsage
};
