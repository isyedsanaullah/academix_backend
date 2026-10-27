'use strict';

const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { clearEntitlementCache, getEntitlements } = require('../middleware/loadEntitlements');
const { planKeysFor, normalizePlan } = require('../services/collegeAdapter');
const mailService = require('../services/mailService');

/**
 * GET /api/super-admin/colleges/:id/subscription
 * Retrieves current subscription period, status, days left, and full history
 */
exports.getSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        slug: true,
        status: true,
        subscription: true,
        subscription_status: true,
        grace_until: true,
        feature_overrides: true
      }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const history = await prisma.subscriptionPeriod.findMany({
      where: { college_id: id },
      orderBy: { created_at: 'desc' }
    });

    const now = new Date();
    // Active period: explicit 'active' status or covering current date
    const currentPeriod = history.find(p => p.status === 'active') || history[0] || null;

    let daysLeft = null;
    if (currentPeriod && currentPeriod.expires_at) {
      const diffMs = new Date(currentPeriod.expires_at).getTime() - now.getTime();
      daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    }

    const effectiveStatus = college.subscription_status || (currentPeriod ? currentPeriod.status : 'inactive');
    const ent = await getEntitlements(id);

    res.json({
      success: true,
      data: {
        college: {
          id: college.id,
          name: college.name,
          code: college.code,
          slug: college.slug
        },
        currentPeriod,
        status: effectiveStatus,
        graceUntil: college.grace_until,
        daysLeft,
        featureOverrides: college.feature_overrides || {},
        effectiveFeatures: ent.active ? ent.effectiveFeatures : [],
        history
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/subscription/assign
 * Assigns a new subscription plan with features snapshot and duration
 */
exports.assignSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { plan, features, startsAt, expiresAt, amountNote, paymentNote, reason } = req.body;
    const prisma = getSystemClient();

    if (!plan || !startsAt || !expiresAt) {
      return res.status(400).json({
        success: false,
        message: 'Plan, startsAt, and expiresAt are required.'
      });
    }

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const normPlan = normalizePlan(plan);
    let finalFeatures = features;
    if (!finalFeatures || (Array.isArray(finalFeatures) && finalFeatures.length === 0)) {
      finalFeatures = [...planKeysFor(normPlan)];
    }

    const starts = new Date(startsAt);
    const expires = new Date(expiresAt);

    // Deactivate previous active periods (mark expired)
    await prisma.subscriptionPeriod.updateMany({
      where: { college_id: id, status: 'active' },
      data: { status: 'expired' }
    });

    const newPeriod = await prisma.subscriptionPeriod.create({
      data: {
        college_id: id,
        plan: normPlan,
        features: finalFeatures,
        starts_at: starts,
        expires_at: expires,
        status: 'active',
        amount_note: amountNote || null,
        payment_note: paymentNote || null,
        created_by: req.user?.email || 'superAdmin',
        reason: reason || 'Initial plan assignment'
      }
    });

    // Update college state
    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    await prisma.college.update({
      where: { id },
      data: {
        subscription_status: 'active',
        grace_until: null,
        status: college.status === 'suspended' ? 'active' : college.status,
        subscription: {
          ...existingSub,
          plan: normPlan,
          status: 'active',
          periodEnd: expires
        }
      }
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'ASSIGN_SUBSCRIPTION',
        category: 'Subscription',
        resourceType: 'SubscriptionPeriod',
        resourceId: newPeriod.id,
        title: `Assigned ${normPlan} Plan to ${college.name}`,
        description: `Plan assigned from ${starts.toISOString().split('T')[0]} to ${expires.toISOString().split('T')[0]}.`,
        metadata: { plan: normPlan, startsAt: starts, expiresAt: expires, amountNote, paymentNote }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      data: newPeriod,
      message: `Assigned ${normPlan} subscription plan successfully.`
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/subscription/renew
 * Renews subscription extending from either 'current_expiry' or 'today'
 */
exports.renewSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { extendFrom = 'current_expiry', months, newExpiry, amountNote, paymentNote, reason } = req.body;
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const currentPeriod = await prisma.subscriptionPeriod.findFirst({
      where: { college_id: id, status: 'active' },
      orderBy: { created_at: 'desc' }
    });

    const now = new Date();
    let baseDate = now;

    if (extendFrom === 'current_expiry' && currentPeriod && new Date(currentPeriod.expires_at) > now) {
      baseDate = new Date(currentPeriod.expires_at);
    }

    let calculatedExpiry;
    if (newExpiry) {
      calculatedExpiry = new Date(newExpiry);
    } else {
      const m = parseInt(months || '12', 10);
      calculatedExpiry = new Date(baseDate);
      calculatedExpiry.setMonth(calculatedExpiry.getMonth() + m);
    }

    const plan = currentPeriod?.plan || college.subscription?.plan || 'starter';
    const features = currentPeriod?.features || [...planKeysFor(plan)];

    // Archive previous active periods so history is NEVER overwritten
    await prisma.subscriptionPeriod.updateMany({
      where: { college_id: id, status: 'active' },
      data: { status: 'expired' }
    });

    const renewedPeriod = await prisma.subscriptionPeriod.create({
      data: {
        college_id: id,
        plan,
        features,
        starts_at: baseDate,
        expires_at: calculatedExpiry,
        status: 'active',
        amount_note: amountNote || null,
        payment_note: paymentNote || null,
        created_by: req.user?.email || 'superAdmin',
        reason: reason || `Subscription renewal (${extendFrom === 'current_expiry' ? 'extended from expiry' : 'extended from today'})`
      }
    });

    // Reactivate college if it was suspended or in grace
    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    await prisma.college.update({
      where: { id },
      data: {
        subscription_status: 'active',
        grace_until: null,
        status: college.status === 'suspended' ? 'active' : college.status,
        subscription: {
          ...existingSub,
          status: 'active',
          periodEnd: calculatedExpiry
        }
      }
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'RENEW_SUBSCRIPTION',
        category: 'Subscription',
        resourceType: 'SubscriptionPeriod',
        resourceId: renewedPeriod.id,
        title: `Renewed Subscription for ${college.name}`,
        description: `Renewed until ${calculatedExpiry.toISOString().split('T')[0]}. Base date: ${extendFrom}.`,
        metadata: { plan, baseDate, expiresAt: calculatedExpiry, amountNote, paymentNote }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      data: renewedPeriod,
      message: 'Subscription renewed successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/super-admin/colleges/:id/subscription/expiry
 * Edits expiry date of the current period. Requires reason.
 */
exports.editExpiry = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newExpiry, reason } = req.body;
    const prisma = getSystemClient();

    if (!newExpiry) {
      return res.status(400).json({ success: false, message: 'newExpiry is required.' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required when modifying the expiry date.' });
    }

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const currentPeriod = await prisma.subscriptionPeriod.findFirst({
      where: { college_id: id, status: 'active' },
      orderBy: { created_at: 'desc' }
    });

    const parsedExpiry = new Date(newExpiry);

    if (currentPeriod) {
      await prisma.subscriptionPeriod.update({
        where: { id: currentPeriod.id },
        data: {
          expires_at: parsedExpiry,
          reason: `Expiry modified: ${reason.trim()}`
        }
      });
    }

    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    const updateData = {
      subscription: {
        ...existingSub,
        periodEnd: parsedExpiry
      }
    };

    // If new expiry is in future and college was suspended/grace, restore to active
    if (parsedExpiry > new Date()) {
      updateData.subscription_status = 'active';
      updateData.grace_until = null;
      if (college.status === 'suspended') updateData.status = 'active';
    }

    await prisma.college.update({
      where: { id },
      data: updateData
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'EDIT_EXPIRY',
        category: 'Subscription',
        resourceType: 'SubscriptionPeriod',
        resourceId: currentPeriod?.id || id,
        title: `Edited Subscription Expiry for ${college.name}`,
        description: `New expiry: ${parsedExpiry.toISOString().split('T')[0]}. Reason: ${reason.trim()}`,
        metadata: { newExpiry: parsedExpiry, reason: reason.trim() }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      message: 'Subscription expiry updated successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/super-admin/colleges/:id/subscription/features
 * Updates feature overrides on top of the plan
 */
exports.editFeatureOverrides = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { overrides } = req.body;
    const prisma = getSystemClient();

    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ success: false, message: 'Overrides object is required.' });
    }

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    await prisma.college.update({
      where: { id },
      data: {
        feature_overrides: overrides,
        subscription: {
          ...existingSub,
          featureOverrides: overrides
        }
      }
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'UPDATE_FEATURE_OVERRIDES',
        category: 'Subscription',
        resourceType: 'College',
        resourceId: id,
        title: `Updated Feature Overrides for ${college.name}`,
        description: `Super admin updated feature overrides.`,
        metadata: { overrides }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      message: 'Feature overrides updated successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/suspend
 * Suspends college due to expired subscription or administrative reason
 */
exports.suspendCollege = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    await prisma.college.update({
      where: { id },
      data: {
        status: 'suspended',
        subscription_status: 'suspended',
        subscription: {
          ...existingSub,
          status: 'suspended'
        }
      }
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'SUSPEND_COLLEGE',
        category: 'Subscription',
        resourceType: 'College',
        resourceId: id,
        title: `Suspended College ${college.name}`,
        description: `College suspended. Reason: ${reason || 'Subscription suspension'}`,
        metadata: { reason }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      message: 'College suspended successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/reactivate
 * Reactivates college and restores access immediately
 */
exports.reactivateCollege = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, subscription: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    const existingSub = (college.subscription && typeof college.subscription === 'object') ? college.subscription : {};
    await prisma.college.update({
      where: { id },
      data: {
        status: 'active',
        subscription_status: 'active',
        grace_until: null,
        subscription: {
          ...existingSub,
          status: 'active'
        }
      }
    });

    clearEntitlementCache(id);

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'REACTIVATE_COLLEGE',
        category: 'Subscription',
        resourceType: 'College',
        resourceId: id,
        title: `Reactivated College ${college.name}`,
        description: 'College access restored immediately.'
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      message: 'College reactivated successfully.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/messages
 * Sends in-app notice and/or email to college admin and/or principal
 */
exports.sendMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subject, message, channel = 'both', recipients = 'admin' } = req.body;
    const prisma = getSystemClient();

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Subject and message are required.' });
    }

    const college = await prisma.college.findUnique({
      where: { id },
      select: { id: true, name: true, email: true }
    });

    if (!college) {
      return res.status(404).json({ success: false, message: 'College not found' });
    }

    // Determine target roles
    let targetRoles = [];
    if (recipients === 'admin') targetRoles = ['admin'];
    else if (recipients === 'principal') targetRoles = ['principal'];
    else targetRoles = ['admin', 'principal'];

    const targetUsers = await prisma.user.findMany({
      where: {
        college_id: id,
        role: { in: targetRoles },
        isActive: true
      },
      select: { id: true, name: true, email: true, role: true }
    });

    const deliveries = [];
    let announcementId = null;

    // 1. In-App Announcement (restricted to admin/principal audience only)
    if (channel === 'in_app' || channel === 'both') {
      const audienceMap = {
        admin: 'Admin',
        principal: 'Principal',
        both: 'Admin & Principal'
      };

      const announcement = await prisma.announcement.create({
        data: {
          college_id: id,
          title: subject,
          content: message,
          category: 'Administration',
          audience: audienceMap[recipients] || 'Admin',
          priority: 'High',
          status: 'Published',
          isPublic: false,
          createdBy: req.user?.id || null
        }
      });
      announcementId = announcement.id;

      // Track in-app delivery per user
      for (const u of targetUsers) {
        const d = await prisma.messageDelivery.create({
          data: {
            college_id: id,
            announcement_id: announcementId,
            recipient_user_id: u.id,
            recipient_email: u.email,
            recipient_role: u.role,
            subject,
            content: message,
            channel: 'in_app',
            status: 'sent',
            sent_at: new Date()
          }
        });
        deliveries.push(d);
      }
    }

    // 2. Email Delivery (through mailService)
    if (channel === 'email' || channel === 'both') {
      const emailRecipients = [...targetUsers];
      // If no admin user found in DB, fallback to college email
      if (emailRecipients.length === 0 && college.email) {
        emailRecipients.push({
          id: 'college_primary',
          name: college.name,
          email: college.email,
          role: 'admin'
        });
      }

      for (const u of emailRecipients) {
        const emailHtml = mailService.buildCollegeshubTemplate({
          title: subject,
          bodyHtml: `
            <p style="margin-bottom: 16px;">Dear ${u.name || 'College Administration'},</p>
            <div style="background-color: #F8FAFC; border-left: 4px solid #0A4D94; padding: 14px 18px; margin-bottom: 18px; border-radius: 4px; font-size: 14px; line-height: 1.6; color: #1E293B;">
              ${message.replace(/\n/g, '<br/>')}
            </div>
            <p style="font-size: 13px; color: #64748B;">This is an administrative communication regarding your college portal on Collegeshub.</p>
          `,
          footerNote: 'Collegeshub Platform Administration'
        });

        const sendRes = await mailService.send({
          to: u.email,
          subject: `[Collegeshub] ${subject}`,
          html: emailHtml,
          text: `${subject}\n\n${message}\n\n- Collegeshub Platform Administration`
        });

        const d = await prisma.messageDelivery.create({
          data: {
            college_id: id,
            announcement_id: announcementId,
            recipient_user_id: u.id,
            recipient_email: u.email,
            recipient_role: u.role,
            subject,
            content: message,
            channel: 'email',
            status: sendRes.success ? 'sent' : 'failed',
            error: sendRes.error || null,
            sent_at: sendRes.success ? new Date() : null
          }
        });
        deliveries.push(d);
      }
    }

    try {
      await logActivity({
        college_id: id,
        actorUser: req.user,
        action: 'SEND_ADMIN_MESSAGE',
        category: 'Communication',
        resourceType: 'MessageDelivery',
        resourceId: id,
        title: `Sent Message to ${college.name}`,
        description: `Subject: "${subject}". Channel: ${channel}. Recipients: ${recipients}.`,
        metadata: { subject, channel, recipients, deliveryCount: deliveries.length }
      });
    } catch (e) {
      console.error('Activity log error:', e.message);
    }

    res.json({
      success: true,
      message: 'Message delivered successfully.',
      data: {
        deliveriesCount: deliveries.length,
        deliveries
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/super-admin/colleges/:id/messages
 * Retrieves message delivery history for a college
 */
exports.getMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const deliveries = await prisma.messageDelivery.findMany({
      where: { college_id: id },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: deliveries
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/super-admin/colleges/:id/messages/:deliveryId/retry
 * Retries a failed email message delivery
 */
exports.retryMessageDelivery = async (req, res, next) => {
  try {
    const { id, deliveryId } = req.params;
    const prisma = getSystemClient();

    const delivery = await prisma.messageDelivery.findUnique({
      where: { id: deliveryId }
    });

    if (!delivery || delivery.college_id !== id) {
      return res.status(404).json({ success: false, message: 'Message delivery record not found.' });
    }

    if (delivery.channel !== 'email') {
      return res.status(400).json({ success: false, message: 'Only email deliveries can be retried.' });
    }

    const emailHtml = mailService.buildCollegeshubTemplate({
      title: delivery.subject || 'Administrative Notice',
      bodyHtml: `
        <div style="background-color: #F8FAFC; border-left: 4px solid #0A4D94; padding: 14px 18px; margin-bottom: 18px; border-radius: 4px; font-size: 14px; line-height: 1.6; color: #1E293B;">
          ${(delivery.content || '').replace(/\n/g, '<br/>')}
        </div>
        <p style="font-size: 13px; color: #64748B;">This is a resent administrative communication regarding your college portal on Collegeshub.</p>
      `,
      footerNote: 'Collegeshub Platform Administration'
    });

    const sendRes = await mailService.send({
      to: delivery.recipient_email,
      subject: `[Collegeshub] ${delivery.subject}`,
      html: emailHtml,
      text: `${delivery.subject}\n\n${delivery.content}`
    });

    const updated = await prisma.messageDelivery.update({
      where: { id: deliveryId },
      data: {
        status: sendRes.success ? 'sent' : 'failed',
        error: sendRes.error || null,
        sent_at: sendRes.success ? new Date() : delivery.sent_at
      }
    });

    res.json({
      success: sendRes.success,
      data: updated,
      message: sendRes.success ? 'Message redelivered successfully.' : `Retry failed: ${sendRes.error}`
    });
  } catch (error) {
    next(error);
  }
};
