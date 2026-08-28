/**
 * Status Transition Controller
 * Handles reversible status changes and exact operationId-based Undo.
 *
 * Endpoints consumed:
 *   POST /api/colleges/:id/status       → Apply status change (suspend/activate)
 *   POST /api/colleges/:id/undo-status  → Undo using exact operationId
 *   POST /api/students/:id/status       → Apply student status change
 *   POST /api/students/:id/undo-status  → Undo student status change
 *   POST /api/users/:id/status          → Apply user status change
 *   POST /api/users/:id/undo-status     → Undo user status change
 */

const { applyStatusChange, revertOperation } = require('../services/statusTransitionService');

// ─── Generic Handlers ────────────────────────────────────────────────────────

function applyStatus(resourceType) {
  return async function (req, res) {
    try {
      const { id } = req.params;
      const { newStatus } = req.body;

      if (!newStatus) {
        return res.status(400).json({ message: 'newStatus is required.' });
      }

      const tenantDb = req.tenantClient || req.systemClient;

      const result = await applyStatusChange({
        tenantDb,
        resourceType,
        resourceId: id,
        newStatus,
        actorUser: req.user,
      });

      return res.json({
        message: `${resourceType} status changed to '${newStatus}'.`,
        ...result,
      });
    } catch (err) {
      console.error(`[StatusController] applyStatus(${resourceType}) error:`, err.message);
      return res.status(err.statusCode || 500).json({ message: err.message });
    }
  };
}

function undoStatus(resourceType) {
  return async function (req, res) {
    try {
      const { id } = req.params;
      const { operationId } = req.body;

      if (!operationId) {
        return res.status(400).json({ message: 'operationId is required to undo a status change.' });
      }

      const tenantDb = req.tenantClient || req.systemClient;

      const result = await revertOperation({
        tenantDb,
        resourceType,
        resourceId: id,
        operationId,
        actorUser: req.user,
      });

      return res.json({
        message: `${resourceType} status reverted to '${result.restoredStatus}'.`,
        ...result,
      });
    } catch (err) {
      console.error(`[StatusController] undoStatus(${resourceType}) error:`, err.message);
      return res.status(err.statusCode || 500).json({ message: err.message });
    }
  };
}

// ─── Exported Handlers ───────────────────────────────────────────────────────

module.exports = {
  applyCollegeStatus:  applyStatus('college'),
  undoCollegeStatus:   undoStatus('college'),
  applyStudentStatus:  applyStatus('student'),
  undoStudentStatus:   undoStatus('student'),
  applyUserStatus:     applyStatus('user'),
  undoUserStatus:      undoStatus('user'),
};
