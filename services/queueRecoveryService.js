const { getSystemClient } = require('../config/prismaManager');

/**
 * Server Startup Queue Recovery Service
 * Scans for any PDF Documents left in 'processing' status from an unexpected restart.
 * Resumes processing or cleanly updates their status to prevent jobs staying stuck.
 */
async function recoverStuckJobs() {
  const prisma = getSystemClient();
  try {
    const stuckDocs = await prisma.pDFDocument.findMany({
      where: { status: 'processing' }
    });

    if (stuckDocs.length === 0) return;

    console.log(`🔄 Startup Recovery: Found ${stuckDocs.length} PDF document(s) in 'processing' state.`);

    for (const doc of stuckDocs) {
      const chunkCount = await prisma.documentChunk.count({
        where: { documentId: doc.id }
      });

      if (chunkCount > 0) {
        await prisma.pDFDocument.update({
          where: { id: doc.id },
          data: {
            status: 'ready',
            chunkCount
          }
        });
        console.log(`✅ Recovered doc ${doc.id} (${doc.originalName}): set status to 'ready' (${chunkCount} chunks found).`);
      } else {
        await prisma.pDFDocument.update({
          where: { id: doc.id },
          data: {
            status: 'failed',
            errorMessage: 'Processing interrupted by server restart. Please click Retry.'
          }
        });
        console.log(`⚠️ Marked doc ${doc.id} (${doc.originalName}) as 'failed' due to server restart.`);
      }
    }
  } catch (err) {
    console.error('❌ Queue recovery service error:', err.message);
  }
}

module.exports = { recoverStuckJobs };
