'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { isThreePlanMode } = require('../config/featureFlags');

function testFeatureFlagDefaults() {
  const prev = process.env.THREE_PLAN_MODE;
  try {
    delete process.env.THREE_PLAN_MODE;
    assert.strictEqual(isThreePlanMode(), false, 'THREE_PLAN_MODE unset must default to false');

    process.env.THREE_PLAN_MODE = '';
    assert.strictEqual(isThreePlanMode(), false, 'THREE_PLAN_MODE empty must be false');

    process.env.THREE_PLAN_MODE = 'false';
    assert.strictEqual(isThreePlanMode(), false, 'THREE_PLAN_MODE=false must be false');

    process.env.THREE_PLAN_MODE = 'TRUE';
    assert.strictEqual(isThreePlanMode(), true, 'THREE_PLAN_MODE=TRUE must be true');

    process.env.THREE_PLAN_MODE = 'true';
    assert.strictEqual(isThreePlanMode(), true, 'THREE_PLAN_MODE=true must be true');
  } finally {
    if (prev === undefined) delete process.env.THREE_PLAN_MODE;
    else process.env.THREE_PLAN_MODE = prev;
  }
}

function testSchemaAdditiveFieldsAndDefaults() {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const modelBlock = (name) => {
    const start = schema.indexOf(`model ${name} {`);
    assert(start !== -1, `model ${name} not found in schema.prisma`);
    const end = schema.indexOf('\n}', start);
    return schema.slice(start, end);
  };

  const college = modelBlock('College');
  assert(/isCustomQuote\s+Boolean\s+@default\(false\)/.test(college), 'College.isCustomQuote default false missing');
  assert(/customQuoteNotes\s+String\?/.test(college), 'College.customQuoteNotes nullable missing');
  assert(/grandfatheredUntil\s+DateTime\?/.test(college), 'College.grandfatheredUntil nullable missing');
  assert(/grandfatherReason\s+String\?/.test(college), 'College.grandfatherReason nullable missing');

  const addon = modelBlock('CollegeAddon');
  assert(/status\s+String\s+@default\("ACTIVE"\)/.test(addon), 'CollegeAddon.status default ACTIVE missing');

  const agent = modelBlock('PendingAgentAction');
  assert(/requestedById\s+String\?/.test(agent), 'PendingAgentAction.requestedById nullable missing');
  assert(/requestedByRole\s+String\?/.test(agent), 'PendingAgentAction.requestedByRole nullable missing');
  assert(/affectedRecordsCount\s+Int\s+@default\(1\)/.test(agent), 'PendingAgentAction.affectedRecordsCount default 1 missing');
  assert(/diffPreviewJson\s+Json\?/.test(agent), 'PendingAgentAction.diffPreviewJson nullable missing');

  const usage = modelBlock('CollegeUsage');
  assert(/metric\s+String\b/.test(usage), 'CollegeUsage.metric expected to remain free String');

  // Verify generated migration SQL contains only additive ADD COLUMN statements
  const migrationPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20261118000000_three_plan_stage0_additive',
    'migration.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const sqlStatementsOnly = sql.replace(/--.*$/gm, '');
  assert(!/\b(DROP|RENAME|ALTER\s+COLUMN|ALTER\s+TYPE|SET\s+DATA\s+TYPE)\b/i.test(sqlStatementsOnly), 'Migration SQL must not contain drops, renames, or type changes');
  assert(/ADD COLUMN IF NOT EXISTS "isCustomQuote"/i.test(sql), 'Migration SQL must add College.isCustomQuote');
  assert(/ADD COLUMN IF NOT EXISTS "status"/i.test(sql), 'Migration SQL must add CollegeAddon.status');
  assert(/ADD COLUMN IF NOT EXISTS "affectedRecordsCount"/i.test(sql), 'Migration SQL must add PendingAgentAction.affectedRecordsCount');
}

testFeatureFlagDefaults();
testSchemaAdditiveFieldsAndDefaults();
console.log('✓ Stage 0 (T0.1) feature flag & additive schema tests passed');
