const router = require('express').Router();
const { login, register, getMe, updatePassword, googleLogin } = require('../controllers/auth.controller');
const protect = require('../middleware/auth');

router.post('/login', login);
router.post('/google', googleLogin);
router.post('/register', protect, register);
router.get('/me', protect, getMe);
router.put('/update-password', protect, updatePassword);


router.meta = {
  "exempt": "auth",
  "reason": "Authentication and session handling for all users"
};

module.exports = router;