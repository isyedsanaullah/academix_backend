const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { getSystemClient } = require('../config/prismaManager');

router.get('/', async (req, res) => {
  const startTime = Date.now();
  const services = {
    database: { status: 'unknown' },
    pgvector: { status: 'unknown' },
    storage: { status: 'unknown' },
    queue: { status: 'unknown' },
    aiProvider: { status: 'unknown' }
  };

  let overallHealthy = true;

  // 1. Database & pgvector Check
  try {
    const prisma = getSystemClient();
    await prisma.$queryRaw`SELECT 1`;
    services.database = { status: 'healthy', provider: 'PostgreSQL 16' };

    try {
      const extResult = await prisma.$queryRaw`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
      const vectorExtExists = Array.isArray(extResult) && extResult.length > 0;
      services.pgvector = {
        status: vectorExtExists ? 'healthy' : 'fallback_array_mode',
        extension: vectorExtExists ? 'enabled' : 'not installed (using float array search)'
      };
    } catch (e) {
      services.pgvector = { status: 'fallback_array_mode', extension: 'float array search' };
    }
  } catch (err) {
    overallHealthy = false;
    services.database = { status: 'unhealthy', error: err.message };
  }

  // 2. Storage Check
  try {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const absoluteUploadDir = path.resolve(uploadDir);
    if (!fs.existsSync(absoluteUploadDir)) {
      fs.mkdirSync(absoluteUploadDir, { recursive: true });
    }
    const testFile = path.join(absoluteUploadDir, `.health_check_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'health check');
    fs.unlinkSync(testFile);
    services.storage = { status: 'healthy', path: uploadDir };
  } catch (err) {
    overallHealthy = false;
    services.storage = { status: 'unhealthy', error: err.message };
  }

  // 3. Queue Check
  try {
    const prisma = getSystemClient();
    const [processingCount, failedCount] = await Promise.all([
      prisma.pDFDocument.count({ where: { status: 'processing' } }),
      prisma.pDFDocument.count({ where: { status: 'failed' } })
    ]);
    services.queue = {
      status: 'healthy',
      processingJobs: processingCount,
      failedJobs: failedCount
    };
  } catch (err) {
    services.queue = { status: 'unhealthy', error: err.message };
  }

  // 4. AI Provider Config Check (Zero API Call Cost)
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
  services.aiProvider = {
    status: (hasGeminiKey || hasOpenRouterKey) ? 'configured' : 'missing_key',
    model: process.env.EMBEDDING_MODEL || 'text-embedding-004',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION || '768', 10),
    hasGeminiKey,
    hasOpenRouterKey
  };

  res.status(overallHealthy ? 200 : 503).json({
    status: overallHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - startTime,
    services
  });
});

module.exports = router;
