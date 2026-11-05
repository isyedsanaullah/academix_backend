const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { login, register, getMe, updatePassword, googleLogin, verifyEmail, resendVerification, stepUp } = require('../controllers/auth.controller');
const {
  setup2FA,
  verify2FA,
  validate2FA,
  recover2FA,
  disable2FA,
  listKnownDevices,
  removeKnownDevice
} = require('../controllers/twoFactor.controller');
const protect = require('../middleware/auth');
const { getSystemClient } = require('../config/prismaManager');

// Helper middleware allowing either normal session OR ENROLL_2FA scope
const protectEnrollOrSession = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized - no token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope === 'PREAUTH_2FA') {
      return res.status(401).json({ success: false, code: 'INVALID_SESSION_SCOPE', message: 'Pre-auth token cannot be used for 2FA setup' });
    }
    const prisma = getSystemClient();
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or deactivated' });
    }
    req.user = { ...user, _id: user.id };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized: ' + err.message });
  }
};

router.post('/login', login);
router.post('/google', googleLogin);
router.post('/register', protect, register);
router.get('/me', protect, getMe);
router.put('/update-password', protect, updatePassword);
// Phase 4: Email verification
router.post('/verify-email', protect, verifyEmail);
router.post('/resend-verification', protect, resendVerification);
// Phase 6B: Step-Up Authentication
router.post('/step-up', protect, stepUp);

// Phase 9A: N07 Admin 2FA & Known Devices
router.post('/2fa/setup', protectEnrollOrSession, setup2FA);
router.post('/2fa/verify', protectEnrollOrSession, verify2FA);
router.post('/2fa/validate', validate2FA);
router.post('/2fa/recover', recover2FA);
router.post('/2fa/disable', protect, disable2FA);
router.get('/known-devices', protect, listKnownDevices);
router.delete('/known-devices/:id', protect, removeKnownDevice);


router.meta = {
  "exempt": "auth",
  "reason": "Authentication and session handling for all users"
};

module.exports = router;