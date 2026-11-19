'use strict';

const assert = require('assert');
process.env.NODE_ENV = 'test';

const bannerService = require('../services/bannerService');
const bannerController = require('../controllers/banner.controller');
const { getEntitlements } = require('../services/entitlements');
const { getCollegeLimit } = require('../services/quota');
const { TRIAL_QUOTA_LIMITS } = require('../config/trialConfig');
const { getPlansCatalog } = require('../services/subscriptionBillingService');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function run() {
  console.log('🧪 Running Phase (e) Universal Banners, Low Trial Limits & 3-Plan Mode Tests...\n');

  // ── 1. Universal Banner Visibility & Tenant Isolation ─────────────────────
  const sampleBanners = [
    {
      id: 'b-platform-all',
      scope: 'PLATFORM',
      college_id: null,
      title: 'Platform Notice',
      message: 'Scheduled maintenance tonight at 11 PM PKT.',
      variant: 'info',
      targetAudience: 'ALL_USERS',
      targetRoles: [],
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
    },
    {
      id: 'b-platform-panel',
      scope: 'PLATFORM',
      college_id: null,
      title: 'Admin Alert',
      message: 'New billing compliance policy effective.',
      variant: 'warning',
      targetAudience: 'ROLE_PANEL',
      targetRoles: ['admin', 'principal'],
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
    },
    {
      id: 'b-colA-all',
      scope: 'COLLEGE',
      college_id: 'col-A',
      title: 'College A Welcome',
      message: 'Annual sports week starts Monday!',
      variant: 'success',
      targetAudience: 'ALL_COLLEGE_USERS',
      targetRoles: [],
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
    },
    {
      id: 'b-colA-adminOnly',
      scope: 'COLLEGE',
      college_id: 'col-A',
      title: 'Office Staff Only',
      message: 'Submit audit sheets before Friday.',
      variant: 'urgent',
      targetAudience: 'ADMINISTRATION_ONLY',
      targetRoles: [],
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
    },
    {
      id: 'b-colA-teachStud',
      scope: 'COLLEGE',
      college_id: 'col-A',
      title: 'Exam Datesheet',
      message: 'Mid-term exams begin next week.',
      variant: 'info',
      targetAudience: 'TEACHERS_AND_STUDENTS',
      targetRoles: [],
      isActive: true,
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
    },
  ];

  // Super Admin sees platform ALL_USERS, not college banners, not role_panel for admin/principal
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[0], { role: 'superAdmin' }), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[1], { role: 'superAdmin' }), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[2], { role: 'superAdmin' }), false);

  // College A Admin sees platform ALL, platform ROLE_PANEL(admin), College A ALL, College A ADMIN_ONLY, NOT TEACHERS_AND_STUDENTS
  const colAAdmin = { role: 'admin', college_id: 'col-A' };
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[0], colAAdmin), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[1], colAAdmin), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[2], colAAdmin), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[3], colAAdmin), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[4], colAAdmin), false);

  // College A Accountant (administration role) sees ADMIN_ONLY, not TEACHERS_AND_STUDENTS
  const colAAccountant = { role: 'accountant', college_id: 'col-A' };
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[3], colAAccountant), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[4], colAAccountant), false);

  // College A Teacher & Student see ALL_COLLEGE_USERS & TEACHERS_AND_STUDENTS, NOT ADMIN_ONLY, NOT platform admin panel
  const colATeacher = { role: 'teacher', college_id: 'col-A' };
  const colAStudent = { role: 'student', college_id: 'col-A' };
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[1], colATeacher), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[2], colATeacher), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[3], colATeacher), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[4], colATeacher), true);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[3], colAStudent), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[4], colAStudent), true);

  // College B Admin NEVER sees any College A tenant banners
  const colBAdmin = { role: 'admin', college_id: 'col-B' };
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[2], colBAdmin), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[3], colBAdmin), false);
  assert.strictEqual(bannerService.isBannerVisibleToUser(sampleBanners[4], colBAdmin), false);

  // Mock Prisma for cross-tenant update/delete guard
  const mockPrismaForBanners = {
    announcementBanner: {
      findUnique: async ({ where }) => sampleBanners.find((b) => b.id === where.id) || null,
      update: async ({ where, data }) => ({ id: where.id, ...data }),
      delete: async ({ where }) => ({ id: where.id }),
    },
  };

  await assert.rejects(
    () => bannerService.updateBanner(mockPrismaForBanners, {
      id: 'b-colA-all',
      scope: 'COLLEGE',
      collegeId: 'col-B',
      body: { message: 'Tampered' },
    }),
    (err) => err.status === 404 && err.code === 'BANNER_NOT_FOUND'
  );
  await assert.rejects(
    () => bannerService.deleteBanner(mockPrismaForBanners, {
      id: 'b-platform-all',
      scope: 'COLLEGE',
      collegeId: 'col-A',
    }),
    (err) => err.status === 404 && err.code === 'BANNER_NOT_FOUND'
  );

  // Controller rejects non-superAdmin from platform endpoints with 403
  const forbiddenRes1 = makeRes();
  await bannerController.listPlatformBanners({ user: colAAdmin }, forbiddenRes1);
  assert.strictEqual(forbiddenRes1.statusCode, 403);

  const forbiddenRes2 = makeRes();
  await bannerController.createPlatformBanner({ user: colATeacher, body: { message: 'Hack' } }, forbiddenRes2);
  assert.strictEqual(forbiddenRes2.statusCode, 403);

  console.log('  ✔ Universal banner audience targeting, role filtering & cross-tenant isolation pass');

  // ── 2. Low Free Trial Limits vs Paid Plan Limits ──────────────────────────
  const now = new Date();
  const futureTrialEnd = new Date(now.getTime() + 10 * 86400000);
  const futurePaidEnd = new Date(now.getTime() + 25 * 86400000);

  const trialCollege = {
    id: 'col-trial',
    name: 'Trial College',
    isActive: true,
    subStatus: 'TRIAL',
    trialStartedAt: new Date(now.getTime() - 4 * 86400000),
    trialEndsAt: futureTrialEnd,
    periodEnd: null,
    billingCycle: 'MONTHLY',
    subscription: { plan: 'standard', status: 'trial' },
    feature_overrides: {},
    settings: {},
  };

  const paidStandardCollege = {
    id: 'col-paid',
    name: 'Paid Standard College',
    isActive: true,
    subStatus: 'ACTIVE',
    trialStartedAt: null,
    trialEndsAt: null,
    periodStart: new Date(now.getTime() - 5 * 86400000),
    periodEnd: futurePaidEnd,
    billingCycle: 'MONTHLY',
    subscription: { plan: 'standard', status: 'active' },
    feature_overrides: {},
    settings: {},
  };

  const makeMockDbForCollege = (col) => ({
    college: {
      findUnique: async () => col,
    },
    collegeAddon: {
      findMany: async () => [],
    },
    planVersion: {
      findUnique: async () => null,
    },
  });

  const trialDb = makeMockDbForCollege(trialCollege);
  const trialEnt = await getEntitlements('col-trial', trialDb);
  assert.strictEqual(trialEnt.isTrialLimits, true);
  assert.strictEqual(trialEnt.effectiveLimits.maxStudents, TRIAL_QUOTA_LIMITS.maxStudents);
  assert.strictEqual(trialEnt.effectiveLimits.maxStaff, TRIAL_QUOTA_LIMITS.maxStaff);
  assert.strictEqual(trialEnt.effectiveLimits.maxAdmins, TRIAL_QUOTA_LIMITS.maxAdmins);
  assert.strictEqual(trialEnt.effectiveLimits.maxStorageBytes, TRIAL_QUOTA_LIMITS.maxStorageBytes);
  assert.strictEqual(trialEnt.effectiveLimits.maxApplications, TRIAL_QUOTA_LIMITS.maxApplications);
  assert.strictEqual(trialEnt.effectiveLimits.aiCreditsMonthly, TRIAL_QUOTA_LIMITS.aiCreditsMonthly);

  assert.strictEqual(await getCollegeLimit(trialDb, 'col-trial', 'students'), TRIAL_QUOTA_LIMITS.maxStudents);
  assert.strictEqual(await getCollegeLimit(trialDb, 'col-trial', 'staff'), TRIAL_QUOTA_LIMITS.maxStaff);

  const paidDb = makeMockDbForCollege(paidStandardCollege);
  const paidEnt = await getEntitlements('col-paid', paidDb);
  assert.strictEqual(paidEnt.isTrialLimits, false);
  assert.ok(paidEnt.effectiveLimits.maxStudents >= 750, `Expected paid standard maxStudents >= 750, got ${paidEnt.effectiveLimits.maxStudents}`);
  assert.strictEqual(await getCollegeLimit(paidDb, 'col-paid', 'students'), paidEnt.effectiveLimits.maxStudents);

  console.log('  ✔ Free trial enforces low TRIAL_QUOTA_LIMITS while paid colleges receive full plan limits');

  // ── 3. THREE_PLAN_MODE=true Catalog Verification ──────────────────────────
  const prevThreePlan = process.env.THREE_PLAN_MODE;
  process.env.THREE_PLAN_MODE = 'true';
  try {
    const emptyPrisma = {
      subscription: { findMany: async () => [] },
      addonCatalog: { findMany: async () => [] },
      planVersion: { findMany: async () => [] },
    };
    const catalog = await getPlansCatalog(emptyPrisma);
    const planIds = catalog.plans.map((p) => p.planId);
    assert.deepStrictEqual(planIds, ['starter', 'standard', 'premium']);

    const byId = Object.fromEntries(catalog.plans.map((p) => [p.planId, p]));
    assert.strictEqual(byId.starter.monthlyPrice, 2999);
    assert.strictEqual(byId.starter.yearlyPrice, 32989);
    assert.strictEqual(byId.standard.monthlyPrice, 5999);
    assert.strictEqual(byId.standard.yearlyPrice, 65989);
    assert.strictEqual(byId.premium.monthlyPrice, 14999);
    assert.strictEqual(byId.premium.yearlyPrice, 164989);
    assert.strictEqual(byId.enterprise, undefined, 'Legacy Enterprise plan must NOT appear in 3-plan mode');

    console.log('  ✔ THREE_PLAN_MODE=true serves exact 3 canonical plans (Starter/Standard/Premium)');
  } finally {
    if (prevThreePlan === undefined) delete process.env.THREE_PLAN_MODE;
    else process.env.THREE_PLAN_MODE = prevThreePlan;
  }

  console.log('\n✅ All Phase (e) tests passed!');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
