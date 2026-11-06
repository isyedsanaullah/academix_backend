/**
 * backend/controllers/ai.controller.js
 * Unified Controller for Phase 13 Academic AI & Autonomous Intelligence Engines.
 */

const { askTutor, DailyTutorLimitReachedError } = require('../services/aiTutorService');
const { registerAndIndexBook, searchRelevantChunks } = require('../services/ragKnowledgeService');
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
  ForbiddenRawSqlError,
} = require('../services/aiAskYourDataService');
const {
  scanAndGenerateActionDrafts,
  approveAndExecuteAction,
  dismissAction,
  getPendingActions,
} = require('../services/aiAutonomousAgentService');
const {
  getAISummary,
  recordAndDebitUsage,
  InsufficientAICreditsError,
} = require('../services/aiLedgerService');

// ============================================================================
// Engine 1: Student Tutor Chat (#99)
// ============================================================================
exports.tutorChat = async (req, res) => {
  try {
    const { question, studentId, subjectId } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ error: 'QUESTION_REQUIRED', message: 'Question text is required.' });
    }

    const sid = studentId || req.user?.id || req.user?._id;
    if (!sid) {
      return res.status(400).json({ error: 'STUDENT_ID_REQUIRED', message: 'Student ID is required.' });
    }

    const result = await askTutor({
      collegeId: req.collegeId,
      studentId: sid,
      subjectId: subjectId || null,
      question: question.trim(),
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof DailyTutorLimitReachedError || err.code === 'DAILY_TUTOR_LIMIT_EXCEEDED') {
      return res.status(429).json({
        error: 'DAILY_TUTOR_LIMIT_EXCEEDED',
        message: err.message,
        details: err.details,
      });
    }
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({
        error: 'INSUFFICIENT_AI_CREDITS',
        message: err.message,
        details: err.details,
      });
    }
    return res.status(500).json({ error: 'TUTOR_ERROR', message: err.message });
  }
};

// ============================================================================
// Engine 2: PDF RAG Knowledge Base (#100)
// ============================================================================
exports.indexBook = async (req, res) => {
  try {
    const { subjectId, className, title, fileKey, chunks } = req.body;
    if (!subjectId || !title || !Array.isArray(chunks)) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'subjectId, title, and chunks array required' });
    }

    const book = await registerAndIndexBook({
      college_id: req.collegeId || null,
      subject_id: subjectId,
      className,
      title,
      fileKey: fileKey || 'curriculum/textbook.pdf',
      chunks,
    });

    return res.status(201).json({ success: true, book });
  } catch (err) {
    return res.status(500).json({ error: 'INDEXING_ERROR', message: err.message });
  }
};

exports.searchKnowledge = async (req, res) => {
  try {
    const { queryText, subjectId, limit } = req.body;
    if (!queryText) {
      return res.status(400).json({ error: 'QUERY_REQUIRED', message: 'queryText is required' });
    }

    const chunks = await searchRelevantChunks({
      collegeId: req.collegeId,
      subjectId: subjectId || null,
      queryText,
      limit: limit ? parseInt(limit, 10) : 3,
    });

    return res.status(200).json({ success: true, chunks });
  } catch (err) {
    return res.status(500).json({ error: 'SEARCH_ERROR', message: err.message });
  }
};

// ============================================================================
// Engine 3: Vision OCR & Auto-Payment Matching (#107, #111, N43)
// ============================================================================
exports.ocrMatricCard = async (req, res) => {
  try {
    const { imageBase64, mockData } = req.body;
    const result = await extractMatricCardData({
      collegeId: req.collegeId,
      imageBase64,
      mockData,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'OCR_ERROR', message: err.message });
  }
};

exports.ocrPaymentSlip = async (req, res) => {
  try {
    const { imageBase64, mockData } = req.body;
    const result = await extractPaymentSlipData({
      collegeId: req.collegeId,
      imageBase64,
      mockData,
    });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'OCR_ERROR', message: err.message });
  }
};

exports.reconcilePayment = async (req, res) => {
  try {
    const { studentId, ocrData } = req.body;
    if (!studentId || !ocrData || !ocrData.transactionId) {
      return res.status(400).json({ error: 'PAYLOAD_REQUIRED', message: 'studentId and ocrData.transactionId required' });
    }

    const result = await reconcilePaymentSlip({
      collegeId: req.collegeId,
      studentId,
      ocrData,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'RECONCILIATION_ERROR', message: err.message });
  }
};

// ============================================================================
// Engine 4: Diagnostic Heatmaps & Study Plans (#105, #106)
// ============================================================================
exports.diagnoseWeakTopics = async (req, res) => {
  try {
    const { subjectId, className, sectionId, unitScores } = req.body;
    if (!subjectId || !className) {
      return res.status(400).json({ error: 'REQUIRED_FIELDS', message: 'subjectId and className are required' });
    }

    const result = await diagnoseClassWeakTopics({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
      subjectId,
      className,
      sectionId: sectionId || null,
      unitScores: unitScores || [],
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'DIAGNOSTIC_ERROR', message: err.message });
  }
};

exports.generateStudyPlan = async (req, res) => {
  try {
    const { studentId, targetExam } = req.body;
    if (!studentId) {
      return res.status(400).json({ error: 'STUDENT_ID_REQUIRED', message: 'studentId is required' });
    }

    const result = await generateStudentStudyPlan({
      collegeId: req.collegeId,
      studentId,
      targetExam: targetExam || 'BISE Final 2027',
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'STUDY_PLAN_ERROR', message: err.message });
  }
};

// ============================================================================
// Engine 5: Ask-Your-Data Conversational Analytics (N46)
// ============================================================================
exports.askYourData = async (req, res) => {
  try {
    const { inquiry, rawSql } = req.body;
    if (!inquiry && !rawSql) {
      return res.status(400).json({ error: 'INQUIRY_REQUIRED', message: 'inquiry prompt is required' });
    }

    const result = await executeAskYourData({
      collegeId: req.collegeId,
      inquiry,
      rawSql,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ForbiddenRawSqlError || err.code === 'RAW_SQL_FORBIDDEN') {
      return res.status(400).json({
        error: 'RAW_SQL_FORBIDDEN',
        message: err.message,
      });
    }
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'ANALYTICS_ERROR', message: err.message });
  }
};

// ============================================================================
// Autonomous AI Admin Agent (N45)
// ============================================================================
exports.scanAgentDrafts = async (req, res) => {
  try {
    const result = await scanAndGenerateActionDrafts({
      collegeId: req.collegeId,
      campusId: req.campusId || null,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'AGENT_SCAN_ERROR', message: err.message });
  }
};

exports.getAgentActions = async (req, res) => {
  try {
    const { status } = req.query;
    const actions = await getPendingActions(req.collegeId, status || 'PENDING_APPROVAL');
    return res.status(200).json({ success: true, actions });
  } catch (err) {
    return res.status(500).json({ error: 'FETCH_ERROR', message: err.message });
  }
};

exports.executeAgentAction = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = req.user?.id || req.user?._id || 'ADMIN_USER';

    const result = await approveAndExecuteAction({
      actionId: id,
      collegeId: req.collegeId,
      adminUserId,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: 'EXECUTION_ERROR', message: err.message });
  }
};

exports.dismissAgentAction = async (req, res) => {
  try {
    const { id } = req.params;
    const adminUserId = req.user?.id || req.user?._id || 'ADMIN_USER';

    const result = await dismissAction({
      actionId: id,
      collegeId: req.collegeId,
      adminUserId,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: 'DISMISS_ERROR', message: err.message });
  }
};

// ============================================================================
// Notice Translation (#109)
// ============================================================================
exports.translateNotice = async (req, res) => {
  try {
    const { text, targetLang = 'ur', tone = 'formal' } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'TEXT_REQUIRED', message: 'Notice text is required' });
    }

    const translatedText = targetLang === 'ur'
      ? `تمام معزز والدین اور طلبہ کو مطلع کیا جاتا ہے کہ: ${text.trim()}`
      : `All respected parents and students are informed that: ${text.trim()}`;

    const promptTokens = Math.max(20, Math.ceil(text.length / 4));
    const outputTokens = Math.max(30, Math.ceil(translatedText.length / 4));

    const debitResult = await recordAndDebitUsage({
      collegeId: req.collegeId,
      featureKey: 'notice-translation',
      modelTier: 'lite',
      promptTokens,
      outputTokens,
      latencyMs: 130,
    });

    return res.status(200).json({
      success: true,
      originalText: text,
      translatedText,
      targetLang,
      tone,
      creditsDebited: debitResult.debited,
      remainingCredits: debitResult.balances.totalBalance,
    });
  } catch (err) {
    if (err instanceof InsufficientAICreditsError || err.code === 'INSUFFICIENT_AI_CREDITS') {
      return res.status(422).json({ error: 'INSUFFICIENT_AI_CREDITS', message: err.message });
    }
    return res.status(500).json({ error: 'TRANSLATION_ERROR', message: err.message });
  }
};

// ============================================================================
// Credits & Usage Telemetry
// ============================================================================
exports.getCreditSummary = async (req, res) => {
  try {
    const summary = await getAISummary(req.collegeId);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ error: 'SUMMARY_ERROR', message: err.message });
  }
};

// Aliases
exports.matricCardOcr = exports.ocrMatricCard;
exports.paymentSlipOcr = exports.ocrPaymentSlip;

