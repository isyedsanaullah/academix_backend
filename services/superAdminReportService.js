const { GoogleGenerativeAI } = require('@google/generative-ai');
const { validateReportSpec } = require('./reportSpecValidator');
const {
  fetchPlatformSummary,
  fetchCollegesList,
  fetchSubscriptionBreakdown,
  fetchExpiringSubscriptions,
  fetchActivityAudit,
  fetchCollegeDetail
} = require('./superAdminDataService');
const { generateSuperAdminPDF, getReportByToken } = require('./superAdminPDFEngine');

function buildReportSystemPrompt() {
  return `YOU ARE THE ACADEMIX SUPER ADMIN REPORT ARCHITECT.
YOUR SOLE PURPOSE IS TO TRANSLATE A SUPER ADMIN'S REPORT PROMPT INTO A STRICT, MACHINE-READABLE REPORT SPECIFICATION SCHEMA.

YOU DO NOT RETRIEVE DATA, CALCULATE COUNTS, OR INVENT DATABASE RECORDS.
YOU ONLY SPECIFY WHAT DATA SOURCES, KPI BLOCKS, CHARTS, AND TABLES THE BACKEND SHOULD ASSEMBLE.

ALLOWED DATA SOURCES:
- "platform_summary": Global platform totals (colleges, active, students, staff, AI colleges).
- "colleges_list": Tabular list of colleges with enrollment and subscription status.
- "subscription_breakdown": Breakdown by plan tier (Basic, Standard, Premium) and active/suspended status.
- "expiring_subscriptions": List of colleges nearing term expiry.
- "activity_audit": Recent administrative audit events.
- "college_detail": Deep-dive metrics for a single college.

ALLOWED SECTION TYPES:
- "kpi_grid": Grid of top-level metrics (e.g. for platform_summary).
- "chart": Vector visualization. "chartType" MUST be one of: "donut", "horizontal_bar", "vertical_column".
- "table": Tabular data. Allowed columns for "colleges_list": ["code", "name", "city", "plan", "status", "students_count", "staff_count", "created_at"].
- "notice_box": Highlighted administrative notice. "severity" MUST be one of: "info", "warning", "urgent".
- "text_summary": Contextual text paragraph summarizing the objective of the section.

OUTPUT FORMAT:
Output MUST be strict JSON only with NO surrounding markdown or conversational text:
{
  "reportTitle": "Platform Colleges Performance & Subscription Audit",
  "reportSubtitle": "Executive summary of registered institutions, enrollment, and plan distribution",
  "scope": {
    "type": "global",
    "collegeId": null,
    "dateRange": null
  },
  "sections": [
    {
      "id": "sec_kpis",
      "title": "Platform Overview Metrics",
      "type": "kpi_grid",
      "dataSource": "platform_summary"
    },
    {
      "id": "sec_sub_chart",
      "title": "Subscription Tier Breakdown",
      "type": "chart",
      "chartType": "donut",
      "dataSource": "subscription_breakdown"
    },
    {
      "id": "sec_colleges_table",
      "title": "Institutional Directory & Enrollment",
      "type": "table",
      "dataSource": "colleges_list",
      "columns": ["code", "name", "city", "plan", "status", "students_count", "staff_count"],
      "sortBy": "students_count",
      "sortOrder": "desc",
      "limit": 20
    }
  ]
}`;
}

/**
 * Generates an AI Report Specification from user prompt
 */
async function generateReportSpec({ message, apiKey }) {
  const systemPrompt = buildReportSystemPrompt();
  const userPrompt = `USER REPORT REQUEST:\n"${message}"\n\nGenerate the complete JSON Report Specification matching the schema.`;

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
  let rawJsonText = '';

  if (effectiveKey && typeof effectiveKey === 'string' && effectiveKey.length > 10 && !effectiveKey.startsWith('sk-or-')) {
    const genAI = new GoogleGenerativeAI(effectiveKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json' }
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
    });
    rawJsonText = result.response.text();
  } else {
    // Openrouter fallback
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${effectiveKey?.trim()}`,
        'HTTP-Referer': 'https://academix.edu.pk'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    const data = await response.json();
    rawJsonText = data.choices[0]?.message?.content || '';
  }

  let parsed = {};
  try {
    const cleaned = rawJsonText.replace(/```json/gi, '').replace(/```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.warn('Failed to parse AI report JSON, using structured fallback:', e);
    parsed = {
      reportTitle: 'Super Admin Executive Platform Report',
      reportSubtitle: message.substring(0, 100),
      scope: { type: 'global' },
      sections: [
        { id: 'sec_1', title: 'Platform Overview KPIs', type: 'kpi_grid', dataSource: 'platform_summary' },
        { id: 'sec_2', title: 'Plan Tier Breakdown', type: 'chart', chartType: 'donut', dataSource: 'subscription_breakdown' },
        { id: 'sec_3', title: 'Institutional Directory', type: 'table', dataSource: 'colleges_list', limit: 20 }
      ]
    };
  }

  // Enforce security validation & allowlists
  return validateReportSpec(parsed);
}

/**
 * Gathers ground-truth data from PostgreSQL based on the validated spec
 */
async function fetchReportDataBundle(spec) {
  const dataBundle = {};
  const dataSourcesNeeded = new Set(spec.sections.map(s => s.dataSource));

  if (dataSourcesNeeded.has('platform_summary')) {
    dataBundle.platformSummary = await fetchPlatformSummary();
  }

  if (dataSourcesNeeded.has('colleges_list')) {
    const tableSec = spec.sections.find(s => s.dataSource === 'colleges_list');
    dataBundle.collegesList = await fetchCollegesList({
      sortBy: tableSec?.sortBy || 'students_count',
      sortOrder: tableSec?.sortOrder || 'desc',
      limit: tableSec?.limit || 20
    });
  }

  if (dataSourcesNeeded.has('subscription_breakdown')) {
    dataBundle.subscriptionBreakdown = await fetchSubscriptionBreakdown();
  }

  if (dataSourcesNeeded.has('expiring_subscriptions')) {
    dataBundle.expiringSubscriptions = await fetchExpiringSubscriptions({ daysAhead: 60 });
  }

  if (dataSourcesNeeded.has('activity_audit')) {
    dataBundle.activityAudit = await fetchActivityAudit({ limit: 15 });
  }

  if (dataSourcesNeeded.has('college_detail') && spec.scope?.collegeId) {
    dataBundle.collegeDetail = await fetchCollegeDetail(spec.scope.collegeId);
  }

  return dataBundle;
}

/**
 * End-to-end report generation orchestration
 */
async function orchestrateReportGeneration({ message, apiKey, onProgress }) {
  // Step 1: Generate AI Spec
  if (onProgress) onProgress('Analyzing report requirements & structure...');
  const spec = await generateReportSpec({ message, apiKey });

  // Step 2: Validate Spec
  if (onProgress) onProgress('Validating report schema & data sources...');
  const validatedSpec = validateReportSpec(spec);

  // Step 3: Fetch Ground-Truth Data
  if (onProgress) onProgress('Collecting institutional metrics & database records...');
  const dataBundle = await fetchReportDataBundle(validatedSpec);

  // Step 4: Build PDF & Charts
  if (onProgress) onProgress('Building vector charts & compiling PDF document...');
  const result = await generateSuperAdminPDF(validatedSpec, dataBundle);

  // Step 5: Finalize
  if (onProgress) onProgress('Finalizing report...');

  return {
    token: result.token,
    title: result.title,
    subtitle: result.subtitle,
    pageCount: result.pageCount,
    downloadUrl: `/api/ai/chat/reports/download/${result.token}`,
    previewUrl: `/api/ai/chat/reports/preview/${result.token}`,
    sectionsCount: validatedSpec.sections.length,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  generateReportSpec,
  fetchReportDataBundle,
  orchestrateReportGeneration,
  getReportByToken
};
