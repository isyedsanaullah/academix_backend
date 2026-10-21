// scripts/pushAllTenants.js
// Runs `prisma db push --skip-generate` against the main database and every tenant database.
// Never prints database connection strings.

require('dotenv').config();
const { spawnSync } = require('child_process');
const { getSystemClient } = require('../config/prismaManager');

const isDryRun = process.argv.includes('--dry');

function runPrismaPush(url) {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'npx.cmd' : 'npx';
  const args = ['prisma', 'db', 'push', '--accept-data-loss'];

  const result = spawnSync(cmd, args, {
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    stdio: 'pipe',
    shell: true
  });

  if (result.status !== 0) {
    // Sanitize any accidental connection strings in stdout/stderr
    const raw = result.error?.message || result.stderr || result.stdout || 'Unknown error';
    const errText = raw
      .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***@')
      .replace(/postgres:\/\/[^@]+@/gi, 'postgres://***@');
    return { success: false, error: errText.trim().split('\n')[0] };
  }
  return { success: true };
}

async function main() {
  console.log(`=== Multi-Tenant Schema Push ${isDryRun ? '(DRY RUN)' : ''} ===\n`);

  const prisma = getSystemClient();
  let colleges = [];
  try {
    colleges = await prisma.college.findMany({
      select: { id: true, name: true, mongoUrl: true }
    });
  } catch (err) {
    console.error('Failed to query colleges from main database:', err.message);
    process.exit(1);
  }

  // Compile unique target databases
  const mainDbUrl = process.env.DATABASE_URL;
  const targets = [];

  if (mainDbUrl) {
    targets.push({
      name: 'Main System Database',
      url: mainDbUrl,
      isMain: true
    });
  }

  const seenUrls = new Set([mainDbUrl]);

  for (const col of colleges) {
    const url = col.mongoUrl;
    if (!url) {
      console.log(`⚠ College "${col.name}" has no mongoUrl configured, skipping.`);
      continue;
    }
    if (seenUrls.has(url)) {
      targets.push({
        name: col.name + ' (shares existing DB)',
        url,
        skippedDuplicate: true
      });
    } else {
      seenUrls.add(url);
      targets.push({
        name: col.name,
        url,
        skippedDuplicate: false
      });
    }
  }

  console.log(`Found ${targets.length} database target(s) across ${colleges.length} college(s).\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const target of targets) {
    if (target.skippedDuplicate) {
      console.log(`→ [SKIPPED] ${target.name} (already pushed via shared database)`);
      continue;
    }

    if (isDryRun) {
      console.log(`[DRY RUN] Would push schema to: ${target.name}`);
      successCount++;
      continue;
    }

    process.stdout.write(`Pushing schema to: ${target.name}... `);
    const res = runPrismaPush(target.url);
    if (res.success) {
      console.log('✓ SUCCESS');
      successCount++;
    } else {
      console.log(`✗ ERROR: ${res.error}`);
      errorCount++;
    }
  }

  console.log(`\n=== Summary: ${successCount} successful, ${errorCount} failed ===`);
  await prisma.$disconnect();
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
