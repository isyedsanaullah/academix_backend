/**
 * storageReconciliationService.js — Phase 7A
 * Reconciles storage quota drift and backfills legacy R2 uploads:
 * - Scans tenants/{collegeId}/ prefix in R2
 * - Strictly excludes tenants/{collegeId}/receipts/ (exempt platform PDFs)
 * - Excludes active pending reservations
 * - Registers untracked legacy uploads as StoredFile (category: 'BACKFILLED')
 * - Recomputes CollegeUsage.storageBytes to eliminate drift
 */

const { getSystemClient } = require('../config/prismaManager');
const { getR2Client, getBucketName } = require('../config/r2');
const { ListObjectsV2Command } = require('@aws-sdk/client-s3');

const SERVER_EXEMPT_PREFIXES = ['receipts/', 'exports/', 'backups/', 'reports/', 'import-sources/'];
const SERVER_EXEMPT_CATEGORIES = ['EXPORTS', 'BACKUPS', 'REPORTS', 'RECEIPTS', 'IMPORT_SOURCE'];

async function reconcileCollegeStorage(collegeId) {
  const prisma = getSystemClient();
  const client = getR2Client();
  const bucket = getBucketName();

  console.log(`[StorageReconciliation] Starting reconciliation for college ${collegeId}...`);

  // 1. List objects under tenant prefix
  const prefix = `tenants/${collegeId}/`;
  let continuationToken = null;
  const r2Objects = [];

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      });
      const res = await client.send(command);
      if (res.Contents) {
        for (const item of res.Contents) {
          // Strictly exclude receipts, exports, backups, reports, and import sources
          const isExempt = SERVER_EXEMPT_PREFIXES.some(p => item.Key.startsWith(`tenants/${collegeId}/${p}`));
          if (!isExempt) {
            r2Objects.push({
              key: item.Key,
              size: item.Size
            });
          }
        }
      }
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
  } catch (err) {
    console.warn(`[StorageReconciliation] Could not scan R2 bucket directly: ${err.message}. Falling back to DB synchronization.`);
  }

  // 2. Fetch all known StoredFile records for this college
  const existingFiles = await prisma.storedFile.findMany({
    where: { college_id: collegeId },
    select: { id: true, objectKey: true, sizeBytes: true, status: true, deletedAt: true }
  });
  const fileMap = new Map();
  for (const f of existingFiles) {
    fileMap.set(f.objectKey, f);
  }

  let backfilledCount = 0;

  // 3. Register any untracked objects found in R2
  for (const obj of r2Objects) {
    if (!fileMap.has(obj.key)) {
      // Check if it's currently a pending reservation
      const pendingRes = await prisma.uploadReservation.findUnique({
        where: { storageKey: obj.key }
      });
      if (pendingRes && pendingRes.status === 'PENDING' && pendingRes.expiresAt > new Date()) {
        continue; // Skip active pending uploads
      }

      // Backfill missing file record
      const keyParts = obj.key.split('/');
      const filename = keyParts[keyParts.length - 1] || 'legacy_file';
      const category = keyParts[2] || 'BACKFILLED';

      await prisma.storedFile.create({
        data: {
          college_id: collegeId,
          uploadedById: 'SYSTEM_BACKFILL',
          objectKey: obj.key,
          originalFilename: filename,
          contentType: 'application/octet-stream',
          sizeBytes: obj.size,
          category,
          status: 'ready'
        }
      });
      backfilledCount++;
    }
  }

  // 4. Calculate total verified storage usage from StoredFile (excluding exempt categories)
  const usageAggregate = await prisma.storedFile.aggregate({
    where: {
      college_id: collegeId,
      status: { not: 'deleted' },
      deletedAt: null,
      category: { notIn: SERVER_EXEMPT_CATEGORIES }
    },
    _sum: { sizeBytes: true }
  });

  const verifiedTotalBytes = BigInt(usageAggregate._sum.sizeBytes || 0);

  // 5. Update CollegeUsage.storageBytes
  await prisma.collegeUsage.upsert({
    where: {
      college_id_metric_period: {
        college_id: collegeId,
        metric: 'storageBytes',
        period: 'total'
      }
    },
    update: {
      value: verifiedTotalBytes
    },
    create: {
      college_id: collegeId,
      metric: 'storageBytes',
      period: 'total',
      value: verifiedTotalBytes
    }
  });

  console.log(`[StorageReconciliation] College ${collegeId} reconciled: ${verifiedTotalBytes} bytes, ${backfilledCount} backfilled.`);
  return {
    collegeId,
    verifiedTotalBytes: Number(verifiedTotalBytes),
    backfilledCount
  };
}

module.exports = {
  reconcileCollegeStorage
};

