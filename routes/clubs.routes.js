const router = require('express').Router();
const clubsController = require('../controllers/clubs.controller');
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

router.use(protect, tenantContext, featureGate('events-sports-clubs'));

router.post('/', authorize('admin', 'principal', 'teacher'), clubsController.createClub);
router.get('/', authorize('admin', 'principal', 'teacher', 'student'), clubsController.listClubs);
router.post('/:id/members', authorize('admin', 'principal', 'teacher'), clubsController.addClubMember);
router.post('/:id/events', authorize('admin', 'principal', 'teacher'), clubsController.scheduleClubEvent);

router.meta = {
  feature: 'events-sports-clubs',
};

module.exports = router;

