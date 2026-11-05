const { getSystemClient } = require('../config/prismaManager');
const { runShortageScannerForCollege } = require('../workers/attendanceShortageScannerWorker');

exports.getShortages = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { termKey, status } = req.query;

    const where = { college_id: req.collegeId };
    if (termKey) where.termKey = termKey;
    if (status) where.status = status;

    const notices = await prisma.attendanceShortageNotice.findMany({
      where,
      orderBy: { attendancePercent: 'asc' }
    });

    res.json({ success: true, data: notices });
  } catch (error) {
    next(error);
  }
};

exports.acknowledgeNotice = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { id } = req.params;

    const notice = await prisma.attendanceShortageNotice.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!notice) return res.status(404).json({ success: false, message: 'Notice not found' });

    const updated = await prisma.attendanceShortageNotice.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED' }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

exports.triggerScan = async (req, res, next) => {
  try {
    const { runKey, thresholdOverride } = req.body;
    const result = await runShortageScannerForCollege(req.collegeId, {
      runKey: runKey || `MANUAL_${Date.now()}`,
      thresholdOverride
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

