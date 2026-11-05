'use strict';

const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  submitImport,
  getImportJobs,
  getImportJob,
  undoImport
} = require('../controllers/bulkImport.controller');

router.use(protect, tenantContext);

// Phase 8C: #27 Bulk Data Import Engine
router.post('/submit', authorize('admin', 'registrar'), featureGate('bulk-import'), submitImport);
router.get('/jobs', authorize('admin', 'registrar', 'principal'), getImportJobs);
router.get('/jobs/:id', authorize('admin', 'registrar', 'principal'), getImportJob);
router.post('/jobs/:id/undo', authorize('admin'), undoImport);

router.meta = {
  feature: 'bulk-import',
  reason: 'Bulk data import engine'
};

module.exports = router;

