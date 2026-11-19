'use strict';

const assert = require('assert');
const zlib = require('zlib');

process.env.NODE_ENV = 'test';

const {
  getPlansCatalog,
  calculateCheckoutQuote,
  createSubscriptionCheckout,
} = require('../services/subscriptionBillingService');
const { generateSubscriptionVoucherPDF, COPIES } = require('../services/documentTemplates/subscriptionVoucher');
const { PLAN_PRICING, PLAN_LIMITS } = require('../config/planConstants');

function collectPdfTextFromBuffer(pdfBuffer) {
  const raw = pdfBuffer.toString('latin1');
  const streams = [raw];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(raw)) !== null) {
    const chunk = Buffer.from(match[1], 'latin1');
    try {
      streams.push(zlib.inflateSync(chunk).toString('latin1'));
    } catch {
      // Not flate-compressed or binary image stream; ignore
    }
  }
  const combined = streams.join('\n');
  // Extract concatenated string literals and hex strings emitted by PDFKit text operators
  const extracted = [];
  const tokenRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9a-fA-F]+)>/g;
  let tok;
  while ((tok = tokenRe.exec(combined)) !== null) {
    if (tok[1] !== undefined) {
      extracted.push(tok[1].replace(/\\([()\\])/g, '$1'));
    } else if (tok[2] && tok[2].length % 2 === 0) {
      extracted.push(Buffer.from(tok[2], 'hex').toString('latin1'));
    }
  }
  return `${combined}\n${extracted.join('')}`;
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function makeMockPrisma({ college, activeSub = null, invoices = [], addons = [] } = {}) {
  const state = {
    college: { ...college },
    collegeSubscriptions: activeSub ? [{ ...activeSub }] : [],
    platformInvoices: invoices.map((i) => ({ ...i })),
    invoiceProofSubmissions: [],
    notifications: [],
    audits: [],
    verifyTokens: [],
  };

  const prisma = {
    college: {
      findUnique: async ({ where }) => {
        if (where.id === state.college.id) return { ...state.college };
        return null;
      },
      update: async ({ where, data }) => {
        assert.strictEqual(where.id, state.college.id);
        Object.assign(state.college, data);
        return { ...state.college };
      },
    },
    subscription: {
      findMany: async () => [],
    },
    planVersion: {
      findMany: async () => [],
    },
    addonCatalog: {
      findMany: async ({ where } = {}) => {
        if (!where) return addons;
        return addons.filter((a) => (!where.planId || a.planId === where.planId));
      },
    },
    collegeSubscription: {
      findUnique: async ({ where }) => state.collegeSubscriptions.find((s) => s.id === where.id) || null,
      findFirst: async ({ where }) => {
        const list = state.collegeSubscriptions.filter((s) => {
          if (where.college_id && s.college_id !== where.college_id) return false;
          if (where.status && s.status !== where.status) return false;
          return true;
        });
        return list[list.length - 1] || null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const s of state.collegeSubscriptions) {
          if (s.college_id === where.college_id && (!where.status || s.status === where.status)) {
            Object.assign(s, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const rec = { id: `csub_${state.collegeSubscriptions.length + 1}`, createdAt: new Date(), ...data };
        state.collegeSubscriptions.push(rec);
        return rec;
      },
    },
    platformInvoice: {
      findFirst: async ({ where } = {}) => {
        const list = state.platformInvoices.filter((inv) => {
          if (where.id && typeof where.id === 'string' && inv.id !== where.id) return false;
          if (where.id?.not && inv.id === where.id.not) return false;
          if (where.college_id && inv.college_id !== where.college_id) return false;
          if (where.referenceNumber && inv.referenceNumber !== where.referenceNumber) return false;
          if (typeof where.status === 'string' && inv.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(inv.status)) return false;
          return true;
        });
        return list[list.length - 1] || null;
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const inv of state.platformInvoices) {
          const statusMatch = !where.status || (where.status.in ? where.status.in.includes(inv.status) : inv.status === where.status);
          if (inv.college_id === where.college_id && statusMatch) {
            Object.assign(inv, data);
            count++;
          }
        }
        return { count };
      },
      create: async ({ data }) => {
        const inv = { id: `inv_${state.platformInvoices.length + 1}`, createdAt: new Date(), ...data };
        state.platformInvoices.push(inv);
        return inv;
      },
      update: async ({ where, data }) => {
        const inv = state.platformInvoices.find((i) => i.id === where.id);
        if (!inv) throw new Error('Invoice not found');
        Object.assign(inv, data);
        return { ...inv };
      },
    },
    invoiceProofSubmission: {
      create: async ({ data }) => {
        const rec = { id: `subm_${state.invoiceProofSubmissions.length + 1}`, createdAt: new Date(), ...data };
        state.invoiceProofSubmissions.push(rec);
        return rec;
      },
    },
    verifyToken: {
      create: async ({ data }) => {
        state.verifyTokens.push(data);
        return data;
      },
    },
    collegeEntitlementAudit: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
    user: {
      findMany: async () => [{ id: 'sa_1', email: 'superadmin@collegeshub.org', role: 'superAdmin', isActive: true }],
    },
    notification: {
      createMany: async ({ data }) => {
        state.notifications.push(...data);
        return { count: data.length };
      },
    },
    $transaction: async (fn) => fn(prisma),
  };

  return { prisma, state };
}

async function run() {
  console.log('🧪 Running Phase (c) Plan Checkout, 3-Copy Voucher PDF & Proof Upload Tests...\n');

  // 1. Dynamic catalog (no hardcoded prices; reflects planConstants)
  const { prisma: catPrisma } = makeMockPrisma({
    college: { id: 'col_1', name: 'Margalla Science College', code: 'MSC-01', planId: 'standard', subStatus: 'TRIAL' },
  });
  const catalog = await getPlansCatalog(catPrisma, 'col_1');
  assert.ok(Array.isArray(catalog.plans) && catalog.plans.length >= 3, 'Catalog should include starter, standard, premium');
  const starterPlan = catalog.plans.find((p) => p.planId === 'starter');
  const standardPlan = catalog.plans.find((p) => p.planId === 'standard');
  const premiumPlan = catalog.plans.find((p) => p.planId === 'premium');
  assert.strictEqual(starterPlan.monthlyPrice, PLAN_PRICING.starter.monthly);
  assert.strictEqual(standardPlan.yearlyPrice, PLAN_PRICING.standard.yearly);
  assert.strictEqual(standardPlan.limits.maxStudents, PLAN_LIMITS.standard.maxStudents);
  assert.strictEqual(catalog.bankDetails.bankName.includes('United Bank Limited'), true);
  assert.ok(premiumPlan.addons.some((a) => a.addonType === 'STUDENTS' && a.isPurchasable));
  console.log('  ✔ getPlansCatalog returns live plans, limits, services & add-ons from canonical config');

  // 2. Quote calculation: monthly, yearly, add-on validation & caps, and locked-price proration flag
  const quoteYearlyWithAddons = await calculateCheckoutQuote(catPrisma, {
    collegeId: 'col_1',
    planId: 'standard',
    billingCycle: 'YEARLY',
    lineItems: [{ addonType: 'STUDENTS', quantity: 50 }],
  });
  const studentsAddon = standardPlan.addons.find((a) => a.addonType === 'STUDENTS');
  assert.strictEqual(quoteYearlyWithAddons.planPricePkr, PLAN_PRICING.standard.yearly);
  assert.strictEqual(quoteYearlyWithAddons.addonsSubtotalPkr, studentsAddon.unitPriceYearlyPkr * 50);
  assert.strictEqual(
    quoteYearlyWithAddons.totalPkr,
    PLAN_PRICING.standard.yearly + studentsAddon.unitPriceYearlyPkr * 50
  );

  await assert.rejects(
    () => calculateCheckoutQuote(catPrisma, {
      collegeId: 'col_1',
      planId: 'standard',
      billingCycle: 'MONTHLY',
      lineItems: [{ addonType: 'STUDENTS', quantity: 99999 }],
    }),
    (err) => err.code === 'ADDON_CAP_EXCEEDED' && err.status === 400
  );

  // Mid-term upgrade proration calculated from LOCKED price (NOT live list price!)
  const futureEnd = new Date(Date.now() + 15 * 86400000);
  const { prisma: upgradePrisma } = makeMockPrisma({
    college: {
      id: 'col_upg',
      name: 'Locked Rate College',
      code: 'LRC-1',
      planId: 'starter',
      billingCycle: 'MONTHLY',
      subStatus: 'ACTIVE',
      periodEnd: futureEnd,
      activeSubscriptionId: 'sub_locked_1',
    },
    activeSub: {
      id: 'sub_locked_1',
      college_id: 'col_upg',
      status: 'ACTIVE',
      planId: 'starter',
      planPricePkr: 2400, // historical locked rate instead of current 2999
      billingCycle: 'MONTHLY',
    },
  });

  process.env.ENABLE_UPGRADE_PRORATION = 'true';
  const upgradeQuoteOn = await calculateCheckoutQuote(upgradePrisma, {
    collegeId: 'col_upg',
    planId: 'standard',
    billingCycle: 'MONTHLY',
    lineItems: [],
  });
  assert.strictEqual(upgradeQuoteOn.isUpgrade, true);
  // 14 or 15 full days remaining depending on millisecond tick -> ~1120 or 1200 PKR from locked 2400, NOT from 2999!
  assert.ok(
    upgradeQuoteOn.prorationCreditPkr >= 1100 && upgradeQuoteOn.prorationCreditPkr <= 1250,
    `Expected proration credit derived from locked 2400, got ${upgradeQuoteOn.prorationCreditPkr}`
  );

  process.env.ENABLE_UPGRADE_PRORATION = 'false';
  const upgradeQuoteOff = await calculateCheckoutQuote(upgradePrisma, {
    collegeId: 'col_upg',
    planId: 'standard',
    billingCycle: 'MONTHLY',
    lineItems: [],
  });
  assert.strictEqual(upgradeQuoteOff.prorationCreditPkr, 0);
  delete process.env.ENABLE_UPGRADE_PRORATION;
  console.log('  ✔ calculateCheckoutQuote enforces add-on caps and uses locked price for mid-term proration');

  // 3. Checkout creation: CollegeSubscription (PENDING_PAYMENT), PlatformInvoice (UNPAID), voids old UNPAID, blocks PENDING_REVIEW
  const { prisma: coPrisma, state: coState } = makeMockPrisma({
    college: {
      id: 'col_co',
      name: 'Indus Valley College',
      code: 'IVC-99',
      planId: 'standard',
      subStatus: 'TRIAL',
      trialEndsAt: new Date(Date.now() + 5 * 86400000),
    },
    invoices: [
      { id: 'old_unpaid', college_id: 'col_co', status: 'UNPAID', invoiceNo: 'INV-2026-OLD' },
    ],
  });

  const checkoutResult = await createSubscriptionCheckout(coPrisma, {
    collegeId: 'col_co',
    userId: 'admin_1',
    planId: 'premium',
    billingCycle: 'YEARLY',
    lineItems: [{ addonType: 'STUDENTS', quantity: 20 }],
  });

  assert.strictEqual(checkoutResult.subscription.status, 'PENDING_PAYMENT');
  assert.strictEqual(checkoutResult.subscription.planId, 'premium');
  assert.strictEqual(checkoutResult.subscription.planPricePkr, PLAN_PRICING.premium.yearly);
  assert.strictEqual(checkoutResult.invoice.status, 'UNPAID');
  assert.ok(checkoutResult.invoice.purpose.includes('Premium'));
  assert.strictEqual(coState.college.subStatus, 'PENDING_PAYMENT');
  assert.strictEqual(coState.platformInvoices[0].status, 'VOID', 'Prior UNPAID draft should be voided');

  // Simulate proof uploaded -> PENDING_REVIEW blocks another checkout
  checkoutResult.invoice.status = 'PENDING_REVIEW';
  await assert.rejects(
    () => createSubscriptionCheckout(coPrisma, {
      collegeId: 'col_co',
      userId: 'admin_1',
      planId: 'standard',
      billingCycle: 'MONTHLY',
      lineItems: [],
    }),
    (err) => err.code === 'INVOICE_PENDING_REVIEW' && err.status === 409
  );
  console.log('  ✔ createSubscriptionCheckout creates locked subscription + UNPAID invoice and blocks PENDING_REVIEW double checkout');

  // 4. 3-Copy UBL Pay Voucher PDF generation (<=5 items single-page 3-up & >5 items multi-page)
  const sampleInvoice = {
    ...checkoutResult.invoice,
    status: 'UNPAID',
    createdAt: new Date('2026-11-18T10:00:00Z'),
    dueDate: new Date('2026-11-25T10:00:00Z'),
  };
  const renderPdfToBuffer = (doc) => new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });

  const landscapeDoc = await generateSubscriptionVoucherPDF({
    invoice: sampleInvoice,
    college: { id: 'col_co', name: 'Indus Valley College', code: 'IVC-99' },
    verifyBaseUrl: 'https://www.collegeshub.org',
  });
  const landscapeBuf = await renderPdfToBuffer(landscapeDoc);
  assert.ok(landscapeBuf.slice(0, 5).toString() === '%PDF-', 'Generated output must be a valid PDF binary');
  const landscapeText = collectPdfTextFromBuffer(landscapeBuf);
  assert.strictEqual(COPIES.length, 3);
  for (const c of COPIES) {
    assert.ok(landscapeText.includes(c.title), `Voucher PDF missing '${c.title}'`);
  }
  assert.ok(landscapeText.includes('Indus Valley College'), 'Voucher PDF must include actual college name');
  assert.ok(landscapeText.includes('United Bank Limited'), 'Voucher PDF must include bank name');
  assert.ok(landscapeText.includes('UNPAID'), 'Voucher PDF must clearly show UNPAID status row');
  assert.ok(landscapeText.includes(sampleInvoice.invoiceNo), 'Voucher PDF must include invoice number');

  // >5 line items triggers 3 portrait pages (one full page per copy)
  const manyItemsInvoice = {
    ...sampleInvoice,
    lineItems: Array.from({ length: 7 }, (_, i) => ({
      name: `Extra Line Item #${i + 1}`,
      quantity: 1,
      subtotalPkr: 1000,
      status: 'UNPAID',
    })),
  };
  const portraitDoc = await generateSubscriptionVoucherPDF({
    invoice: manyItemsInvoice,
    college: { id: 'col_co', name: 'Indus Valley College', code: 'IVC-99' },
    verifyBaseUrl: 'https://www.collegeshub.org',
  });
  const portraitBuf = await renderPdfToBuffer(portraitDoc);
  const pageMatches = portraitBuf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) || [];
  assert.strictEqual(pageMatches.length, 3, 'PDF with >5 line items should produce 3 pages (1 per copy)');
  console.log('  ✔ 3-copy UBL voucher PDF renders Bank/College/Accounts copies (1-page 3-up & 3-page overflow)');

  // 5. Payment proof upload controller tests (magic bytes, size cap, tenant isolation, re-upload on REJECTED)
  const { prisma: proofPrisma, state: proofState } = makeMockPrisma({
    college: { id: 'col_proof', name: 'Capital Degree College', code: 'CDC-10', planId: 'standard', subStatus: 'TRIAL' },
    invoices: [
      { id: 'inv_unpaid', college_id: 'col_proof', invoiceNo: 'INV-2026-001', amount: 65989, status: 'UNPAID' },
      { id: 'inv_rejected', college_id: 'col_proof', invoiceNo: 'INV-2026-002', amount: 65989, status: 'REJECTED', rejectionReason: 'Blurry photo' },
      { id: 'inv_other', college_id: 'col_other_college', invoiceNo: 'INV-2026-999', amount: 5999, status: 'UNPAID' },
    ],
  });

  // Mock prismaManager/storage/mail dependencies cleanly in Node require.cache for unit testing controller handler
  const dbPath = require.resolve('../config/prismaManager');
  const storagePath = require.resolve('../services/storageService');
  const mailPath = require.resolve('../services/mailService');
  const origDb = require.cache[dbPath];
  const origStorage = require.cache[storagePath];
  const origMail = require.cache[mailPath];

  const sentEmails = [];
  const uploadedKeys = [];
  const realStorage = require('../services/storageService');

  require.cache[dbPath] = { exports: { getSystemClient: () => proofPrisma } };
  require.cache[storagePath] = {
    exports: {
      ...realStorage,
      uploadObject: async ({ objectKey }) => { uploadedKeys.push(objectKey); return { objectKey }; },
    },
  };
  require.cache[mailPath] = {
    exports: {
      ...require('../services/mailService'),
      sendBillingProofSubmittedEmail: async (to, data) => { sentEmails.push({ to, data }); },
    },
  };
  delete require.cache[require.resolve('../controllers/subscription.controller')];
  const { uploadInvoiceProofHandler } = require('../controllers/subscription.controller');

  try {
    const validPngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const validPdfBuf = Buffer.from('%PDF-1.4\n%fake-receipt');

    // A) Spoofed MIME / invalid signature rejected
    const badSigRes = makeRes();
    await uploadInvoiceProofHandler({
      collegeId: 'col_proof',
      user: { id: 'adm_1', email: 'admin@cdc.edu.pk' },
      params: { id: 'inv_unpaid' },
      body: {},
      file: { originalname: 'fake.png', mimetype: 'image/png', size: 12, buffer: Buffer.from('not-a-png-at-all') },
    }, badSigRes);
    assert.strictEqual(badSigRes.statusCode, 400);
    assert.strictEqual(badSigRes.body.code, 'INVALID_FILE_SIGNATURE');

    // B) Cross-tenant isolation -> 404
    const crossTenantRes = makeRes();
    await uploadInvoiceProofHandler({
      collegeId: 'col_proof',
      user: { id: 'adm_1', email: 'admin@cdc.edu.pk' },
      params: { id: 'inv_other' },
      body: {},
      file: { originalname: 'receipt.png', mimetype: 'image/png', size: validPngBuf.length, buffer: validPngBuf },
    }, crossTenantRes);
    assert.strictEqual(crossTenantRes.statusCode, 404);

    // C) Valid UNPAID upload -> PENDING_REVIEW + R2 key + notification + email
    const okRes = makeRes();
    await uploadInvoiceProofHandler({
      collegeId: 'col_proof',
      user: { id: 'adm_1', email: 'admin@cdc.edu.pk' },
      params: { id: 'inv_unpaid' },
      body: { referenceNumber: 'UBL-REF-111', note: 'Paid at F-10 branch' },
      file: { originalname: 'receipt.png', mimetype: 'image/png', size: validPngBuf.length, buffer: validPngBuf },
    }, okRes);
    assert.strictEqual(okRes.statusCode, 200, JSON.stringify(okRes.body));
    assert.strictEqual(okRes.body.data.status, 'PENDING_REVIEW');
    assert.strictEqual(uploadedKeys.length, 1);
    assert.strictEqual(proofState.notifications.length, 1);
    assert.strictEqual(sentEmails.length, 1);

    // D) Double upload on PENDING_REVIEW rejected with 409
    const dupRes = makeRes();
    await uploadInvoiceProofHandler({
      collegeId: 'col_proof',
      user: { id: 'adm_1', email: 'admin@cdc.edu.pk' },
      params: { id: 'inv_unpaid' },
      body: {},
      file: { originalname: 'receipt2.png', mimetype: 'image/png', size: validPngBuf.length, buffer: validPngBuf },
    }, dupRes);
    assert.strictEqual(dupRes.statusCode, 409);
    assert.strictEqual(dupRes.body.code, 'ALREADY_PENDING_REVIEW');

    // E) Re-upload on REJECTED succeeds with PDF receipt and clears rejectionReason
    const reuploadRes = makeRes();
    await uploadInvoiceProofHandler({
      collegeId: 'col_proof',
      user: { id: 'adm_1', email: 'admin@cdc.edu.pk' },
      params: { id: 'inv_rejected' },
      body: { referenceNumber: 'UBL-REF-222', note: 'Re-uploaded clearer PDF' },
      file: { originalname: 'slip.pdf', mimetype: 'application/pdf', size: validPdfBuf.length, buffer: validPdfBuf },
    }, reuploadRes);
    assert.strictEqual(reuploadRes.statusCode, 200);
    assert.strictEqual(reuploadRes.body.data.status, 'PENDING_REVIEW');
    assert.strictEqual(reuploadRes.body.data.rejectionReason, null);
    assert.strictEqual(proofState.invoiceProofSubmissions.length, 2);
  } finally {
    if (origDb) require.cache[dbPath] = origDb; else delete require.cache[dbPath];
    if (origStorage) require.cache[storagePath] = origStorage; else delete require.cache[storagePath];
    if (origMail) require.cache[mailPath] = origMail; else delete require.cache[mailPath];
    delete require.cache[require.resolve('../controllers/subscription.controller')];
  }

  console.log('  ✔ uploadInvoiceProofHandler enforces magic bytes, tenant isolation, double-submit guard & REJECTED re-upload\n');
  console.log('✅ All Phase (c) tests passed!');
}

run().catch((err) => {
  console.error('❌ Phase (c) tests failed:', err);
  process.exit(1);
});
