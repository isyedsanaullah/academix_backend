'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { invalidatePricingCache, getAllPricingRecords, normalizeModelName } = require('../services/aiPricingService');

/**
 * Neutralizes CSV Formula Injection (Excel / LibreOffice formula execution prevention)
 */
function sanitizeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // If starts with =, +, -, @, or tab/return, prepend apostrophe
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds where clause for Prisma queries from query params
 */
function buildFilterWhere(query) {
  const where = {};
  const { startDate, endDate, collegeId, modelName, featureKey, status, search } = query;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      where.createdAt.lte = new Date(`${endDate}T23:59:59.999Z`);
    }
  }

  if (collegeId) {
    if (collegeId === 'platform' || collegeId === 'null') {
      where.collegeId = null;
    } else {
      where.collegeId = collegeId;
    }
  }

  if (modelName && modelName !== 'all') {
    where.modelName = normalizeModelName(modelName);
  }

  if (featureKey && featureKey !== 'all') {
    where.featureKey = featureKey;
  }

  if (status && status !== 'all') {
    where.status = status;
  }

  if (search && search.trim()) {
    const q = search.trim();
    where.OR = [
      { requestId: { contains: q, mode: 'insensitive' } },
      { errorMessage: { contains: q, mode: 'insensitive' } },
      { userRole: { contains: q, mode: 'insensitive' } }
    ];
  }

  return where;
}

/**
 * GET /api/super-admin/usage/ai/summary
 * Overview KPIs (Requests, Total Tokens, Prompt/Output/Cached, Estimated Cost USD, Success %, Active Tenants)
 */
exports.getSummary = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    // Total counts by status
    const [totalRequests, successCount, failedCount, rateLimitedCount, tokenAgg, colleges] = await Promise.all([
      prisma.aIRequestRecord.count({ where }),
      prisma.aIRequestRecord.count({ where: { ...where, status: 'SUCCESS' } }),
      prisma.aIRequestRecord.count({ where: { ...where, status: 'FAILED' } }),
      prisma.aIRequestRecord.count({ where: { ...where, status: 'RATE_LIMITED' } }),
      prisma.aIRequestRecord.aggregate({
        where,
        _sum: {
          promptTokens: true,
          outputTokens: true,
          cachedTokens: true,
          reasoningTokens: true,
          totalTokens: true,
          estimatedCostUsd: true
        },
        _avg: {
          durationMs: true
        }
      }),
      prisma.aIRequestRecord.findMany({
        where: { ...where, collegeId: { not: null } },
        distinct: ['collegeId'],
        select: { collegeId: true }
      })
    ]);

    const promptTokens = tokenAgg._sum.promptTokens || 0;
    const outputTokens = tokenAgg._sum.outputTokens || 0;
    const cachedTokens = tokenAgg._sum.cachedTokens || 0;
    const reasoningTokens = tokenAgg._sum.reasoningTokens || 0;
    const totalTokens = tokenAgg._sum.totalTokens || (promptTokens + outputTokens);
    const estimatedCostUsd = Number(tokenAgg._sum.estimatedCostUsd || 0);
    const avgDurationMs = Math.round(tokenAgg._avg.durationMs || 0);
    const successRate = totalRequests > 0 ? Math.round((successCount / totalRequests) * 1000) / 10 : 100;

    res.json({
      success: true,
      data: {
        totalRequests,
        successCount,
        failedCount,
        rateLimitedCount,
        successRate,
        promptTokens,
        outputTokens,
        cachedTokens,
        reasoningTokens,
        totalTokens,
        estimatedCostUsd,
        avgDurationMs,
        activeCollegesCount: colleges.length,
        billingReferenceUrl: 'https://aistudio.google.com/app/plan_information'
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/timeseries
 * Daily aggregated timeseries for cost and token charts
 */
exports.getTimeseries = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    // Fetch records grouped by day
    const records = await prisma.aIRequestRecord.findMany({
      where,
      select: {
        createdAt: true,
        status: true,
        promptTokens: true,
        outputTokens: true,
        cachedTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        durationMs: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const dayMap = new Map();

    for (const r of records) {
      const day = r.createdAt.toISOString().slice(0, 10);
      if (!dayMap.has(day)) {
        dayMap.set(day, {
          date: day,
          requests: 0,
          successful: 0,
          failed: 0,
          rateLimited: 0,
          promptTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          durationSum: 0
        });
      }

      const item = dayMap.get(day);
      item.requests += 1;
      if (r.status === 'SUCCESS') item.successful += 1;
      else if (r.status === 'RATE_LIMITED') item.rateLimited += 1;
      else item.failed += 1;

      item.promptTokens += r.promptTokens || 0;
      item.outputTokens += r.outputTokens || 0;
      item.cachedTokens += r.cachedTokens || 0;
      item.totalTokens += r.totalTokens || 0;
      item.estimatedCostUsd += Number(r.estimatedCostUsd || 0);
      item.durationSum += r.durationMs || 0;
    }

    const series = Array.from(dayMap.values()).map((d) => ({
      ...d,
      estimatedCostUsd: Math.round(d.estimatedCostUsd * 10000) / 10000,
      avgDurationMs: d.requests > 0 ? Math.round(d.durationSum / d.requests) : 0
    }));

    res.json({
      success: true,
      data: series
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/by-model
 * Breakdown of usage, tokens, and cost by model
 */
exports.getByModel = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    const records = await prisma.aIRequestRecord.findMany({
      where,
      select: {
        modelName: true,
        promptTokens: true,
        outputTokens: true,
        cachedTokens: true,
        totalTokens: true,
        estimatedCostUsd: true
      }
    });

    const modelMap = new Map();
    let overallCost = 0;
    let overallTokens = 0;

    for (const r of records) {
      const model = r.modelName || 'unknown';
      if (!modelMap.has(model)) {
        modelMap.set(model, {
          modelName: model,
          requestCount: 0,
          promptTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0
        });
      }

      const item = modelMap.get(model);
      item.requestCount += 1;
      item.promptTokens += r.promptTokens || 0;
      item.outputTokens += r.outputTokens || 0;
      item.cachedTokens += r.cachedTokens || 0;
      item.totalTokens += r.totalTokens || 0;
      const cost = Number(r.estimatedCostUsd || 0);
      item.estimatedCostUsd += cost;

      overallCost += cost;
      overallTokens += r.totalTokens || 0;
    }

    const result = Array.from(modelMap.values())
      .map((m) => ({
        ...m,
        estimatedCostUsd: Math.round(m.estimatedCostUsd * 10000) / 10000,
        percentageOfCost: overallCost > 0 ? Math.round((m.estimatedCostUsd / overallCost) * 1000) / 10 : 0,
        percentageOfTokens: overallTokens > 0 ? Math.round((m.totalTokens / overallTokens) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/by-college
 * College tenant breakdown decorated with college name & code
 */
exports.getByCollege = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    const records = await prisma.aIRequestRecord.findMany({
      where,
      select: {
        collegeId: true,
        promptTokens: true,
        outputTokens: true,
        cachedTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
        createdAt: true
      }
    });

    // Fetch college names from database
    const colleges = await prisma.college.findMany({
      select: { id: true, name: true, code: true }
    });
    const collegeLookup = new Map(colleges.map((c) => [c.id, c]));

    const collegeMap = new Map();
    let overallCost = 0;

    for (const r of records) {
      const cid = r.collegeId || 'platform';
      if (!collegeMap.has(cid)) {
        const cInfo = collegeLookup.get(cid);
        collegeMap.set(cid, {
          collegeId: cid === 'platform' ? null : cid,
          collegeName: cid === 'platform' ? 'System & Super Admin' : (cInfo?.name || `College (${cid.slice(0, 8)})`),
          collegeCode: cid === 'platform' ? 'SYS' : (cInfo?.code || '---'),
          requestCount: 0,
          promptTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          lastRequestAt: r.createdAt
        });
      }

      const item = collegeMap.get(cid);
      item.requestCount += 1;
      item.promptTokens += r.promptTokens || 0;
      item.outputTokens += r.outputTokens || 0;
      item.cachedTokens += r.cachedTokens || 0;
      item.totalTokens += r.totalTokens || 0;
      const cost = Number(r.estimatedCostUsd || 0);
      item.estimatedCostUsd += cost;
      overallCost += cost;

      if (r.createdAt > item.lastRequestAt) {
        item.lastRequestAt = r.createdAt;
      }
    }

    const result = Array.from(collegeMap.values())
      .map((c) => ({
        ...c,
        estimatedCostUsd: Math.round(c.estimatedCostUsd * 10000) / 10000,
        percentageOfCost: overallCost > 0 ? Math.round((c.estimatedCostUsd / overallCost) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/by-feature
 * Feature breakdown (ai-chat, quiz-generator, student-tutor, etc.)
 */
exports.getByFeature = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    const records = await prisma.aIRequestRecord.findMany({
      where,
      select: {
        featureKey: true,
        totalTokens: true,
        estimatedCostUsd: true,
        durationMs: true
      }
    });

    const featMap = new Map();
    let overallCost = 0;

    for (const r of records) {
      const feat = r.featureKey || 'general';
      if (!featMap.has(feat)) {
        featMap.set(feat, {
          featureKey: feat,
          requestCount: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          durationSum: 0
        });
      }

      const item = featMap.get(feat);
      item.requestCount += 1;
      item.totalTokens += r.totalTokens || 0;
      const cost = Number(r.estimatedCostUsd || 0);
      item.estimatedCostUsd += cost;
      item.durationSum += r.durationMs || 0;
      overallCost += cost;
    }

    const result = Array.from(featMap.values())
      .map((f) => ({
        ...f,
        estimatedCostUsd: Math.round(f.estimatedCostUsd * 10000) / 10000,
        avgDurationMs: f.requestCount > 0 ? Math.round(f.durationSum / f.requestCount) : 0,
        percentageOfCost: overallCost > 0 ? Math.round((f.estimatedCostUsd / overallCost) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/requests
 * Paginated request log with filtering & search (PII-free)
 */
exports.getRequests = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [total, records, colleges] = await Promise.all([
      prisma.aIRequestRecord.count({ where }),
      prisma.aIRequestRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          requestId: true,
          collegeId: true,
          userId: true,
          userRole: true,
          featureKey: true,
          provider: true,
          modelName: true,
          promptTokens: true,
          outputTokens: true,
          cachedTokens: true,
          reasoningTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          durationMs: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          createdAt: true
        }
      }),
      prisma.college.findMany({
        select: { id: true, name: true, code: true }
      })
    ]);

    const collegeLookup = new Map(colleges.map((c) => [c.id, c]));

    const formattedRecords = records.map((r) => {
      const c = r.collegeId ? collegeLookup.get(r.collegeId) : null;
      return {
        ...r,
        collegeName: r.collegeId ? (c?.name || 'College Tenant') : 'System (Global)',
        collegeCode: r.collegeId ? (c?.code || '---') : 'SYS',
        estimatedCostUsd: Number(r.estimatedCostUsd || 0)
      };
    });

    res.json({
      success: true,
      data: {
        records: formattedRecords,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/pricing
 * View all pricing records
 */
exports.getPricing = async (req, res, next) => {
  try {
    const records = await getAllPricingRecords();
    res.json({
      success: true,
      data: records
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/super-admin/usage/ai/pricing
 * Create new pricing tier
 */
exports.createPricing = async (req, res, next) => {
  try {
    const {
      modelName,
      provider = 'gemini',
      inputPricePerMillionUsd,
      outputPricePerMillionUsd,
      cachedInputPricePerMillionUsd = 0,
      reasoningPricePerMillionUsd = 0,
      effectiveFrom = new Date(),
      notes = ''
    } = req.body;

    if (!modelName || inputPricePerMillionUsd === undefined || outputPricePerMillionUsd === undefined) {
      return res.status(400).json({
        success: false,
        message: 'modelName, inputPricePerMillionUsd, and outputPricePerMillionUsd are required.'
      });
    }

    const prisma = getSystemClient();
    const normalized = normalizeModelName(modelName);

    // Find highest version for this model
    const latest = await prisma.aIModelPricing.findFirst({
      where: { modelName: normalized },
      orderBy: { version: 'desc' }
    });

    const version = latest ? latest.version + 1 : 1;

    // Create record
    const created = await prisma.aIModelPricing.create({
      data: {
        modelName: normalized,
        provider,
        version,
        inputPricePerMillionUsd: Number(inputPricePerMillionUsd),
        outputPricePerMillionUsd: Number(outputPricePerMillionUsd),
        cachedInputPricePerMillionUsd: Number(cachedInputPricePerMillionUsd),
        reasoningPricePerMillionUsd: Number(reasoningPricePerMillionUsd),
        effectiveFrom: new Date(effectiveFrom),
        effectiveTo: null,
        isActive: true,
        notes
      }
    });

    invalidatePricingCache();

    res.status(201).json({
      success: true,
      message: `Pricing tier v${version} created for ${normalized}`,
      data: created
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/super-admin/usage/ai/pricing/:id
 * Update existing pricing tier
 */
exports.updatePricing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      inputPricePerMillionUsd,
      outputPricePerMillionUsd,
      cachedInputPricePerMillionUsd,
      reasoningPricePerMillionUsd,
      isActive,
      notes
    } = req.body;

    const prisma = getSystemClient();
    const updated = await prisma.aIModelPricing.update({
      where: { id },
      data: {
        inputPricePerMillionUsd: inputPricePerMillionUsd !== undefined ? Number(inputPricePerMillionUsd) : undefined,
        outputPricePerMillionUsd: outputPricePerMillionUsd !== undefined ? Number(outputPricePerMillionUsd) : undefined,
        cachedInputPricePerMillionUsd: cachedInputPricePerMillionUsd !== undefined ? Number(cachedInputPricePerMillionUsd) : undefined,
        reasoningPricePerMillionUsd: reasoningPricePerMillionUsd !== undefined ? Number(reasoningPricePerMillionUsd) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
        notes: notes !== undefined ? String(notes) : undefined
      }
    });

    invalidatePricingCache();

    res.json({
      success: true,
      message: 'Pricing tier updated successfully',
      data: updated
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/alerts
 * View alert configuration
 */
exports.getAlerts = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const config = await prisma.aIUsageAlertConfig.findFirst({
      where: { collegeId: null }
    });

    res.json({
      success: true,
      data: config || {
        dailyCostLimitUsd: 20.0,
        monthlyCostLimitUsd: 300.0,
        dailyTokenLimit: '10000000',
        alertEmail: 'admin@collegeshub.com',
        isEnabled: true
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/super-admin/usage/ai/alerts
 * Update alert configuration
 */
exports.updateAlerts = async (req, res, next) => {
  try {
    const { dailyCostLimitUsd, monthlyCostLimitUsd, dailyTokenLimit, alertEmail, isEnabled } = req.body;
    const prisma = getSystemClient();

    const existing = await prisma.aIUsageAlertConfig.findFirst({
      where: { collegeId: null }
    });

    let config;
    if (existing) {
      config = await prisma.aIUsageAlertConfig.update({
        where: { id: existing.id },
        data: {
          dailyCostLimitUsd: dailyCostLimitUsd !== undefined ? Number(dailyCostLimitUsd) : undefined,
          monthlyCostLimitUsd: monthlyCostLimitUsd !== undefined ? Number(monthlyCostLimitUsd) : undefined,
          dailyTokenLimit: dailyTokenLimit !== undefined ? BigInt(dailyTokenLimit) : undefined,
          alertEmail: alertEmail !== undefined ? String(alertEmail) : undefined,
          isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : undefined
        }
      });
    } else {
      config = await prisma.aIUsageAlertConfig.create({
        data: {
          collegeId: null,
          dailyCostLimitUsd: Number(dailyCostLimitUsd || 20),
          monthlyCostLimitUsd: Number(monthlyCostLimitUsd || 300),
          dailyTokenLimit: BigInt(dailyTokenLimit || 10000000),
          alertEmail: String(alertEmail || 'admin@collegeshub.com'),
          isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : true
        }
      });
    }

    res.json({
      success: true,
      message: 'Usage alert settings updated successfully',
      data: {
        ...config,
        dailyTokenLimit: config.dailyTokenLimit ? config.dailyTokenLimit.toString() : null
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/super-admin/usage/ai/export
 * Sanitized CSV export with formula injection prevention
 */
exports.exportCsv = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const where = buildFilterWhere(req.query);

    const [records, colleges] = await Promise.all([
      prisma.aIRequestRecord.findMany({
        where,
        take: 5000,
        orderBy: { createdAt: 'desc' },
        select: {
          requestId: true,
          collegeId: true,
          userRole: true,
          featureKey: true,
          modelName: true,
          promptTokens: true,
          outputTokens: true,
          cachedTokens: true,
          reasoningTokens: true,
          totalTokens: true,
          estimatedCostUsd: true,
          durationMs: true,
          status: true,
          statusCode: true,
          errorMessage: true,
          createdAt: true
        }
      }),
      prisma.college.findMany({
        select: { id: true, name: true, code: true }
      })
    ]);

    const collegeLookup = new Map(colleges.map((c) => [c.id, c]));

    const headers = [
      'Timestamp (UTC)',
      'Request ID',
      'College Name',
      'College Code',
      'User Role',
      'Feature Key',
      'Model Name',
      'Prompt Tokens',
      'Output Tokens',
      'Cached Tokens',
      'Reasoning Tokens',
      'Total Tokens',
      'Estimated Cost (USD)',
      'Duration (ms)',
      'Status',
      'Status Code',
      'Error Message'
    ];

    const rows = [headers.join(',')];

    for (const r of records) {
      const c = r.collegeId ? collegeLookup.get(r.collegeId) : null;
      const cName = r.collegeId ? (c?.name || 'College Tenant') : 'System (Global)';
      const cCode = r.collegeId ? (c?.code || '---') : 'SYS';

      const line = [
        sanitizeCsvValue(r.createdAt.toISOString()),
        sanitizeCsvValue(r.requestId),
        sanitizeCsvValue(cName),
        sanitizeCsvValue(cCode),
        sanitizeCsvValue(r.userRole || '---'),
        sanitizeCsvValue(r.featureKey),
        sanitizeCsvValue(r.modelName),
        sanitizeCsvValue(r.promptTokens),
        sanitizeCsvValue(r.outputTokens),
        sanitizeCsvValue(r.cachedTokens),
        sanitizeCsvValue(r.reasoningTokens),
        sanitizeCsvValue(r.totalTokens),
        sanitizeCsvValue(Number(r.estimatedCostUsd || 0).toFixed(6)),
        sanitizeCsvValue(r.durationMs),
        sanitizeCsvValue(r.status),
        sanitizeCsvValue(r.statusCode),
        sanitizeCsvValue(r.errorMessage || '')
      ].join(',');

      rows.push(line);
    }

    const csvContent = rows.join('\r\n');
    const filename = `collegeshub-ai-usage-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};

