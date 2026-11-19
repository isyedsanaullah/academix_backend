'use strict';

const assert = require('assert');

process.env.NODE_ENV = 'test';

const { PLAN_PRICING } = require('../config/planConstants');
const {
  createSubscriptionCheckout,
} = require('../services/subscriptionBillingService');

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function makeFullMockPrisma() {
  const now = new Date();
  const state = {
    colleges: [
      {
        id: 'col_std',
        name: 'Lahore Beacon College',
        code: 'LBC-01',
        email: 'admin@lbc.edu.pk',
        city: 'Lahore',
        isActive: true,
        planId: 'standard',
        billingCycle: 'TRIAL',
        subStatus: 'TRIAL',
        trialStartedAt: new Date(now.getTime() - 5 * 86400000),
        trialEndsAt: new Date(now.getTime() + 9 * 86400000),
        periodStart: null,
        periodEnd: null,
        forceReadOnly: false,
        readOnlyReason: null,
        activeSubscriptionId: null,
        deletedAt: null,
        tokenEpoch: 0,
        createdAt: now,
      },
      {
        id: 'col_exp',
        name: 'Multan Expired College',
        code: 'MEC-02',
        email: 'admin@mec.edu.pk',
        city: 'Multan',
        isActive: true,
        planId: 'starter',
        billingCycle: 'MONTHLY',
        subStatus: 'EXPIRED',
        trialStartedAt: new Date(now.getTime() - 20 * 86400000),
        trialEndsAt: new Date(now.getTime() - 6 * 86400000),
        periodStart: null,
        periodEnd: null,
        forceReadOnly: true,
        readOnlyReason: 'TRIAL_EXPIRED',
        activeSubscriptionId: null,
        deletedAt: null,
        tokenEpoch: 0,
        createdAt: now,
      },
    ],
    users: [
      { id: 'u_lbc_admin', email: 'admin@lbc.edu.pk', role: 'admin', college_id: 'col_std', isActive: true },
      { id: 'u_mec_admin', email: 'admin@mec.edu.pk', role: 'admin', college_id: 'col_exp', isActive: true },
    ],
    planVersions: [],
    collegeSubscriptions: [],
    platformInvoices: [],
    invoiceProofSubmissions: [],
    collegeAddons: [],
    collegeUsages: [],
    collegeCreditBalances: [],
    collegeSubscriptionPayments: [],
    collegeQuotaOverrides: [],
    collegeFeatureOverrides: [],
    verifyTokens: [],
    audits: [],
    auditLogs: [],
    notifications: [],
  };

  const matchCollegeWhere = (c, where = {}) => {
    if (where.id && c.id !== where.id) return false;
    if (where.deletedAt === null && c.deletedAt !== null) return false;
    return true;
  };

  const prisma = {
    college: {
      findMany: async ({ where = {} } = {}) => state.colleges.filter((c) => matchCollegeWhere(c, where)),
      findUnique: async ({ where }) => {
        const col = state.colleges.find((c) => c.id === where.id);
        return col ? { ...col, featureOverrides: [] } : null;
      },
      update: async ({ where, data }) => {
        const col = state.colleges.find((c) => c.id === where.id);
        if (!col) throw new Error('College not found');
        for (const [k, v] of Object.entries(data)) {
          if (k === 'tokenEpoch' && v && typeof v === 'object' && v.increment) {
            col.tokenEpoch = (col.tokenEpoch || 0) + v.increment;
          } else {
            col[k] = v;
          }
        }
        return { ...col };
      },
    },
    user: {
      findMany: async ({ where = {} } = {}) =>
        state.users.filter((u) => {
          if (where.college_id && u.college_id !== where.college_id) return false;
          if (where.role && u.role !== where.role) return false;
          if (where.isActive !== undefined && u.isActive !== where.isActive) return false;
          return true;
        }),
    },
    subscription: { findMany: async () => [] },
    planVersion: {
      findMany: async () => [...state.planVersions].sort((a, b) => (b.version || 0) - (a.version || 0)),
      findFirst: async ({ where = {} } = {}) => {
        const list = state.planVersions
          .filter((pv) => !where.planId || pv.planId === where.planId)
          .sort((a, b) => (b.version || 0) - (a.version || 0));
        return list[0] || null;
      },
      findUnique: async () => null,
    },
    addonCatalog: { findMany: async () => [] },
    collegeUsage: { findMany: async () => [] },
    collegeCreditBalance: { findMany: async () => [] },
    messageCreditLedgerEntry: { findFirst: async () => ({ balanceAfter: 0 }), create: async ({ data }) => data, aggregate: async () => ({ _sum: { delta: 0 } }) },
    aICreditLedgerEntry: { findFirst: async () => ({ balanceAfter: 0 }), create: async ({ data }) => data, aggregate: async () => ({ _sum: { delta: 0 } }) },
    collegeSubscriptionPayment: { findFirst: async () => null },
    collegeAddon: {
      findMany: async ({ where = {} } = {}) =>
        state.collegeAddons.filter((a) => a.college_id === where.college_id),
      create: async ({ data }) => {
        const rec = { id: `cadd_${state.collegeAddons.length + 1}`, createdAt: new Date(), ...data };
        state.collegeAddons.push(rec);
        return rec;
      },
    },
    collegeSubscription: {
      findMany: async ({ where = {} } = {}) =>
        state.collegeSubscriptions
          .filter((s) => {
            if (where.college_id && typeof where.college_id === 'string' && s.college_id !== where.college_id) return false;
            if (where.college_id?.in && !where.college_id.in.includes(s.college_id)) return false;
            return true;
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      findUnique: async ({ where }) => state.collegeSubscriptions.find((s) => s.id === where.id) || null,
      findFirst: async ({ where = {} } = {}) => {
        const list = state.collegeSubscriptions.filter((s) => {
          if (where.college_id && s.college_id !== where.college_id) return false;
          if (where.status && s.status !== where.status) return false;
          return true;
        });
        return list[list.length - 1] || null;
      },
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const s of state.collegeSubscriptions) {
          if (
            (!where.college_id || s.college_id === where.college_id) &&
            (!where.status || s.status === where.status) &&
            (!where.id?.not || s.id !== where.id.not)
          ) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const rec = { id: `csub_${state.collegeSubscriptions.length + 1}`, createdAt: new Date(), ...data };
        state.collegeSubscriptions.push(rec);
        return { ...rec };
      },
      update: async ({ where, data }) => {
        const rec = state.collegeSubscriptions.find((s) => s.id === where.id);
        if (!rec) throw new Error('CollegeSubscription not found');
        Object.assign(rec, data);
        return { ...rec };
      },
    },
    platformInvoice: {
      findMany: async ({ where = {} } = {}) =>
        state.platformInvoices
          .filter((i) => {
            if (where.college_id && typeof where.college_id === 'string' && i.college_id !== where.college_id) return false;
            if (where.college_id?.in && !where.college_id.in.includes(i.college_id)) return false;
            return true;
          })
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      findUnique: async ({ where }) => state.platformInvoices.find((i) => i.id === where.id) || null,
      findFirst: async ({ where = {} } = {}) => {
        const list = state.platformInvoices.filter((i) => {
          if (where.college_id && i.college_id !== where.college_id) return false;
          if (typeof where.status === 'string' && i.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(i.status)) return false;
          if (where.status?.notIn && where.status.notIn.includes(i.status)) return false;
          return true;
        });
        return list[list.length - 1] || null;
      },
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const i of state.platformInvoices) {
          const stMatch = !where.status || (where.status.in ? where.status.in.includes(i.status) : i.status === where.status);
          if ((!where.college_id || i.college_id === where.college_id) && stMatch) {
            Object.assign(i, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const rec = { id: `inv_${state.platformInvoices.length + 1}`, createdAt: new Date(), ...data };
        state.platformInvoices.push(rec);
        return { ...rec };
      },
      update: async ({ where, data }) => {
        const rec = state.platformInvoices.find((i) => i.id === where.id);
        if (!rec) throw new Error('Invoice not found');
        Object.assign(rec, data);
        return { ...rec };
      },
    },
    invoiceProofSubmission: {
      create: async ({ data }) => {
        const rec = { id: `subm_${state.invoiceProofSubmissions.length + 1}`, createdAt: new Date(), ...data };
        state.invoiceProofSubmissions.push(rec);
        return rec;
      },
      findMany: async ({ where = {} } = {}) =>
        state.invoiceProofSubmissions.filter((s) => {
          if (where.invoiceId && s.invoiceId !== where.invoiceId) return false;
          if (where.college_id && s.college_id !== where.college_id) return false;
          return true;
        }),
      updateMany: async ({ where = {}, data }) => {
        let count = 0;
        for (const s of state.invoiceProofSubmissions) {
          if (
            (!where.invoiceId || s.invoiceId === where.invoiceId) &&
            (!where.status || s.status === where.status)
          ) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
    },
    collegeEntitlementAudit: {
      create: async ({ data }) => {
        const rec = { id: `aud_${state.audits.length + 1}`, createdAt: new Date(), ...data };
        state.audits.push(rec);
        return rec;
      },
      findMany: async ({ where = {} } = {}) =>
        state.audits
          .filter((a) => (!where.college_id || a.college_id === where.college_id) && (!where.action || a.action === where.action))
          .map((a) => {
            const col = state.colleges.find((c) => c.id === a.college_id);
            return { ...a, college: col ? { id: col.id, name: col.name, code: col.code } : null };
          })
          .reverse(),
      count: async ({ where = {} } = {}) =>
        state.audits.filter((a) => (!where.college_id || a.college_id === where.college_id) && (!where.action || a.action === where.action)).length,
    },
    auditLog: {
      create: async ({ data }) => {
        const rec = { id: `alog_${state.auditLogs.length + 1}`, createdAt: new Date(), ...data };
        state.auditLogs.push(rec);
        return rec;
      },
    },
    verifyToken: { create: async ({ data }) => { state.verifyTokens.push(data); return data; } },
    notification: { createMany: async ({ data }) => { state.notifications.push(...data); return { count: data.length }; } },
    $transaction: async (fn) => fn(prisma),
  };

  return { prisma, state };
}

async function run() {
  console.log('🧪 Running Phase (d) Super Admin Billing, Audit Log & Price-Lock Tests...\n');

  const { prisma, state } = makeFullMockPrisma();
  const sentEmails = [];

  // Mock prismaManager & mailService for controller/service tests
  const dbPath = require.resolve('../config/prismaManager');
  const mailPath = require.resolve('../services/mailService');
  const origDb = require.cache[dbPath];
  const origMail = require.cache[mailPath];

  require.cache[dbPath] = { exports: { getSystemClient: () => prisma } };
  require.cache[mailPath] = {
    exports: {
      ...require('../services/mailService'),
      sendBillingDecisionEmail: async (to, data) => { sentEmails.push({ to, ...data }); },
    },
  };

  delete require.cache[require.resolve('../services/superAdminBillingService')];
  delete require.cache[require.resolve('../controllers/superAdminBilling.controller')];
  delete require.cache[require.resolve('../controllers/subscription.controller')];

  const {
    getBillingOverview,
    approveBillingInvoice,
    denyBillingInvoice,
    manualToggleCollegeSubscription,
    getBillingAuditLogs,
  } = require('../services/superAdminBillingService');
  const {
    getBillingOverviewHandler,
    approveInvoiceHandler,
    denyInvoiceHandler,
    deactivateCollegeSubscriptionHandler,
  } = require('../controllers/superAdminBilling.controller');
  const { getCurrentSubscription } = require('../controllers/subscription.controller');

  try {
    // 1. Strict Super Admin RBAC check on billing handlers (403 for college admin / teacher)
    const r1 = makeRes();
    await getBillingOverviewHandler({ user: { id: 'u_lbc_admin', role: 'admin' }, query: {} }, r1);
    assert.strictEqual(r1.statusCode, 403);
    const r2 = makeRes();
    await approveInvoiceHandler({ user: { id: 'u_t', role: 'teacher' }, params: { invoiceId: 'x' } }, r2);
    assert.strictEqual(r2.statusCode, 403);
    const r3 = makeRes();
    await denyInvoiceHandler({ user: { id: 'u_a', role: 'accountant' }, params: { invoiceId: 'x' }, body: { reason: 'no' } }, r3);
    assert.strictEqual(r3.statusCode, 403);
    const r4 = makeRes();
    await deactivateCollegeSubscriptionHandler({ user: { id: 'u_lbc_admin', role: 'admin' }, params: { collegeId: 'col_std' } }, r4);
    assert.strictEqual(r4.statusCode, 403);
    console.log('  ✔ Super Admin billing endpoints reject non-superAdmin roles with 403 Forbidden');

    // 2. College purchases Standard Yearly (PKR 65,989) + add-on, paid slightly AFTER due date
    const co1 = await createSubscriptionCheckout(prisma, {
      collegeId: 'col_std',
      userId: 'u_lbc_admin',
      planId: 'standard',
      billingCycle: 'YEARLY',
      lineItems: [{ addonType: 'STUDENTS', quantity: 10 }],
    });
    const inv1 = state.platformInvoices.find((i) => i.id === co1.invoice.id);
    // Simulate late payment after dueDate & proof upload
    inv1.dueDate = new Date(Date.now() - 3 * 86400000);
    inv1.status = 'PENDING_REVIEW';
    inv1.proofObjectKey = 'colleges/col_std/proof1.png';
    state.invoiceProofSubmissions.push({
      id: 'subm_initial',
      invoiceId: inv1.id,
      college_id: 'col_std',
      objectKey: inv1.proofObjectKey,
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'PENDING_REVIEW',
      submittedBy: 'admin@lbc.edu.pk',
      createdAt: new Date(),
    });

    // 3. Super Admin approves invoice -> activates term from NOW (not back-dated to past dueDate), locks price, enables add-ons, logs audit & sends email
    const approved = await approveBillingInvoice(prisma, {
      invoiceId: inv1.id,
      adminUserId: 'sa_1',
      adminEmail: 'superadmin@academix.io',
      note: 'Verified in UBL statement (late payment)',
      ipAddress: '127.0.0.1',
    });

    assert.strictEqual(approved.invoice.status, 'APPROVED');
    assert.strictEqual(approved.subscription.status, 'ACTIVE');
    assert.strictEqual(approved.subscription.planPricePkr, PLAN_PRICING.standard.yearly);
    assert.strictEqual(approved.college.subStatus, 'ACTIVE');
    assert.strictEqual(approved.college.activeSubscriptionId, approved.subscription.id);
    assert.ok(new Date(approved.subscription.endsAt) > new Date(Date.now() + 360 * 86400000));
    assert.strictEqual(state.collegeAddons.length, 1);
    assert.strictEqual(state.collegeAddons[0].addonType, 'STUDENTS');
    assert.strictEqual(state.collegeAddons[0].quantity, 10);
    assert.ok(state.audits.some((a) => a.action === 'BILLING_INVOICE_APPROVED'));
    assert.ok(state.auditLogs.some((a) => a.action === 'BILLING_INVOICE_APPROVED'));
    assert.strictEqual(sentEmails.length, 1);
    assert.strictEqual(sentEmails[0].decision, 'APPROVED');
    console.log('  ✔ Invoice approval activates subscription (even post-dueDate), unlocks college, applies add-ons, writes audit & emails admin');

    // 4. Price Lock Enforcement (Task 8): increase Standard Yearly list price to PKR 78,000 mid-term
    state.planVersions.push({
      id: 'pv_new',
      planId: 'standard',
      version: 2,
      pricesJson: { monthlyPkr: 7200, yearlyPkr: 78000 },
    });

    const curRes = makeRes();
    await getCurrentSubscription({ collegeId: 'col_std', user: { id: 'u_lbc_admin', college_id: 'col_std' } }, curRes);
    assert.strictEqual(curRes.statusCode, 200);
    assert.strictEqual(
      curRes.body.data.activeSubscription.planPricePkr,
      PLAN_PRICING.standard.yearly,
      'Active subscription must remain locked at original agreed price PKR 65,989'
    );
    assert.deepStrictEqual(curRes.body.data.priceChangedOnRenewal, {
      lockedPlanPricePkr: PLAN_PRICING.standard.yearly,
      currentListPlanPricePkr: 78000,
      billingCycle: 'YEARLY',
      planId: 'standard',
    });

    // Renewal checkout creates a NEW subscription & invoice at current live catalog price (78,000), leaving active locked sub at 65,989 intact!
    const renewalCheckout = await createSubscriptionCheckout(prisma, {
      collegeId: 'col_std',
      userId: 'u_lbc_admin',
      planId: 'standard',
      billingCycle: 'YEARLY',
      lineItems: [],
    });
    assert.strictEqual(renewalCheckout.subscription.planPricePkr, 78000);
    assert.strictEqual(Number(renewalCheckout.invoice.amount), 78000);
    assert.strictEqual(approved.subscription.planPricePkr, PLAN_PRICING.standard.yearly);
    console.log('  ✔ Price lock keeps active term at 65,989 PKR on list price change & surfaces priceChangedOnRenewal for next term');

    // 5. Deny payment workflow (requires reason, notifies college, leaves EXPIRED college locked)
    const coExp = await createSubscriptionCheckout(prisma, {
      collegeId: 'col_exp',
      userId: 'u_mec_admin',
      planId: 'starter',
      billingCycle: 'MONTHLY',
      lineItems: [],
    });
    const invExp = state.platformInvoices.find((i) => i.id === coExp.invoice.id);
    invExp.status = 'PENDING_REVIEW';

    await assert.rejects(
      () => denyBillingInvoice(prisma, { invoiceId: invExp.id, adminUserId: 'sa_1', reason: 'no' }),
      (err) => err.code === 'MISSING_DENIAL_REASON' && err.status === 400
    );

    const denied = await denyBillingInvoice(prisma, {
      invoiceId: invExp.id,
      adminUserId: 'sa_1',
      adminEmail: 'superadmin@academix.io',
      reason: 'Transaction ID did not match UBL statement',
      ipAddress: '127.0.0.1',
    });
    assert.strictEqual(denied.invoice.status, 'REJECTED');
    assert.strictEqual(denied.invoice.rejectionReason, 'Transaction ID did not match UBL statement');
    assert.strictEqual(state.colleges.find((c) => c.id === 'col_exp').forceReadOnly, true, 'Denied invoice must not unlock EXPIRED college');
    assert.strictEqual(sentEmails[sentEmails.length - 1].decision, 'REJECTED');
    console.log('  ✔ Invoice rejection records reason, leaves expired college locked & emails re-upload prompt');

    // 6. Manual Activate / Deactivate + Overview Search/Filters + Audit Trail
    const epochBefore = state.colleges.find((c) => c.id === 'col_std').tokenEpoch;
    const deact = await manualToggleCollegeSubscription(prisma, {
      collegeId: 'col_std',
      action: 'DEACTIVATE',
      reason: 'Policy review hold',
      adminUserId: 'sa_1',
      adminEmail: 'superadmin@academix.io',
    });
    assert.strictEqual(deact.college.subStatus, 'DEACTIVATED');
    assert.strictEqual(deact.college.forceReadOnly, true);
    assert.strictEqual(deact.college.tokenEpoch, epochBefore + 1);

    const react = await manualToggleCollegeSubscription(prisma, {
      collegeId: 'col_std',
      action: 'ACTIVATE',
      reason: 'Hold cleared',
      adminUserId: 'sa_1',
      adminEmail: 'superadmin@academix.io',
    });
    assert.strictEqual(react.college.subStatus, 'ACTIVE');
    assert.strictEqual(react.college.forceReadOnly, false);

    const overviewAll = await getBillingOverview(prisma, { status: 'ALL', search: 'Beacon' });
    assert.strictEqual(overviewAll.rows.length, 1);
    assert.strictEqual(overviewAll.rows[0].college.code, 'LBC-01');

    const auditFeed = await getBillingAuditLogs(prisma, { collegeId: 'col_std' });
    assert.ok(auditFeed.logs.some((l) => l.action === 'MANUAL_SUBSCRIPTION_DEACTIVATE'));
    assert.ok(auditFeed.logs.some((l) => l.action === 'MANUAL_SUBSCRIPTION_ACTIVATE'));
    console.log('  ✔ Manual Activate/Deactivate, overview search filters & audit logs verified\n');
    console.log('✅ All Phase (d) tests passed!');
  } finally {
    if (origDb) require.cache[dbPath] = origDb; else delete require.cache[dbPath];
    if (origMail) require.cache[mailPath] = origMail; else delete require.cache[mailPath];
    delete require.cache[require.resolve('../services/superAdminBillingService')];
    delete require.cache[require.resolve('../controllers/superAdminBilling.controller')];
    delete require.cache[require.resolve('../controllers/subscription.controller')];
  }
}

run().catch((err) => {
  console.error('❌ Phase (d) tests failed:', err);
  process.exit(1);
});
