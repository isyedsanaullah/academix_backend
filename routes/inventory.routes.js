'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const inventoryController = require('../controllers/inventory.controller');

router.use(protect);
router.use(featureGate('inventory-asset-register'));

router.post('/assets', inventoryController.registerAsset);
router.get('/assets', inventoryController.listAssets);
router.post('/assets/:id/depreciation', inventoryController.applyDepreciation);
router.post('/maintenance', inventoryController.logMaintenance);

module.exports = router;

