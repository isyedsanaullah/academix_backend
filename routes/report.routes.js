const express = require('express');
const router = express.Router();
const { previewReport, generatePDF } = require('../controllers/report.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const planGate = require('../middleware/planGate');

router.use(protect, tenantContext, planGate('analytics-reports'));

router.get('/preview', checkReportAuthorization(), previewReport);
router.post('/generate-pdf', checkReportAuthorization(), generatePDF);

module.exports = router;
