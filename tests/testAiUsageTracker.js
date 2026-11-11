'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { getSystemClient } = require('../config/prismaManager');
const { calculateEstimatedCostUsd, getPricingForModel } = require('../services/aiPricingService');
const { recordAIUsage, trackGeminiCall } = require('../services/aiUsageTracker');

async function testAll() {
  console.log('🧪 Starting AI Usage Tracking & Pricing Engine Verification...');
  const prisma = getSystemClient();

  // Test 1: Pricing Resolution
  console.log('\n--- 1. Testing Pricing Resolution ---');
  const flashPricing = await getPricingForModel('gemini-2.0-flash');
  console.log('Resolved Gemini 2.0 Flash Pricing:', {
    model: flashPricing.modelName,
    in: flashPricing.inputPricePerMillionUsd,
    out: flashPricing.outputPricePerMillionUsd,
    cached: flashPricing.cachedInputPricePerMillionUsd
  });

  if (flashPricing.inputPricePerMillionUsd !== 0.10) {
    throw new Error(`Expected input price 0.10, got ${flashPricing.inputPricePerMillionUsd}`);
  }

  // Test 2: Cost Calculation
  console.log('\n--- 2. Testing Cost Calculation ---');
  // 1,000,000 prompt tokens + 1,000,000 output tokens on gemini-2.0-flash = $0.10 + $0.40 = $0.50
  const cost1 = await calculateEstimatedCostUsd({
    modelName: 'gemini-2.0-flash',
    promptTokens: 1000000,
    outputTokens: 1000000
  });
  console.log('1M prompt + 1M output cost:', cost1, 'USD (Expected: 0.50)');
  if (cost1 !== 0.5) throw new Error(`Expected 0.50, got ${cost1}`);

  // Test with cached tokens: 100k prompt, 50k cached, 20k output
  const cost2 = await calculateEstimatedCostUsd({
    modelName: 'gemini-2.0-flash',
    promptTokens: 100000,
    cachedTokens: 50000,
    outputTokens: 20000
  });
  // uncached prompt: 50k * 0.10 / 1M = $0.005
  // cached prompt: 50k * 0.025 / 1M = $0.00125
  // output: 20k * 0.40 / 1M = $0.008
  // total = 0.005 + 0.00125 + 0.008 = 0.01425
  console.log('100k prompt (50k cached) + 20k output cost:', cost2, 'USD (Expected: 0.01425)');
  if (Math.abs(cost2 - 0.01425) > 0.000001) throw new Error(`Expected ~0.01425, got ${cost2}`);

  // Test 3: Record AI Usage
  console.log('\n--- 3. Testing Granular Usage Telemetry Recording ---');
  const testRequestId = `test-verify-${Date.now()}`;
  const record = await recordAIUsage({
    requestId: testRequestId,
    collegeId: null,
    userId: 'super-admin-test',
    userRole: 'superAdmin',
    featureKey: 'test-verification',
    provider: 'gemini',
    modelName: 'gemini-2.0-flash',
    promptTokens: 1500,
    outputTokens: 450,
    cachedTokens: 500,
    durationMs: 320,
    status: 'SUCCESS',
    statusCode: 200
  });

  console.log('Saved Record in Neon DB:', {
    id: record.id,
    requestId: record.requestId,
    modelName: record.modelName,
    promptTokens: record.promptTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    estimatedCostUsd: Number(record.estimatedCostUsd),
    status: record.status
  });

  if (!record || record.requestId !== testRequestId) {
    throw new Error('Record creation failed');
  }

  // Test 4: Direct Call Wrapper trackGeminiCall
  console.log('\n--- 4. Testing trackGeminiCall Universal Wrapper ---');
  const wrapperRequestId = `test-wrap-${Date.now()}`;
  const mockCallResult = await trackGeminiCall({
    requestId: wrapperRequestId,
    featureKey: 'test-wrapper',
    modelName: 'gemini-2.0-flash'
  }, async () => {
    // Simulating SDK generateContent
    return {
      response: {
        text: () => 'Simulated AI Response for verification',
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 30,
          totalTokenCount: 150
        }
      }
    };
  });

  console.log('trackGeminiCall succeeded. Response text:', mockCallResult.response.text());

  // Wait a moment for background fire-and-forget write to complete
  await new Promise(r => setTimeout(r, 600));

  const savedWrapperRecord = await prisma.aIRequestRecord.findUnique({
    where: { requestId: wrapperRequestId }
  });
  console.log('Saved Wrapper Telemetry Record:', {
    requestId: savedWrapperRecord?.requestId,
    promptTokens: savedWrapperRecord?.promptTokens,
    outputTokens: savedWrapperRecord?.outputTokens,
    totalTokens: savedWrapperRecord?.totalTokens,
    estimatedCostUsd: Number(savedWrapperRecord?.estimatedCostUsd),
    status: savedWrapperRecord?.status
  });

  if (!savedWrapperRecord || savedWrapperRecord.totalTokens !== 150) {
    throw new Error('Wrapper failed to record usageMetadata correctly');
  }

  // Test 5: Verify Fail-safe Resilience (Never throw when recording fails)
  console.log('\n--- 5. Testing Error Resilience & Fail-Safe ---');
  try {
    await trackGeminiCall({
      requestId: `test-error-${Date.now()}`,
      featureKey: 'test-error-handling'
    }, async () => {
      const err = new Error('Simulated Quota Error');
      err.status = 429;
      throw err;
    });
  } catch (caughtErr) {
    console.log('Caller correctly received original error:', caughtErr.message);
  }

  // Clean up test records
  console.log('\n--- 6. Cleaning up test rows ---');
  await prisma.aIRequestRecord.deleteMany({
    where: {
      featureKey: { in: ['test-verification', 'test-wrapper', 'test-error-handling'] }
    }
  });
  console.log('Cleaned up test telemetry records.');

  console.log('\n🎉 ALL AI USAGE TRACKING & PRICING TESTS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}

testAll().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

