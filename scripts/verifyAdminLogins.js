require('dotenv').config();
const { getSystemClient, closeAllClients } = require('../config/prismaManager');
const { getEntitlements } = require('../middleware/loadEntitlements');

async function main() {
  const prisma = getSystemClient();

  const admins = await prisma.user.findMany({
    where: {
      role: 'admin'
    }
  });

  console.log(`Found ${admins.length} admin users.`);

  for (const admin of admins) {
    if (!admin.college_id) continue;
    const college = await prisma.college.findUnique({
      where: { id: admin.college_id },
      select: { id: true, name: true, code: true, subscription: true }
    });
    if (!college) continue;

    console.log(`\n========================================`);
    console.log(`Admin: ${admin.name} (${admin.email})`);
    console.log(`College: ${college.name} [${college.code}] (${college.id})`);
    console.log(`Subscription Plan: ${college.subscription?.plan}`);

    const ent = await getEntitlements(college.id);
    const effectiveFeatures = ent.active ? ent.effectiveFeatures : [];

    console.log(`Total Effective Features: ${effectiveFeatures.length}`);
    console.log(`Effective Features:`, effectiveFeatures);

    if (college.code === 'FMC') {
      console.log('\n--- FMC Grandfathering Check ---');
      const hasAssignments = effectiveFeatures.includes('assignments');
      const hasQuizzes = effectiveFeatures.includes('quizzes');
      const hasCertificates = effectiveFeatures.includes('certificates');
      const hasAiChat = effectiveFeatures.includes('ai-chat');
      console.log(`Has assignments: ${hasAssignments}`);
      console.log(`Has quizzes: ${hasQuizzes}`);
      console.log(`Has certificates: ${hasCertificates}`);
      console.log(`Has ai-chat (should be false): ${hasAiChat}`);

      if (!hasAssignments || !hasQuizzes || !hasCertificates) {
        throw new Error('FMC missing grandfathered features in effectiveFeatures!');
      }
      if (hasAiChat) {
        throw new Error('FMC has ai-chat which should be off!');
      }
    }

    if (college.code === 'PCS') {
      console.log('\n--- PCS Grandfathering Check ---');
      const hasAiChat = effectiveFeatures.includes('ai-chat');
      const hasAiPdfChat = effectiveFeatures.includes('ai-pdf-chat');
      const hasAiGenerators = effectiveFeatures.includes('ai-generators');
      const hasCanteen = effectiveFeatures.includes('canteen');
      console.log(`Has ai-chat: ${hasAiChat}`);
      console.log(`Has ai-pdf-chat: ${hasAiPdfChat}`);
      console.log(`Has ai-generators: ${hasAiGenerators}`);
      console.log(`Has canteen: ${hasCanteen}`);

      if (!hasAiChat || !hasAiPdfChat || !hasAiGenerators || !hasCanteen) {
        throw new Error('PCS missing expected features in effectiveFeatures!');
      }
    }
  }

  // Also check FMC specifically by college ID to ensure both are verified
  const fmc = await prisma.college.findUnique({
    where: { id: 'f6984890fa9da61d60f47393' }
  });
  console.log(`\n========================================`);
  console.log(`Direct College Check: ${fmc.name} [${fmc.code}]`);
  const fmcEnt = await getEntitlements(fmc.id);
  const fmcFeatures = fmcEnt.active ? fmcEnt.effectiveFeatures : [];
  console.log(`Total Effective Features: ${fmcFeatures.length}`);
  console.log(`Has assignments: ${fmcFeatures.includes('assignments')}`);
  console.log(`Has quizzes: ${fmcFeatures.includes('quizzes')}`);
  console.log(`Has certificates: ${fmcFeatures.includes('certificates')}`);
  console.log(`Has ai-chat (should be false): ${fmcFeatures.includes('ai-chat')}`);

  if (!fmcFeatures.includes('assignments') || !fmcFeatures.includes('quizzes') || !fmcFeatures.includes('certificates')) {
    throw new Error('FMC missing grandfathered features!');
  }
  if (fmcFeatures.includes('ai-chat')) {
    throw new Error('FMC has ai-chat!');
  }

  console.log('\nAll admin login & college entitlement checks passed successfully!');
}

main()
  .catch(err => {
    console.error('Admin login verification failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closeAllClients();
  });
