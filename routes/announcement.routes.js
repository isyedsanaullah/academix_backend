const router = require('express').Router();
const { getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement } = require('../controllers/announcement.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');

router.use(protect, tenantContext);

router.route('/').get(authorize('admin', 'principal', 'registrar', 'teacher', 'student', 'employee'), getAnnouncements).post(authorize('admin', 'principal', 'registrar'), createAnnouncement);
router.route('/:id').put(authorize('admin', 'principal', 'registrar'), updateAnnouncement).delete(authorize('admin', 'principal'), deleteAnnouncement);

module.exports = router;
