/**
 * Storage Service Tests
 * ─────────────────────
 * Unit tests for the R2 storage service layer.
 * Uses mocked AWS SDK to avoid hitting real R2 endpoints.
 */
const {
  generateObjectKey,
  sanitizeFilename,
  sanitizeExtension,
  validateFile,
  validateFileSignature,
  computeChecksum,
  isR2Reference,
  parseR2Reference,
  toR2Reference,
} = require('../services/storageService');

// ═══════════════════════════════════════════════
// Object Key Generation
// ═══════════════════════════════════════════════
function testObjectKeyGeneration() {
  console.log('\n🔑 Testing object key generation...');
  let passed = 0;
  let failed = 0;

  // Test 1: Basic key format
  const key = generateObjectKey('college-uuid', 'students', 'entity-uuid', 'photo.jpg');
  console.assert(key.startsWith('tenants/college-uuid/students/entity-uuid/'), `Expected key to start with tenant path, got: ${key}`);
  console.assert(key.endsWith('.jpg'), `Expected key to end with .jpg, got: ${key}`);
  key.startsWith('tenants/college-uuid/students/') ? passed++ : failed++;

  // Test 2: Key includes random UUID (unique each call)
  const key2 = generateObjectKey('college-uuid', 'students', 'entity-uuid', 'photo.jpg');
  console.assert(key !== key2, 'Keys should be unique for each call');
  key !== key2 ? passed++ : failed++;

  // Test 3: Missing entity uses 'general'
  const key3 = generateObjectKey('college-uuid', 'documents', null, 'doc.pdf');
  console.assert(key3.includes('/general/'), `Expected 'general' for null entity, got: ${key3}`);
  key3.includes('/general/') ? passed++ : failed++;

  // Test 4: Throws without collegeId
  try {
    generateObjectKey(null, 'students', 'id', 'file.jpg');
    console.assert(false, 'Should throw without collegeId');
    failed++;
  } catch (e) {
    passed++;
  }

  // Test 5: No PII in keys
  const keyWithPII = generateObjectKey('college-uuid', 'students', 'entity', 'john_doe_resume.pdf');
  console.assert(!keyWithPII.includes('john'), 'Key should not contain filename PII');
  !keyWithPII.includes('john') ? passed++ : failed++;

  console.log(`  Object Key: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// Filename Sanitization
// ═══════════════════════════════════════════════
function testFilenameSanitization() {
  console.log('\n🧹 Testing filename sanitization...');
  let passed = 0;
  let failed = 0;

  // Test 1: Normal filename
  console.assert(sanitizeFilename('document.pdf') === 'document.pdf', 'Normal filename');
  sanitizeFilename('document.pdf') === 'document.pdf' ? passed++ : failed++;

  // Test 2: Path traversal
  console.assert(!sanitizeFilename('../../etc/passwd').includes('..'), 'Path traversal stripped');
  !sanitizeFilename('../../etc/passwd').includes('..') ? passed++ : failed++;

  // Test 3: Special characters
  const sanitized = sanitizeFilename('file<name>:with*special?chars.pdf');
  console.assert(!sanitized.includes('<'), 'Special chars stripped');
  !sanitized.includes('<') ? passed++ : failed++;

  // Test 4: Empty input
  console.assert(sanitizeFilename('') === 'unnamed', 'Empty returns unnamed');
  sanitizeFilename('') === 'unnamed' ? passed++ : failed++;

  // Test 5: Length limit
  const longName = 'a'.repeat(500) + '.pdf';
  console.assert(sanitizeFilename(longName).length <= 255, 'Long name truncated');
  sanitizeFilename(longName).length <= 255 ? passed++ : failed++;

  // Test 6: Extension sanitization
  console.assert(sanitizeExtension('file.PDF') === '.pdf', 'Extension lowercase');
  sanitizeExtension('file.PDF') === '.pdf' ? passed++ : failed++;

  console.log(`  Sanitization: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// File Validation
// ═══════════════════════════════════════════════
function testFileValidation() {
  console.log('\n✅ Testing file validation...');
  let passed = 0;
  let failed = 0;

  // Test 1: Valid image
  const r1 = validateFile({ filename: 'photo.jpg', contentType: 'image/jpeg', size: 1024 * 1024, category: 'image' });
  console.assert(r1.valid === true, 'Valid JPEG should pass');
  r1.valid ? passed++ : failed++;

  // Test 2: Invalid extension
  const r2 = validateFile({ filename: 'script.exe', contentType: 'image/jpeg', size: 1024, category: 'image' });
  console.assert(r2.valid === false, 'EXE extension should fail');
  !r2.valid ? passed++ : failed++;

  // Test 3: Invalid MIME type
  const r3 = validateFile({ filename: 'file.jpg', contentType: 'application/x-executable', size: 1024, category: 'image' });
  console.assert(r3.valid === false, 'Invalid MIME should fail');
  !r3.valid ? passed++ : failed++;

  // Test 4: Oversized file
  const r4 = validateFile({ filename: 'big.jpg', contentType: 'image/jpeg', size: 100 * 1024 * 1024, category: 'image' });
  console.assert(r4.valid === false, 'Oversized file should fail');
  !r4.valid ? passed++ : failed++;

  // Test 5: Zero-size file
  const r5 = validateFile({ filename: 'empty.pdf', contentType: 'application/pdf', size: 0, category: 'pdf' });
  console.assert(r5.valid === false, 'Empty file should fail');
  !r5.valid ? passed++ : failed++;

  // Test 6: Valid PDF
  const r6 = validateFile({ filename: 'doc.pdf', contentType: 'application/pdf', size: 5 * 1024 * 1024, category: 'pdf' });
  console.assert(r6.valid === true, 'Valid PDF should pass');
  r6.valid ? passed++ : failed++;

  // Test 7: SVG should fail (not in allowlist)
  const r7 = validateFile({ filename: 'icon.svg', contentType: 'image/svg+xml', size: 1024, category: 'image' });
  console.assert(r7.valid === false, 'SVG should fail');
  !r7.valid ? passed++ : failed++;

  console.log(`  Validation: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// File Signature Validation
// ═══════════════════════════════════════════════
function testFileSignatureValidation() {
  console.log('\n🔍 Testing file signature validation...');
  let passed = 0;
  let failed = 0;

  // Test 1: Valid JPEG signature
  const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
  const r1 = validateFileSignature(jpegBuf, 'image/jpeg');
  console.assert(r1.valid === true, 'Valid JPEG signature');
  r1.valid ? passed++ : failed++;

  // Test 2: Valid PNG signature
  const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const r2 = validateFileSignature(pngBuf, 'image/png');
  console.assert(r2.valid === true, 'Valid PNG signature');
  r2.valid ? passed++ : failed++;

  // Test 3: Valid PDF signature
  const pdfBuf = Buffer.from('%PDF-1.4');
  const r3 = validateFileSignature(pdfBuf, 'application/pdf');
  console.assert(r3.valid === true, 'Valid PDF signature');
  r3.valid ? passed++ : failed++;

  // Test 4: Mismatched signature (PNG bytes but declared as JPEG)
  const r4 = validateFileSignature(pngBuf, 'image/jpeg');
  console.assert(r4.valid === false, 'Mismatched JPEG signature should fail');
  !r4.valid ? passed++ : failed++;

  // Test 5: Random bytes for JPEG
  const randBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const r5 = validateFileSignature(randBuf, 'image/jpeg');
  console.assert(r5.valid === false, 'Random bytes should fail JPEG check');
  !r5.valid ? passed++ : failed++;

  console.log(`  Signature: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// R2 Reference Helpers
// ═══════════════════════════════════════════════
function testR2References() {
  console.log('\n🔗 Testing R2 reference helpers...');
  let passed = 0;
  let failed = 0;

  // Test 1: isR2Reference
  console.assert(isR2Reference('r2:abc-123') === true, 'r2: prefix detected');
  isR2Reference('r2:abc-123') ? passed++ : failed++;

  console.assert(isR2Reference('http://example.com') === false, 'HTTP not r2 ref');
  !isR2Reference('http://example.com') ? passed++ : failed++;

  console.assert(isR2Reference('data:image/png;base64,...') === false, 'Base64 not r2 ref');
  !isR2Reference('data:image/png;base64,...') ? passed++ : failed++;

  console.assert(isR2Reference(null) === false, 'Null not r2 ref');
  !isR2Reference(null) ? passed++ : failed++;

  // Test 2: parseR2Reference
  console.assert(parseR2Reference('r2:file-uuid-123') === 'file-uuid-123', 'Parse r2 ref');
  parseR2Reference('r2:file-uuid-123') === 'file-uuid-123' ? passed++ : failed++;

  console.assert(parseR2Reference('not-r2') === null, 'Non-r2 returns null');
  parseR2Reference('not-r2') === null ? passed++ : failed++;

  // Test 3: toR2Reference
  console.assert(toR2Reference('my-id') === 'r2:my-id', 'Create r2 ref');
  toR2Reference('my-id') === 'r2:my-id' ? passed++ : failed++;

  // Test 4: Round-trip
  const id = 'round-trip-uuid';
  console.assert(parseR2Reference(toR2Reference(id)) === id, 'Round-trip works');
  parseR2Reference(toR2Reference(id)) === id ? passed++ : failed++;

  console.log(`  References: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// Checksum
// ═══════════════════════════════════════════════
function testChecksum() {
  console.log('\n🔒 Testing checksum computation...');
  let passed = 0;
  let failed = 0;

  const buf = Buffer.from('hello world');
  const hash = computeChecksum(buf);
  console.assert(hash.length === 64, 'SHA-256 is 64 hex chars');
  hash.length === 64 ? passed++ : failed++;

  // Deterministic
  const hash2 = computeChecksum(buf);
  console.assert(hash === hash2, 'Same input → same hash');
  hash === hash2 ? passed++ : failed++;

  // Different input → different hash
  const hash3 = computeChecksum(Buffer.from('different'));
  console.assert(hash !== hash3, 'Different input → different hash');
  hash !== hash3 ? passed++ : failed++;

  console.log(`  Checksum: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

// ═══════════════════════════════════════════════
// Run All Tests
// ═══════════════════════════════════════════════
function runAll() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Academix R2 Storage Service — Unit Tests');
  console.log('═══════════════════════════════════════════════');

  const results = [
    testObjectKeyGeneration(),
    testFilenameSanitization(),
    testFileValidation(),
    testFileSignatureValidation(),
    testR2References(),
    testChecksum(),
  ];

  const totals = results.reduce((acc, r) => ({ passed: acc.passed + r.passed, failed: acc.failed + r.failed }), { passed: 0, failed: 0 });

  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Total: ${totals.passed} passed, ${totals.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  process.exit(totals.failed > 0 ? 1 : 0);
}

runAll();
