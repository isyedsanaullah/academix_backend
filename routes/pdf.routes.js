const router = require('express').Router();
const { uploadPDF, getDocuments, getSubjects, deleteDocument, retryDocument, downloadDocument, getSubjectHierarchy } = require('../controllers/pdfUpload.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');
const upload = require('../config/multer');

// All PDF routes require auth + tenant + premium plan
router.use(protect, tenantContext, featureGate('ai-pdf-chat'));

// Upload PDF (teachers and admins only)
router.post(
  '/upload',
  authorize('teacher', 'admin'),
  upload.single('pdf'),
  uploadPDF
);

// Retry failed PDF document processing
router.post(
  '/retry/:id',
  authorize('teacher', 'admin'),
  retryDocument
);

// List documents
router.get('/documents', getDocuments);

// Download PDF document
router.get('/download/:id', downloadDocument);

// Get subjects with counts
router.get('/subjects', getSubjects);

// Get merged subject hierarchy
router.get('/hierarchy', getSubjectHierarchy);

// Delete document
router.delete('/:id', authorize('teacher', 'admin'), deleteDocument);


router.meta = {
  "feature": "ai-pdf-chat"
};

module.exports = router;