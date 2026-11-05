require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const {
  PaymentGatewayDriver,
  JazzCashDriver,
  EasyPaisaDriver,
  getActiveGatewayDriver
} = require('../services/paymentGatewayAdapter');
const { FEATURE_REGISTRY } = require('../config/featureRegistry');
const { SERVER_EXEMPT_CATEGORIES } = require('../services/storageQuotaService');

async function runTests() {
  console.log('--- Testing Sub-Phase 8K: #82 Online Fee Payment Gateway Adapter ---');

  // 1. Adapter Interface and Stub Drivers
  console.log('1. Testing PaymentGatewayAdapter interface...');
  assert(PaymentGatewayDriver, 'PaymentGatewayDriver must be defined');
  const jc = new JazzCashDriver();
  assert.strictEqual(jc.isReal, false);
  const ep = new EasyPaisaDriver();
  assert.strictEqual(ep.isReal, false);

  assert.strictEqual(getActiveGatewayDriver('any-college'), null, 'getActiveGatewayDriver must return null');
  console.log('   PASS: Adapter interface and stubs defined; active driver is null.');

  // 2. Registry Status
  console.log('2. Testing Feature Registry for #82...');
  const f82 = FEATURE_REGISTRY.find(f => f.id === '#82');
  assert(f82, '#82 must exist in registry');
  assert.strictEqual(f82.status, 'coming_soon', '#82 must remain coming_soon');
  console.log('   PASS: #82 verified as coming_soon.');

  // 3. Storage Quota Check
  console.log('3. Verifying Fee Proof storage quota accounting...');
  assert(!SERVER_EXEMPT_CATEGORIES.has('FEE_PROOFS'), 'FEE_PROOFS must NOT be in server-exempt whitelist; counts toward quota');
  console.log('   PASS: Fee proofs verified to count against storage quota.');

  console.log('\n====================================================');
  console.log('ALL SUB-PHASE 8K TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
