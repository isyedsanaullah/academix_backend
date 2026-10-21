/**
 * File Routes — R2 Storage API
 * ─────────────────────────────
 * All routes require authentication + tenant context.
 * File operations are tenant-scoped and permission-checked.
 */
const router = require('express').Router();
const multer = require('multer');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');
const {
  initiateUpload,
  finalizeUpload,
  directUpload,
  getDownloadUrl,
  listFiles,
  deleteFile,
  resolveUrls,
} = require('../controllers/file.controller');

// Memory storage for backend-mediated uploads (small files)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for direct uploads
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type '${file.mimetype}' is not allowed.`), false);
    }
  },
});

// All routes require auth + tenant context
router.use(protect, tenantContext);

// Presigned upload flow (for larger files)
router.post('/initiate', initiateUpload);
router.post('/:id/finalize', finalizeUpload);

// Backend-mediated upload (for small files like avatars, logos)
router.post('/upload', memoryUpload.single('file'), directUpload);

// Download and preview
router.get('/:id/download-url', getDownloadUrl);

// Batch URL resolution
router.post('/resolve-urls', resolveUrls);

// List files
router.get('/', listFiles);

// Delete file
router.delete('/:id', deleteFile);


router.meta = {
  "exempt": "core",
  "reason": "System file upload and retrieval infrastructure"
};

module.exports = router;