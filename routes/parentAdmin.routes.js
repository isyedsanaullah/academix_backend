const express = require('express');
const router = express.Router();
const controller = require('../controllers/parentPortal.controller');
const { protect } = require('../middleware/auth.middleware');
const { subscriptionGate } = require('../middleware/subscriptionGate');

router.use(protect);
router.use(subscriptionGate('parent-portal-pwa'));

router.post('/issue', controller.issueSinglePin);
router.post('/issue-bulk', controller.issueBulkPins);
router.get('/sessions', controller.getSessions);

module.exports = router;

