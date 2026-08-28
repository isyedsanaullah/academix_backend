/**
 * Trash Routes
 * GET    /api/trash                             → List authorized trash items
 * POST   /api/trash/:resourceType/:id/restore   → Restore a soft-deleted item
 */

const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const { getTrash, restoreItem } = require('../controllers/trash.controller');

// All trash routes require authentication and tenant context
router.use(protect);
router.use(tenantContext);

router.get('/', getTrash);
router.post('/:resourceType/:id/restore', restoreItem);

module.exports = router;
