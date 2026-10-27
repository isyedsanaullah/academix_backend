'use strict';

/**
 * Phase 8 — Cron Job Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * All routes require the X-Cron-Secret header matching CRON_SECRET env var.
 * Designed to be called by Render Cron Jobs or any external scheduler.
 *
 * Render Cron Job configuration example (in render.yaml):
 *   - type: cron
 *     name: collegeshub-nudge-stalled
 *     schedule: "0 8 * * *"   # Every day at 08:00 UTC
 *     buildCommand: ""
 *     startCommand: >
 *       curl -s -X POST https://api.collegeshub.org/api/cron/nudge-stalled-onboarding
 *         -H "X-Cron-Secret: $CRON_SECRET"
 *
 * Endpoints:
 *   POST /api/cron/nudge-stalled-onboarding  — nudge emails to stalled onboarding colleges (day 3 & 7)
 *   POST /api/cron/invite-expiry-reminder    — alert super admin of invites expiring in <24h
 *   POST /api/cron/cleanup-expired-tokens    — hard-delete expired invites + null out expired codes
 */

const router = require('express').Router();
const {
  nudgeStalledOnboarding,
  inviteExpiryReminder,
  cleanupExpiredTokens,
  subscriptionReminders
} = require('../controllers/cronJobs.controller');

// Validate CRON_SECRET — done per-handler for granular logging,
// but we also gate the entire router with a lightweight pre-check
router.use((req, res, next) => {
  const cronSecret = process.env.CRON_SECRET;
  const provided = req.headers['x-cron-secret'];
  if (!cronSecret || !provided || provided !== cronSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized — invalid cron secret' });
  }
  next();
});

// Stalled-onboarding nudge emails (run daily, e.g. 08:00 UTC)
router.post('/nudge-stalled-onboarding', nudgeStalledOnboarding);

// Invite-expiry reminder to super admin (run daily)
router.post('/invite-expiry-reminder', inviteExpiryReminder);

// Cleanup expired tokens and verification codes (run daily)
router.post('/cleanup-expired-tokens', cleanupExpiredTokens);

// Subscription expiry reminders, grace period and suspension lifecycle (run daily)
router.post('/subscription-reminders', subscriptionReminders);

module.exports = router;
