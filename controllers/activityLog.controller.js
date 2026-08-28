/**
 * ActivityLog Controller
 * Endpoint handler for retrieving role-relevant activity history.
 */

const { getActivitiesForUser } = require('../services/activityLog.service');

exports.getActivities = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const user = req.user;

    const {
      page = 1,
      limit = 20,
      category,
      status,
      dateRange = 'all',
      startDate,
      endDate,
      search,
      college_id
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      category,
      status,
      dateRange,
      startDate,
      endDate,
      search,
      college_id: req.isSuperAdmin ? college_id : req.collegeId
    };

    const result = await getActivitiesForUser(user, tenantDb, options);

    res.json({
      success: true,
      data: result.logs,
      pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};
