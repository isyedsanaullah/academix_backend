require('dotenv').config();
const assert = require('assert');
const sharp = require('sharp');
const zlib = require('zlib');
const { FEATURES } = require('../services/capabilityCatalog');
const {
  optimizeImage,
  createStudentThumbnail,
  removeNearWhiteBackground,
  getCacheControlHeader,
  extractZipEntries,
  MAX_IMAGE_FILE_SIZE,
} = require('../services/mediaOptimizer');
const {
  getBranding,
  updateBranding,
  uploadSignature,
} = require('../controllers/college.controller');
const {
  uploadStudentPhoto,
  uploadBulkStudentPhotos,
} = require('../controllers/student.controller');
const { runTenantFileCleanup } = require('../services/fileCleanupScheduler');

async function createTestImage(width, height, color = { r: 255, g: 0, b: 0 }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Helper to build a standard uncompressed ZIP file in memory
 */
function createTestZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const filenameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = file.buffer;
    const crc = 0; // minimal stub

    // Local file header (30 bytes + name + data)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Signature
    localHeader.writeUInt16LE(20, 4);         // Version needed
    localHeader.writeUInt16LE(0, 6);          // Flags
    localHeader.writeUInt16LE(0, 8);          // Compression (0 = store)
    localHeader.writeUInt16LE(0, 10);         // Mod time
    localHeader.writeUInt16LE(0, 12);         // Mod date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(dataBuf.length, 18); // Compressed size
    localHeader.writeUInt32LE(dataBuf.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // Filename len
    localHeader.writeUInt16LE(0, 28);         // Extra field len

    localHeaders.push(Buffer.concat([localHeader, filenameBuf, dataBuf]));

    // Central directory header (46 bytes + name)
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);   // Signature
    cdHeader.writeUInt16LE(20, 4);           // Version made by
    cdHeader.writeUInt16LE(20, 6);           // Version needed
    cdHeader.writeUInt16LE(0, 8);            // Flags
    cdHeader.writeUInt16LE(0, 10);           // Compression
    cdHeader.writeUInt16LE(0, 12);           // Mod time
    cdHeader.writeUInt16LE(0, 14);           // Mod date
    cdHeader.writeUInt32LE(crc, 16);         // CRC-32
    cdHeader.writeUInt32LE(dataBuf.length, 20); // Compressed size
    cdHeader.writeUInt32LE(dataBuf.length, 24); // Uncompressed size
    cdHeader.writeUInt16LE(filenameBuf.length, 28); // Filename len
    cdHeader.writeUInt16LE(0, 30);           // Extra field len
    cdHeader.writeUInt16LE(0, 32);           // Comment len
    cdHeader.writeUInt16LE(0, 34);           // Disk number start
    cdHeader.writeUInt16LE(0, 36);           // Internal attrs
    cdHeader.writeUInt32LE(0, 38);           // External attrs
    cdHeader.writeUInt32LE(offset, 42);      // Relative offset of local header

    centralHeaders.push(Buffer.concat([cdHeader, filenameBuf]));
    offset += 30 + filenameBuf.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(centralHeaders);
  const cdOffset = offset;
  const cdSize = cdBuf.length;

  // End of Central Directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // Signature
  eocd.writeUInt16LE(0, 4);          // Disk number
  eocd.writeUInt16LE(0, 6);          // Disk with CD
  eocd.writeUInt16LE(files.length, 8); // Entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12);    // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);  // Offset of central directory
  eocd.writeUInt16LE(0, 20);         // Comment len

  return Buffer.concat([...localHeaders, cdBuf, eocd]);
}

async function runPhase11Tests() {
  console.log('--- Starting Phase 11 Test Suite: Branding, Signatures, Student Photo & Media Optimization ---');

  // 1. Capability Catalog checks
  const p11Features = ['college-branding', 'student-photo', 'media-optimization'];
  for (const key of p11Features) {
    const f = FEATURES.find((feat) => feat.key === key);
    assert(f, `Feature '${key}' must exist in capability catalog`);
    assert.strictEqual(f.status, 'live', `Feature '${key}' must have status 'live'`);
    assert.strictEqual(f.effort, 'Done', `Feature '${key}' must have effort 'Done'`);
  }
  console.log('✓ 1. All 3 Phase 11 features verified live & Done in capabilityCatalog');

  // 2. Media Optimization: Image Resizing & Format Conversion
  const largeImgBuffer = await createTestImage(1000, 1000, { r: 100, g: 150, b: 200 });

  // Student photo: max 480px, WebP
  const studentOpt = await optimizeImage(largeImgBuffer, { entityType: 'Student' });
  assert.strictEqual(studentOpt.format, 'webp', 'Student photo must be converted to WebP');
  assert.strictEqual(studentOpt.contentType, 'image/webp', 'Student photo contentType must be image/webp');
  assert(studentOpt.width <= 480, `Student photo width (${studentOpt.width}) must be <= 480px`);
  assert(studentOpt.height <= 480, `Student photo height (${studentOpt.height}) must be <= 480px`);
  console.log('✓ 2. Student photo successfully resized to <= 480px WebP');

  // 3. Student Thumbnail: 96px WebP
  const thumb = await createStudentThumbnail(largeImgBuffer);
  assert.strictEqual(thumb.width, 96, 'Student thumbnail width must be 96px');
  assert.strictEqual(thumb.height, 96, 'Student thumbnail height must be 96px');
  assert.strictEqual(thumb.contentType, 'image/webp', 'Student thumbnail contentType must be image/webp');
  console.log('✓ 3. Student thumbnail correctly generated at 96x96 WebP');

  // 4. Near-White Background Removal for Signatures
  // Create an image with near-white background (RGB 245, 245, 245)
  const nearWhiteImg = await createTestImage(300, 200, { r: 245, g: 245, b: 245 });
  const sigOpt = await optimizeImage(nearWhiteImg, {
    entityType: 'Signature',
    category: 'signatures',
    removeBackground: true,
  });

  assert.strictEqual(sigOpt.format, 'png', 'Signatures must maintain PNG format for transparency');
  assert.strictEqual(sigOpt.contentType, 'image/png', 'Signature contentType must be image/png');
  assert(sigOpt.width <= 600, 'Signature width must be <= 600px');

  // Inspect first pixel alpha channel in output
  const rawSig = await sharp(sigOpt.buffer).raw().toBuffer({ resolveWithObject: true });
  const alphaValue = rawSig.data[3];
  assert.strictEqual(alphaValue, 0, 'Near-white background pixel must have alpha = 0 (transparent)');
  console.log('✓ 4. Near-white background removal converted white pixels to transparent PNG');

  // 5. File Size Limit Rejection (> 5 MB)
  const oversizedBuffer = Buffer.alloc(MAX_IMAGE_FILE_SIZE + 1024);
  let rejected = false;
  try {
    await optimizeImage(oversizedBuffer, { entityType: 'Student' });
  } catch (err) {
    if (err.code === 'FILE_TOO_LARGE' || err.message.includes('5 MB')) {
      rejected = true;
    }
  }
  assert.strictEqual(rejected, true, 'Files over 5 MB must be rejected by optimizeImage');
  console.log('✓ 5. Oversized images (> 5 MB) rejected with FILE_TOO_LARGE');

  // 6. Cache-Control Header Rules
  assert.strictEqual(
    getCacheControlHeader('Signature', 'signatures'),
    'public, max-age=31536000, immutable',
    'Signatures must have immutable 1-year cache'
  );
  assert.strictEqual(
    getCacheControlHeader('Student', 'students'),
    'private, max-age=3600',
    'Student photos must have private 1-hour cache'
  );
  assert.strictEqual(
    getCacheControlHeader('Document', 'documents'),
    'public, max-age=86400',
    'General documents must have 1-day public cache'
  );
  console.log('✓ 6. Cache-Control headers verified according to security and privacy guidelines');

  // 7. Pure-Node Zip File Extraction
  const dummyImg1 = await createTestImage(100, 100);
  const dummyImg2 = await createTestImage(100, 100);
  const zipBuffer = createTestZip([
    { name: 'roll-101.png', buffer: dummyImg1 },
    { name: 'subfolder/roll-102.png', buffer: dummyImg2 },
  ]);

  const extracted = extractZipEntries(zipBuffer);
  assert.strictEqual(extracted.length, 2, 'Should extract 2 entries from zip buffer');
  assert.strictEqual(extracted[0].filename, 'roll-101.png');
  assert.strictEqual(extracted[1].filename, 'subfolder/roll-102.png');
  assert(extracted[0].buffer.length > 0, 'Extracted file buffer must not be empty');
  console.log('✓ 7. Pure Node standard zip extractor successfully parsed central directory and files');

  // 8. Controller Endpoints Export Validation
  assert.strictEqual(typeof getBranding, 'function', 'getBranding controller must be exported');
  assert.strictEqual(typeof updateBranding, 'function', 'updateBranding controller must be exported');
  assert.strictEqual(typeof uploadSignature, 'function', 'uploadSignature controller must be exported');
  assert.strictEqual(typeof uploadStudentPhoto, 'function', 'uploadStudentPhoto controller must be exported');
  assert.strictEqual(typeof uploadBulkStudentPhotos, 'function', 'uploadBulkStudentPhotos controller must be exported');
  console.log('✓ 8. All required branding and student photo controller handlers exported properly');

  // 9. Idempotent Cleanup Scheduler Unit Test
  const mockTenantDb = {
    storedFile: {
      findMany: async () => [],
      delete: async () => ({ id: 'mock' }),
    },
  };
  const cleanupStats = await runTenantFileCleanup(mockTenantDb, 'test-college-id');
  assert.strictEqual(cleanupStats.collegeId, 'test-college-id');
  assert.strictEqual(cleanupStats.deletedPendingOrFailed, 0);
  assert.strictEqual(cleanupStats.deletedOldPaymentProofs, 0);
  assert.strictEqual(cleanupStats.errors.length, 0);
  console.log('✓ 9. Idempotent cleanup job runs successfully without errors');

  console.log('\n======================================================');
  console.log('✅ ALL PHASE 11 TESTS PASSED SUCCESSFULLY (100%)');
  console.log('======================================================\n');
}

if (require.main === module) {
  runPhase11Tests().catch((err) => {
    console.error('❌ Phase 11 Test Failure:', err);
    process.exit(1);
  });
}

module.exports = { runPhase11Tests };
