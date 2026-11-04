const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const subscriptionController = require('../controllers/subscription.controller');

/**
 * College Subscription & Entitlement Routes
 * Accessible to authenticated college admins, accountants, and staff with billing visibility.
 */
router.get('/current', protect, tenantContext, subscriptionController.getCurrentSubscription);
router.get('/status', protect, tenantContext, subscriptionController.getCurrentSubscription);
router.get('/addon-catalog', protect, tenantContext, subscriptionController.getAddonCatalog);
router.post('/calculate-total', protect, tenantContext, subscriptionController.calculateTotal);
router.post('/submit-payment', protect, tenantContext, subscriptionController.submitPaymentProof);
router.post('/renew', protect, tenantContext, subscriptionController.submitPaymentProof);
router.get('/payment-history', protect, tenantContext, subscriptionController.getPaymentHistory);
router.get('/history', protect, tenantContext, subscriptionController.getPaymentHistory);

module.exports = router;

