const { getKpiSummary } = require('../services/executiveKpiService');

exports.getKpiSummary = async (req, res, next) => {
  try {
    const userRole = req.user?.role?.toLowerCase();
    if (userRole !== 'admin' && userRole !== 'principal') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Access restricted to administrators and principals only'
      });
    }

    const { periodStart, periodEnd, campusId } = req.query;
    const summary = await getKpiSummary(req.collegeId, {
      periodStart,
      periodEnd,
      campusId
    });

    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};

