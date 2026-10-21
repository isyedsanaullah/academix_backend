const router = require('express').Router();
const { getCombinedClasses, createCombinedClass, updateCombinedClass, deleteCombinedClass } = require('../controllers/batch.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);
router.use(featureGate('combined-classes'));

// Combined Classes CRUD
router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getCombinedClasses)
  .post(authorize('admin', 'registrar', 'principal'), createCombinedClass);

router.route('/:id')
  .put(authorize('admin', 'registrar', 'principal'), updateCombinedClass)
  .delete(authorize('admin', 'registrar'), deleteCombinedClass);

router.meta = {
  feature: 'combined-classes'
};

module.exports = router;
