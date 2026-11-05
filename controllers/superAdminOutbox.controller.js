'use strict';

const { getDeadLetterEvents, retryDeadLetterEvent } = require('../workers/outboxWorker');

/**
 * GET /api/super-admin/outbox/dead-letter
 * List all events that exceeded MAX_ATTEMPTS with pagination & college filtering
 */
async function getDeadLetters(req, res) {
  try {
    const { page, limit, college_id } = req.query;
    const result = await getDeadLetterEvents({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      collegeId: college_id || null
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/super-admin/outbox/:id/retry
 * Reset a DEAD_LETTER event back to PENDING for immediate reprocessing
 */
async function retryDeadLetter(req, res) {
  try {
    const { id } = req.params;
    const event = await retryDeadLetterEvent(id);
    return res.json({
      success: true,
      message: 'Event reset to PENDING and requeued for dispatch',
      event
    });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getDeadLetters,
  retryDeadLetter
};

