const router = require('express').Router();
const { getCertificates, createCertificate, getCertificate, revokeCertificate } = require('../controllers/certificate.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('certificates'));
router.route('/').get(authorize('admin', 'principal'), getCertificates).post(authorize('admin', 'principal'), createCertificate);
router.route('/:id').get(authorize('admin', 'principal', 'student'), getCertificate);
router.put('/:id/revoke', authorize('admin', 'principal'), revokeCertificate);


router.meta = {
  "feature": "certificates"
};

module.exports = router;