'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const purchaseController = require('../controllers/purchase.controller');

router.use(protect);
router.use(featureGate('purchase-requests-vendor-ledger'));

router.post('/vendors', purchaseController.createVendor);
router.post('/orders', purchaseController.createOrder);
router.get('/orders', purchaseController.listOrders);

module.exports = router;

