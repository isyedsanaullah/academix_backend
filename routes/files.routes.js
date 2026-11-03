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

// Public endpoint for serving files by object key (logos, covers, avatars, public assets)
router.get('/download-key', async (req, res, next) => {
  try {
    const objectKey = req.query.key;
    if (!objectKey || typeof objectKey !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing key parameter' });
    }
    if (objectKey.includes('..') || objectKey.startsWith('/')) {
      return res.status(400).json({ success: false, message: 'Invalid key parameter' });
    }

    const { getObjectStream, headObject } = require('../services/storageService');
    const meta = await headObject(objectKey);
    if (!meta) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.set({
      'Content-Type': meta.contentType || 'application/octet-stream',
      'Content-Length': meta.contentLength,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': meta.etag,
      'Access-Control-Allow-Origin': '*'
    });

    const streamObj = await getObjectStream(objectKey);
    streamObj.body.pipe(res);
  } catch (err) {
    next(err);
  }
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