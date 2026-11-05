// ─── Credit Wallet Controller (Phase 10: N20) ─────────────────────────
const creditWalletService = require('../services/creditWalletService');

/**
 * GET /api/subscription/credits/wallet
 * Returns credit balance summary, consumption metrics, and top-up notice
 */
async function getWallet(req, res) {
  try {
    const collegeId = req.user.college_id;
    const overview = await creditWalletService.getWalletOverview(collegeId);

    return res.json({
      success: true,
      ...overview
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/**
 * GET /api/subscription/credits/ledger
 * Paged audit ledger of message credit transactions
 */
async function getLedger(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { page, limit, bucket, type, startDate, endDate } = req.query;

    const result = await creditWalletService.getLedgerEntries(collegeId, {
      page,
      limit,
      bucket,
      type,
      startDate,
      endDate
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

module.exports = {
  getWallet,
  getLedger
};

