/**
 * backend/services/analyticsTemplates.js
 * Parameterized Type-Safe Prisma Analytics Query Templates for Ask-Your-Data (N46).
 * Strictly prevents SQL injection by routing natural language inquiries through
 * vetted Prisma operations with mandatory college_id multi-tenant isolation.
 */

const { getSystemClient } = require('../config/prismaManager');

const ANALYTICS_TEMPLATES = {
  /**
   * Identifies students with attendance below threshold who have unpaid fee balances.
   */
  low_attendance_unpaid_fees: async ({ collegeId, attendanceThreshold = 75 }) => {
    const prisma = getSystemClient();

    // 1. Fetch unpaid fees
    const unpaidFees = await prisma.fee.findMany({
      where: {
        college_id: collegeId,
        status: { in: ['unpaid', 'overdue', 'partial'] },
      },
      select: {
        student_id: true,
        month: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
      },
    });

    const unpaidStudentIds = [...new Set(unpaidFees.map((f) => f.student_id))];
    if (unpaidStudentIds.length === 0) {
      return {
        template: 'low_attendance_unpaid_fees',
        title: 'Students with Low Attendance & Unpaid Fees',
        records: [],
        count: 0,
      };
    }

    // 2. Fetch students
    const students = await prisma.student.findMany({
      where: {
        college_id: collegeId,
        id: { in: unpaidStudentIds },
        status: 'active',
      },
      select: {
        id: true,
        name: true,
        rollNumber: true,
        class: true,
        section: true,
        fatherPhone: true,
      },
    });

    // 3. Compute attendance rates
    const records = [];
    for (const student of students) {
      const totalDays = await prisma.attendance.count({
        where: { college_id: collegeId, student_id: student.id },
      });
      const presentDays = await prisma.attendance.count({
        where: { college_id: collegeId, student_id: student.id, status: 'present' },
      });

      const rate = totalDays > 0 ? (presentDays / totalDays) * 100 : 0;
      if (rate < attendanceThreshold) {
        const studentDues = unpaidFees.filter((f) => f.student_id === student.id);
        const totalDue = studentDues.reduce((sum, f) => sum + (Number(f.totalAmount) - Number(f.paidAmount || 0)), 0);

        records.push({
          studentId: student.id,
          name: student.name,
          rollNumber: student.rollNumber,
          class: student.class,
          section: student.section,
          attendanceRate: Math.round(rate * 10) / 10,
          totalDuePkr: totalDue,
          unpaidMonths: studentDues.map((f) => f.month).join(', '),
        });
      }
    }

    return {
      template: 'low_attendance_unpaid_fees',
      title: `Students with < ${attendanceThreshold}% Attendance and Unpaid Fees`,
      threshold: attendanceThreshold,
      records,
      count: records.length,
    };
  },

  /**
   * Summarizes fee collections by payment status.
   */
  fee_collection_summary: async ({ collegeId }) => {
    const prisma = getSystemClient();

    const grouped = await prisma.fee.groupBy({
      by: ['status'],
      where: { college_id: collegeId },
      _sum: { totalAmount: true, paidAmount: true },
      _count: { id: true },
    });

    const summary = grouped.map((g) => ({
      status: g.status,
      voucherCount: g._count.id,
      totalBilledPkr: Number(g._sum.totalAmount || 0),
      totalCollectedPkr: Number(g._sum.paidAmount || 0),
    }));

    return {
      template: 'fee_collection_summary',
      title: 'Fee Collection Summary by Status',
      records: summary,
      count: summary.length,
    };
  },

  /**
   * Returns enrollment count broken down by class and group.
   */
  enrollment_by_class: async ({ collegeId }) => {
    const prisma = getSystemClient();

    const grouped = await prisma.student.groupBy({
      by: ['class', 'group'],
      where: { college_id: collegeId, status: 'active' },
      _count: { id: true },
    });

    const records = grouped.map((g) => ({
      class: g.class,
      group: g.group,
      activeStudents: g._count.id,
    }));

    return {
      template: 'enrollment_by_class',
      title: 'Active Student Enrollment by Class & Group',
      records,
      count: records.length,
    };
  },

  /**
   * Returns recent teacher leaves and substitutions.
   */
  teacher_leave_overview: async ({ collegeId, days = 30 }) => {
    const prisma = getSystemClient();
    const sinceDate = new Date(Date.now() - days * 86400000);

    const leaves = await prisma.staffLeave.findMany({
      where: {
        college_id: collegeId,
        createdAt: { gte: sinceDate },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    return {
      template: 'teacher_leave_overview',
      title: `Teacher Leave Records (Past ${days} Days)`,
      records: leaves,
      count: leaves.length,
    };
  },
};

module.exports = {
  ANALYTICS_TEMPLATES,
};

