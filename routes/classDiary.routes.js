'use strict';

const router = require('express').Router();
const protect = require('../middleware/auth');
const authorize = require('../middleware/rbac');
const tenantContext = require('../middleware/tenantContext');
const { featureGate } = require('../middleware/loadEntitlements');

const {
  getDiary,
  saveDiaryEntry,
  getWorkingDays,
  createCalendarEvent
} = require('../controllers/classDiary.controller');

router.use(protect, tenantContext);

// Class Diary routes (#28)
router.route('/')
  .get(authorize('admin', 'principal', 'teacher', 'student', 'registrar'), getDiary)
  .post(authorize('admin', 'principal', 'teacher'), featureGate('class-diary'), saveDiaryEntry);

// Calendar & Working Days routes (#28)
router.get('/working-days', authorize('admin', 'principal', 'teacher', 'accountant', 'student', 'registrar'), getWorkingDays);
router.post('/events', authorize('admin', 'principal'), featureGate('academic-calendar'), createCalendarEvent);

router.meta = {
  feature: 'class-diary',
  reason: 'Class diary & academic calendar management'
};

module.exports = router;

