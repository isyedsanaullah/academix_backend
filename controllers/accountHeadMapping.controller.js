'use strict';

/**
 * accountHeadMapping.controller.js — Phase 9J (#N04)
 * Controller for AccountHeadMapping CRUD and seeding
 */

const { getSystemClient } = require('../config/prismaManager');
const {
  seedDefaultMappings,
  validateAccountHeadMappings
} = require('../services/accountantJournalService');

function getPrisma() {
  return getSystemClient();
}

/**
 * GET /api/accountant-journal/mappings
 */
async function listMappings(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const campusId = req.campusId || null;
    const prisma = getPrisma();

    const where = { college_id: collegeId };
    if (campusId) where.campus_id = campusId;

    const mappings = await prisma.accountHeadMapping.findMany({
      where,
      orderBy: [{ sourceType: 'asc' }, { sourceKey: 'asc' }]
    });

    return res.json({ success: true, mappings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list account head mappings', error: err.message });
  }
}

/**
 * POST /api/accountant-journal/mappings
 * Create or update an account head mapping
 */
async function upsertMapping(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const campusId = req.campusId || null;
    const { sourceType, sourceKey, accountName, accountCode } = req.body;

    if (!sourceType || !sourceKey || !accountName) {
      return res.status(400).json({
        success: false,
        message: 'sourceType, sourceKey, and accountName are required fields'
      });
    }

    const validTypes = ['FEE_TYPE', 'PAYMENT_METHOD', 'FINE', 'REFUND'];
    const cleanType = String(sourceType).trim().toUpperCase();
    if (!validTypes.includes(cleanType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid sourceType "${sourceType}". Allowed: ${validTypes.join(', ')}`
      });
    }

    const prisma = getPrisma();
    const cleanKey = String(sourceKey).trim().toLowerCase();

    const mapping = await prisma.accountHeadMapping.upsert({
      where: {
        college_id_sourceType_sourceKey: {
          college_id: collegeId,
          sourceType: cleanType,
          sourceKey: cleanKey
        }
      },
      update: {
        accountName: String(accountName).trim(),
        accountCode: accountCode ? String(accountCode).trim() : null,
        campus_id: campusId || null
      },
      create: {
        college_id: collegeId,
        campus_id: campusId || null,
        sourceType: cleanType,
        sourceKey: cleanKey,
        accountName: String(accountName).trim(),
        accountCode: accountCode ? String(accountCode).trim() : null
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Account head mapping saved successfully',
      mapping
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to save account head mapping', error: err.message });
  }
}

/**
 * DELETE /api/accountant-journal/mappings/:id
 */
async function deleteMapping(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const { id } = req.params;
    const prisma = getPrisma();

    const existing = await prisma.accountHeadMapping.findFirst({
      where: { id, college_id: collegeId }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Mapping not found' });
    }

    await prisma.accountHeadMapping.delete({ where: { id } });

    return res.json({ success: true, message: 'Mapping deleted successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete mapping', error: err.message });
  }
}

/**
 * POST /api/accountant-journal/mappings/seed-defaults
 */
async function seedDefaults(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const campusId = req.campusId || null;
    const prisma = getPrisma();

    const result = await seedDefaultMappings(collegeId, campusId, prisma);

    return res.json({
      success: true,
      message: `Successfully seeded ${result.count} standard Chart of Accounts mappings`,
      count: result.count
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to seed default mappings', error: err.message });
  }
}

/**
 * GET /api/accountant-journal/preflight
 * Validate whether all heads are mapped before attempting export
 */
async function preflightCheck(req, res) {
  try {
    const collegeId = req.collegeId || req.user?.college_id;
    const campusId = req.campusId || null;
    const prisma = getPrisma();
    const { startDate, endDate } = req.query;

    const check = await validateAccountHeadMappings(prisma, collegeId, campusId, { startDate, endDate });

    return res.json({
      success: true,
      valid: check.valid,
      unmapped: check.unmapped,
      transactionCount: check.payments.length + check.refunds.length
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Preflight check failed', error: err.message });
  }
}

module.exports = {
  listMappings,
  upsertMapping,
  deleteMapping,
  seedDefaults,
  preflightCheck
};

