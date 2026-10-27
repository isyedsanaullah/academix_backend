'use strict';

require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { isValidSlug, isReservedSlug, normalizeSlug } = require('../utils/reservedSlugs');

/**
 * Phase 0 Database Migration & Backfill
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Additive columns for Collegeshub multi-tenancy & college public profiles:
 *    - status: 'pending_setup' | 'onboarding' | 'active' | 'suspended'
 *    - onboarding_state: jsonb
 *    - activated_at: timestamptz
 *    - tagline, about, address, city, phone, email, website
 *    - social_links: jsonb
 *    - established_year: int
 *    - affiliation: text
 *    - logo_key, cover_key: text (R2 object keys)
 *    - gallery: jsonb
 *
 * 2. Backfill existing colleges:
 *    - status = 'active'
 *    - activated_at = COALESCE(activated_at, now())
 *    - slug derived from existing slug, code, or name, checked against reserved slugs,
 *      resolving any collisions with numeric suffix.
 *    - copy legacy settings (tagline, about, socialLinks, establishedYear) into dedicated columns.
 *
 * 3. Enforce case-insensitive unique index on lower(slug) and non-null constraint.
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function runPhase0Migration() {
  const prisma = getSystemClient();
  console.log('🚀 [Phase 0 Migration] Starting additive migration & backfill...');

  // 1. Add columns to "College" table additively
  // Notice: In postgres with Prisma default mapping, model College maps to "College" or "colleges".
  // Let's detect the actual table name in PostgreSQL.
  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND lower(table_name) IN ('college', 'colleges');
  `;

  if (!tables || tables.length === 0) {
    throw new Error('College table not found in public schema!');
  }

  const tableName = tables[0].table_name;
  console.log(`📌 Found colleges table: "${tableName}"`);

  // Add columns if they do not exist
  const addColumnsSql = `
    ALTER TABLE "${tableName}" 
      ADD COLUMN IF NOT EXISTS "slug" text,
      ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pending_setup',
      ADD COLUMN IF NOT EXISTS "onboarding_state" jsonb DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS "activated_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "tagline" text,
      ADD COLUMN IF NOT EXISTS "about" text,
      ADD COLUMN IF NOT EXISTS "social_links" jsonb,
      ADD COLUMN IF NOT EXISTS "established_year" integer,
      ADD COLUMN IF NOT EXISTS "affiliation" text,
      ADD COLUMN IF NOT EXISTS "logo_key" text,
      ADD COLUMN IF NOT EXISTS "cover_key" text,
      ADD COLUMN IF NOT EXISTS "gallery" jsonb DEFAULT '[]'::jsonb;
  `;
  await prisma.$executeRawUnsafe(addColumnsSql);
  console.log('✅ Additive columns verified/added.');

  // 2. Fetch all colleges to perform backfill
  const colleges = await prisma.$queryRawUnsafe(`
    SELECT id, name, code, slug, status, settings, activated_at
    FROM "${tableName}"
  `);

  console.log(`🔍 Processing ${colleges.length} colleges for backfill...`);

  const assignedSlugs = new Set();

  for (const college of colleges) {
    let candidateSlug = college.slug ? normalizeSlug(college.slug) : '';

    if (!candidateSlug && college.code) {
      candidateSlug = normalizeSlug(college.code);
    }
    if (!candidateSlug && college.name) {
      candidateSlug = normalizeSlug(college.name);
    }
    if (!candidateSlug) {
      candidateSlug = `college-${college.id.slice(0, 6)}`;
    }

    // Ensure valid format and handle reserved slugs
    if (!isValidSlug(candidateSlug) || isReservedSlug(candidateSlug) || candidateSlug.length < 3) {
      candidateSlug = `edu-${candidateSlug}`;
    }

    // Resolve collision
    let finalSlug = candidateSlug;
    let suffix = 1;
    while (assignedSlugs.has(finalSlug)) {
      finalSlug = `${candidateSlug.slice(0, 26)}-${suffix}`;
      suffix++;
    }
    assignedSlugs.add(finalSlug);

    // Extract settings if available
    const settings = typeof college.settings === 'object' && college.settings ? college.settings : {};
    const tagline = settings.tagline || null;
    const about = settings.about || null;
    const socialLinks = settings.socialLinks ? JSON.stringify(settings.socialLinks) : null;
    const establishedYear = settings.establishedYear ? parseInt(settings.establishedYear, 10) : null;

    await prisma.$executeRawUnsafe(`
      UPDATE "${tableName}"
      SET 
        "slug" = $1,
        "status" = 'active',
        "activated_at" = COALESCE("activated_at", NOW()),
        "tagline" = COALESCE("tagline", $2),
        "about" = COALESCE("about", $3),
        "social_links" = COALESCE("social_links", $4::jsonb),
        "established_year" = COALESCE("established_year", $5)
      WHERE id = $6
    `, finalSlug, tagline, about, socialLinks, establishedYear, college.id);

    console.log(`  ✓ College [${college.code || college.id}] -> slug: "${finalSlug}", status: "active"`);
  }

  // 3. Ensure slug is NOT NULL and indexed case-insensitively
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "${tableName}" ALTER COLUMN "slug" SET NOT NULL;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS colleges_lower_slug_idx 
    ON "${tableName}" (LOWER("slug"));
  `);

  // Add status check constraint safely
  const constraintCheck = await prisma.$queryRaw`
    SELECT conname 
    FROM pg_constraint 
    WHERE conname = 'colleges_status_check';
  `;

  if (constraintCheck.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "${tableName}" 
      ADD CONSTRAINT colleges_status_check 
      CHECK ("status" IN ('pending_setup', 'onboarding', 'active', 'suspended'));
    `);
    console.log('✅ Added colleges_status_check constraint.');
  }

  console.log('🎉 [Phase 0 Migration] Backfill and schema groundwork completed successfully!');
}

async function rollbackPhase0Migration() {
  const prisma = getSystemClient();
  console.log('⚠️ [Phase 0 Rollback] Rolling back schema changes...');

  const tables = await prisma.$queryRaw`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND lower(table_name) IN ('college', 'colleges');
  `;
  if (!tables || tables.length === 0) return;
  const tableName = tables[0].table_name;

  await prisma.$executeRawUnsafe(`
    DROP INDEX IF EXISTS colleges_lower_slug_idx;
    ALTER TABLE "${tableName}" DROP CONSTRAINT IF EXISTS colleges_status_check;
    ALTER TABLE "${tableName}"
      DROP COLUMN IF EXISTS "status",
      DROP COLUMN IF EXISTS "onboarding_state",
      DROP COLUMN IF EXISTS "activated_at",
      DROP COLUMN IF EXISTS "tagline",
      DROP COLUMN IF EXISTS "about",
      DROP COLUMN IF EXISTS "social_links",
      DROP COLUMN IF EXISTS "established_year",
      DROP COLUMN IF EXISTS "affiliation",
      DROP COLUMN IF EXISTS "logo_key",
      DROP COLUMN IF EXISTS "cover_key",
      DROP COLUMN IF EXISTS "gallery";
  `);

  console.log('✅ Rollback complete.');
}

if (require.main === module) {
  const isDown = process.argv.includes('--down');
  const action = isDown ? rollbackPhase0Migration() : runPhase0Migration();

  action
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      await closeAllClients();
    });
}

module.exports = {
  runPhase0Migration,
  rollbackPhase0Migration
};
