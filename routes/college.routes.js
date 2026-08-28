const router = require('express').Router();
const { getCollegeInfo, getDashboard, getSettings, updateSettings, getStaff, addStaff } = require('../controllers/college.controller');
const { applyCollegeStatus, undoCollegeStatus } = require('../controllers/statusTransition.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

// Any authenticated user can see their college info
router.get('/info', getCollegeInfo);

router.get('/dashboard', authorize('admin', 'principal'), getDashboard);
router.route('/settings').get(authorize('admin'), getSettings).put(authorize('admin'), updateSettings);
router.route('/staff').get(authorize('admin', 'principal'), getStaff).post(authorize('admin'), addStaff);

// Reversible Status Transitions (Super Admin only)
router.post('/:id/status', authorize('superAdmin'), applyCollegeStatus);
router.post('/:id/undo-status', authorize('superAdmin'), undoCollegeStatus);

module.exports = router;
