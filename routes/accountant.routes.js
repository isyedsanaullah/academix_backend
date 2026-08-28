const router = require('express').Router();
const {
  getTreasury, addTransaction, getTransactions,
  generateChallan, recordPayment, getDuesReport,
  getPayroll, paySalary
} = require('../controllers/accountant.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext, authorize('accountant', 'admin'));

router.get('/treasury', getTreasury);
router.route('/transactions')
  .get(getTransactions)
  .post(addTransaction);
router.post('/challan', generateChallan);
router.post('/payment', recordPayment);
router.get('/dues', getDuesReport);
router.get('/payroll', getPayroll);
router.post('/pay-salary', paySalary);

module.exports = router;
