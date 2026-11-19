'use strict';

const router = require('express').Router();
const protect = require('../middleware/auth');
const { getActiveBanners } = require('../controllers/banner.controller');

router.use(protect);
router.get('/active', getActiveBanners);

router.meta = {
  exempt: 'platform',
  reason: 'Returns platform + tenant banners scoped to authenticated user role/college',
};

module.exports = router;
