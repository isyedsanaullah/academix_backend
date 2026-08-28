const router = require('express').Router();
const { login, register, getMe, updatePassword, googleLogin } = require('../controllers/auth.controller');
const protect = require('../middleware/auth');

router.post('/login', login);
router.post('/google', googleLogin);
router.post('/register', protect, register);
router.get('/me', protect, getMe);
router.put('/update-password', protect, updatePassword);

module.exports = router;
