// ─── Universal Timetable Controller (Multi-DB with Prisma) ───────────────────

exports.getUniversalTimetables = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const timetables = await tenantDb.universalTimetable.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: timetables.map(t => ({ ...t, _id: t.id })) });
  } catch (error) { next(error); }
};

exports.getUniversalTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const tt = await tenantDb.universalTimetable.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!tt) return res.status(404).json({ success: false, message: 'Universal timetable not found' });
    res.json({ success: true, data: { ...tt, _id: tt.id } });
  } catch (error) { next(error); }
};

exports.createUniversalTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { name, fromDate, toDate, slots } = req.body;
    if (!name || !fromDate || !toDate || !slots) {
      return res.status(400).json({ success: false, message: 'name, fromDate, toDate, and slots are required' });
    }
    const tt = await tenantDb.universalTimetable.create({
      data: {
        college_id: req.collegeId,
        name,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
        slots: slots || [],
        isActive: true
      }
    });
    res.status(201).json({ success: true, data: { ...tt, _id: tt.id } });
  } catch (error) { next(error); }
};

exports.updateUniversalTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.universalTimetable.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Universal timetable not found' });

    const data = { ...req.body };
    if (data.fromDate) data.fromDate = new Date(data.fromDate);
    if (data.toDate) data.toDate = new Date(data.toDate);

    const tt = await tenantDb.universalTimetable.update({
      where: { id: req.params.id },
      data
    });
    res.json({ success: true, data: { ...tt, _id: tt.id } });
  } catch (error) { next(error); }
};

exports.deleteUniversalTimetable = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.universalTimetable.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Universal timetable not found' });

    await tenantDb.universalTimetable.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Universal timetable deleted' });
  } catch (error) { next(error); }
};
