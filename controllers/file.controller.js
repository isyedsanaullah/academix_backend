/**
 * File Controller — Secure Multi-Tenant File Operations
 * ──────────────────────────────────────────────────────
 * Handles upload initiation, finalization, download URL generation,
 * listing, and deletion for all R2-managed files.
 *
 * SECURITY INVARIANTS:
 * 1. Every operation authenticates the user and resolves tenant from server context.
 * 2. Object keys are generated server-side — never from client input.
 * 3. All DB queries are tenant-scoped (college_id = req.collegeId).
 * 4. Presigned URLs are short-lived and never stored permanently.
 * 5. Cross-tenant access is impossible by design.
 */
const {
  generateObjectKey,
  sanitizeFilename,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  headObject,
  uploadObject,
  deleteObject,
  validateFile,
  validateFileSignature,
  computeChecksum,
  toR2Reference,
} = require('../services/storageService');
const { getSystemClient } = require('../config/prismaManager');
const { consume, getCollegeLimit } = require('../services/quota');
const {
  optimizeImage,
  createStudentThumbnail,
  getCacheControlHeader,
  MAX_IMAGE_FILE_SIZE,
} = require('../services/mediaOptimizer');

// ── Allowed categories (maps to object key path segments) ────────────
const VALID_CATEGORIES = [
  'college', 'students', 'staff', 'documents', 'notices',
  'assignments', 'attachments', 'applications', 'avatars',
  'visitors', 'leaves', 'general', 'image', 'signatures',
  'stamps', 'logos', 'payment-proofs',
];

/**
 * POST /api/files/initiate
 * Start a new file upload — creates a pending StoredFile record and returns
 * either a presigned PUT URL (for large files) or accepts the file buffer
 * directly (for small files via multipart form).
 */
exports.initiateUpload = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const collegeId = req.collegeId;

    const {
      filename,
      contentType,
      size,
      category = 'general',
      entityType,
      entityId,
    } = req.body;

    // ── Validate inputs ──────────────────────────────────────────────
    if (!filename || !contentType || !size) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: filename, contentType, size',
      });
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category '${category}'. Allowed: ${VALID_CATEGORIES.join(', ')}`,
      });
    }

    // Determine file type category for validation
    const fileTypeCategory = ['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
      ? 'image'
      : contentType === 'application/pdf'
        ? 'pdf'
        : 'document';

    const validation = validateFile({
      filename,
      contentType,
      size: parseInt(size, 10),
      category: fileTypeCategory,
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // ── Verify entity ownership if entityType + entityId provided ─────
    if (entityType && entityId) {
      const verified = await verifyEntityOwnership(tenantDb, collegeId, entityType, entityId, userId, req.user.role);
      if (!verified) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to upload files for this entity.',
        });
      }
    }

    // ── Generate object key and create pending record ────────────────
    const sanitizedName = sanitizeFilename(filename);
    const objectKey = generateObjectKey(collegeId, category, entityId, filename);

    const storedFile = await tenantDb.storedFile.create({
      data: {
        college_id: collegeId,
        uploadedById: userId,
        objectKey,
        originalFilename: sanitizedName,
        contentType,
        sizeBytes: parseInt(size, 10),
        category,
        entityType: entityType || null,
        entityId: entityId || null,
        status: 'pending',
      },
    });

    // ── Generate presigned upload URL ────────────────────────────────
    const { uploadUrl } = await getPresignedUploadUrl({
      objectKey,
      contentType,
      contentLength: parseInt(size, 10),
    });

    res.status(201).json({
      success: true,
      data: {
        fileId: storedFile.id,
        uploadUrl,
        objectKey, // needed by frontend to set correct headers
        contentType,
        expiresIn: 900, // 15 minutes
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/files/:id/finalize
 * Verify the upload completed successfully and mark the file as ready.
 */
exports.finalizeUpload = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const collegeId = req.collegeId;
    const fileId = req.params.id;

    // ── Load the pending file within tenant scope ────────────────────
    const storedFile = await tenantDb.storedFile.findFirst({
      where: {
        id: fileId,
        college_id: collegeId,
      },
    });

    if (!storedFile) {
      return res.status(404).json({ success: false, message: 'File record not found.' });
    }

    // Idempotent: if already ready, return success
    if (storedFile.status === 'ready') {
      return res.json({
        success: true,
        message: 'File already finalized.',
        data: { ...storedFile, _id: storedFile.id },
      });
    }

    if (storedFile.status !== 'pending' && storedFile.status !== 'uploading') {
      return res.status(400).json({
        success: false,
        message: `Cannot finalize a file with status '${storedFile.status}'.`,
      });
    }

    // Only the uploader or admin can finalize
    if (storedFile.uploadedById !== userId && !['admin', 'superAdmin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to finalize this upload.' });
    }

    // ── Verify R2 object exists ──────────────────────────────────────
    const objectMeta = await headObject(storedFile.objectKey);

    if (!objectMeta) {
      await tenantDb.storedFile.update({
        where: { id: fileId },
        data: { status: 'failed', errorMessage: 'Upload not found in storage. The upload may have failed or expired.' },
      });
      return res.status(400).json({
        success: false,
        message: 'File was not found in storage. Please retry the upload.',
      });
    }

    // ── Verify file size matches ─────────────────────────────────────
    if (objectMeta.contentLength && Math.abs(objectMeta.contentLength - storedFile.sizeBytes) > 1024) {
      // Allow 1KB variance for encoding differences
      await tenantDb.storedFile.update({
        where: { id: fileId },
        data: {
          status: 'failed',
          errorMessage: `Size mismatch: expected ${storedFile.sizeBytes}, actual ${objectMeta.contentLength}`,
        },
      });
      return res.status(400).json({
        success: false,
        message: 'Uploaded file size does not match the declared size.',
      });
    }

    // ── Check storage quota ──────────────────────────────────────────
    const finalSizeBytes = objectMeta.contentLength || storedFile.sizeBytes;
    const sysDb = getSystemClient();
    const storageLimit = await getCollegeLimit(sysDb, collegeId, 'storageBytes');
    const quotaResult = await consume(sysDb, collegeId, 'storageBytes', finalSizeBytes, storageLimit);
    if (!quotaResult.allowed) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded for storageBytes',
        metric: 'storageBytes'
      });
    }
    if (quotaResult.warning) {
      res.setHeader('X-Quota-Warning', `storageBytes quota at 80%+ (${quotaResult.value}/${quotaResult.limit})`);
    }

    // ── Mark as ready ────────────────────────────────────────────────
    const updatedFile = await tenantDb.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'ready',
        sizeBytes: objectMeta.contentLength || storedFile.sizeBytes,
        errorMessage: null,
      },
    });

    res.json({
      success: true,
      message: 'File upload verified and finalized.',
      data: { ...updatedFile, _id: updatedFile.id },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/files/upload
 * Backend-mediated upload for small files (avatars, logos).
 * Accepts multipart form data, validates, uploads to R2, creates ready record.
 */
exports.directUpload = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const collegeId = req.collegeId;

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const { category = 'general', entityType, entityId } = req.body;

    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `Invalid category '${category}'.`,
      });
    }

    const fileTypeCategory = ['image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)
      ? 'image'
      : req.file.mimetype === 'application/pdf'
        ? 'pdf'
        : 'document';

    const validation = validateFile({
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size,
      category: fileTypeCategory,
    });

    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.error });
    }

    // Validate file signature (magic bytes)
    const sigCheck = validateFileSignature(req.file.buffer, req.file.mimetype);
    if (!sigCheck.valid) {
      return res.status(400).json({ success: false, message: sigCheck.error });
    }

    // Verify entity ownership
    if (entityType && entityId) {
      const verified = await verifyEntityOwnership(tenantDb, collegeId, entityType, entityId, userId, req.user.role);
      if (!verified) {
        return res.status(403).json({ success: false, message: 'Not authorized for this entity.' });
      }
    }

    const sanitizedName = sanitizeFilename(req.file.originalname);

    let finalBuffer = req.file.buffer;
    let finalContentType = req.file.mimetype;
    let finalSize = req.file.size;
    let thumbStoredFile = null;

    // ── Media optimization for images ───────────────────────────────
    if (fileTypeCategory === 'image') {
      if (req.file.size > MAX_IMAGE_FILE_SIZE) {
        return res.status(400).json({
          success: false,
          code: 'FILE_TOO_LARGE',
          message: 'Image size exceeds maximum allowed 5 MB',
        });
      }

      const shouldRemoveBg = req.body.removeBackground === 'true' || req.body.removeBackground === true;
      const opt = await optimizeImage(req.file.buffer, {
        entityType,
        category,
        removeBackground: shouldRemoveBg,
      });

      finalBuffer = opt.buffer;
      finalContentType = opt.contentType;
      finalSize = opt.sizeBytes;
    }

    // ── Storage quota consumption ───────────────────────────────────
    const sysDb = getSystemClient();
    const storageLimit = await getCollegeLimit(sysDb, collegeId, 'storageBytes');
    const quotaResult = await consume(sysDb, collegeId, 'storageBytes', finalSize, storageLimit);
    if (!quotaResult.allowed) {
      return res.status(403).json({
        success: false,
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded for storageBytes',
        metric: 'storageBytes',
      });
    }
    if (quotaResult.warning) {
      res.setHeader('X-Quota-Warning', `storageBytes quota at 80%+ (${quotaResult.value}/${quotaResult.limit})`);
    }

    const cacheControl = getCacheControlHeader(entityType, category);
    const objectKey = generateObjectKey(collegeId, category, entityId, sanitizedName);
    const checksum = computeChecksum(finalBuffer);

    // Upload main file to R2
    await uploadObject({
      objectKey,
      body: finalBuffer,
      contentType: finalContentType,
      cacheControl,
    });

    // Create ready record
    const storedFile = await tenantDb.storedFile.create({
      data: {
        college_id: collegeId,
        uploadedById: userId,
        objectKey,
        originalFilename: sanitizedName,
        contentType: finalContentType,
        sizeBytes: finalSize,
        checksumSha256: checksum,
        category,
        entityType: entityType || null,
        entityId: entityId || null,
        status: 'ready',
      },
    });

    // ── Student photo: generate and store 96px thumbnail ────────────
    if (fileTypeCategory === 'image' && (entityType === 'Student' || category === 'avatars' || category === 'students')) {
      try {
        const thumb = await createStudentThumbnail(req.file.buffer);
        const thumbKey = generateObjectKey(collegeId, 'avatars', entityId || 'thumb', `thumb_${sanitizedName}.webp`);
        await uploadObject({
          objectKey: thumbKey,
          body: thumb.buffer,
          contentType: thumb.contentType,
          cacheControl: 'private, max-age=3600',
        });

        thumbStoredFile = await tenantDb.storedFile.create({
          data: {
            college_id: collegeId,
            uploadedById: userId,
            objectKey: thumbKey,
            originalFilename: `thumb_${sanitizedName}.webp`,
            contentType: thumb.contentType,
            sizeBytes: thumb.sizeBytes,
            checksumSha256: computeChecksum(thumb.buffer),
            category: 'avatars',
            entityType: 'Student',
            entityId: entityId || null,
            status: 'ready',
          },
        });

        // If entityId refers to a student, link photo and photoThumb
        if (entityId) {
          await tenantDb.student.update({
            where: { id: entityId },
            data: {
              photo: toR2Reference(storedFile.id),
              photoThumb: toR2Reference(thumbStoredFile.id),
            },
          }).catch(() => {
            // Non-fatal if student record not found by entityId
          });
        }
      } catch (thumbErr) {
        console.warn('[directUpload] Thumbnail generation warning:', thumbErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully.',
      data: {
        ...storedFile,
        _id: storedFile.id,
        r2Ref: toR2Reference(storedFile.id),
        thumbnail: thumbStoredFile ? {
          ...thumbStoredFile,
          _id: thumbStoredFile.id,
          r2Ref: toR2Reference(thumbStoredFile.id),
        } : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/files/:id/download-url
 * Generate a short-lived presigned GET URL for authorized file access.
 */
exports.getDownloadUrl = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const fileId = req.params.id;

    const storedFile = await tenantDb.storedFile.findFirst({
      where: {
        id: fileId,
        college_id: collegeId,
        status: 'ready',
        deletedAt: null,
      },
    });

    if (!storedFile) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Determine disposition based on content type
    const inlineTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const isInline = req.query.preview === 'true' && inlineTypes.includes(storedFile.contentType);

    const disposition = isInline
      ? `inline; filename="${encodeURIComponent(storedFile.originalFilename)}"`
      : `attachment; filename="${encodeURIComponent(storedFile.originalFilename)}"`;

    const url = await getPresignedDownloadUrl({
      objectKey: storedFile.objectKey,
      disposition,
      expiresIn: 300, // 5 minutes
    });

    res.json({
      success: true,
      data: {
        url,
        filename: storedFile.originalFilename,
        contentType: storedFile.contentType,
        sizeBytes: storedFile.sizeBytes,
        expiresIn: 300,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/files
 * List files with tenant-scoped pagination and filtering.
 */
exports.listFiles = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { category, entityType, entityId, status = 'ready', page = 1, limit = 20 } = req.query;

    const where = {
      college_id: collegeId,
      deletedAt: null,
    };

    if (status) where.status = status;
    if (category) where.category = category;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;

    // Non-admin users only see their own uploads
    if (!['admin', 'superAdmin', 'principal', 'registrar'].includes(req.user.role)) {
      where.uploadedById = req.user.id || req.user._id;
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const skip = (pageNum - 1) * limitNum;

    const [total, files] = await Promise.all([
      tenantDb.storedFile.count({ where }),
      tenantDb.storedFile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    res.json({
      success: true,
      data: files.map((f) => ({ ...f, _id: f.id })),
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/files/:id
 * Soft-delete a file: marks as deleting, removes R2 object, then marks deleted.
 */
exports.deleteFile = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const collegeId = req.collegeId;
    const fileId = req.params.id;

    const storedFile = await tenantDb.storedFile.findFirst({
      where: {
        id: fileId,
        college_id: collegeId,
        deletedAt: null,
      },
    });

    if (!storedFile) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Authorization: uploader or admin roles
    if (storedFile.uploadedById !== userId && !['admin', 'superAdmin', 'principal'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this file.' });
    }

    // Mark as deleting
    await tenantDb.storedFile.update({
      where: { id: fileId },
      data: { status: 'deleting' },
    });

    // Delete from R2
    try {
      await deleteObject(storedFile.objectKey);
    } catch (r2Err) {
      // Log but don't block — cleanup scheduler will retry
      console.error(`R2 deletion failed for ${storedFile.objectKey}: ${r2Err.message}`);
    }

    // Soft delete in DB
    await tenantDb.storedFile.update({
      where: { id: fileId },
      data: {
        status: 'deleted',
        deletedAt: new Date(),
      },
    });

    res.json({ success: true, message: 'File deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/files/resolve-urls
 * Batch resolve StoredFile IDs to presigned download URLs.
 * Used by frontend components that need to display multiple files.
 */
exports.resolveUrls = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const collegeId = req.collegeId;
    const { fileIds } = req.body;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ success: false, message: 'fileIds array is required.' });
    }

    // Cap at 20 per request
    const ids = fileIds.slice(0, 20);

    const files = await tenantDb.storedFile.findMany({
      where: {
        id: { in: ids },
        college_id: collegeId,
        status: 'ready',
        deletedAt: null,
      },
    });

    const results = {};
    for (const file of files) {
      const inlineTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const isInline = inlineTypes.includes(file.contentType);

      const url = await getPresignedDownloadUrl({
        objectKey: file.objectKey,
        disposition: isInline
          ? `inline; filename="${encodeURIComponent(file.originalFilename)}"`
          : `attachment; filename="${encodeURIComponent(file.originalFilename)}"`,
        expiresIn: 300,
      });

      results[file.id] = {
        url,
        filename: file.originalFilename,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
      };
    }

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
};

// ── Entity ownership verification helper ─────────────────────────────
/**
 * Verify that the given entity belongs to the authenticated tenant.
 * Returns true if the entity is owned by the college, false otherwise.
 */
async function verifyEntityOwnership(tenantDb, collegeId, entityType, entityId, userId, userRole) {
  // Admin roles can upload for any entity within their tenant
  if (['admin', 'superAdmin', 'principal', 'registrar'].includes(userRole)) {
    return true;
  }

  try {
    const normalizedType = entityType.toLowerCase();

    switch (normalizedType) {
      case 'student': {
        const student = await tenantDb.student.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        if (!student) return false;
        // Students can only upload for themselves
        if (userRole === 'student') return student.user_id === userId;
        return true;
      }

      case 'teacher': {
        const teacher = await tenantDb.teacher.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        if (!teacher) return false;
        if (userRole === 'teacher') return teacher.user_id === userId;
        return true;
      }

      case 'assignment': {
        const assignment = await tenantDb.assignment.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        if (!assignment) return false;
        if (userRole === 'teacher') return assignment.teacher_id === userId;
        return true; // students can submit to assignments
      }

      case 'announcement': {
        const announcement = await tenantDb.announcement.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        return !!announcement;
      }

      case 'leave': {
        const leave = await tenantDb.leaveApplication.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        if (!leave) return false;
        if (userRole === 'student') return leave.user_id === userId;
        return true;
      }

      case 'college': {
        // College-level uploads (logo, etc.)
        return entityId === collegeId;
      }

      case 'visitor': {
        const visitor = await tenantDb.visitorLog.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        return !!visitor;
      }

      case 'application': {
        const app = await tenantDb.application.findFirst({
          where: { id: entityId, college_id: collegeId },
        });
        return !!app;
      }

      default:
        // Unknown entity type — default to admin-only
        return ['admin', 'superAdmin', 'principal'].includes(userRole);
    }
  } catch {
    return false;
  }
}
