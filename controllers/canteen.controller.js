// ─── Canteen Controller (Multi-DB with Prisma) ───────────────────

exports.getTransactions = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, page = 1, limit = 20 } = req.query;
    
    const where = { college_id: req.collegeId };
    if (student_id) where.student_id = student_id;
    
    const take = parseInt(limit) || 20;
    const skip = (parseInt(page) - 1) * take;

    const [total, transactions] = await Promise.all([
      tenantDb.canteenTransaction.count({ where }),
      tenantDb.canteenTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take
      })
    ]);

    const formatted = transactions.map(t => ({
      ...t,
      _id: t.id
    }));

    res.json({
      success: true,
      data: formatted,
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

exports.createTransaction = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { student_id, items, totalAmount, paymentMethod } = req.body;
    const amt = parseFloat(totalAmount) || 0;

    const transaction = await tenantDb.canteenTransaction.create({
      data: {
        college_id: req.collegeId,
        student_id,
        items: items || null,
        totalAmount: amt,
        paymentMethod,
        enteredBy: req.user._id
      }
    });

    if (paymentMethod === 'account') {
      await tenantDb.student.update({
        where: { id: student_id },
        data: {
          canteenBalance: { increment: amt }
        }
      });
    }

    res.status(201).json({
      success: true,
      data: {
        ...transaction,
        _id: transaction.id
      }
    });
  } catch (error) {
    next(error);
  }
};

