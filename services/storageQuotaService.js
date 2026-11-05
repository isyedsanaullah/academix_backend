/**
 * storageQuotaService.js — Phase 7A
 * Quota-managed file storage operations:
 * - Reservation phase with pessimistic quota check (usage + pending reservations + declared)
 * - Finalize phase with R2 HEAD validation and atomic StoredFile creation
 * - Immediate quota reclamation on permanent delete
 * - Platform receipts exemption (tenants/{id}/receipts/ excluded from quota)
 */

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('./entitlements');
const {
  generateObjectKey,
  sanitizeFilename,
  getPresignedUploadUrl,
  headObject,
  deleteObject,
  getPresignedDownloadUrl
} = require('./storageService');

const SERVER_EXEMPT_CATEGORIES = new Set(['EXPORTS', 'BACKUPS', 'REPORTS', 'RECEIPTS', 'IMPORT_SOURCE']);

/**
 * Reserve an upload slot with atomic quota validation.
 */
async function reserveUploadSlot(collegeId, userId, opts) {
  const {
    filename,
    category = 'general',
    declaredSizeBytes,
    entityType = null,
    entityId = null,
    contentType = 'application/octet-stream'
  } = opts;

  if (SERVER_EXEMPT_CATEGORIES.has(String(category).toUpperCase())) {
    throw Object.assign(
      new Error(`Category '${category}' is reserved for platform operations and cannot be reserved by clients`),
      { status: 400, code: 'CLIENT_CATEGORY_NOT_ALLOWED' }
    );
  }

  const prisma = getSystemClient();
  const declaredBytes = BigInt(declaredSizeBytes || 0);

  if (declaredBytes <= 0n) {
    throw Object.assign(new Error('Declared file size must be greater than 0'), { status: 400 });
  }

  // 1. Fetch entitlements for storage caps
  const ent = await getEntitlements(collegeId);
  const maxStorage = ent.effectiveLimits?.maxStorageBytes ?? (5n * 1024n * 1024n * 1024n); // 5GB default
  const maxUpload = ent.effectiveLimits?.maxUploadBytes ?? (50n * 1024n * 1024n); // 50MB default

  if (maxUpload !== -1n && declaredBytes > BigInt(maxUpload)) {
    throw Object.assign(
      new Error(`File size (${declaredBytes} bytes) exceeds maximum upload limit (${maxUpload} bytes)`),
      { status: 413, code: 'MAX_UPLOAD_SIZE_EXCEEDED' }
    );
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10-minute TTL

  // 2. Validate storage quota inside transaction
  return await prisma.$transaction(async (tx) => {
    // Current usage
    const usageRow = await tx.collegeUsage.findUnique({
      where: {
        college_id_metric_period: {
          college_id: collegeId,
          metric: 'storageBytes',
          period: 'total'
        }
      }
    });
    const currentUsage = usageRow ? BigInt(usageRow.value) : 0n;

    // Unexpired pending reservations
    const pendingRows = await tx.uploadReservation.findMany({
      where: {
        college_id: collegeId,
        status: 'PENDING',
        expiresAt: { gt: now }
      },
      select: { declaredSizeBytes: true }
    });
    const pendingSum = pendingRows.reduce((sum, r) => sum + BigInt(r.declaredSizeBytes), 0n);

    if (maxStorage !== -1n && (currentUsage + pendingSum + declaredBytes > BigInt(maxStorage))) {
      throw Object.assign(
        new Error(`Storage quota exceeded. Available: ${Number(BigInt(maxStorage) - currentUsage - pendingSum)} bytes`),
        { status: 413, code: 'STORAGE_QUOTA_EXCEEDED' }
      );
    }

    const sanitized = sanitizeFilename(filename);
    const storageKey = generateObjectKey(collegeId, category, entityId, sanitized);

    const reservation = await tx.uploadReservation.create({
      data: {
        college_id: collegeId,
        category,
        originalFilename: sanitized,
        declaredSizeBytes: declaredBytes,
        storageKey,
        expiresAt,
        status: 'PENDING'
      }
    });

    const { uploadUrl } = await getPresignedUploadUrl({
      objectKey: storageKey,
      contentType,
      contentLength: Number(declaredBytes),
      expiresIn: 600
    });

    return {
      reservationId: reservation.id,
      storageKey,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      declaredSizeBytes: Number(declaredBytes)
    };
  });
}

/**
 * Finalize an upload reservation after client uploaded bytes to R2.
 */
async function finalizeUploadReservation(reservationId, userId) {
  const prisma = getSystemClient();
  const now = new Date();

  const reservation = await prisma.uploadReservation.findUnique({
    where: { id: reservationId }
  });

  if (!reservation) {
    throw Object.assign(new Error('Reservation not found'), { status: 404 });
  }

  if (reservation.status === 'FINALIZED') {
    const existing = await prisma.storedFile.findUnique({
      where: { objectKey: reservation.storageKey }
    });
    return { success: true, file: existing };
  }

  if (reservation.status !== 'PENDING' || reservation.expiresAt < now) {
    throw Object.assign(new Error(`Reservation is ${reservation.status} or expired`), { status: 400 });
  }

  // 1. Verify object exists on R2 via HEAD
  const head = await headObject(reservation.storageKey);
  if (!head) {
    await prisma.uploadReservation.update({
      where: { id: reservationId },
      data: { status: 'ABANDONED' }
    });
    throw Object.assign(new Error('Object not found in cloud storage. Upload may have failed.'), { status: 400 });
  }

  const actualBytes = BigInt(head.contentLength || 0);
  if (actualBytes > BigInt(reservation.declaredSizeBytes)) {
    // Exceeded declared size -> delete from R2 and abort
    await deleteObject(reservation.storageKey);
    await prisma.uploadReservation.update({
      where: { id: reservationId },
      data: { status: 'ABANDONED' }
    });
    throw Object.assign(
      new Error(`Actual size (${actualBytes}) exceeds declared size (${reservation.declaredSizeBytes})`),
      { status: 400, code: 'FILE_SIZE_MISMATCH' }
    );
  }

  // 2. Atomic state transition and StoredFile registration
  return await prisma.$transaction(async (tx) => {
    // Conditional update
    const updated = await tx.uploadReservation.updateMany({
      where: { id: reservationId, status: 'PENDING' },
      data: { status: 'FINALIZED' }
    });

    if (updated.count !== 1) {
      throw Object.assign(new Error('Reservation already processed or cancelled'), { status: 409 });
    }

    const storedFile = await tx.storedFile.create({
      data: {
        college_id: reservation.college_id,
        uploadedById: userId,
        objectKey: reservation.storageKey,
        originalFilename: reservation.originalFilename,
        contentType: head.contentType || 'application/octet-stream',
        sizeBytes: Number(actualBytes),
        category: reservation.category,
        status: 'ready'
      }
    });

    // Increment CollegeUsage.storageBytes
    await tx.collegeUsage.upsert({
      where: {
        college_id_metric_period: {
          college_id: reservation.college_id,
          metric: 'storageBytes',
          period: 'total'
        }
      },
      update: {
        value: { increment: actualBytes }
      },
      create: {
        college_id: reservation.college_id,
        metric: 'storageBytes',
        period: 'total',
        value: actualBytes
      }
    });

    return {
      success: true,
      file: storedFile
    };
  });
}

/**
 * Permanently delete a file from R2 and immediately reclaim storage quota.
 */
async function deleteStoredFile(fileId, collegeId) {
  const prisma = getSystemClient();

  const file = await prisma.storedFile.findFirst({
    where: { id: fileId, college_id: collegeId }
  });

  if (!file) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }

  // Phase 10: N16 Legal Hold Delete Protection
  const { assertNoLegalHold } = require('./legalHoldService');
  const studentTargetId = file.entityType === 'Student' ? file.entityId : (file.student_id || null);
  await assertNoLegalHold(collegeId, {
    studentId: studentTargetId,
    sessionId: file.session_id || null
  });

  // 1. Delete from R2
  try {
    await deleteObject(file.objectKey);
  } catch (err) {
    console.warn(`[deleteStoredFile] R2 delete warning for ${file.objectKey}:`, err.message);
  }

  // 2. Mark deleted and decrement usage
  const sizeToReclaim = BigInt(file.sizeBytes || 0);

  return await prisma.$transaction(async (tx) => {
    await tx.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'deleted',
        deletedAt: new Date()
      }
    });

    if (sizeToReclaim > 0n) {
      const current = await tx.collegeUsage.findUnique({
        where: {
          college_id_metric_period: {
            college_id: collegeId,
            metric: 'storageBytes',
            period: 'total'
          }
        }
      });

      if (current) {
        const newVal = BigInt(current.value) > sizeToReclaim ? BigInt(current.value) - sizeToReclaim : 0n;
        await tx.collegeUsage.update({
          where: {
            college_id_metric_period: {
              college_id: collegeId,
              metric: 'storageBytes',
              period: 'total'
            }
          },
          data: { value: newVal }
        });
      }
    }

    return { success: true, reclaimedBytes: Number(sizeToReclaim) };
  });
}

/**
 * Get storage quota breakdown for a college.
 */
async function getStorageQuotaOverview(collegeId) {
  const prisma = getSystemClient();
  const ent = await getEntitlements(collegeId);

  const maxStorage = ent.effectiveLimits?.maxStorageBytes ?? (5n * 1024n * 1024n * 1024n);
  const maxUpload = ent.effectiveLimits?.maxUploadBytes ?? (50n * 1024n * 1024n);

  const usageRow = await prisma.collegeUsage.findUnique({
    where: {
      college_id_metric_period: {
        college_id: collegeId,
        metric: 'storageBytes',
        period: 'total'
      }
    }
  });

  const usedBytes = usageRow ? Number(usageRow.value) : 0;
  const maxBytes = maxStorage === -1n ? -1 : Number(maxStorage);
  const percentage = maxBytes > 0 ? Number(((usedBytes / maxBytes) * 100).toFixed(1)) : 0;

  // Breakdown by category
  const files = await prisma.storedFile.groupBy({
    by: ['category'],
    where: { college_id: collegeId, status: { not: 'deleted' }, deletedAt: null },
    _sum: { sizeBytes: true },
    _count: { id: true }
  });

  const categories = {};
  for (const f of files) {
    categories[f.category] = {
      count: f._count.id,
      bytes: f._sum.sizeBytes || 0
    };
  }

  return {
    usedBytes,
    maxBytes,
    percentage,
    maxUploadBytes: maxUpload === -1n ? -1 : Number(maxUpload),
    categories
  };
}

module.exports = {
  reserveUploadSlot,
  finalizeUploadReservation,
  deleteStoredFile,
  getStorageQuotaOverview,
  SERVER_EXEMPT_CATEGORIES
};

