/**
 * Centralized R2 Storage Service
 * ────────────────────────────────
 * Reusable module for all Cloudflare R2 object operations in the Academix
 * backend. Every controller must use this service — never create ad-hoc
 * S3 clients elsewhere.
 *
 * SECURITY: Object keys are generated server-side only. Client-provided
 * filenames are sanitized and never used as object keys.
 */
const crypto = require('crypto');
const path = require('path');
const {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getR2Client, getBucketName } = require('../config/r2');

// ── File validation constants ────────────────────────────────────────
const ALLOWED_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  document: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // xlsx
  ],
  pdf: ['application/pdf'],
};

const ALLOWED_EXTENSIONS = {
  image: ['.jpg', '.jpeg', '.png', '.webp'],
  document: ['.pdf', '.docx', '.xlsx'],
  pdf: ['.pdf'],
};

// Magic bytes for basic file-signature validation
const FILE_SIGNATURES = {
  'image/jpeg': [Buffer.from([0xFF, 0xD8, 0xFF])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  'image/webp': [Buffer.from('RIFF')], // first 4 bytes of WebP (RIFF header)
  'application/pdf': [Buffer.from('%PDF')],
};

const MAX_FILE_SIZES = {
  image: 5 * 1024 * 1024,       // 5 MB
  document: 25 * 1024 * 1024,   // 25 MB
  pdf: 25 * 1024 * 1024,        // 25 MB
  default: 50 * 1024 * 1024,    // 50 MB
};

const PRESIGNED_URL_EXPIRY = {
  upload: 15 * 60,   // 15 minutes for uploads
  download: 5 * 60,  // 5 minutes for downloads
  preview: 5 * 60,   // 5 minutes for previews
};

// ── Key generation ───────────────────────────────────────────────────

/**
 * Sanitize a filename extension. Returns lowercase extension with dot,
 * or empty string if invalid.
 */
function sanitizeExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const ext = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext || '';
}

/**
 * Sanitize a display filename — strip path traversals, limit length.
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return 'unnamed';
  return filename
    .replace(/[/\\:*?"<>|]/g, '_') // strip path/shell characters
    .replace(/\.{2,}/g, '.')       // strip path traversal
    .slice(0, 255);                // limit length
}

/**
 * Generate a tenant-isolated, random R2 object key.
 *
 * Format: tenants/{collegeId}/{category}/{entityId}/{fileUUID}.{ext}
 *
 * @param {string} collegeId  - Tenant UUID (from server context, never from client)
 * @param {string} category   - File category (e.g. 'students', 'documents', 'college')
 * @param {string} entityId   - Associated entity UUID (student, assignment, etc.)
 * @param {string} originalFilename - Original filename (used only for extension)
 * @returns {string}
 */
function generateObjectKey(collegeId, category, entityId, originalFilename) {
  if (!collegeId || !category) {
    throw new Error('generateObjectKey requires collegeId and category');
  }
  const fileUUID = crypto.randomUUID();
  const ext = sanitizeExtension(originalFilename);
  const entityPart = entityId || 'general';
  return `tenants/${collegeId}/${category}/${entityPart}/${fileUUID}${ext}`;
}

// ── Core operations ──────────────────────────────────────────────────

/**
 * Upload a buffer directly to R2 (backend-mediated upload).
 * Suitable for small files like avatars and logos.
 */
async function uploadObject({ objectKey, body, contentType, cacheControl, metadata = {} }) {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
    ...(cacheControl ? { CacheControl: cacheControl } : {}),
    Metadata: metadata,
  });

  await client.send(command);
  return { objectKey, bucket };
}

/**
 * Generate a short-lived presigned PUT URL for direct browser uploads.
 * The frontend uploads bytes directly to R2 without receiving credentials.
 */
async function getPresignedUploadUrl({ objectKey, contentType, contentLength, expiresIn }) {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
    ...(contentLength ? { ContentLength: contentLength } : {}),
  });

  const url = await getSignedUrl(client, command, {
    expiresIn: expiresIn || PRESIGNED_URL_EXPIRY.upload,
  });

  return { uploadUrl: url, objectKey };
}

/**
 * Generate a short-lived presigned GET URL for authorized downloads.
 * The URL acts as a bearer token — do not log or store permanently.
 *
 * @param {object} opts
 * @param {string} opts.objectKey
 * @param {number} [opts.expiresIn]  - Seconds (default: 5 min)
 * @param {string} [opts.disposition] - Content-Disposition override
 */
async function getPresignedDownloadUrl({ objectKey, expiresIn, disposition }) {
  const client = getR2Client();
  const bucket = getBucketName();

  const commandInput = {
    Bucket: bucket,
    Key: objectKey,
  };

  if (disposition) {
    commandInput.ResponseContentDisposition = disposition;
  }

  const command = new GetObjectCommand(commandInput);
  const url = await getSignedUrl(client, command, {
    expiresIn: expiresIn || PRESIGNED_URL_EXPIRY.download,
  });

  return url;
}

/**
 * Check if an object exists in R2 and return its metadata.
 * Returns null if the object doesn't exist.
 */
async function headObject(objectKey) {
  const client = getR2Client();
  const bucket = getBucketName();

  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: objectKey,
    });
    const response = await client.send(command);
    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      etag: response.ETag,
      lastModified: response.LastModified,
      metadata: response.Metadata || {},
    };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Download an object's body as a readable stream.
 * Use for backend-mediated downloads when presigned URLs are not suitable.
 */
async function getObjectStream(objectKey) {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });

  const response = await client.send(command);
  return {
    body: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Delete a single object from R2.
 * Safe to retry — deleting a non-existent key is a no-op in S3/R2.
 */
async function deleteObject(objectKey) {
  const client = getR2Client();
  const bucket = getBucketName();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: objectKey,
  });

  await client.send(command);
  return true;
}

/**
 * Delete multiple objects by prefix (tenant cleanup).
 * Use with extreme care — scoped to a tenant prefix.
 */
async function deleteByPrefix(prefix, { dryRun = true, maxKeys = 100 } = {}) {
  const client = getR2Client();
  const bucket = getBucketName();

  const listCommand = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
  });

  const response = await client.send(listCommand);
  const keys = (response.Contents || []).map((obj) => obj.Key);

  if (dryRun) {
    return { dryRun: true, keys };
  }

  for (const key of keys) {
    await deleteObject(key);
  }

  return { deleted: keys.length, keys };
}

// ── Validation helpers ───────────────────────────────────────────────

/**
 * Validate a file against category-specific allowlists.
 * @param {object} opts
 * @param {string} opts.filename
 * @param {string} opts.contentType
 * @param {number} opts.size
 * @param {string} opts.category - 'image', 'document', or 'pdf'
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFile({ filename, contentType, size, category }) {
  const cat = category || 'document';
  const allowedMimes = ALLOWED_MIME_TYPES[cat] || ALLOWED_MIME_TYPES.document;
  const allowedExts = ALLOWED_EXTENSIONS[cat] || ALLOWED_EXTENSIONS.document;
  const maxSize = MAX_FILE_SIZES[cat] || MAX_FILE_SIZES.default;

  // Extension check
  const ext = sanitizeExtension(filename);
  if (!ext || !allowedExts.includes(ext)) {
    return { valid: false, error: `File extension '${ext}' is not allowed. Accepted: ${allowedExts.join(', ')}` };
  }

  // MIME type check
  if (!allowedMimes.includes(contentType)) {
    return { valid: false, error: `Content type '${contentType}' is not allowed. Accepted: ${allowedMimes.join(', ')}` };
  }

  // Size check
  if (size > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
    return { valid: false, error: `File size exceeds the ${maxMB}MB limit for ${cat} files.` };
  }

  if (size <= 0) {
    return { valid: false, error: 'File is empty.' };
  }

  return { valid: true };
}

/**
 * Validate file content (magic bytes) against declared content type.
 * @param {Buffer} buffer - File buffer (at least first 8 bytes)
 * @param {string} declaredType - The declared MIME type
 * @returns {{ valid: boolean, error?: string }}
 */
function validateFileSignature(buffer, declaredType) {
  const signatures = FILE_SIGNATURES[declaredType];
  if (!signatures) {
    // No signature check for this type — allow but note limitation
    return { valid: true };
  }

  const headerSlice = buffer.slice(0, 8);
  const matches = signatures.some((sig) => {
    for (let i = 0; i < sig.length; i++) {
      if (headerSlice[i] !== sig[i]) return false;
    }
    return true;
  });

  if (!matches) {
    return { valid: false, error: `File content does not match declared type '${declaredType}'. Possible file corruption or type mismatch.` };
  }

  return { valid: true };
}

/**
 * Compute SHA-256 checksum of a buffer.
 */
function computeChecksum(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ── R2 reference helpers (for legacy compatibility) ──────────────────

/**
 * Determine if a stored value is an R2 reference.
 * R2 references are stored as `r2:{storedFileId}` in legacy string fields.
 */
function isR2Reference(value) {
  return typeof value === 'string' && value.startsWith('r2:');
}

/**
 * Extract the StoredFile ID from an r2: reference.
 */
function parseR2Reference(value) {
  if (!isR2Reference(value)) return null;
  return value.slice(3); // Remove 'r2:' prefix
}

/**
 * Create an r2: reference string from a StoredFile ID.
 */
function toR2Reference(storedFileId) {
  return `r2:${storedFileId}`;
}

module.exports = {
  // Key generation
  generateObjectKey,
  sanitizeFilename,
  sanitizeExtension,

  // Core operations
  uploadObject,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  headObject,
  getObjectStream,
  deleteObject,
  deleteByPrefix,

  // Validation
  validateFile,
  validateFileSignature,
  computeChecksum,

  // Legacy compatibility
  isR2Reference,
  parseR2Reference,
  toR2Reference,

  // Constants
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZES,
  PRESIGNED_URL_EXPIRY,
};
