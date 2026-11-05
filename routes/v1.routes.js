'use strict';

/**
 * v1.routes.js — Phase 9E (#N06)
 * Public REST API v1 (Strictly Read-Only).
 * Authenticated via apiKeyAuth with DB-atomic rate limiting.
 */

const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const { getSystemClient } = require('../config/prismaManager');

function getPrisma() {
  return getSystemClient();
}

// 1. Enforce Strictly Read-Only (Reject POST, PUT, PATCH, DELETE)
router.use((req, res, next) => {
  const method = req.method.toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return res.status(405).json({
      success: false,
      code: 'METHOD_NOT_ALLOWED',
      message: `Method ${method} is not allowed on Public REST API v1. This API is strictly read-only.`
    });
  }
  next();
});

// 2. All v1 endpoints require API Key Auth
router.use(apiKeyAuth);

/**
 * GET /api/v1/students
 */
router.get('/students', async (req, res) => {
  try {
    const prisma = getPrisma();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const where = { college_id: req.collegeId };
    if (req.query.class) where.class = String(req.query.class);
    if (req.query.group) where.group = String(req.query.group);

    const [total, students] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          fatherName: true,
          rollNumber: true,
          class: true,
          group: true,
          gender: true,
          phone: true,
          status: true,
          createdAt: true
        },
        orderBy: { rollNumber: 'asc' }
      })
    ]);

    return res.json({
      success: true,
      data: students,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('[v1.routes] /students error:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/attendance
 */
router.get('/attendance', async (req, res) => {
  try {
    const prisma = getPrisma();
    const where = { college_id: req.collegeId };
    if (req.query.studentId) where.student_id = String(req.query.studentId);

    const attendanceRecords = await prisma.attendance.findMany({
      where,
      take: 100,
      orderBy: { date: 'desc' },
      select: {
        id: true,
        student_id: true,
        date: true,
        status: true
      }
    });

    return res.json({
      success: true,
      data: attendanceRecords
    });
  } catch (err) {
    console.error('[v1.routes] /attendance error:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/fees
 */
router.get('/fees', async (req, res) => {
  try {
    const prisma = getPrisma();
    const where = { college_id: req.collegeId };
    if (req.query.month) where.month = String(req.query.month);
    if (req.query.status) where.status = String(req.query.status);

    const fees = await prisma.fee.findMany({
      where,
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        student_id: true,
        month: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
        dueDate: true
      }
    });

    return res.json({
      success: true,
      data: fees
    });
  } catch (err) {
    console.error('[v1.routes] /fees error:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

/**
 * GET /api/v1/classes
 */
router.get('/classes', async (req, res) => {
  try {
    const prisma = getPrisma();
    const [sessions, sections] = await Promise.all([
      prisma.session.findMany({
        where: { college_id: req.collegeId },
        select: { id: true, name: true, startDate: true, endDate: true }
      }),
      prisma.section.findMany({
        where: { college_id: req.collegeId },
        select: { id: true, name: true, capacity: true, shift: true }
      })
    ]);

    return res.json({
      success: true,
      data: { sessions, sections }
    });
  } catch (err) {
    console.error('[v1.routes] /classes error:', err);
    return res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: err.message });
  }
});

module.exports = router;

