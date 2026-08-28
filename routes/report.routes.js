const express = require('express');
const router = express.Router();
const { previewReport, generatePDF } = require('../controllers/report.controller');
const protect = require('../middleware/auth');

/**
 * Middleware to enforce Role-Based Authorization for Reports
 */
const checkReportAuthorization = (allowedRoles = ['principal', 'admin', 'registrar', 'accountant', 'teacher']) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (req.user.role === 'student') {
      return res.status(403).json({ success: false, message: 'Access denied: Students are not authorized to generate institutional reports.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: `Access denied: Role '${req.user.role}' is not authorized for report generation.` });
    }

    next();
  };
};

router.use(protect);

router.get('/preview', checkReportAuthorization(), previewReport);
router.post('/generate-pdf', checkReportAuthorization(), generatePDF);

module.exports = router;
