const router = require('express').Router();
const { getEmployees, getEmployee, createEmployee, updateEmployee, recordSalary, applyLeave, handleLeave } = require('../controllers/employee.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('employees'));
router.route('/').get(authorize('admin', 'principal'), getEmployees).post(authorize('admin'), createEmployee);
router.route('/:id').get(authorize('admin', 'principal'), getEmployee).put(authorize('admin'), updateEmployee);
router.post('/:id/salary', authorize('admin'), recordSalary);
router.post('/:id/leave', authorize('admin', 'employee'), applyLeave);
router.put('/:id/leave/:leaveId', authorize('admin'), handleLeave);

module.exports = router;
