require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { resolveCollegeFeatures } = require('../config/featureRegistry');
const { resolveCollege, legacyEffectiveKeys } = require('../services/collegeAdapter');

async function main() {
  const prisma = getSystemClient();
  const colleges = await prisma.college.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
      subscription: true,
      settings: true
    },
    orderBy: { name: 'asc' }
  });

  console.log(`\n================================================================================`);
  console.log(`ENTITLEMENT COMPARISON REPORT (${colleges.length} colleges found)`);
  console.log(`Comparing OLD (resolveCollegeFeatures) vs NEW (resolveCollege + legacyEffectiveKeys)`);
  console.log(`================================================================================\n`);

  for (const college of colleges) {
    const sub = (typeof college.subscription === 'object' && college.subscription !== null)
      ? college.subscription
      : {};

    const groups = await prisma.group.findMany({
      where: { college_id: college.id, isActive: true },
      select: { name: true },
      distinct: ['name']
    });

    // 1. OLD effective keys
    const oldResult = resolveCollegeFeatures(sub.plan || 'basic', sub.featureOverrides || {});
    const oldKeys = (oldResult.effectiveKeys || []).sort();

    // 2. NEW legacy effective keys
    const resolved = resolveCollege(college, { groupNames: groups.map(g => g.name) });
    const newKeys = legacyEffectiveKeys(resolved).sort();

    const oldSet = new Set(oldKeys);
    const newSet = new Set(newKeys);

    const lostInNew = oldKeys.filter(k => !newSet.has(k));
    const gainedInNew = newKeys.filter(k => !oldSet.has(k));

    console.log(`College: ${college.name} (${college.code}) [ID: ${college.id}]`);
    console.log(`  Plan: ${sub.plan || 'basic'} | Active: ${college.isActive} | Groups found: ${groups.length}`);
    console.log(`  Total OLD keys: ${oldKeys.length} | Total NEW legacy keys: ${newKeys.length}`);

    if (lostInNew.length === 0 && gainedInNew.length === 0) {
      console.log(`  ✅ EXACT MATCH: No differences found.`);
    } else {
      console.log(`  ⚠️  DIFFERENCES FOUND:`);
      if (lostInNew.length > 0) {
        console.log(`     - LOST in NEW (${lostInNew.length}): ${lostInNew.join(', ')}`);
      }
      if (gainedInNew.length > 0) {
        console.log(`     + GAINED in NEW (${gainedInNew.length}): ${gainedInNew.join(', ')}`);
      }
    }
    console.log('--------------------------------------------------------------------------------');
  }
}

main()
  .catch(err => {
    console.error('Error running compareEntitlements:', err);
  })
  .finally(async () => {
    await closeAllClients();
  });
