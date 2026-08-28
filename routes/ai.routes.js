const router = require('express').Router();
const { saveKey, getKey, deleteKey, testKey } = require('../controllers/aiApiKey.controller');
const protect = require('../middleware/auth');

// All routes require authentication — any role can manage their own key
router.use(protect);

router.route('/api-key')
  .get(getKey)
  .post(saveKey)
  .delete(deleteKey);

router.post('/api-key/test', testKey);

module.exports = router;
