'use strict';

require('dotenv').config();
const assert = require('assert');
process.env.INTERNAL_SERVICE_SECRET = 'test-secret-at-least-32-characters-long!!';
process.env.AI_SERVICE_URL = 'http://127.0.0.1:10001';

// Mock aiLedgerService to decouple from live DB college existence
const aiLedgerService = require('../services/aiLedgerService');
aiLedgerService.assertAICreditsAvailable = async () => true;
aiLedgerService.recordAndDebitUsage = async () => ({
  debited: 250,
  balances: { totalBalance: 9750 },
});

const client = require('../services/aiMicroserviceClient');
const templates = require('../services/promptTemplates');
const aiTutorService = require('../services/aiTutorService');
const aiVisionOcrService = require('../services/aiVisionOcrService');

console.log('Testing Phase 5: Existing Feature Migration...');

async function runTests() {
  // 1. aiMicroserviceClient has new methods
  assert.strictEqual(typeof client.executeCompletion, 'function');
  assert.strictEqual(typeof client.pipeChatStreamToExpress, 'function');
  console.log('✔ aiMicroserviceClient method signatures verified');

  // 2. promptTemplates available for generateFromTemplate
  assert.ok(templates.quiz, 'quiz template exists');
  assert.ok(templates.notes, 'notes template exists');
  const rendered = templates.notes({
    topic: 'Photosynthesis',
    subject: 'Biology',
  });
  assert.ok(rendered.system, 'rendered.system exists');
  assert.ok(rendered.user.includes('Photosynthesis'), 'rendered.user includes topic');
  console.log('✔ Prompt templates verified for template generation');

  // 3. aiTutorService daily limits & date string helper
  const today = aiTutorService.getTodayDateString();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
  console.log(`✔ aiTutorService date helper verified: ${today}`);

  // 4. aiVisionOcrService mock data & cleanTid helper
  const matricData = await aiVisionOcrService.extractMatricCardData({
    collegeId: 'test-college',
    mockData: {
      rollNumber: '887766',
      boardName: 'BISE Rawalpindi',
      totalMarks: 1100,
      obtainedMarks: 1010,
    },
  });
  assert.strictEqual(matricData.rollNumber, '887766');
  assert.strictEqual(matricData.obtainedMarks, 1010);

  const slipData = await aiVisionOcrService.extractPaymentSlipData({
    collegeId: 'test-college',
    mockData: {
      transactionId: 'trx-1234-abcd',
      amountPkr: 7500,
      channel: 'Easypaisa',
    },
  });
  assert.strictEqual(slipData.transactionId, 'TRX1234ABCD');
  assert.strictEqual(slipData.amountPkr, 7500);
  console.log('✔ aiVisionOcrService matric & slip extraction verified');

  console.log('✅ Phase 5 Migration tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Phase 5 test failure:', err);
  process.exit(1);
});
