const router = require('express').Router();
const { getColleges, getCollegePage, submitApplication, checkStatus } = require('../controllers/public.controller');
const { submitSubscriptionRequest, submitContactForm } = require('../controllers/subscriptionRequest.controller');
const multer = require('multer');
const path = require('path');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/applications/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

const { verifyInvitationToken, acceptInvitation } = require('../controllers/invitation.controller');
const { verifyPublicDocument } = require('../controllers/verify.controller');
const rateLimit = require('express-rate-limit');

const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' }
});

const invitationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

const { getSystemClient } = require('../config/prismaManager');
const { getEntitlements } = require('../middleware/loadEntitlements');
const { getCollegeLimit } = require('../services/quota');

const applyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many applications submitted from this IP. Please try again later.' }
});

const checkOnlineAdmissions = async (req, res, next) => {
  try {
    const code = req.params.code;
    const systemDb = getSystemClient();
    const college = await systemDb.college.findFirst({
      where: { OR: [{ code: code.toUpperCase() }, { slug: code.toLowerCase() }] },
      select: { id: true }
    });
    if (!college) return res.status(404).json({ success: false, message: 'College not found' });

    const ent = await getEntitlements(college.id);
    if (!ent.active || !ent.features['admissions-online']?.on) {
      return res.status(403).json({
        success: false,
        message: 'Online admissions are not enabled for this institution.',
        code: 'FEATURE_UNAVAILABLE',
        feature: 'admissions-online'
      });
    }

    // Check yearly online application quota
    const currentYear = String(new Date().getFullYear());
    const limit = await getCollegeLimit(systemDb, college.id, 'applications');
    if (limit !== null) {
      const usage = await systemDb.collegeUsage.findUnique({
        where: {
          college_id_metric_period: {
            college_id: college.id,
            metric: 'applications',
            period: currentYear
          }
        }
      });
      if (usage && Number(usage.value) >= limit) {
        return res.status(403).json({
          success: false,
          message: `Annual online application limit of ${limit} reached for this institution.`,
          code: 'QUOTA_EXCEEDED',
          metric: 'applications'
        });
      }
    }

    req.targetCollegeId = college.id;
    next();
  } catch (err) {
    next(err);
  }
};

// Public routes — no authentication required
router.get('/colleges', getColleges);
router.get('/college/:code', getCollegePage);
router.post('/apply/:code', applyRateLimiter, checkOnlineAdmissions, upload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'sscDMC', maxCount: 1 },
  { name: 'hopeCertificate', maxCount: 1 },
  { name: 'ninthDMC', maxCount: 1 }
]), submitApplication);
router.get('/application-status/:appNumber', checkStatus);
router.post('/subscription-request', submitSubscriptionRequest);
router.post('/contact', submitContactForm);

// Invitation Acceptance Public Routes (Rate Limited)
router.get('/invitations/verify/:token', invitationRateLimiter, verifyInvitationToken);
router.post('/invitations/accept', invitationRateLimiter, acceptInvitation);

// Public Document Verification (30 req/min per IP rate limit)
router.get('/verify/:token', verifyRateLimiter, verifyPublicDocument);

router.meta = { exempt: 'public', reason: 'Public portal; apply endpoint gated per-college' };
module.exports = router;

