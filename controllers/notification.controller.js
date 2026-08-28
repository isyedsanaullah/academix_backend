const mapNotification = (n) => {
  if (!n) return null;
  return {
    ...n,
    _id: n.id
  };
};

exports.getMyNotifications = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const recipientId = req.user.id || req.user._id;
    const { isRead, limit = 50 } = req.query;

    const where = {
      recipient: recipientId
    };
    if (req.collegeId) {
      where.college_id = req.collegeId;
    }
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }

    const notifications = await tenantDb.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit) || 50
    });

    const unreadCount = await tenantDb.notification.count({
      where: {
        ...where,
        isRead: false
      }
    });

    res.json({
      success: true,
      data: notifications.map(mapNotification),
      unreadCount
    });
  } catch (error) {
    next(error);
  }
};

exports.markAsRead = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const recipientId = req.user.id || req.user._id;
    const { id } = req.params;

    // Check if the notification exists and belongs to the recipient
    const existing = await tenantDb.notification.findFirst({
      where: {
        id,
        recipient: recipientId
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    const updated = await tenantDb.notification.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });

    res.json({ success: true, data: mapNotification(updated) });
  } catch (error) {
    next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const recipientId = req.user.id || req.user._id;

    await tenantDb.notification.updateMany({
      where: {
        recipient: recipientId,
        isRead: false
      },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    next(error);
  }
};

exports.createNotification = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { recipient, title, message, type, link } = req.body;

    const n = await tenantDb.notification.create({
      data: {
        college_id: req.collegeId,
        recipient,
        title,
        message,
        type,
        link,
        isRead: false
      }
    });

    res.status(201).json({ success: true, data: mapNotification(n) });
  } catch (error) {
    next(error);
  }
};

exports.deleteNotification = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const recipientId = req.user.id || req.user._id;
    const { id } = req.params;

    const existing = await tenantDb.notification.findFirst({
      where: {
        id,
        recipient: recipientId
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }

    await tenantDb.notification.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    next(error);
  }
};
