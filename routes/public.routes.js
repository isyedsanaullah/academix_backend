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
const rateLimit = require('express-rate-limit');

const invitationRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25,
  message: { success: false, message: 'Too many requests. Please try again later.' }
});

// Public routes — no authentication required
router.get('/colleges', getColleges);
router.get('/college/:code', getCollegePage);
router.post('/apply/:code', upload.fields([
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

module.exports = router;

