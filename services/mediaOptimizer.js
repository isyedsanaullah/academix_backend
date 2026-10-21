/**
 * Media Optimizer Service (Phase 11)
 * ─────────────────────────────────────────────────────────────
 * Resizes, compresses, and optimizes images using `sharp`.
 * - Photos for students: max 480px, WebP quality 80, 96px thumbnail
 * - Logos and signatures: max 600px (signatures keep PNG with transparency)
 * - Payment screenshots (PaymentProof): max 1200px, WebP quality 70
 * - General images: max 1280px, WebP quality 80
 * - Background removal for signatures: near-white pixels to transparent
 * - Cache-Control rule evaluation
 * - Pure Node zip decompression using standard zlib (for bulk photo uploads)
 */

const sharp = require('sharp');
const zlib = require('zlib');
const path = require('path');

const MAX_IMAGE_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Remove near-white background from an image buffer
 * Converts pixels where R, G, B >= threshold to transparent (A = 0)
 */
async function removeNearWhiteBackground(buffer, threshold = 240) {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const rawData = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  
  const data = rawData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      data[i + 3] = 0; // Alpha = 0 (transparent)
    }
  }

  return sharp(data, {
    raw: {
      width: rawData.info.width,
      height: rawData.info.height,
      channels: 4,
    },
  })
    .png({ quality: 90, compressionLevel: 8 })
    .toBuffer();
}

/**
 * Optimize an image buffer according to entityType & category guidelines
 * Returns { buffer, contentType, sizeBytes, width, height }
 */
async function optimizeImage(buffer, options = {}) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Valid image buffer is required');
  }

  if (buffer.length > MAX_IMAGE_FILE_SIZE) {
    const err = new Error('File size exceeds 5 MB limit');
    err.statusCode = 400;
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  const {
    entityType = null,
    category = 'general',
    removeBackground = false,
    bgThreshold = 240,
  } = options;

  let isSignatureOrStamp = ['Signature', 'Stamp'].includes(entityType) || ['signatures', 'stamps'].includes(category);
  let isLogo = entityType === 'Logo' || category === 'logos';
  let isStudent = entityType === 'Student' || category === 'avatars' || category === 'students';
  let isPaymentProof = entityType === 'PaymentProof' || category === 'payment-proofs';

  // Background removal option for signatures/stamps
  let workingBuffer = buffer;
  if ((isSignatureOrStamp || removeBackground) && removeBackground) {
    workingBuffer = await removeNearWhiteBackground(workingBuffer, bgThreshold);
  }

  let maxSide = 1280;
  let targetFormat = 'webp';
  let quality = 80;

  if (isStudent) {
    maxSide = 480;
    targetFormat = 'webp';
    quality = 80;
  } else if (isSignatureOrStamp) {
    maxSide = 600;
    targetFormat = 'png'; // Preserves transparency
  } else if (isLogo) {
    maxSide = 600;
    targetFormat = 'png'; // Preserves transparency for logos and seals
  } else if (isPaymentProof) {
    maxSide = 1200;
    targetFormat = 'webp';
    quality = 70;
  }

  let pipeline = sharp(workingBuffer)
    .rotate() // Auto-orient based on EXIF then strip
    .resize({
      width: maxSide,
      height: maxSide,
      fit: 'inside',
      withoutEnlargement: true,
    });

  if (targetFormat === 'png') {
    pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
  } else {
    pipeline = pipeline.webp({ quality, effort: 4 });
  }

  const outputBuffer = await pipeline.toBuffer();
  const meta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    contentType: targetFormat === 'png' ? 'image/png' : 'image/webp',
    sizeBytes: outputBuffer.length,
    width: meta.width,
    height: meta.height,
    format: targetFormat,
  };
}

/**
 * Create a 96px thumbnail for student photo
 */
async function createStudentThumbnail(buffer) {
  const thumbBuffer = await sharp(buffer)
    .rotate()
    .resize(96, 96, {
      fit: 'cover',
      position: 'centre',
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();

  const meta = await sharp(thumbBuffer).metadata();
  return {
    buffer: thumbBuffer,
    contentType: 'image/webp',
    sizeBytes: thumbBuffer.length,
    width: meta.width,
    height: meta.height,
  };
}

/**
 * Determine Cache-Control header based on entityType
 */
function getCacheControlHeader(entityType, category) {
  if (['Signature', 'Stamp', 'Logo'].includes(entityType) || ['signatures', 'stamps', 'logos'].includes(category)) {
    return 'public, max-age=31536000, immutable';
  }
  if (entityType === 'Student' || ['avatars', 'students'].includes(category)) {
    return 'private, max-age=3600';
  }
  return 'public, max-age=86400';
}

/**
 * Lightweight ZIP file parser using Node standard zlib
 * Extracts all non-directory files from a zip buffer
 */
function extractZipEntries(buffer) {
  if (!buffer || buffer.length < 22) {
    throw new Error('Invalid or empty zip buffer');
  }

  // Find End of Central Directory record (EOCD signature: 0x06054b50)
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Could not locate end of central directory in zip');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  const entries = [];
  let curr = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (curr + 46 > buffer.length || buffer.readUInt32LE(curr) !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(curr + 10);
    const compressedSize = buffer.readUInt32LE(curr + 20);
    const uncompressedSize = buffer.readUInt32LE(curr + 24);
    const fileNameLen = buffer.readUInt16LE(curr + 28);
    const extraFieldLen = buffer.readUInt16LE(curr + 30);
    const fileCommentLen = buffer.readUInt16LE(curr + 32);
    const localHeaderOffset = buffer.readUInt32LE(curr + 42);

    const fileName = buffer.toString('utf8', curr + 46, curr + 46 + fileNameLen);
    curr += 46 + fileNameLen + extraFieldLen + fileCommentLen;

    // Skip directories and MacOS metadata
    if (fileName.endsWith('/') || fileName.includes('__MACOSX')) {
      continue;
    }

    // Read local header to find exact file data offset
    if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      continue;
    }

    const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const rawCompressedData = buffer.slice(dataStart, dataStart + compressedSize);

    let decompressed;
    if (compressionMethod === 0) {
      decompressed = rawCompressedData;
    } else if (compressionMethod === 8) {
      try {
        decompressed = zlib.inflateRawSync(rawCompressedData);
      } catch (err) {
        continue; // Skip corrupted entry
      }
    } else {
      continue; // Unsupported compression
    }

    entries.push({
      filename: fileName,
      fileName: path.basename(fileName),
      fullPath: fileName,
      buffer: decompressed,
      size: decompressed.length,
    });
  }

  return entries;
}

module.exports = {
  MAX_IMAGE_FILE_SIZE,
  optimizeImage,
  createStudentThumbnail,
  removeNearWhiteBackground,
  getCacheControlHeader,
  extractZipEntries,
};
