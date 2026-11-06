'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { featureGate } = require('../middleware/loadEntitlements');
const libraryController = require('../controllers/library.controller');

router.use(protect);
router.use(featureGate('library-management'));

router.post('/titles', libraryController.createTitle);
router.get('/titles/:id', libraryController.getTitle);
router.post('/copies', libraryController.addCopy);
router.post('/issues', libraryController.issueBook);
router.post('/returns', libraryController.returnBook);
router.get('/loans', libraryController.listLoans);

module.exports = router;

