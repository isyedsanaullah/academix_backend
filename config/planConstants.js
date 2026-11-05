'use strict';

/**
 * Academix Master Plan Constants & Quota Definitions
 * Single source of truth for canonical tiers, pricing, quotas, limits and add-on catalogs.
 */

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

const CANONICAL_PLANS = ['starter', 'standard', 'premium', 'enterprise'];

const PLAN_LEVEL = {
  starter: 0,
  basic: 0, // legacy alias
  standard: 1,
  premium: 2,
  enterprise: 3
};

/**
 * Official Monthly & Yearly Pricing (PKR integers)
 * Yearly is strictly 11x monthly (1 Month FREE).
 */
const PLAN_PRICING = {
  starter: { monthly: 2999, yearly: 32989 },
  standard: { monthly: 5999, yearly: 65989 },
  premium: { monthly: 10999, yearly: 120989 },
  enterprise: { monthly: 17999, yearly: 197989 }
};

/**
 * Exact Base Plan Quotas & Hard Limits
 */
const PLAN_LIMITS = {
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

/**
 * Canonical Add-on Catalog Seed Definitions
 * Used to populate the AddonCatalog table in the system database.
 */
const ADDON_CATALOG_SEEDS = [
  // Capacity: Extra Students
  {
    addonType: 'STUDENTS',
    planId: 'standard',
    name: 'Extra Student Capacity (Standard)',
    unitPriceMonthlyPkr: 15,
    unitPriceYearlyPkr: 165, // 15 * 11
    isAvailable: true,
    maxCapPercentOfBase: 50, // +375 students max
    maxUnitsStatic: null
  },
  {
    addonType: 'STUDENTS',
    planId: 'premium',
    name: 'Extra Student Capacity (Premium)',
    unitPriceMonthlyPkr: 12,
    unitPriceYearlyPkr: 132, // 12 * 11
    isAvailable: true,
    maxCapPercentOfBase: 50, // +750 students max
    maxUnitsStatic: null
  },
  {
    addonType: 'STUDENTS',
    planId: 'enterprise',
    name: 'Extra Student Capacity (Enterprise)',
    unitPriceMonthlyPkr: 8,
    unitPriceYearlyPkr: 88, // 8 * 11
    isAvailable: true,
    maxCapPercentOfBase: null, // Unlimited
    maxUnitsStatic: null
  },

  // Capacity: Extra Staff
  {
    addonType: 'STAFF',
    planId: 'standard',
    name: 'Extra Staff Account (Standard)',
    unitPriceMonthlyPkr: 120,
    unitPriceYearlyPkr: 1320,
    isAvailable: true,
    maxCapPercentOfBase: 50, // +25 staff max
    maxUnitsStatic: null
  },
  {
    addonType: 'STAFF',
    planId: 'premium',
    name: 'Extra Staff Account (Premium)',
    unitPriceMonthlyPkr: 100,
    unitPriceYearlyPkr: 1100,
    isAvailable: true,
    maxCapPercentOfBase: 50, // +50 staff max
    maxUnitsStatic: null
  },
  {
    addonType: 'STAFF',
    planId: 'enterprise',
    name: 'Extra Staff Account (Enterprise)',
    unitPriceMonthlyPkr: 80,
    unitPriceYearlyPkr: 880,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Capacity: Extra Administrators
  {
    addonType: 'ADMINS',
    planId: 'standard',
    name: 'Extra Administrator Account (Standard)',
    unitPriceMonthlyPkr: 400,
    unitPriceYearlyPkr: 4400,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 2 // Max 2 extra admins (total 7)
  },
  {
    addonType: 'ADMINS',
    planId: 'premium',
    name: 'Extra Administrator Account (Premium)',
    unitPriceMonthlyPkr: 350,
    unitPriceYearlyPkr: 3850,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 5 // Max 5 extra admins (total 15)
  },
  {
    addonType: 'ADMINS',
    planId: 'enterprise',
    name: 'Extra Administrator Account (Enterprise)',
    unitPriceMonthlyPkr: 250,
    unitPriceYearlyPkr: 2750,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Capacity: Extra Storage (10 GB blocks)
  {
    addonType: 'STORAGE_GB',
    planId: 'starter',
    name: 'Extra 10 GB Storage Block (Starter)',
    unitPriceMonthlyPkr: 600,
    unitPriceYearlyPkr: 6600,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1 // 1 block max (10 GB)
  },
  {
    addonType: 'STORAGE_GB',
    planId: 'standard',
    name: 'Extra 10 GB Storage Block (Standard)',
    unitPriceMonthlyPkr: 500,
    unitPriceYearlyPkr: 5500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 2 // 2 blocks max (+20 GB, max 45 GB)
  },
  {
    addonType: 'STORAGE_GB',
    planId: 'premium',
    name: 'Extra 10 GB Storage Block (Premium)',
    unitPriceMonthlyPkr: 450,
    unitPriceYearlyPkr: 4950,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 10 // 10 blocks max (+100 GB, max 200 GB)
  },
  {
    addonType: 'STORAGE_GB',
    planId: 'enterprise',
    name: 'Extra 10 GB Storage Block (Enterprise)',
    unitPriceMonthlyPkr: 400,
    unitPriceYearlyPkr: 4400,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Capacity: Online Applications (Packs of 25 / year)
  {
    addonType: 'APPLICATIONS',
    planId: 'standard',
    name: '25 Online Applications Pack (Standard)',
    unitPriceMonthlyPkr: 2500,
    unitPriceYearlyPkr: 2500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 2 // 2 packs = 50 extra (+100% cap)
  },
  {
    addonType: 'APPLICATIONS',
    planId: 'premium',
    name: '25 Online Applications Pack (Premium)',
    unitPriceMonthlyPkr: 2000,
    unitPriceYearlyPkr: 2000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 6 // 6 packs = 150 extra (+100% cap)
  },
  {
    addonType: 'APPLICATIONS',
    planId: 'enterprise',
    name: '25 Online Applications Pack (Enterprise)',
    unitPriceMonthlyPkr: 1500,
    unitPriceYearlyPkr: 1500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Multi-Campus: Extra Campus Slot (Enterprise only)
  {
    addonType: 'CAMPUS',
    planId: 'enterprise',
    name: 'Extra Campus Slot (Enterprise)',
    unitPriceMonthlyPkr: 3000,
    unitPriceYearlyPkr: 33000, // 3000 * 11
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Credit Packs: Message Credits (SMS / WhatsApp)
  {
    addonType: 'SMS_PACK_500',
    planId: 'standard',
    name: 'Small Message Pack (500 Credits)',
    unitPriceMonthlyPkr: 2000,
    unitPriceYearlyPkr: 2000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_2000',
    planId: 'standard',
    name: 'Medium Message Pack (2,000 Credits)',
    unitPriceMonthlyPkr: 7500,
    unitPriceYearlyPkr: 7500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_5000',
    planId: 'standard',
    name: 'Large Message Pack (5,000 Credits)',
    unitPriceMonthlyPkr: 18000,
    unitPriceYearlyPkr: 18000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_500',
    planId: 'premium',
    name: 'Small Message Pack (500 Credits)',
    unitPriceMonthlyPkr: 2000,
    unitPriceYearlyPkr: 2000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_2000',
    planId: 'premium',
    name: 'Medium Message Pack (2,000 Credits)',
    unitPriceMonthlyPkr: 7500,
    unitPriceYearlyPkr: 7500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_5000',
    planId: 'premium',
    name: 'Large Message Pack (5,000 Credits)',
    unitPriceMonthlyPkr: 18000,
    unitPriceYearlyPkr: 18000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_500',
    planId: 'enterprise',
    name: 'Small Message Pack (500 Credits)',
    unitPriceMonthlyPkr: 2000,
    unitPriceYearlyPkr: 2000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_2000',
    planId: 'enterprise',
    name: 'Medium Message Pack (2,000 Credits)',
    unitPriceMonthlyPkr: 7500,
    unitPriceYearlyPkr: 7500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'SMS_PACK_5000',
    planId: 'enterprise',
    name: 'Large Message Pack (5,000 Credits)',
    unitPriceMonthlyPkr: 18000,
    unitPriceYearlyPkr: 18000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Credit Packs: AI Tokens
  {
    addonType: 'AI_TOKENS_1M',
    planId: 'standard',
    name: 'AI Lite Token Pack (1M Credits)',
    unitPriceMonthlyPkr: 500,
    unitPriceYearlyPkr: 500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'AI_TOKENS_5M',
    planId: 'premium',
    name: 'AI Plus Token Pack (5M Credits)',
    unitPriceMonthlyPkr: 2000,
    unitPriceYearlyPkr: 2000,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },
  {
    addonType: 'AI_TOKENS_5M',
    planId: 'enterprise',
    name: 'AI Full Token Pack (5M Credits)',
    unitPriceMonthlyPkr: 1500,
    unitPriceYearlyPkr: 1500,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: null
  },

  // Optional Modules
  {
    addonType: 'MODULE_LIBRARY',
    planId: 'standard',
    name: 'Library Management Module (Add-on)',
    unitPriceMonthlyPkr: 800,
    unitPriceYearlyPkr: 8800, // 800 * 11
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  },
  {
    addonType: 'MODULE_CANTEEN',
    planId: 'standard',
    name: 'Canteen POS & Sales Ledger (Add-on)',
    unitPriceMonthlyPkr: 800,
    unitPriceYearlyPkr: 8800,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  },
  {
    addonType: 'MODULE_TRANSPORT',
    planId: 'standard',
    name: 'Transport Management Module (Add-on)',
    unitPriceMonthlyPkr: 1200,
    unitPriceYearlyPkr: 13200,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  },
  {
    addonType: 'MODULE_TRANSPORT',
    planId: 'premium',
    name: 'Transport Management Module (Add-on)',
    unitPriceMonthlyPkr: 1200,
    unitPriceYearlyPkr: 13200,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  },
  {
    addonType: 'MODULE_HOSTEL',
    planId: 'standard',
    name: 'Hostel Management Module (Add-on)',
    unitPriceMonthlyPkr: 1200,
    unitPriceYearlyPkr: 13200,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  },
  {
    addonType: 'MODULE_HOSTEL',
    planId: 'premium',
    name: 'Hostel Management Module (Add-on)',
    unitPriceMonthlyPkr: 1200,
    unitPriceYearlyPkr: 13200,
    isAvailable: true,
    maxCapPercentOfBase: null,
    maxUnitsStatic: 1
  }
];

/**
 * Normalizes raw plan string to canonical plan ID
 * @param {string} rawPlan - Raw plan value from DB or request
 * @returns {string} - 'starter' | 'standard' | 'premium' | 'enterprise'
 */
const normalizePlanId = (rawPlan) => {
  if (!rawPlan || typeof rawPlan !== 'string') return 'starter';
  const clean = rawPlan.toLowerCase().trim();
  if (clean.startsWith('ent')) return 'enterprise';
  if (clean.startsWith('prem')) return 'premium';
  if (clean.startsWith('stand')) return 'standard';
  return 'starter'; // maps 'basic', 'free', etc.
};

/**
 * Period Key Helpers for CollegeUsage counters
 */
const getDailyKey = (date = new Date()) => date.toISOString().slice(0, 10); // YYYY-MM-DD
const getMonthlyKey = (date = new Date()) => date.toISOString().slice(0, 7); // YYYY-MM
const getCycleKey = (anchorDate = new Date()) => `cycle_${anchorDate.toISOString().slice(0, 10)}`;

/**
 * Safe BigInt serialization for Prisma CollegeUsage outputs
 */
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
  CANONICAL_PLANS,
  PLAN_LEVEL,
  PLAN_PRICING,
  PLAN_LIMITS,
  ADDON_CATALOG_SEEDS,
  normalizePlanId,
  getDailyKey,
  getMonthlyKey,
  getCycleKey,
  serializeUsage
};
