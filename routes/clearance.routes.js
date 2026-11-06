const router = require('express').Router();
const clearanceController = require('../controllers/clearance.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

// Public verification route
router.get('/verify/:hash', clearanceController.verifyCertificate);

// Protected tenant routes
router.use(protect, tenantContext, featureGate('leaving-certificate-clearance'));

router.get('/heads', authorize('admin', 'principal', 'registrar', 'accountant'), clearanceController.getHeads);
router.post('/initiate', authorize('admin', 'principal', 'registrar'), clearanceController.initiateClearance);
router.put('/process/:id/items/:headId', authorize('admin', 'principal', 'accountant', 'teacher', 'employee'), clearanceController.updateClearanceItem);
router.post('/process/:id/issue-certificate', authorize('admin', 'principal', 'registrar'), clearanceController.issueLeavingCertificate);

router.meta = {
  feature: 'leaving-certificate-clearance',
};

module.exports = router;

