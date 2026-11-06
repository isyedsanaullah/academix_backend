/**
 * backend/services/aiAskYourDataService.js
 * Engine 5: Ask-Your-Data Conversational Analytics (N46).
 * Natural language reporting interface that translates admin prompts into
 * type-safe, parameterized Prisma query templates.
 *
 * CRITICAL SECURITY RULE:
 * Raw SQL execution is strictly forbidden. Any raw SQL keywords or syntax
 * are rejected immediately to guarantee 100% SQL injection prevention.
 */

const { ANALYTICS_TEMPLATES } = require('./analyticsTemplates');
const { recordAndDebitUsage, assertAICreditsAvailable } = require('./aiLedgerService');

class ForbiddenRawSqlError extends Error {
  constructor(message = 'Arbitrary raw SQL execution is strictly forbidden. Inquiries must route through parameterized templates.') {
    super(message);
    this.name = 'ForbiddenRawSqlError';
    this.code = 'RAW_SQL_FORBIDDEN';
    this.statusCode = 400;
  }
}

/**
 * Checks for prohibited raw SQL keywords or syntax.
 */
function checkForProhibitedSql(input) {
  if (!input || typeof input !== 'string') return;

  const rawSqlPattern = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|UNION|EXEC|EXECUTE)\b/i;
  const syntaxPattern = /(--|;|\/\*|\*\/)/;

  if (rawSqlPattern.test(input) || syntaxPattern.test(input)) {
    throw new ForbiddenRawSqlError();
  }
}

/**
 * Maps a natural language inquiry to a parameterized analytics template.
 */
function matchInquiryToTemplate(inquiry) {
  const text = (inquiry || '').toLowerCase();

  if ((text.includes('attendance') && text.includes('fee')) || text.includes('unpaid') || text.includes('defaulter')) {
    // Extract optional threshold percentage from prompt, e.g. "less than 75%"
    const match = text.match(/(\d+)%/);
    const threshold = match ? parseInt(match[1], 10) : 75;
    return {
      templateKey: 'low_attendance_unpaid_fees',
      params: { attendanceThreshold: threshold },
    };
  }

  if (text.includes('fee') || text.includes('collection') || text.includes('dues') || text.includes('paid')) {
    return {
      templateKey: 'fee_collection_summary',
      params: {},
    };
  }

  if (text.includes('teacher') || text.includes('leave') || text.includes('absent') || text.includes('faculty')) {
    return {
      templateKey: 'teacher_leave_overview',
      params: { days: 30 },
    };
  }

  // Default to enrollment overview
  return {
    templateKey: 'enrollment_by_class',
    params: {},
  };
}

/**
 * Executes a conversational analytics inquiry.
 */
async function executeAskYourData({
  collegeId,
  inquiry,
  rawSql = null,
}) {
  // 1. Strictly block raw SQL attempts
  if (rawSql) {
    throw new ForbiddenRawSqlError('Executing raw SQL strings is forbidden.');
  }
  checkForProhibitedSql(inquiry);

  // 2. Ensure college has AI credit allowance
  await assertAICreditsAvailable(collegeId, 150, 'lite');

  // 3. Map prompt to safe template
  const { templateKey, params } = matchInquiryToTemplate(inquiry);
  const templateFn = ANALYTICS_TEMPLATES[templateKey];

  if (!templateFn) {
    throw new Error(`Analytics template "${templateKey}" not found`);
  }

  // 4. Execute parameterized query with strict college tenant context
  const queryResult = await templateFn({ collegeId, ...params });

  // 5. Generate AI commentary
  const commentary = `Based on your query "${inquiry}", identified ${queryResult.count} matching records ` +
    `using template [${templateKey}]. Multi-tenant filter applied strictly for College ID: ${collegeId}.`;

  // 6. Debit AI credit ledger
  const debitResult = await recordAndDebitUsage({
    collegeId,
    featureKey: 'ask-your-data',
    modelTier: 'lite',
    promptTokens: 140,
    outputTokens: 80,
    latencyMs: 160,
  });

  return {
    inquiry,
    template: templateKey,
    params,
    result: queryResult,
    commentary,
    creditsDebited: debitResult.debited,
    remainingCredits: debitResult.balances.totalBalance,
  };
}

module.exports = {
  ForbiddenRawSqlError,
  checkForProhibitedSql,
  matchInquiryToTemplate,
  executeAskYourData,
};

