// ─── Approval Controller (Multi-DB with Prisma) ───────────────────
const { getSystemClient } = require('../config/prismaManager');

exports.getPendingApprovals = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { status = 'pending', type } = req.query;
    const where = { college_id: req.collegeId, status };
    if (type) where.type = type;

    const approvals = await tenantDb.approval.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    const statsGroup = await tenantDb.approval.groupBy({
      by: ['type'],
      where: { college_id: req.collegeId, status: 'pending' },
      _count: {
        type: true
      }
    });

    const stats = {};
    statsGroup.forEach(s => {
      stats[s.type] = s._count.type;
    });

    const formatted = approvals.map(a => ({
      ...a,
      _id: a.id
    }));

    res.json({ success: true, data: formatted, stats });
  } catch (error) { next(error); }
};

exports.approveRequest = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const systemDb = getSystemClient();
    const userId = req.user?.id || req.user?._id;

    const approval = await tenantDb.approval.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!approval) return res.status(404).json({ success: false, message: 'Not found' });
    if (approval.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed' });

    // Parse JSON fields
    let dataPayload = approval.data || {};
    if (typeof dataPayload === 'string') {
      try { dataPayload = JSON.parse(dataPayload); } catch (e) {}
    }

    if (approval.type === 'principal_delete') {
      let approvers = approval.approvers || [];
      if (typeof approvers === 'string') {
        try { approvers = JSON.parse(approvers); } catch (e) {}
      }
      if (!Array.isArray(approvers)) {
        approvers = [];
      }

      const approver = approvers.find(a => a.user_id?.toString() === userId?.toString());
      if (!approver) return res.status(403).json({ success: false, message: 'You are not an approver' });
      
      approver.status = 'approved';
      approver.decidedAt = new Date();

      const approvedCount = approvers.filter(a => a.status === 'approved').length;
      let finalStatus = approval.status;
      let approvedAt = approval.approvedAt;

      if (approvedCount >= (approval.requiredApprovals || 1)) {
        finalStatus = 'approved';
        approvedAt = new Date();
        
        if (dataPayload.principalId) {
          await systemDb.user.update({
            where: { id: dataPayload.principalId },
            data: { isActive: false }
          });
        }
      }

      const updated = await tenantDb.approval.update({
        where: { id: approval.id },
        data: {
          status: finalStatus,
          approvedAt,
          approvers: approvers
        }
      });

      return res.json({
        success: true,
        message: `Approved (${approvedCount}/${approval.requiredApprovals})`,
        data: { ...updated, _id: updated.id }
      });
    }

    const updated = await tenantDb.approval.update({
      where: { id: approval.id },
      data: {
        status: 'approved',
        approvedBy: userId,
        approvedAt: new Date()
      }
    });

    await executeApproval(updated, req);

    res.json({ success: true, message: 'Approved and executed', data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

exports.rejectRequest = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const userId = req.user?.id || req.user?._id;

    const approval = await tenantDb.approval.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!approval) return res.status(404).json({ success: false, message: 'Not found' });

    if (approval.type === 'principal_delete') {
      let approvers = approval.approvers || [];
      if (typeof approvers === 'string') {
        try { approvers = JSON.parse(approvers); } catch (e) {}
      }
      if (!Array.isArray(approvers)) {
        approvers = [];
      }

      const approver = approvers.find(a => a.user_id?.toString() === userId?.toString());
      if (!approver) return res.status(403).json({ success: false, message: 'Not an approver' });

      approver.status = 'rejected';
      approver.decidedAt = new Date();

      const updated = await tenantDb.approval.update({
        where: { id: approval.id },
        data: {
          status: 'rejected',
          rejectionReason: req.body.reason || 'Rejected',
          approvers: approvers
        }
      });

      return res.json({ success: true, data: { ...updated, _id: updated.id } });
    }

    const rejectionReason = req.body.reason || 'Rejected by principal';
    const updated = await tenantDb.approval.update({
      where: { id: approval.id },
      data: {
        status: 'rejected',
        approvedBy: userId,
        approvedAt: new Date(),
        rejectionReason
      }
    });

    if (approval.type === 'student_admission' && approval.relatedId) {
      await tenantDb.application.update({
        where: { id: approval.relatedId },
        data: {
          status: 'rejected',
          rejectionReason
        }
      });
    }

    res.json({ success: true, message: 'Rejected', data: { ...updated, _id: updated.id } });
  } catch (error) { next(error); }
};

async function executeApproval(approval, req) {
  const tenantDb = req.tenantClient;
  const systemDb = getSystemClient();

  let d = approval.data || {};
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch (e) {}
  }

  switch (approval.type) {
    case 'student_admission': {
      if (!approval.relatedId) break;
      const app = await tenantDb.application.findFirst({
        where: { id: approval.relatedId }
      });
      if (!app) break;

      const session = await tenantDb.session.findFirst({
        where: { college_id: approval.college_id, isCurrent: true }
      });

      if (app.user_id) {
        await systemDb.user.update({
          where: { id: app.user_id },
          data: { isActive: true }
        });
      }

      const count = await tenantDb.student.count({
        where: { college_id: approval.college_id }
      });

      await tenantDb.student.create({
        data: {
          college_id: approval.college_id,
          session_id: session?.id || '',
          user_id: app.user_id,
          name: app.name,
          fatherName: app.fatherName,
          rollNumber: `${approval.college_id.slice(-4).toUpperCase()}-${String(count + 1).padStart(4, '0')}`,
          registrationNumber: app.applicationNumber,
          gender: app.gender,
          phone: app.phone,
          email: app.email,
          address: app.address,
          class: app.preferredClass || '',
          group: app.preferredGroup,
          section: d.section || 'A',
          guardianName: app.guardianName,
          guardianPhone: app.guardianPhone,
          photo: app.photo,
          status: 'active'
        }
      });

      await tenantDb.application.update({
        where: { id: app.id },
        data: {
          status: 'approved',
          reviewedAt: new Date()
        }
      });
      break;
    }
    case 'salary_change': {
      if (!d.recordId) break;
      if (d.model === 'Teacher') {
        await tenantDb.teacher.update({
          where: { id: d.recordId },
          data: { salary: Number(d.newSalary) }
        });
      } else {
        await tenantDb.employee.update({
          where: { id: d.recordId },
          data: { salary: Number(d.newSalary) }
        });
      }
      break;
    }
    case 'teacher_add': {
      if (!d.userData) break;
      await systemDb.user.create({
        data: {
          name: d.userData.name,
          email: d.userData.email?.toLowerCase(),
          username: d.userData.username || undefined,
          password: d.userData.password,
          role: d.userData.role || 'teacher',
          phone: d.userData.phone,
          cnic: d.userData.cnic,
          college_id: approval.college_id,
          isActive: true,
          authProvider: 'local'
        }
      });
      break;
    }
    case 'teacher_remove': {
      if (!d.userId) break;
      await systemDb.user.update({
        where: { id: d.userId },
        data: { isActive: false }
      });
      break;
    }
    case 'function_fee': break;
  }
}

exports.createApproval = async (tenantDb, data) => {
  return await tenantDb.approval.create({
    data
  });
};

module.exports = exports;
