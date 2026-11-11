/**
 * backend/services/aiTutorService.js
 * Engine 1: Student Tutor Chat (#99)
 * Grounded in curriculum textbooks via Engine 2 (PDF Knowledge Base).
 * Enforces per-student daily message caps: Premium = 10 msgs/day, Enterprise = 30 msgs/day.
 * Debits AI credit pool (Lite tier: 1 token = 1 credit).
 */

const { getSystemClient } = require('../config/prismaManager');
const AI_CONFIG = require('../config/aiConfig');
const { searchRelevantChunks } = require('./ragKnowledgeService');
const { recordAndDebitUsage, assertAICreditsAvailable } = require('./aiLedgerService');
const { getEntitlements } = require('./entitlements');
const aiMicroserviceClient = require('./aiMicroserviceClient');

class DailyTutorLimitReachedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DailyTutorLimitReachedError';
    this.code = 'DAILY_TUTOR_LIMIT_EXCEEDED';
    this.statusCode = 429;
    this.details = details;
  }
}

/**
 * Formats today's date in YYYY-MM-DD (UTC/PKT standard).
 */
function getTodayDateString() {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Checks and updates per-student daily usage.
 * Enforces: Premium max 10/day, Enterprise max 30/day.
 */
async function checkAndIncrementStudentUsage(collegeId, studentId, planId, tx = null) {
  const prisma = tx || getSystemClient();
  const today = getTodayDateString();

  const maxDaily = AI_CONFIG.tutorDailyLimits[planId] || 0;
  if (maxDaily <= 0) {
    throw new DailyTutorLimitReachedError('AI Tutor Chat is not included in the current institutional plan.', {
      planId,
      limit: 0,
      current: 0,
    });
  }

  // Find or create usage record for today
  let usage = await prisma.studentTutorDailyUsage.findUnique({
    where: {
      college_id_student_id_usageDate: {
        college_id: collegeId,
        student_id: studentId,
        usageDate: today,
      },
    },
  });

  const currentCount = usage ? usage.messageCount : 0;
  if (currentCount >= maxDaily) {
    throw new DailyTutorLimitReachedError(
      `Daily AI Tutor message limit of ${maxDaily} questions reached for today. Resets at midnight.`,
      {
        planId,
        limit: maxDaily,
        current: currentCount,
        usageDate: today,
      }
    );
  }

  // Increment usage count
  usage = await prisma.studentTutorDailyUsage.upsert({
    where: {
      college_id_student_id_usageDate: {
        college_id: collegeId,
        student_id: studentId,
        usageDate: today,
      },
    },
    update: {
      messageCount: { increment: 1 },
      lastMessageAt: new Date(),
    },
    create: {
      college_id: collegeId,
      student_id: studentId,
      usageDate: today,
      messageCount: 1,
      lastMessageAt: new Date(),
    },
  });

  return {
    usageDate: today,
    currentCount: usage.messageCount,
    limit: maxDaily,
    remaining: Math.max(0, maxDaily - usage.messageCount),
  };
}

/**
 * Processes a student query against the curriculum knowledge base.
 */
async function askTutor({
  collegeId,
  studentId,
  subjectId = null,
  question,
}) {
  const prisma = getSystemClient();

  // 1. Resolve college plan entitlements
  const entitlements = await getEntitlements(collegeId, prisma);
  const planId = entitlements.planId || 'starter';

  // 2. Enforce student daily message caps
  const usageInfo = await checkAndIncrementStudentUsage(collegeId, studentId, planId);

  // 3. Verify AI credit balance before calling inference
  await assertAICreditsAvailable(collegeId, 120, 'lite');

  // 4. Retrieve grounding excerpts from curriculum textbooks (Engine 2)
  const chunks = await searchRelevantChunks({
    collegeId,
    subjectId,
    queryText: question,
    limit: 3,
  });

  // 5. Synthesize grounded answer with Real LLM via AI Microservice Gateway
  const citations = chunks.map((c) => ({
    bookTitle: c.bookTitle,
    chapterName: c.chapterName,
    pageNumber: c.pageNumber,
  }));

  const groundingText = chunks.length > 0
    ? chunks.map((c, i) => `[Source ${i + 1}: ${c.bookTitle || 'Official Textbook'}, Chapter: ${c.chapterName || 'General'}, Page: ${c.pageNumber}]\n${c.chunkText}`).join('\n\n')
    : 'No direct textbook passages retrieved for this question.';

  const systemPrompt = `You are the College AI Tutor, an encouraging and academically rigorous virtual instructor.
Your goal is to explain curriculum concepts clearly to students in clean Markdown.
Base your explanations on the following official curriculum textbook excerpts:

${groundingText}

Guidelines:
- Explain clearly with step-by-step logic, bold keywords, and concise examples.
- If the question is outside the textbook, explain using general undergraduate science/humanities fundamentals while noting the textbook context.
- Keep the tone pedagogical, patient, and direct.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question },
  ];

  let answer = '';
  let creditsDebited = 0;
  let remainingCredits = 0;

  try {
    const completion = await aiMicroserviceClient.executeCompletion({
      collegeId,
      userId: studentId,
      role: 'student',
      planId,
      featureKey: 'student-tutor',
      messages,
      temperature: 0.7,
      maxTokens: 2048,
    });

    answer = completion.text || '';
    creditsDebited = Number(completion.creditsDebited || 0);
    remainingCredits = Number(completion.balanceAfter || 0);
  } catch (err) {
    // Graceful fallback if microservice is offline during transition
    if (chunks.length > 0) {
      const topChunk = chunks[0];
      answer = `Based on your curriculum textbook (${topChunk.bookTitle || 'Official Textbook'}, Chapter: ${topChunk.chapterName || 'General'}, Page ${topChunk.pageNumber}):\n\n${topChunk.chunkText}`;
    } else {
      answer = `In response to your query regarding "${question}", please refer to your assigned course textbook for detailed review exercises.`;
    }
  }

  return {
    answer,
    citations,
    chunksUsed: chunks.length,
    usage: usageInfo,
    creditsDebited,
    remainingCredits,
  };
}

module.exports = {
  DailyTutorLimitReachedError,
  getTodayDateString,
  checkAndIncrementStudentUsage,
  askTutor,
};

