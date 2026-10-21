require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FEATURES } = require('../services/capabilityCatalog');
const {
  isValidTransactionId,
  canTransition,
  computeProofWarnings,
  ALLOWED_PAYMENT_METHODS,
  PAYMENT_PROOF_STATES
} = require('../services/paymentProof.service');
const paymentProofController = require('../controllers/paymentProof.controller');

async function runTests() {
  console.log('--- Starting Phase 14 Test Suite: Payment Screenshot Flow (EasyPaisa, JazzCash, Bank) ---');

  // Test 1: Capability Catalog verification
  const proofFeat = FEATURES.find(f => f.key === 'payment-proof');
  assert(proofFeat, 'payment-proof feature must exist in capabilityCatalog');
  assert.strictEqual(proofFeat.status, 'live', 'payment-proof status must be live');
  assert.strictEqual(proofFeat.effort, 'Done', 'payment-proof effort must be Done');
  assert(proofFeat.hard.includes('fees-basic'), 'payment-proof must depend on fees-basic');
  console.log('✓ 1. Catalog feature payment-proof verified live and Done');

  // Test 2: Schema verification
  const schemaContent = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
  assert(schemaContent.includes('model PaymentProof'), 'PaymentProof model must exist in schema.prisma');
  assert(schemaContent.includes('easypaisa') && schemaContent.includes('jazzcash') && schemaContent.includes('raast'),
    'Payment.paymentMethod comment must list easypaisa, jazzcash, raast');
  console.log('✓ 2. Prisma schema verified with PaymentProof model and updated payment methods');

  // Test 3: Transaction ID Validation
  assert.strictEqual(isValidTransactionId('883921092'), true, 'Valid numeric txId must pass');
  assert.strictEqual(isValidTransactionId('HBLTRX99201'), true, 'Valid alphanumeric txId must pass');
  assert.strictEqual(isValidTransactionId('TX-123!'), false, 'Special characters must fail');
  assert.strictEqual(isValidTransactionId('12345'), false, 'Under 6 characters must fail');
  assert.strictEqual(isValidTransactionId('A'.repeat(31)), false, 'Over 30 characters must fail');
  assert.strictEqual(isValidTransactionId(''), false, 'Empty string must fail');
  console.log('✓ 3. Transaction ID validator verified (6-30 alphanumeric characters)');

  // Test 4: State Machine Transitions
  assert.strictEqual(canTransition('pending', 'verified'), true, 'pending -> verified must be valid');
  assert.strictEqual(canTransition('pending', 'rejected'), true, 'pending -> rejected must be valid');
  assert.strictEqual(canTransition('pending', 'duplicate'), true, 'pending -> duplicate must be valid');
  assert.strictEqual(canTransition('verified', 'rejected'), false, 'verified -> rejected must be invalid');
  assert.strictEqual(canTransition('rejected', 'verified'), false, 'rejected -> verified must be invalid');
  assert.strictEqual(canTransition('duplicate', 'verified'), false, 'duplicate -> verified must be invalid');
  console.log('✓ 4. State machine transitions verified (pending -> verified/rejected/duplicate; terminal states)');

  // Test 5: Forensic Warnings Calculation
  const mockFee = {
    id: 'fee-test-1',
    totalAmount: 15000,
    paidAmount: 5000,
    createdAt: new Date('2026-10-15T10:00:00Z')
  };

  const mockProofAmountMismatch = {
    id: 'proof-test-1',
    college_id: 'col-1',
    student_id: 'stu-1',
    amount: 8000, // Balance is 10,000
    paidOn: new Date('2026-10-16T12:00:00Z'),
    senderPhone: '03001234567'
  };

  const mockTenantDb = {
    paymentProof: {
      findFirst: async ({ where }) => {
        if (where.senderPhone === '03001234567' && where.student_id?.not) {
          return { id: 'other-proof', student_id: 'other-stu' };
        }
        return null;
      }
    },
    storedFile: {
      findUnique: async () => ({ checksumSha256: 'dummy-sha256-hash' }),
      findFirst: async () => ({ id: 'earlier-file-with-same-hash' })
    }
  };

  const warnings = await computeProofWarnings({
    proof: { ...mockProofAmountMismatch, file_id: 'file-1' },
    fee: mockFee,
    tenantDb: mockTenantDb
  });

  const warningCodes = warnings.map(w => w.code);
  assert(warningCodes.includes('AMOUNT_MISMATCH'), 'Must flag amount mismatch');
  assert(warningCodes.includes('SHARED_SENDER_PHONE'), 'Must flag shared sender phone');
  assert(warningCodes.includes('DUPLICATE_IMAGE_HASH'), 'Must flag duplicate image checksum');

  // Test stale date warning
  const mockProofOldDate = {
    ...mockProofAmountMismatch,
    amount: 10000,
    paidOn: new Date('2026-10-10T00:00:00Z') // Before fee createdAt 2026-10-15
  };
  const warningsDate = await computeProofWarnings({
    proof: mockProofOldDate,
    fee: mockFee,
    tenantDb: { paymentProof: { findFirst: async () => null }, storedFile: { findUnique: async () => null } }
  });
  assert(warningsDate.some(w => w.code === 'PAID_BEFORE_VOUCHER'), 'Must flag payment date before voucher date');
  console.log('✓ 5. Forensic warning calculations verified (amount mismatch, stale date, shared phone, duplicate file hash)');

  // Test 6: Controller Handlers Export Verification
  assert(typeof paymentProofController.submitPaymentProof === 'function', 'submitPaymentProof must be exported');
  assert(typeof paymentProofController.getPaymentProofs === 'function', 'getPaymentProofs must be exported');
  assert(typeof paymentProofController.verifyPaymentProof === 'function', 'verifyPaymentProof must be exported');
  assert(typeof paymentProofController.rejectPaymentProof === 'function', 'rejectPaymentProof must be exported');
  assert(typeof paymentProofController.markDuplicatePaymentProof === 'function', 'markDuplicatePaymentProof must be exported');
  assert(typeof paymentProofController.getDailyProofsReport === 'function', 'getDailyProofsReport must be exported');
  assert(typeof paymentProofController.stubPaymentOcr === 'function', 'stubPaymentOcr must be exported');
  assert(typeof paymentProofController.getPaymentAccounts === 'function', 'getPaymentAccounts must be exported');
  assert(typeof paymentProofController.updatePaymentAccounts === 'function', 'updatePaymentAccounts must be exported');
  console.log('✓ 6. All payment proof controller handlers verified');

  // Test 7: Enterprise AI OCR Stub (returns 501)
  const mockOcrRes = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
  await paymentProofController.stubPaymentOcr({}, mockOcrRes);
  assert.strictEqual(mockOcrRes.statusCode, 501, 'ai-payment-ocr stub must return 501');
  assert.strictEqual(mockOcrRes.body?.code, 'NOT_BUILT', 'Code must be NOT_BUILT');
  console.log('✓ 7. Enterprise ai-payment-ocr stub verified returning HTTP 501 NOT_BUILT');

  // Test 8: Frontend components existence
  const accountantQueuePage = path.join(__dirname, '../../client-next/legacy-pages/accountant/PaymentProofsQueue.jsx');
  assert(fs.existsSync(accountantQueuePage), 'PaymentProofsQueue.jsx must exist');
  const queueContent = fs.readFileSync(accountantQueuePage, 'utf8');
  assert(queueContent.includes('Payment Verification Queue'), 'Must include queue header');
  assert(queueContent.includes('handleVerify'), 'Must implement verify handler');
  assert(queueContent.includes('handleReject'), 'Must implement reject handler');
  assert(queueContent.includes('handleDuplicate'), 'Must implement duplicate handler');

  const myFeesPage = path.join(__dirname, '../../client-next/legacy-pages/student/MyFees.jsx');
  const myFeesContent = fs.readFileSync(myFeesPage, 'utf8');
  assert(myFeesContent.includes('Upload Proof'), 'MyFees.jsx must have Upload Proof button');
  assert(myFeesContent.includes('payment-proofs'), 'MyFees.jsx must call payment-proofs API');
  console.log('✓ 8. Frontend integration verified in PaymentProofsQueue.jsx and MyFees.jsx');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 14 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('======================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n❌ PHASE 14 TEST SUITE FAILED:', err);
  process.exit(1);
});
