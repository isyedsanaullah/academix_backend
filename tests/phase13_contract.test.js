/**
 * backend/tests/phase13_contract.test.js
 * Comprehensive automated contract test suite for Phase 13:
 * Next-Gen AI & Autonomous Intelligence across the Academix multi-tenant platform.
 *
 * Validates all 10 canonical contract test cases:
 * 1. Milestone Registry: 155 Live + 6 Roadmap = 161 Total, DAG Valid
 * 2. AI credit ledger dual-bucket debiting (PLAN first, then PURCHASED)
 * 3. Token multipliers: 1 credit/token (Lite), 20 credits/token (Advanced)
 * 4. Insufficient AI credits returns 422 INSUFFICIENT_AI_CREDITS
 * 5. Student tutor daily limits: 10/day on Premium, 30/day on Enterprise
 * 6. PDF RAG retrieval fetches top-3 cosine distance chunks matching query
 * 7. Vision OCR payment slip extraction and N43 auto-reconciliation
 * 8. Ask-Your-Data rejects arbitrary raw SQL and safely routes through Prisma templates
 * 9. Autonomous Admin Agent creates pending action drafts requiring 1-click execution
 * 10. TokenCostSample accurately instruments token costs and latency for LLM calls
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const assert = require('assert');
const { getSystemClient } = require('../config/prismaManager');
const { FEATURE_REGISTRY, validateRegistryDAG } = require('../config/featureRegistry');
const AI_CONFIG = require('../config/aiConfig');

const {
  getAICreditBalance,
  debitAICredits,
  grantPurchasedCredits,
} = require('../services/ledgerService');

const {
  assertAICreditsAvailable,
  recordAndDebitUsage,
  getAISummary,
  InsufficientAICreditsError,
} = require('../services/aiLedgerService');

const {
  registerAndIndexBook,
  searchRelevantChunks,
} = require('../services/ragKnowledgeService');

const {
  askTutor,
  checkAndIncrementStudentUsage,
  DailyTutorLimitReachedError,
} = require('../services/aiTutorService');

const {
  extractMatricCardData,
  extractPaymentSlipData,
  reconcilePaymentSlip,
} = require('../services/aiVisionOcrService');

const {
  diagnoseClassWeakTopics,
  generateStudentStudyPlan,
} = require('../services/aiDiagnosticService');

const {
  executeAskYourData,
  checkForProhibitedSql,
  ForbiddenRawSqlError,
} = require('../services/aiAskYourDataService');

const {
  scanAndGenerateActionDrafts,
  approveAndExecuteAction,
  dismissAction,
  getPendingActions,
} = require('../services/aiAutonomousAgentService');

let prisma;

async function runPhase13ContractTests() {
  console.log('====================================================');
  console.log('    PHASE 13 MASTER CONTRACT VERIFICATION SUITE     ');
  console.log('====================================================\n');

  prisma = getSystemClient();
  let passed = 0;
  let failed = 0;

  const testCollegeId = `col_phase13_${Date.now()}`;
  let college = null;
  let session = null;
  let adminUser = null;
  let student = null;

  try {
    // -------------------------------------------------------------
    // Setup test fixtures
    // -------------------------------------------------------------
    college = await prisma.college.create({
      data: {
        id: testCollegeId,
        name: 'Phase 13 AI Model Institute',
        email: `p13_${testCollegeId}@test.com`,
        code: `P13-${Date.now().toString().slice(-4)}`,
        planId: 'enterprise',
        subStatus: 'ACTIVE',
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 86400000),
      },
    });

    session = await prisma.session.create({
      data: {
        college_id: testCollegeId,
        name: '2026-2027',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-06-30'),
        isCurrent: true,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        college_id: testCollegeId,
        email: `principal-${testCollegeId}@test.com`,
        password: 'hash',
        name: 'Academic Principal',
        role: 'admin',
      },
    });

    student = await prisma.student.create({
      data: {
        college_id: testCollegeId,
        session_id: session.id,
        name: 'Bilal Farooq',
        fatherName: 'Farooq Ahmed',
        gender: 'Male',
        class: 'FSc Part 1',
        section: 'A',
        group: 'Pre-Engineering',
        rollNumber: `P13-STU-${Date.now()}`,
        status: 'active',
      },
    });

    // -------------------------------------------------------------
    // Test 1: Feature Registry Milestone: 155 Live + 6 Roadmap = 161 Total
    // -------------------------------------------------------------
    try {
      assert.strictEqual(FEATURE_REGISTRY.length, 161, 'Registry total must be 161 services');

      const liveFeatures = FEATURE_REGISTRY.filter((f) => f.status === 'live');
      const roadmapFeatures = FEATURE_REGISTRY.filter((f) => f.status === 'coming_soon');

      assert.strictEqual(liveFeatures.length, 155, `Live services must be 155 (got ${liveFeatures.length})`);
      assert.strictEqual(roadmapFeatures.length, 6, `Roadmap services must be 6 (got ${roadmapFeatures.length})`);

      const roadmapIds = roadmapFeatures.map((f) => f.id).sort();
      const expectedRoadmapIds = ['#79', '#82', '#84', '#85', 'N12', 'N14'].sort();
      assert.deepStrictEqual(roadmapIds, expectedRoadmapIds, 'The 6 permanent roadmap services must match');

      const dagResult = validateRegistryDAG();
      assert.strictEqual(dagResult.valid, true, 'DAG must have zero circular dependencies');

      // Verify the 19 Phase 13 features are live
      const phase13Keys = [
        'notice-translation',               // #109
        'ai-pedagogy-generator',            // #103
        'board-syllabus-mcqs',              // #104
        'weak-topic-detection',             // #105
        'document-ocr',                     // #107
        'payment-screenshot-ocr',           // #111
        'auto-payment-matching',            // N43
        'ai-readonly-assistant',            // N44
        'ask-your-data',                    // N46
        'ai-report-card-remarks',           // N47
        'study-plan-suggestions',           // #106
        'whatsapp-admissions-chatbot',      // #108
        'ai-at-risk-alerts',                // #110
        'staff-appraisal-recruitment',      // N42
        'autonomous-admin-agent',           // N45
        'ai-outreach-anomaly-alerts',       // N48
        'ai-audio-transcription',           // N49
        'ai-answer-marking-assistant',      // N50
        'ai-admission-lead-scoring',        // N51
      ];

      for (const k of phase13Keys) {
        const feat = FEATURE_REGISTRY.find((f) => f.key === k);
        assert.ok(feat, `Feature ${k} must exist in registry`);
        assert.strictEqual(feat.status, 'live', `Feature ${k} must be live`);
      }

      console.log('✓ Test 1 Passed: Feature registry milestone: 155 Live + 6 Roadmap = 161 Total, DAG valid');
      passed++;
    } catch (err) {
      console.error('✗ Test 1 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 2: Dual-Bucket Debiting (PLAN first, PURCHASED second)
    // -------------------------------------------------------------
    try {
      const pCollegeId = `col_dual_${Date.now()}`;
      await prisma.college.create({
        data: {
          id: pCollegeId,
          name: 'Dual Bucket Test College',
          email: `${pCollegeId}@test.com`,
          code: `DB-${Date.now().toString().slice(-4)}`,
          planId: 'starter', // Starter has 0 monthly AI credits
          subStatus: 'ACTIVE',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      // Seed 100 credits into PLAN bucket for current month
      const currentPeriodKey = new Date().toISOString().slice(0, 7);
      await prisma.aICreditLedgerEntry.create({
        data: {
          college_id: pCollegeId,
          bucket: 'PLAN',
          periodKey: currentPeriodKey,
          delta: 100,
          type: 'MONTHLY_GRANT',
          balanceAfter: 100,
          taskType: 'TEST_GRANT',
        },
      });

      // Seed 200 credits into PURCHASED bucket
      await grantPurchasedCredits(pCollegeId, 'AI_CREDITS', 200, 'TEST_ORDER_999');

      const initialBal = await getAICreditBalance(pCollegeId);
      assert.strictEqual(initialBal.planBalance, 100, 'Initial PLAN balance must be 100');
      assert.strictEqual(initialBal.purchasedBalance, 200, 'Initial PURCHASED balance must be 200');
      assert.strictEqual(initialBal.totalBalance, 300, 'Initial Total balance must be 300');

      // Debit 150 credits (should exhaust 100 PLAN, then take 50 from PURCHASED)
      const debitResult = await debitAICredits(pCollegeId, 150, 'lite', 'TEST_DEBIT');
      assert.strictEqual(debitResult.debited, 150, 'Must debit exactly 150 credits');

      const afterBal = await getAICreditBalance(pCollegeId);
      assert.strictEqual(afterBal.planBalance, 0, 'PLAN balance must be 0 after exhausting 100');
      assert.strictEqual(afterBal.purchasedBalance, 150, 'PURCHASED balance must be 150 (200 - 50)');
      assert.strictEqual(afterBal.totalBalance, 150, 'Total remaining balance must be 150');

      console.log('✓ Test 2 Passed: AI credit ledger correctly debits PLAN bucket first, then PURCHASED bucket');
      passed++;
    } catch (err) {
      console.error('✗ Test 2 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 3: Token Multipliers: 1x (Lite) vs 20x (Advanced)
    // -------------------------------------------------------------
    try {
      const multCollegeId = `col_mult_${Date.now()}`;
      await prisma.college.create({
        data: {
          id: multCollegeId,
          name: 'Multiplier Test College',
          email: `${multCollegeId}@test.com`,
          code: `MT-${Date.now().toString().slice(-4)}`,
          planId: 'starter',
          subStatus: 'ACTIVE',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      // Grant 50,000 credits to test both tiers
      await grantPurchasedCredits(multCollegeId, 'AI_CREDITS', 50000);

      // Lite model invocation: 100 prompt + 50 output = 150 tokens -> 150 credits
      const liteResult = await recordAndDebitUsage({
        collegeId: multCollegeId,
        featureKey: 'ai-tutor-chat',
        modelTier: 'lite',
        promptTokens: 100,
        outputTokens: 50,
      });
      assert.strictEqual(liteResult.debited, 150, 'Lite tier must debit 1 credit per token (150)');

      // Advanced model invocation: 100 prompt + 50 output = 150 tokens -> 3000 credits (150 * 20)
      const advResult = await recordAndDebitUsage({
        collegeId: multCollegeId,
        featureKey: 'study-plan-suggestions',
        modelTier: 'advanced',
        promptTokens: 100,
        outputTokens: 50,
      });
      assert.strictEqual(advResult.debited, 3000, 'Advanced tier must debit 20 credits per token (3000)');

      console.log('✓ Test 3 Passed: 1 credit per Lite token; 20 credits per Advanced token accurately applied');
      passed++;
    } catch (err) {
      console.error('✗ Test 3 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 4: Insufficient AI Credits returns 422 INSUFFICIENT_AI_CREDITS
    // -------------------------------------------------------------
    try {
      const brokeCollegeId = `col_broke_${Date.now()}`;
      await prisma.college.create({
        data: {
          id: brokeCollegeId,
          name: 'Zero Balance College',
          email: `${brokeCollegeId}@test.com`,
          code: `ZB-${Date.now().toString().slice(-4)}`,
          planId: 'starter',
          subStatus: 'ACTIVE',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      let caughtError = null;
      try {
        await assertAICreditsAvailable(brokeCollegeId, 500, 'lite');
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Must throw error when credits depleted');
      assert.strictEqual(caughtError.code, 'INSUFFICIENT_AI_CREDITS', 'Error code must be INSUFFICIENT_AI_CREDITS');
      assert.strictEqual(caughtError.statusCode, 422, 'Status code must be 422');

      console.log('✓ Test 4 Passed: Insufficient AI credits returns HTTP 422 INSUFFICIENT_AI_CREDITS');
      passed++;
    } catch (err) {
      console.error('✗ Test 4 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 5: Student Tutor Daily Limits (10/day Prem, 30/day Ent)
    // -------------------------------------------------------------
    try {
      const premCollegeId = `col_prem_${Date.now()}`;
      await prisma.college.create({
        data: {
          id: premCollegeId,
          name: 'Premium Tutor Test College',
          email: `${premCollegeId}@test.com`,
          code: `PT-${Date.now().toString().slice(-4)}`,
          planId: 'premium',
          subStatus: 'ACTIVE',
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
        },
      });

      const premStudentId = `stu_prem_${Date.now()}`;

      // Call 10 times -> all 10 should succeed on Premium
      for (let i = 1; i <= 10; i++) {
        const usage = await checkAndIncrementStudentUsage(premCollegeId, premStudentId, 'premium');
        assert.strictEqual(usage.currentCount, i, `Message ${i} must increment usage to ${i}`);
        assert.strictEqual(usage.limit, 10, 'Premium limit must be 10');
      }

      // 11th call must throw DailyTutorLimitReachedError
      let blockedErr = null;
      try {
        await checkAndIncrementStudentUsage(premCollegeId, premStudentId, 'premium');
      } catch (err) {
        blockedErr = err;
      }

      assert.ok(blockedErr, '11th message must be blocked');
      assert.strictEqual(blockedErr.code, 'DAILY_TUTOR_LIMIT_EXCEEDED');
      assert.strictEqual(blockedErr.statusCode, 429);

      // On Enterprise, verify limit is 30
      const entStudentId = `stu_ent_${Date.now()}`;
      const entUsage = await checkAndIncrementStudentUsage(testCollegeId, entStudentId, 'enterprise');
      assert.strictEqual(entUsage.limit, 30, 'Enterprise limit must be 30');

      console.log('✓ Test 5 Passed: Student tutor chat blocked after 10 daily messages on Premium; elevated to 30 on Enterprise');
      passed++;
    } catch (err) {
      console.error('✗ Test 5 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 6: PDF RAG Knowledge Base Cosine Similarity Retrieval
    // -------------------------------------------------------------
    try {
      const ragBook = await registerAndIndexBook({
        college_id: testCollegeId,
        subject_id: 'physics_intermediate',
        className: 'FSc Part 1',
        title: 'Punjab Textbook Board - Physics 11',
        chunks: [
          { chunkText: 'Newton second law states that acceleration of an object is directly proportional to net force and inversely to mass (F = ma).', pageNumber: 45, chapterName: 'Dynamics' },
          { chunkText: 'A heat engine converts thermal energy into mechanical work through a cyclical thermodynamic process.', pageNumber: 120, chapterName: 'Thermodynamics' },
          { chunkText: 'Coulomb law states that electrostatic force between two point charges is inversely proportional to square of distance.', pageNumber: 180, chapterName: 'Electrostatics' },
          { chunkText: 'Photosynthesis occurs in plant cells using chlorophyll pigments to synthesize glucose from carbon dioxide and water.', pageNumber: 210, chapterName: 'Biology Reference' },
        ],
      });

      assert.strictEqual(ragBook.totalChunks, 4, 'Book must index 4 chunks');

      // Query for Newton's laws / dynamics
      const results = await searchRelevantChunks({
        collegeId: testCollegeId,
        subjectId: 'physics_intermediate',
        queryText: 'Newton second law force and acceleration dynamics formula',
        limit: 3,
      });

      assert.strictEqual(results.length, 3, 'Must fetch top-3 chunks');
      assert.ok(results[0].chunkText.includes('Newton second law'), 'Top chunk must be Dynamics');
      assert.strictEqual(results[0].pageNumber, 45, 'Page number citation must be 45');
      assert.strictEqual(results[0].chapterName, 'Dynamics', 'Chapter name must be Dynamics');
      assert.ok(results[0].distance < results[2].distance, 'Results must be sorted ascending by cosine distance');

      console.log('✓ Test 6 Passed: PDF RAG retrieval fetches top-3 cosine distance chunks matching query');
      passed++;
    } catch (err) {
      console.error('✗ Test 6 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 7: Vision OCR & Payment Auto-Reconciliation (#111 / N43)
    // -------------------------------------------------------------
    try {
      // Grant credits to test college for OCR operations
      await grantPurchasedCredits(testCollegeId, 'AI_CREDITS', 10000);

      // Create an open student fee voucher
      const fee = await prisma.fee.create({
        data: {
          college_id: testCollegeId,
          session_id: session.id,
          student_id: student.id,
          month: 'November 2026',
          totalAmount: 6500,
          status: 'unpaid',
        },
      });

      // Extract slip data with OCR
      const ocrResult = await extractPaymentSlipData({
        collegeId: testCollegeId,
        mockData: {
          transactionId: 'TXN-JAZZ-889900',
          senderPhone: '03001234567',
          amountPkr: 6500,
          channel: 'JazzCash',
        },
      });

      assert.strictEqual(ocrResult.transactionId, 'TXNJAZZ889900', 'TID must be normalized');

      // Execute auto-payment matching
      const reconResult = await reconcilePaymentSlip({
        collegeId: testCollegeId,
        studentId: student.id,
        ocrData: ocrResult,
      });

      assert.strictEqual(reconResult.reconciled, true, 'Payment must be reconciled');
      assert.strictEqual(reconResult.feeId, fee.id, 'Fee ID must match');
      assert.strictEqual(reconResult.status, 'PAID', 'Status must be PAID');

      // Verify DB record updated
      const updatedFee = await prisma.fee.findUnique({ where: { id: fee.id } });
      assert.strictEqual(updatedFee.status, 'paid');
      assert.strictEqual(Number(updatedFee.paidAmount), 6500);

      // Duplicate submission test: attempting same TID again must be rejected
      const dupResult = await reconcilePaymentSlip({
        collegeId: testCollegeId,
        studentId: student.id,
        ocrData: ocrResult,
      });
      assert.strictEqual(dupResult.reconciled, false, 'Duplicate TID must be rejected');
      assert.strictEqual(dupResult.reason, 'DUPLICATE_TRANSACTION_ID');

      console.log('✓ Test 7 Passed: Payment screenshot OCR extracts transaction ID and matches open voucher');
      passed++;
    } catch (err) {
      console.error('✗ Test 7 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 8: Ask-Your-Data Rejects Raw SQL & Routes through Templates (N46)
    // -------------------------------------------------------------
    try {
      // 1. Raw SQL execution rejection
      let sqlBlocked = false;
      try {
        await executeAskYourData({
          collegeId: testCollegeId,
          inquiry: 'SELECT * FROM "Student";',
          rawSql: 'SELECT * FROM "Student"',
        });
      } catch (err) {
        if (err instanceof ForbiddenRawSqlError || err.code === 'RAW_SQL_FORBIDDEN') {
          sqlBlocked = true;
        }
      }
      assert.strictEqual(sqlBlocked, true, 'Arbitrary raw SQL must be blocked');

      // 2. Safe natural language inquiry
      const nlResult = await executeAskYourData({
        collegeId: testCollegeId,
        inquiry: 'Show me students with less than 75% attendance who have unpaid fees',
      });

      assert.strictEqual(nlResult.template, 'low_attendance_unpaid_fees', 'Must match low_attendance_unpaid_fees template');
      assert.strictEqual(nlResult.params.attendanceThreshold, 75, 'Extracted threshold must be 75');
      assert.ok(Array.isArray(nlResult.result.records), 'Result must contain records array');

      console.log('✓ Test 8 Passed: Ask-Your-Data rejects arbitrary raw SQL and safely routes through Prisma templates');
      passed++;
    } catch (err) {
      console.error('✗ Test 8 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 9: Autonomous Admin Agent Creates Drafts Requiring 1-Click Execution (N45)
    // -------------------------------------------------------------
    try {
      // Run autonomous routine scan
      const scanResult = await scanAndGenerateActionDrafts({
        collegeId: testCollegeId,
      });

      assert.ok(scanResult.actionsCreated > 0, 'Must create at least 1 action draft');

      const actions = await getPendingActions(testCollegeId);
      assert.ok(actions.length > 0, 'Must have pending actions in DB');

      const targetAction = actions[0];
      assert.strictEqual(targetAction.status, 'PENDING_APPROVAL', 'Initial status must be PENDING_APPROVAL');

      // 1-Click Execution by Admin
      const execResult = await approveAndExecuteAction({
        actionId: targetAction.id,
        collegeId: testCollegeId,
        adminUserId: adminUser.id,
      });

      assert.strictEqual(execResult.success, true, 'Execution must succeed');
      assert.strictEqual(execResult.status, 'EXECUTED', 'Status must transition to EXECUTED');
      assert.strictEqual(execResult.executedById, adminUser.id, 'executedById must record admin user');

      // Verify dismissal workflow on second action if available
      if (actions.length > 1) {
        const dismissResult = await dismissAction({
          actionId: actions[1].id,
          collegeId: testCollegeId,
          adminUserId: adminUser.id,
        });
        assert.strictEqual(dismissResult.status, 'DISMISSED');
      }

      console.log('✓ Test 9 Passed: Autonomous Admin Agent creates pending action draft; requires 1-click execution');
      passed++;
    } catch (err) {
      console.error('✗ Test 9 Failed:', err.message);
      failed++;
    }

    // -------------------------------------------------------------
    // Test 10: TokenCostSample Telemetry Instrumentation
    // -------------------------------------------------------------
    try {
      const summary = await getAISummary(testCollegeId);
      assert.ok(summary.recentSamples.length > 0, 'Must have recorded TokenCostSample rows');

      const sample = summary.recentSamples[0];
      assert.strictEqual(sample.college_id, testCollegeId, 'Sample college_id must match');
      assert.ok(typeof sample.promptTokens === 'number', 'promptTokens must be a number');
      assert.ok(typeof sample.outputTokens === 'number', 'outputTokens must be a number');
      assert.ok(typeof sample.creditsDebited === 'number', 'creditsDebited must be a number');
      assert.ok(typeof sample.latencyMs === 'number', 'latencyMs must be a number');
      assert.ok(sample.featureKey, 'featureKey must be recorded');

      console.log('✓ Test 10 Passed: TokenCostSample accurately records token usage and latency for every LLM call');
      passed++;
    } catch (err) {
      console.error('✗ Test 10 Failed:', err.message);
      failed++;
    }

  } finally {
    // -------------------------------------------------------------
    // Tenant fixture cleanup
    // -------------------------------------------------------------
    try {
      await prisma.pendingAgentAction.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.tokenCostSample.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.studentTutorDailyUsage.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.weakTopicAnalysis.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.studentStudyPlan.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.aICreditLedgerEntry.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.knowledgeBook.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.fee.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.student.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.user.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.session.deleteMany({ where: { college_id: testCollegeId } });
      await prisma.college.deleteMany({ where: { id: testCollegeId } });
    } catch (cleanupErr) {
      console.warn('Cleanup warning:', cleanupErr.message);
    }
    await prisma.$disconnect();
  }

  console.log('\n====================================================');
  console.log(`Phase 13 Tests Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runPhase13ContractTests();

