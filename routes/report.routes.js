const express = require('express');
const router = express.Router();
const {
  previewReport,
  generatePDF,
  getStudentReportPDF,
  getBatchStudentReportPDF
} = require('../controllers/report.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext);

// Student Comprehensive Reports (feature 'student-reports')
router.get('/student/:id.pdf', featureGate('student-reports'), authorize('admin', 'principal', 'registrar', 'student'), getStudentReportPDF);
router.get('/student/:id', featureGate('student-reports'), authorize('admin', 'principal', 'registrar', 'student'), getStudentReportPDF);
router.post('/student-batch.pdf', featureGate('student-reports'), authorize('admin', 'principal', 'registrar'), getBatchStudentReportPDF);
router.post('/student-batch', featureGate('student-reports'), authorize('admin', 'principal', 'registrar'), getBatchStudentReportPDF);

// General Analytics Reports (feature 'analytics-reports')
router.get('/preview', featureGate('analytics-reports'), authorize('admin', 'principal'), previewReport);
router.post('/generate-pdf', featureGate('analytics-reports'), authorize('admin', 'principal'), generatePDF);

router.meta = {
  feature: 'analytics-reports'
};

module.exports = router;