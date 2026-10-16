/**
 * File Resolver Service
 * ─────────────────────
 * Centralized utility for resolving file references in API responses.
 * Handles the transition from legacy storage (base64, URLs, local paths)
 * to R2-managed files.
 *
 * TRANSITION RULES:
 * - `r2:{storedFileId}` → resolve via StoredFile table → presigned URL
 * - `http://` or `https://` → pass through as-is (legacy external URL)
 * - `data:image/...` → pass through as-is (legacy base64)
 * - Empty/null → return null
 * - Relative path → attempt local file serve (legacy local uploads)
 *
 * SECURITY: Never trust client-provided r2: references without DB validation.
 */
const { isR2Reference, parseR2Reference, getPresignedDownloadUrl } = require('./storageService');

/**
 * Resolve a single file reference to a displayable URL.
 * Call this in API responses where file URLs are sent to the frontend.
 *
 * @param {string|null} ref - The stored file reference
 * @param {object} tenantDb - Prisma tenant client
 * @param {string} collegeId - Authenticated tenant ID
 * @returns {Promise<string|null>} Resolved URL or null
 */
async function resolveFileUrl(ref, tenantDb, collegeId) {
  if (!ref || typeof ref !== 'string') return null;

  // R2 reference — resolve to presigned URL
  if (isR2Reference(ref)) {
    const storedFileId = parseR2Reference(ref);
    if (!storedFileId) return null;

    try {
      const storedFile = await tenantDb.storedFile.findFirst({
        where: {
          id: storedFileId,
          college_id: collegeId,
          status: 'ready',
          deletedAt: null,
        },
      });

      if (!storedFile) return null;

      const inlineTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const isInline = inlineTypes.includes(storedFile.contentType);

      const url = await getPresignedDownloadUrl({
        objectKey: storedFile.objectKey,
        disposition: isInline
          ? `inline; filename="${encodeURIComponent(storedFile.originalFilename)}"`
          : `attachment; filename="${encodeURIComponent(storedFile.originalFilename)}"`,
        expiresIn: 300,
      });

      return url;
    } catch {
      return null;
    }
  }

  // External URLs — pass through
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    return ref;
  }

  // Base64 data URIs — pass through (legacy)
  if (ref.startsWith('data:')) {
    return ref;
  }

  // Relative path — could be a local upload, return as-is for now
  if (ref.startsWith('/') || ref.startsWith('./')) {
    return ref;
  }

  // Unknown format — return as-is
  return ref;
}

/**
 * Resolve multiple file references in batch.
 * Efficiently handles mixed legacy and R2 references.
 *
 * @param {(string|null)[]} refs - Array of file references
 * @param {object} tenantDb - Prisma tenant client
 * @param {string} collegeId - Authenticated tenant ID
 * @returns {Promise<(string|null)[]>} Array of resolved URLs
 */
async function resolveFileUrls(refs, tenantDb, collegeId) {
  if (!Array.isArray(refs)) return [];

  // Batch-fetch all R2 references in one query
  const r2Ids = refs
    .filter((r) => isR2Reference(r))
    .map((r) => parseR2Reference(r))
    .filter(Boolean);

  let storedFilesMap = {};
  if (r2Ids.length > 0) {
    const storedFiles = await tenantDb.storedFile.findMany({
      where: {
        id: { in: r2Ids },
        college_id: collegeId,
        status: 'ready',
        deletedAt: null,
      },
    });

    // Pre-generate all presigned URLs
    for (const file of storedFiles) {
      const inlineTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const isInline = inlineTypes.includes(file.contentType);

      try {
        const url = await getPresignedDownloadUrl({
          objectKey: file.objectKey,
          disposition: isInline
            ? `inline; filename="${encodeURIComponent(file.originalFilename)}"`
            : `attachment; filename="${encodeURIComponent(file.originalFilename)}"`,
          expiresIn: 300,
        });
        storedFilesMap[file.id] = url;
      } catch {
        storedFilesMap[file.id] = null;
      }
    }
  }

  // Resolve each reference
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'string') return null;

    if (isR2Reference(ref)) {
      const id = parseR2Reference(ref);
      return storedFilesMap[id] || null;
    }

    // Pass through non-R2 references
    return ref;
  });
}

/**
 * Resolve file fields on a data object (mutates the object).
 * Useful for resolving avatar, photo, logo fields before sending response.
 *
 * @param {object} data - Data object with file fields
 * @param {string[]} fields - Field names to resolve
 * @param {object} tenantDb - Prisma tenant client  
 * @param {string} collegeId - Authenticated tenant ID
 * @returns {Promise<object>} The mutated data object
 */
async function resolveFileFields(data, fields, tenantDb, collegeId) {
  if (!data) return data;

  for (const field of fields) {
    if (data[field] && isR2Reference(data[field])) {
      data[field] = await resolveFileUrl(data[field], tenantDb, collegeId);
    }
  }

  return data;
}

module.exports = {
  resolveFileUrl,
  resolveFileUrls,
  resolveFileFields,
};
