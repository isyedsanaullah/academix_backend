/**
 * Trash Controller
 * Handles GET /api/trash and POST /api/trash/:resourceType/:id/restore
 *
 * Authorization:
 *  - Requires authenticated user via `protect` middleware.
 *  - Requires tenant context via `tenantContext` middleware.
 *  - College A users cannot access College B trash (enforced by trashService scoping).
 */

const {
  softDeleteResource,
  restoreResource,
  getTrashForUser,
} = require('../services/trashService');

/**
 * GET /api/trash
 * Returns authorized soft-deleted items for the current user's role and college.
 */
async function getTrash(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const tenantDb = req.tenantClient || req.systemClient;

    const result = await getTrashForUser({
      tenantDb,
      user: req.user,
      page,
      limit,
    });

    return res.json(result);
  } catch (err) {
    console.error('[TrashController] getTrash error:', err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Failed to retrieve trash.' });
  }
}

/**
 * POST /api/trash/:resourceType/:id/restore
 * Restores a soft-deleted item if within the 7-day retention window.
 */
async function restoreItem(req, res) {
  try {
    const { resourceType, id } = req.params;
    const tenantDb = req.tenantClient || req.systemClient;

    const result = await restoreResource({
      tenantDb,
      resourceType,
      id,
      user: req.user,
    });

    return res.json({ message: 'Item restored successfully.', ...result });
  } catch (err) {
    console.error('[TrashController] restoreItem error:', err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Restore failed.' });
  }
}

module.exports = { getTrash, restoreItem };
