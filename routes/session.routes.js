const router = require('express').Router();
const { getSessions, getCurrentSession, createSession, updateSession, deleteSession } = require('../controllers/session.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);
router.get('/current', authorize('admin', 'principal', 'registrar', 'teacher', 'student', 'employee'), getCurrentSession);
router.route('/').get(authorize('admin', 'principal', 'registrar'), getSessions).post(authorize('admin'), createSession);
router.route('/:id').put(authorize('admin'), updateSession).delete(authorize('admin'), deleteSession);

module.exports = router;
