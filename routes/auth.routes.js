const router = require('express').Router();
const { login, register, getMe, updatePassword, googleLogin, verifyEmail, resendVerification } = require('../controllers/auth.controller');
const protect = require('../middleware/auth');

router.post('/login', login);
router.post('/google', googleLogin);
router.post('/register', protect, register);
router.get('/me', protect, getMe);
router.put('/update-password', protect, updatePassword);
// Phase 4: Email verification
router.post('/verify-email', protect, verifyEmail);
router.post('/resend-verification', protect, resendVerification);


router.meta = {
  "exempt": "auth",
  "reason": "Authentication and session handling for all users"
};

module.exports = router;