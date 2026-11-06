/**
 * backend/routes/ai.routes.js
 * Phase 13 Academic AI & Autonomous Intelligence Routes.
 * All routes enforce tenant isolation, JWT authentication, and subscription feature gating.
 * Single failure code: FEATURE_NOT_IN_PLAN.
 */

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const { subscriptionGate } = require('../middleware/subscriptionGate');

const aiController = require('../controllers/ai.controller');

// Common middleware for all AI operations
router.use(protect, tenantContext);

// Engine 1: Student Tutor Chat (#99)
router.post('/tutor/chat', subscriptionGate('ai-tutor-chat'), aiController.tutorChat);

// Engine 2: PDF RAG Knowledge Base (#100)
router.post('/books/index', subscriptionGate('ai-knowledge-library'), aiController.indexBook);
router.post('/knowledge/search', subscriptionGate('ai-knowledge-library'), aiController.searchKnowledge);

// Engine 3: Vision OCR & Payment Reconciliation (#107, #111, N43)
router.post('/ocr/matric-card', subscriptionGate('document-ocr'), aiController.ocrMatricCard);
router.post('/ocr/payment-slip', subscriptionGate('payment-screenshot-ocr'), aiController.ocrPaymentSlip);
router.post('/reconcile-payment', subscriptionGate('auto-payment-matching'), aiController.reconcilePayment);

// Engine 4: Diagnostic Heatmaps & Study Plans (#105, #106)
router.post('/weak-topics/diagnose', subscriptionGate('weak-topic-detection'), aiController.diagnoseWeakTopics);
router.post('/study-plan', subscriptionGate('study-plan-suggestions'), aiController.generateStudyPlan);

// Engine 5: Ask-Your-Data Conversational Analytics (N46)
router.post('/ask-your-data', subscriptionGate('ask-your-data'), aiController.askYourData);

// Autonomous AI Admin Agent (N45)
router.post('/agent/scan', subscriptionGate('autonomous-admin-agent'), aiController.scanAgentDrafts);
router.get('/agent/actions', subscriptionGate('autonomous-admin-agent'), aiController.getAgentActions);
router.post('/agent/actions/:id/execute', subscriptionGate('autonomous-admin-agent'), aiController.executeAgentAction);
router.post('/agent/actions/:id/dismiss', subscriptionGate('autonomous-admin-agent'), aiController.dismissAgentAction);

// Notice Translation (#109)
router.post('/translate-notice', subscriptionGate('notice-translation'), aiController.translateNotice);

// Credit Balance & Telemetry
router.get('/credits/balance', aiController.getCreditSummary);

module.exports = router;
