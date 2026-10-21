const router = require('express').Router();
const { saveKey, getKey, deleteKey, testKey } = require('../controllers/aiApiKey.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

// All routes require authentication and tenant context — gated by any AI feature
router.use(protect, tenantContext, featureGate(['ai-chat', 'ai-generators', 'ai-pdf-chat']));

router.route('/api-key')
  .get(getKey)
  .post(saveKey)
  .delete(deleteKey);

router.post('/api-key/test', testKey);

router.meta = { feature: ['ai-chat', 'ai-generators', 'ai-pdf-chat'] };
module.exports = router;
