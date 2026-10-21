const router = require('express').Router();
const { getBatches, createBatch, updateBatch, deleteBatch, runPromotions } = require('../controllers/batch.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);
router.use(featureGate('session-batches'));

// Two-Year Batches CRUD
router.route('/')
  .get(authorize('admin', 'registrar', 'principal', 'teacher'), getBatches)
  .post(authorize('admin', 'registrar'), createBatch);

router.route('/:id')
  .put(authorize('admin', 'registrar'), updateBatch)
  .delete(authorize('admin'), deleteBatch);

// Annual Promotions Engine
router.post('/run', authorize('admin', 'registrar', 'principal'), runPromotions);
router.post('/promotions/run', authorize('admin', 'registrar', 'principal'), runPromotions);

router.meta = {
  feature: 'session-batches'
};

module.exports = router;
