require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES, CAPABILITIES } = require('../services/capabilityCatalog');
const {
  recordVerifyToken,
  lookupVerifyToken,
  logVerifyAttempt,
  hashIp
} = require('../services/verifyToken.service');
const { verifyPublicDocument } = require('../controllers/verify.controller');
const { getSystemClient } = require('../config/prismaManager');
const fallbackController = require('../controllers/fallback.controller');

// Mock Express response helper
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

describe('Phase 13: Public Verification of Certificates, Vouchers and Receipts', () => {
  let sysDb;
  let testToken;
  let invoiceToken;
  let testInvoiceId;

  beforeAll(() => {
    sysDb = getSystemClient();
    testToken = `test-tok-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    invoiceToken = `test-inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterAll(async () => {
    // Cleanup
    if (testInvoiceId) await sysDb.platformInvoice.delete({ where: { id: testInvoiceId } }).catch(() => {});
    await sysDb.verifyToken.delete({ where: { token: invoiceToken } }).catch(() => {});
    await sysDb.verifyToken.delete({ where: { token: testToken } }).catch(() => {});
  });

  test('1. Catalog: qr-verify and voucher-verify are live and Done', () => {
    const qrVerifyFeat = FEATURES.find(f => f.key === 'qr-verify');
    expect(qrVerifyFeat).toBeTruthy();
    expect(qrVerifyFeat.status).toBe('live');
    expect(qrVerifyFeat.effort).toBe('Done');
    expect(qrVerifyFeat.hard).toContain('certificates');
    expect(qrVerifyFeat.hard).toContain('doc-templates');

    const voucherVerifyFeat = FEATURES.find(f => f.key === 'voucher-verify');
    expect(voucherVerifyFeat).toBeTruthy();
    expect(voucherVerifyFeat.status).toBe('live');
    expect(voucherVerifyFeat.effort).toBe('Done');
    expect(voucherVerifyFeat.hard).toContain('paid-receipt');
  });

  test('2. Prisma schema has VerifyToken and VerifyLog models', () => {
    const schemaContent = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
    expect(schemaContent).toContain('model VerifyToken');
    expect(schemaContent).toContain('model VerifyLog');
  });

  test('3. VerifyToken service: record, lookup, IP hash and abuse log', async () => {
    const testIp = '192.168.1.100';
    const hashed = hashIp(testIp);
    expect(typeof hashed).toBe('string');
    expect(hashed).toHaveLength(64); // SHA-256 hex

    const recorded = await recordVerifyToken({
      token: testToken,
      collegeId: 'college-test-123',
      kind: 'certificate',
      refId: 'cert-test-456'
    });
    expect(recorded).toBeTruthy();
    expect(recorded.token).toBe(testToken);
    expect(recorded.kind).toBe('certificate');

    const lookedUp = await lookupVerifyToken(testToken);
    expect(lookedUp).toBeTruthy();
    expect(lookedUp.college_id).toBe('college-test-123');
    expect(lookedUp.ref_id).toBe('cert-test-456');

    const logResult = await logVerifyAttempt({
      token: testToken,
      ip: testIp,
      userAgent: 'Mozilla/5.0 Test Suite',
      status: 'VERIFIED'
    });
    expect(logResult).toBeTruthy();
    expect(logResult.tokenPrefix).toBe(testToken.slice(0, 8));
    expect(logResult.ipHash).toBe(hashed);
  });

  test('4. Uniform 404 for invalid / unknown tokens with Cache-Control: no-store', async () => {
    // Short (malformed) token
    const invalidReq1 = { params: { token: 'short' }, ip: '127.0.0.1', get: () => 'TestAgent' };
    const mockRes1 = createMockRes();
    await verifyPublicDocument(invalidReq1, mockRes1, () => {});
    expect(mockRes1.statusCode).toBe(404);
    expect(mockRes1.headers['Cache-Control']).toBe('no-store');
    expect(mockRes1.body?.code).toBe('NOT_FOUND');

    // Unknown but valid-format token
    const invalidReq2 = { params: { token: 'nonexistent-token-123456789' }, ip: '127.0.0.1', get: () => 'TestAgent' };
    const mockRes2 = createMockRes();
    await verifyPublicDocument(invalidReq2, mockRes2, () => {});
    expect(mockRes2.statusCode).toBe(404);
    expect(mockRes2.headers['Cache-Control']).toBe('no-store');

    // Both responses must be identical (uniform 404 — no oracle)
    expect(mockRes1.body).toEqual(mockRes2.body);
  });

  test('5. Platform Invoice verification returns PAID with correct details', async () => {
    const testInvoice = await sysDb.platformInvoice.create({
      data: {
        college_id: 'sample-col-inv',
        invoiceNo: `PINV-TEST-${Date.now()}`,
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'),
        amount: 15000,
        status: 'paid',
        paidAt: new Date(),
        verifyToken: invoiceToken
      }
    });
    testInvoiceId = testInvoice.id;

    await recordVerifyToken({
      token: invoiceToken,
      collegeId: 'sample-col-inv',
      kind: 'invoice',
      refId: testInvoice.id
    });

    const invoiceReq = { params: { token: invoiceToken }, ip: '127.0.0.1', get: () => 'TestAgent' };
    const invoiceRes = createMockRes();
    await verifyPublicDocument(invoiceReq, invoiceRes, () => {});

    expect(invoiceRes.statusCode).toBe(200);
    expect(invoiceRes.body?.success).toBe(true);
    expect(invoiceRes.body?.kind).toBe('invoice');
    expect(invoiceRes.body?.status).toBe('PAID');
    expect(invoiceRes.body?.document?.invoiceNumber).toBe(testInvoice.invoiceNo);
  });

  test('6. Office verification endpoint exported from fallback.controller.js', () => {
    expect(typeof fallbackController.verifyDocument).toBe('function');
  });

  test('7. Public route /api/public/verify/:token mounted with rate limiter', () => {
    const publicRoutesContent = fs.readFileSync(path.join(__dirname, '../routes/public.routes.js'), 'utf8');
    expect(publicRoutesContent).toContain("router.get('/verify/:token'");
    expect(publicRoutesContent).toContain('verifyRateLimiter');
    expect(publicRoutesContent).toContain('verifyPublicDocument');
  });

  test('8. Frontend Next.js page /verify/[token]/page.js exists and is correct', () => {
    const frontendVerifyPage = path.join(__dirname, '../../client-next/app/verify/[token]/page.js');
    expect(fs.existsSync(frontendVerifyPage)).toBe(true);
    const frontendContent = fs.readFileSync(frontendVerifyPage, 'utf8');
    expect(frontendContent).toContain('DocumentVerificationPage');
    expect(frontendContent).toContain('api/public/verify/');
  });
});
