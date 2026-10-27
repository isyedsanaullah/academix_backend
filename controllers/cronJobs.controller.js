'use strict';

/**
 * Phase 8 — Scheduled Cron Job Handlers
 * ─────────────────────────────────────────────────────────────────────────────
 * These handlers are called by Render Cron Jobs (or any external scheduler)
 * via a secret-protected HTTP endpoint: X-Cron-Secret: <CRON_SECRET>
 *
 * ALL jobs are idempotent — running them multiple times produces the same result.
 *
 * Endpoints:
 *   POST /api/cron/nudge-stalled-onboarding
 *   POST /api/cron/invite-expiry-reminder
 *   POST /api/cron/cleanup-expired-tokens
 */

const { getSystemClient } = require('../config/prismaManager');
const { send: sendMail, buildCollegeshubTemplate, toPlainText } = require('../services/mailService');

// ─── Helper: cron secret guard ──────────────────────────────────────────────
function validateCronSecret(req, res) {
  const secret = req.headers['x-cron-secret'];
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret !== expected) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 1: Stalled Onboarding Nudge
//   Sends a nudge email to college admins whose college has been in `onboarding`
//   status for exactly 3 or 7 days since the invite was accepted (used_at).
//   Idempotency: stored in onboarding_state.nudges_sent (array of day numbers).
// ─────────────────────────────────────────────────────────────────────────────
async function nudgeStalledOnboarding(req, res) {
  if (!validateCronSecret(req, res)) return;

  const prisma = getSystemClient();
  const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
  const nowMs = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  let nudged = 0;
  let skipped = 0;
  const errors = [];

  try {
    // Find all colleges stuck in onboarding
    const stalledColleges = await prisma.college.findMany({
      where: { status: 'onboarding' },
      select: {
        id: true,
        name: true,
        slug: true,
        onboarding_state: true,
        users: {
          where: { role: 'admin' },
          select: { id: true, name: true, email: true },
          take: 1
        },
        CollegeInvite: {
          where: { used_at: { not: null } },
          orderBy: { used_at: 'desc' },
          select: { used_at: true },
          take: 1
        }
      }
    });

    for (const college of stalledColleges) {
      try {
        const invite = college.CollegeInvite?.[0];
        if (!invite?.used_at) { skipped++; continue; }

        const adminUser = college.users?.[0];
        if (!adminUser?.email) { skipped++; continue; }

        const daysSinceAccept = Math.floor((nowMs - new Date(invite.used_at).getTime()) / DAY_MS);
        const nudgeDays = [3, 7];
        const shouldNudge = nudgeDays.find(d => d === daysSinceAccept);
        if (!shouldNudge) { skipped++; continue; }

        // Idempotency check
        const state = (typeof college.onboarding_state === 'object' && college.onboarding_state !== null)
          ? college.onboarding_state
          : {};
        const nudgesSent = state.nudges_sent || [];
        if (nudgesSent.includes(shouldNudge)) { skipped++; continue; }

        // Send nudge email
        const onboardingUrl = `https://${college.slug}.${rootDomain}/onboarding`;
        const daysLeft = 7 - daysSinceAccept;
        const html = buildCollegeshubTemplate({
          title: `Your college setup is ${Math.round((daysSinceAccept / 7) * 100)}% through the deadline`,
          preheader: `Don't leave your Collegeshub workspace incomplete — finish setup today.`,
          bodyHtml: `
            <p>Hi ${adminUser.name || 'there'},</p>
            <p>We noticed that <strong>${college.name}</strong> has been in onboarding for <strong>${daysSinceAccept} day${daysSinceAccept !== 1 ? 's' : ''}</strong>.
            Your workspace isn't live yet — students and staff won't be able to log in until you complete setup.</p>
            <p>You only need to finish a few required steps to launch:</p>
            <ul>
              <li>✅ Verify your email</li>
              <li>📝 Complete your college profile (name, city, contact, logo)</li>
              <li>📚 Set up at least one session and one class</li>
            </ul>
            <p>It typically takes less than 10 minutes. Click below to pick up where you left off.</p>
          `,
          buttonText: 'Continue Setup',
          buttonUrl: onboardingUrl,
          footerNote: daysLeft > 0
            ? `You have been in onboarding for ${daysSinceAccept} days. Reach out to support@${rootDomain} if you need help.`
            : `Please complete your setup as soon as possible. Contact support@${rootDomain} if you need assistance.`
        });

        const mailResult = await sendMail({
          to: adminUser.email,
          subject: `${college.name} — Your Collegeshub workspace isn't live yet`,
          html,
          text: toPlainText({
            title: `${college.name} — Your Collegeshub workspace isn't live yet`,
            bodyText: `Hi ${adminUser.name || 'there'}, you have been in onboarding for ${daysSinceAccept} days. Please complete your setup at: ${onboardingUrl}`,
            buttonText: 'Continue Setup',
            buttonUrl: onboardingUrl
          })
        });

        if (mailResult.success) {
          // Record nudge sent in onboarding_state (idempotent flag)
          await prisma.college.update({
            where: { id: college.id },
            data: {
              onboarding_state: {
                ...state,
                nudges_sent: [...nudgesSent, shouldNudge],
                last_nudge_at: new Date().toISOString()
              }
            }
          });
          nudged++;
        } else {
          errors.push({ collegeId: college.id, error: mailResult.error });
          skipped++;
        }
      } catch (err) {
        errors.push({ collegeId: college.id, error: err.message });
        skipped++;
      }
    }

    return res.json({
      success: true,
      job: 'nudge-stalled-onboarding',
      nudged,
      skipped,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (err) {
    console.error('[CronJob] nudgeStalledOnboarding error:', err.message);
    return res.status(500).json({ success: false, job: 'nudge-stalled-onboarding', error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 2: Invite Expiry Reminder to Super Admin
//   Sends the super admin a reminder for any CollegeInvite that expires in
//   the next 24 hours and has not yet been used. Idempotent via
//   email_status !== 'expiry_reminded' flag.
// ─────────────────────────────────────────────────────────────────────────────
async function inviteExpiryReminder(req, res) {
  if (!validateCronSecret(req, res)) return;

  const prisma = getSystemClient();
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';

  if (!superAdminEmail) {
    return res.json({ success: true, job: 'invite-expiry-reminder', skipped: 'No SUPER_ADMIN_EMAIL configured' });
  }

  let reminded = 0;
  const errors = [];

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find unused invites expiring in the next 24 hours
    const expiringInvites = await prisma.collegeInvite.findMany({
      where: {
        used_at: null,
        revoked_at: null,
        expires_at: { gte: now, lte: in24h },
        email_status: { not: 'expiry_reminded' }
      },
      select: {
        id: true,
        email: true,
        expires_at: true,
        college: { select: { id: true, name: true, slug: true } }
      }
    });

    if (expiringInvites.length === 0) {
      return res.json({ success: true, job: 'invite-expiry-reminder', reminded: 0 });
    }

    const inviteList = expiringInvites
      .map(i => `<li><strong>${i.college?.name || i.college?.id}</strong> (${i.email}) — expires <strong>${new Date(i.expires_at).toUTCString()}</strong></li>`)
      .join('');

    const html = buildCollegeshubTemplate({
      title: `${expiringInvites.length} college invite${expiringInvites.length > 1 ? 's' : ''} expiring within 24 hours`,
      preheader: 'Some college setup invites are about to expire.',
      bodyHtml: `
        <p>The following college admin invites will expire within the next 24 hours and have not been accepted yet:</p>
        <ul>${inviteList}</ul>
        <p>You may want to <strong>resend</strong> these invites from the Collegeshub Super Admin panel before they expire.</p>
      `,
      buttonText: 'Go to Super Admin Panel',
      buttonUrl: `https://admin.${rootDomain}/super-admin/colleges`,
      footerNote: 'This is an automated reminder from the Collegeshub cron system.'
    });

    const mailResult = await sendMail({
      to: superAdminEmail,
      subject: `[Collegeshub] ${expiringInvites.length} invite(s) expiring within 24 hours`,
      html,
      text: toPlainText({
        title: `${expiringInvites.length} college invite(s) expiring within 24 hours`,
        bodyText: expiringInvites.map(i => `${i.college?.name} (${i.email}) — expires ${new Date(i.expires_at).toUTCString()}`).join('\n'),
        buttonText: 'Go to Super Admin Panel',
        buttonUrl: `https://admin.${rootDomain}/super-admin/colleges`
      })
    });

    if (mailResult.success) {
      // Mark all as reminded (idempotent)
      await prisma.collegeInvite.updateMany({
        where: { id: { in: expiringInvites.map(i => i.id) } },
        data: { email_status: 'expiry_reminded' }
      });
      reminded = expiringInvites.length;
    } else {
      errors.push(mailResult.error);
    }

    return res.json({ success: true, job: 'invite-expiry-reminder', reminded, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error('[CronJob] inviteExpiryReminder error:', err.message);
    return res.status(500).json({ success: false, job: 'invite-expiry-reminder', error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JOB 3: Cleanup Expired Tokens & Verification Codes
//   Deletes/nulls out:
//     - CollegeInvite rows that expired AND were never used (hard delete to save space)
//     - User.verificationCode + verificationCodeExpires that have expired
//     - User.resetCode + resetCodeExpires (staff set-password tokens) that expired
//   All operations are idempotent.
// ─────────────────────────────────────────────────────────────────────────────
async function cleanupExpiredTokens(req, res) {
  if (!validateCronSecret(req, res)) return;

  const prisma = getSystemClient();
  const now = new Date();

  try {
    // 1. Delete expired, unused, unrevoked college invites
    const deletedInvites = await prisma.collegeInvite.deleteMany({
      where: {
        used_at: null,
        revoked_at: null,
        expires_at: { lt: now }
      }
    }).catch(() => ({ count: 0 }));

    // 2. Clear expired email verification codes
    const clearedVerificationCodes = await prisma.user.updateMany({
      where: {
        verificationCode: { not: null },
        verificationCodeExpires: { lt: now }
      },
      data: {
        verificationCode: null,
        verificationCodeExpires: null
      }
    }).catch(() => ({ count: 0 }));

    // 3. Clear expired staff set-password tokens (resetCode used for staff invite flow)
    const clearedResetCodes = await prisma.user.updateMany({
      where: {
        resetCode: { not: null },
        resetCodeExpires: { lt: now }
      },
      data: {
        resetCode: null,
        resetCodeExpires: null
      }
    }).catch(() => ({ count: 0 }));

    return res.json({
      success: true,
      job: 'cleanup-expired-tokens',
      deleted: {
        expiredInvites: deletedInvites.count,
        expiredVerificationCodes: clearedVerificationCodes.count,
        expiredResetCodes: clearedResetCodes.count
      }
    });
  } catch (err) {
    console.error('[CronJob] cleanupExpiredTokens error:', err.message);
    return res.status(500).json({ success: false, job: 'cleanup-expired-tokens', error: err.message });
  }
// ─────────────────────────────────────────────────────────────────────────────
// JOB 4: Subscription Expiry Reminders & Grace/Suspension Lifecycle
//   - Reminders at 30, 14, 7, 1 days before expiry (tracked, sent once).
//   - At expiry -> sets status 'grace' for 7 days with in-app banner for all roles.
//   - After grace -> sets status 'suspended'.
// ─────────────────────────────────────────────────────────────────────────────
async function subscriptionReminders(req, res) {
  if (!validateCronSecret(req, res)) return;

  const prisma = getSystemClient();
  const now = new Date();
  const DAY_MS = 24 * 60 * 60 * 1000;

  let remindedCount = 0;
  let graceCount = 0;
  let suspendedCount = 0;
  const errors = [];

  try {
    const colleges = await prisma.college.findMany({
      where: {
        OR: [
          { status: { in: ['active', 'onboarding'] } },
          { subscription_status: { in: ['active', 'grace'] } }
        ]
      },
      include: {
        subscriptionPeriods: {
          where: { status: { in: ['active', 'scheduled'] } },
          orderBy: { expires_at: 'desc' }
        }
      }
    });

    for (const college of colleges) {
      try {
        const period = college.subscriptionPeriods.find(p => p.status === 'active') || college.subscriptionPeriods[0];
        if (!period) continue;

        const expiresAt = new Date(period.expires_at);
        const diffMs = expiresAt.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffMs / DAY_MS);

        const currentThresholds = Array.isArray(period.reminded_thresholds) ? period.reminded_thresholds : [];
        const newThresholds = [...currentThresholds];

        // 1. Reminders: 30, 14, 7, 1 days
        const thresholds = [30, 14, 7, 1];
        for (const t of thresholds) {
          if (daysLeft <= t && daysLeft > 0 && !newThresholds.includes(String(t))) {
            const admins = await prisma.user.findMany({
              where: { college_id: college.id, role: 'admin', isActive: true },
              select: { id: true, name: true, email: true }
            });

            const recipientEmails = admins.length > 0 ? admins.map(a => a.email) : [college.email];
            const subject = `Subscription Expiring in ${daysLeft} Day${daysLeft === 1 ? '' : 's'}`;
            const message = `Your Collegeshub subscription for ${college.name} expires on ${expiresAt.toDateString()} (${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining). Please renew before the expiration date to maintain uninterrupted service.`;

            const announcement = await prisma.announcement.create({
              data: {
                college_id: college.id,
                title: subject,
                content: message,
                category: 'Administration',
                audience: 'Admin & Principal',
                priority: 'High',
                status: 'Published'
              }
            });

            for (const email of recipientEmails) {
              const html = buildCollegeshubTemplate({
                title: subject,
                bodyHtml: `
                  <p>Dear College Administration,</p>
                  <p>Your subscription for <strong>${college.name}</strong> is scheduled to expire in <strong>${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> on <strong>${expiresAt.toDateString()}</strong>.</p>
                  <p>To avoid disruption of your college portal and services, please contact Collegeshub support to renew your subscription.</p>
                `,
                footerNote: 'Collegeshub Platform Administration'
              });

              await sendMail({
                to: email,
                subject: `[Collegeshub] ${subject}`,
                html,
                text: `${subject}\n\n${message}`
              });

              await prisma.messageDelivery.create({
                data: {
                  college_id: college.id,
                  announcement_id: announcement.id,
                  recipient_user_id: admins.find(a => a.email === email)?.id || 'admin',
                  recipient_email: email,
                  recipient_role: 'admin',
                  subject,
                  content: message,
                  channel: 'email',
                  status: 'sent',
                  sent_at: new Date()
                }
              }).catch(() => {});
            }

            newThresholds.push(String(t));
            remindedCount++;
          }
        }

        if (newThresholds.length !== currentThresholds.length) {
          await prisma.subscriptionPeriod.update({
            where: { id: period.id },
            data: { reminded_thresholds: newThresholds }
          });
        }

        // 2. Lifecycle transitions: Expiry -> Grace -> Suspended
        if (daysLeft <= 0) {
          const isCurrentlyGrace = college.subscription_status === 'grace';
          const isCurrentlySuspended = college.subscription_status === 'suspended' || college.status === 'suspended';

          if (!isCurrentlyGrace && !isCurrentlySuspended) {
            const graceUntil = new Date(now.getTime() + 7 * DAY_MS);
            await prisma.college.update({
              where: { id: college.id },
              data: {
                subscription_status: 'grace',
                grace_until: graceUntil
              }
            });

            await prisma.announcement.create({
              data: {
                college_id: college.id,
                title: 'Subscription Grace Period Active',
                content: `The subscription for ${college.name} expired on ${expiresAt.toDateString()}. A 7-day grace period is active until ${graceUntil.toDateString()}. Please renew immediately to avoid suspension.`,
                category: 'Administration',
                audience: 'All Users',
                priority: 'Urgent',
                status: 'Published'
              }
            });

            const { clearEntitlementCache } = require('../middleware/loadEntitlements');
            clearEntitlementCache(college.id);
            graceCount++;
          } else if (isCurrentlyGrace && college.grace_until && new Date(college.grace_until) < now) {
            await prisma.college.update({
              where: { id: college.id },
              data: {
                status: 'suspended',
                subscription_status: 'suspended'
              }
            });

            await prisma.subscriptionPeriod.update({
              where: { id: period.id },
              data: { status: 'expired' }
            });

            const { clearEntitlementCache } = require('../middleware/loadEntitlements');
            clearEntitlementCache(college.id);
            suspendedCount++;
          }
        }
      } catch (colErr) {
        errors.push({ collegeId: college.id, error: colErr.message });
      }
    }

    return res.json({
      success: true,
      job: 'subscription-reminders',
      remindedCount,
      graceCount,
      suspendedCount,
      errors
    });
  } catch (err) {
    console.error('[CronJob] subscriptionReminders error:', err.message);
    return res.status(500).json({ success: false, job: 'subscription-reminders', error: err.message });
  }
}

module.exports = {
  nudgeStalledOnboarding,
  inviteExpiryReminder,
  cleanupExpiredTokens,
  subscriptionReminders
};
