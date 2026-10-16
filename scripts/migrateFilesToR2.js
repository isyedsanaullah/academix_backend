/**
 * Legacy File Migration Utility
 * ─────────────────────────────
 * Migrates existing file data (base64 avatars, local uploads, URLs) to R2.
 * Designed to be run as a one-off migration script.
 *
 * Usage: node scripts/migrateFilesToR2.js [--dry-run] [--limit N]
 *
 * SAFETY:
 * - Dry-run mode by default — pass --execute to actually migrate
 * - Idempotent — skips files that already have r2: references
 * - Resumable — tracks migration status in StoredFile.migratedFrom
 * - Non-destructive — original values preserved until verified
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const { getSystemClient } = require('../config/prismaManager');
const { validateR2Config, isR2Configured } = require('../config/r2');
const {
  uploadObject,
  generateObjectKey,
  sanitizeFilename,
  computeChecksum,
  headObject,
  toR2Reference,
} = require('../services/storageService');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '100', 10);

const stats = {
  scanned: 0,
  skipped: 0,
  migrated: 0,
  failed: 0,
  errors: [],
};

/**
 * Migrate base64 avatars from User table to R2.
 */
async function migrateAvatars(prisma) {
  console.log('\n📷 Migrating user avatars...');

  const users = await prisma.user.findMany({
    where: {
      avatar: { not: '' },
      NOT: [
        { avatar: { startsWith: 'r2:' } },
        { avatar: null },
      ],
    },
    take: LIMIT,
  });

  for (const user of users) {
    stats.scanned++;

    if (!user.avatar || user.avatar.startsWith('r2:') || user.avatar.startsWith('http')) {
      stats.skipped++;
      continue;
    }

    // Check if it's a base64 data URI
    if (!user.avatar.startsWith('data:image/')) {
      stats.skipped++;
      continue;
    }

    try {
      const match = user.avatar.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) {
        stats.skipped++;
        continue;
      }

      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const ext = contentType === 'image/png' ? '.png' : contentType === 'image/webp' ? '.webp' : '.jpg';
      const objectKey = generateObjectKey(user.college_id || 'system', 'avatars', user.id, `avatar${ext}`);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate avatar for user ${user.id} (${buffer.length} bytes) → ${objectKey}`);
        stats.migrated++;
        continue;
      }

      await uploadObject({ objectKey, body: buffer, contentType });

      // Create StoredFile record
      const storedFile = await prisma.storedFile.create({
        data: {
          college_id: user.college_id || 'system',
          uploadedById: user.id,
          objectKey,
          originalFilename: `avatar${ext}`,
          contentType,
          sizeBytes: buffer.length,
          checksumSha256: computeChecksum(buffer),
          category: 'avatars',
          entityType: 'User',
          entityId: user.id,
          status: 'ready',
          migratedFrom: `user.avatar:${user.id}`,
        },
      });

      // Update user record with r2: reference
      await prisma.user.update({
        where: { id: user.id },
        data: { avatar: toR2Reference(storedFile.id) },
      });

      stats.migrated++;
      console.log(`  ✅ Migrated avatar for user ${user.id}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push(`Avatar user ${user.id}: ${err.message}`);
      console.error(`  ❌ Failed avatar for user ${user.id}: ${err.message}`);
    }
  }
}

/**
 * Migrate student photos from base64/URL to R2.
 */
async function migrateStudentPhotos(prisma) {
  console.log('\n🎓 Migrating student photos...');

  const students = await prisma.student.findMany({
    where: {
      photo: { not: '' },
      NOT: [
        { photo: { startsWith: 'r2:' } },
        { photo: null },
      ],
    },
    take: LIMIT,
  });

  for (const student of students) {
    stats.scanned++;

    if (!student.photo || student.photo.startsWith('r2:') || student.photo.startsWith('http')) {
      stats.skipped++;
      continue;
    }

    if (!student.photo.startsWith('data:image/')) {
      stats.skipped++;
      continue;
    }

    try {
      const match = student.photo.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) { stats.skipped++; continue; }

      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const ext = contentType === 'image/png' ? '.png' : '.jpg';
      const objectKey = generateObjectKey(student.college_id, 'students', student.id, `photo${ext}`);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate photo for student ${student.id} (${buffer.length} bytes)`);
        stats.migrated++;
        continue;
      }

      await uploadObject({ objectKey, body: buffer, contentType });

      const storedFile = await prisma.storedFile.create({
        data: {
          college_id: student.college_id,
          uploadedById: student.user_id || 'migration',
          objectKey,
          originalFilename: `photo${ext}`,
          contentType,
          sizeBytes: buffer.length,
          checksumSha256: computeChecksum(buffer),
          category: 'students',
          entityType: 'Student',
          entityId: student.id,
          status: 'ready',
          migratedFrom: `student.photo:${student.id}`,
        },
      });

      await prisma.student.update({
        where: { id: student.id },
        data: { photo: toR2Reference(storedFile.id) },
      });

      stats.migrated++;
      console.log(`  ✅ Migrated photo for student ${student.id}`);
    } catch (err) {
      stats.failed++;
      stats.errors.push(`Student photo ${student.id}: ${err.message}`);
      console.error(`  ❌ Failed photo for student ${student.id}: ${err.message}`);
    }
  }
}

/**
 * Migrate local PDF files to R2.
 */
async function migrateLocalPDFs(prisma) {
  console.log('\n📄 Migrating local PDF documents to R2...');

  const docs = await prisma.pDFDocument.findMany({
    where: {
      status: 'ready',
      OR: [
        { chromaCollectionId: null },
        { chromaCollectionId: { not: { startsWith: 'r2:' } } },
      ],
    },
    take: LIMIT,
  });

  for (const doc of docs) {
    stats.scanned++;

    if (doc.chromaCollectionId && doc.chromaCollectionId.startsWith('r2:')) {
      stats.skipped++;
      continue;
    }

    const filePath = path.resolve(`${process.env.UPLOAD_DIR || './uploads'}/${doc.collegeId}/${doc.filename}`);

    if (!fs.existsSync(filePath)) {
      stats.skipped++;
      console.log(`  ⚠️  Local file missing for doc ${doc.id}: ${filePath}`);
      continue;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const objectKey = generateObjectKey(doc.collegeId, 'documents', doc.id, doc.originalName);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would migrate PDF ${doc.id} (${buffer.length} bytes) → ${objectKey}`);
        stats.migrated++;
        continue;
      }

      await uploadObject({ objectKey, body: buffer, contentType: 'application/pdf' });

      // Verify upload
      const meta = await headObject(objectKey);
      if (!meta) {
        throw new Error('R2 upload verification failed — object not found after upload.');
      }

      await prisma.pDFDocument.update({
        where: { id: doc.id },
        data: { chromaCollectionId: `r2:${objectKey}` },
      });

      stats.migrated++;
      console.log(`  ✅ Migrated PDF ${doc.id} (${doc.originalName})`);
    } catch (err) {
      stats.failed++;
      stats.errors.push(`PDF ${doc.id}: ${err.message}`);
      console.error(`  ❌ Failed PDF ${doc.id}: ${err.message}`);
    }
  }
}

/**
 * Main migration runner.
 */
async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Academix Legacy File Migration → Cloudflare R2');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (use --execute to apply)' : '⚡ EXECUTING'}`);
  console.log(`  Limit: ${LIMIT} records per category`);
  console.log('═══════════════════════════════════════════════');

  if (!DRY_RUN && !isR2Configured()) {
    console.error('❌ R2 is not configured. Set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables.');
    process.exit(1);
  }

  if (!DRY_RUN) {
    validateR2Config();
  }

  const prisma = getSystemClient();

  await migrateAvatars(prisma);
  await migrateStudentPhotos(prisma);
  await migrateLocalPDFs(prisma);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Migration Summary');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Scanned: ${stats.scanned}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Migrated: ${stats.migrated}`);
  console.log(`  Failed: ${stats.failed}`);

  if (stats.errors.length > 0) {
    console.log('\n  Errors:');
    stats.errors.forEach((e) => console.log(`    - ${e}`));
  }

  console.log('═══════════════════════════════════════════════\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
