require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { clearEntitlementCache, getEntitlements } = require('../middleware/loadEntitlements');

async function main() {
  const prisma = getSystemClient();
  const fmcId = 'f6984890fa9da61d60f47393';
  const pcsId = '78ed39ebf264680322795908';

  // 1. Fetch current colleges
  const fmc = await prisma.college.findUnique({ where: { id: fmcId } });
  const pcs = await prisma.college.findUnique({ where: { id: pcsId } });

  if (!fmc || !pcs) {
    throw new Error('Could not find FMC or PCS');
  }

  // 2. Compute overrides
  const in90Days = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  const fmcSub = {
    ...fmc.subscription,
    plan: 'starter',
    featureOverrides: {
      ...(fmc.subscription?.featureOverrides || {}),
      'assignments-quizzes': true,
      'certificates': true
    }
  };

  const pcsSub = {
    ...pcs.subscription,
    featureOverrides: {
      ...(pcs.subscription?.featureOverrides || {}),
      'ai-chat': { state: 'on', expiresAt: in90Days, reason: 'AI grandfathered until Enterprise decision' },
      'ai-pdf-chat': { state: 'on', expiresAt: in90Days, reason: 'AI grandfathered until Enterprise decision' },
      'ai-generators': { state: 'on', expiresAt: in90Days, reason: 'AI grandfathered until Enterprise decision' }
    }
  };

  // 3. Update FMC in DB
  await prisma.college.update({
    where: { id: fmcId },
    data: { subscription: fmcSub }
  });
  console.log('Updated FMC subscription successfully with permanent grandfather overrides.');

  // 4. Update PCS in DB
  await prisma.college.update({
    where: { id: pcsId },
    data: { subscription: pcsSub }
  });
  console.log('Updated PCS subscription successfully with 90-day AI grandfather overrides.');

  // 5. Clear entitlement cache
  clearEntitlementCache(fmcId);
  clearEntitlementCache(pcsId);
  console.log('Cleared entitlement cache for both FMC and PCS.');

  // 6. Verify resolved entitlements
  const fmcEntitlements = await getEntitlements(fmcId);
  const pcsEntitlements = await getEntitlements(pcsId);

  console.log('\n--- FMC Entitlements Verification ---');
  console.log('Plan:', fmcEntitlements.plan);
  console.log('Grandfathered features:');
  console.log('- assignments-quizzes:', fmcEntitlements.features['assignments-quizzes']);
  console.log('- certificates:', fmcEntitlements.features['certificates']);
  console.log('- assignments:', fmcEntitlements.features['assignments']);
  console.log('- quizzes:', fmcEntitlements.features['quizzes']);
  console.log('- ai-chat (should be off):', fmcEntitlements.features['ai-chat']);

  console.log('\n--- PCS Entitlements Verification ---');
  console.log('Plan:', pcsEntitlements.plan);
  console.log('Grandfathered AI features:');
  console.log('- ai-chat:', pcsEntitlements.features['ai-chat']);
  console.log('- ai-pdf-chat:', pcsEntitlements.features['ai-pdf-chat']);
  console.log('- ai-generators:', pcsEntitlements.features['ai-generators']);
  console.log('- canteen (should be on for premium):', pcsEntitlements.features['canteen']);

  // Assertions
  if (!fmcEntitlements.features['assignments-quizzes']?.on) {
    throw new Error('FMC assignments-quizzes not ON');
  }
  if (!fmcEntitlements.features['certificates']?.on) {
    throw new Error('FMC certificates not ON');
  }
  if (fmcEntitlements.features['ai-chat']?.on) {
    throw new Error('FMC ai-chat should be OFF');
  }

  if (!pcsEntitlements.features['ai-chat']?.on) {
    throw new Error('PCS ai-chat not ON');
  }
  if (!pcsEntitlements.features['ai-pdf-chat']?.on) {
    throw new Error('PCS ai-pdf-chat not ON');
  }
  if (!pcsEntitlements.features['ai-generators']?.on) {
    throw new Error('PCS ai-generators not ON');
  }
  if (!pcsEntitlements.features['canteen']?.on) {
    throw new Error('PCS canteen not ON');
  }

  console.log('\nAll grandfathering assertions passed successfully!');
}

main()
  .catch(err => {
    console.error('Grandfathering application failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeAllClients();
  });
