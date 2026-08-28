// ─── Visitor Controller (Multi-DB with Prisma) ───────────────────

const mapRecord = (rec) => {
  if (!rec) return null;
  return {
    ...rec,
    _id: rec.id
  };
};

exports.getVisitors = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status, date, page = 1, limit = 20 } = req.query;

    const where = { college_id: req.collegeId };
    if (status) where.status = status;
    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const d2 = new Date(d);
      d2.setDate(d2.getDate() + 1);
      where.entryTime = {
        gte: d,
        lt: d2
      };
    }

    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

    const [visitors, total] = await Promise.all([
      tenantDb.visitorLog.findMany({
        where,
        orderBy: { entryTime: 'desc' },
        skip,
        take
      }),
      tenantDb.visitorLog.count({ where })
    ]);

    res.json({
      success: true,
      data: visitors.map(mapRecord),
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createVisitor = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user.id || req.user._id;
    const { visitorName, cnic, phone, photo, purpose, hostName, hostDepartment, entryTime } = req.body;

    const visitor = await tenantDb.visitorLog.create({
      data: {
        college_id: req.collegeId,
        visitorName,
        cnic,
        phone,
        photo,
        purpose,
        hostName,
        hostDepartment,
        entryTime: entryTime ? new Date(entryTime) : new Date(),
        status: 'in',
        enteredBy: userId
      }
    });

    res.status(201).json({ success: true, data: mapRecord(visitor) });
  } catch (error) {
    next(error);
  }
};

exports.checkoutVisitor = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { id } = req.params;

    const visitor = await tenantDb.visitorLog.findFirst({
      where: { id, college_id: req.collegeId }
    });
    if (!visitor) return res.status(404).json({ success: false, message: 'Visitor not found' });

    const updated = await tenantDb.visitorLog.update({
      where: { id },
      data: {
        exitTime: new Date(),
        status: 'out'
      }
    });

    res.json({ success: true, data: mapRecord(updated) });
  } catch (error) {
    next(error);
  }
};
