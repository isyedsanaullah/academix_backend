const express = require('express');
const router = express.Router();
const { previewReport, generatePDF } = require('../controllers/report.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('analytics-reports'));

router.get('/preview', authorize('admin', 'principal'), previewReport);
router.post('/generate-pdf', authorize('admin', 'principal'), generatePDF);

module.exports = router;

