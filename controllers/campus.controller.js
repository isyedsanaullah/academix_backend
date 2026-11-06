// ─── Campus Controller (Phase 10: §10.1 & N18) ─────────────────────────
const campusService = require('../services/campusService');

/**
 * List all campuses
 */
async function getCampuses(req, res) {
  try {
    const collegeId = req.user.college_id;
    const campuses = await campusService.listCampuses(collegeId);

    return res.json({
      success: true,
      campuses
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/**
 * Create a new campus
 */
async function createCampus(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { name, code, address, isDefault } = req.body;

    const campus = await campusService.createCampus(collegeId, {
      name,
      code,
      address,
      isDefault
    });

    return res.status(201).json({
      success: true,
      campus
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'VALIDATION_ERROR',
      message: err.message
    });
  }
}

/**
 * Update an existing campus
 */
async function updateCampus(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { id } = req.params;
    const { name, address, isActive, isDefault } = req.body;

    const campus = await campusService.updateCampus(collegeId, id, {
      name,
      address,
      isActive,
      isDefault
    });

    return res.json({
      success: true,
      campus
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'UPDATE_ERROR',
      message: err.message
    });
  }
}

/**
 * Delete a campus
 */
async function deleteCampus(req, res) {
  try {
    const collegeId = req.user.college_id;
    const { id } = req.params;

    await campusService.deleteCampus(collegeId, id);

    return res.json({
      success: true,
      message: 'Campus deleted successfully'
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      code: err.code || 'DELETE_ERROR',
      message: err.message
    });
  }
}

/**
 * Executive multi-campus dashboard (N18)
 */
async function getDashboard(req, res) {
  try {
    const collegeId = req.user.college_id;
    const dashboard = await campusService.getMultiCampusDashboard(collegeId);

    return res.json({
      success: true,
      ...dashboard
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

module.exports = {
  getCampuses,
  createCampus,
  updateCampus,
  deleteCampus,
  getDashboard
};

