const router = require('express').Router();
const {
  getProfile, updateProfile, setUsername, changePassword,
  sendVerificationCode, verifyEmail, changeEmail,
  requestPasswordReset, resetPassword
} = require('../controllers/profile.controller');
const protect = require('../middleware/auth');
const tenantContext = require('../middleware/tenantContext');

// Public routes (no auth needed)
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

// Protected routes
router.use(protect, tenantContext);

router.get('/me', getProfile);
router.put('/me', updateProfile);
router.put('/username', setUsername);
router.put('/password', changePassword);
router.post('/email/verify/send', sendVerificationCode);
router.post('/email/verify', verifyEmail);
router.put('/email', changeEmail);


router.meta = {
  "exempt": "core",
  "reason": "Personal profile settings and password change"
};

module.exports = router;