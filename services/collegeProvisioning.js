'use strict';

const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { isValidSlug, isReservedSlug, normalizeSlug } = require('../utils/reservedSlugs');
const { generateToken } = require('../utils/token');
const { PLAN_FEATURES } = require('../config/planConstants');
const { ROOT_DOMAIN } = require('../config/env');
const mailService = require('./mailService');
const { logActivity } = require('./activityLog.service');

/**
 * Check subdomain slug availability.
 * @param {string} rawSlug
 * @returns {Promise<{ available: boolean, reason?: string, slug?: string }>}
 */
async function checkSlugAvailability(rawSlug) {
  if (!rawSlug || typeof rawSlug !== 'string') {
    return { available: false, reason: 'Subdomain slug is required' };
  }

  const slug = rawSlug.trim().toLowerCase();

  if (slug.length < 3) {
    return { available: false, reason: 'Subdomain must be at least 3 characters long', slug };
  }
  if (slug.length > 30) {
    return { available: false, reason: 'Subdomain cannot exceed 30 characters', slug };
  }
  if (isReservedSlug(slug)) {
    return { available: false, reason: `Subdomain '${slug}' is reserved for platform infrastructure`, slug };
  }
  if (!isValidSlug(slug)) {
    return { available: false, reason: 'Invalid format. Use lowercase letters, numbers, and hyphens only (cannot start or end with a hyphen)', slug };
  }

  const prisma = getSystemClient();
  const existing = await prisma.college.findFirst({
    where: {
      OR: [
        { slug: { equals: slug, mode: 'insensitive' } },
        { code: { equals: slug.toUpperCase(), mode: 'insensitive' } }
      ]
    },
    select: { id: true, name: true, slug: true }
  });

  if (existing) {
    return { available: false, reason: `Subdomain '${slug}' is already taken by another institution`, slug };
  }

  return { available: true, slug };
}

/**
 * Build setup / invite URL for tenant subdomain.
 */
function buildSetupUrl(slug, token) {
  if (process.env.NODE_ENV === 'development' || !ROOT_DOMAIN.includes('.')) {
    return `http://${slug}.localhost:3000/setup/${token}`;
  }
  return `https://${slug}.${ROOT_DOMAIN}/setup/${token}`;
}

/**
 * Send branded college invitation email.
 */
async function sendInviteEmail({ toEmail, collegeName, slug, token, expiresAt }) {
  const setupUrl = buildSetupUrl(slug, token);
  const formattedExpiry = new Date(expiresAt).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const subject = `Welcome to Collegeshub — Set up your ${collegeName} workspace`;

  const bodyHtml = `
    <p>Dear Administrator,</p>
    <p>We are delighted to inform you that your subscription request for <strong>${collegeName}</strong> has been approved!</p>
    <p>Your dedicated campus subdomain is configured and ready: <strong style="color:#0A4D94;">${slug}.${ROOT_DOMAIN}</strong></p>
    <p>Please click the button below to complete your administrator account setup and begin customizing your portal:</p>
    <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 18px;margin:24px 0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        ⏳ <strong>Security Notice:</strong> This single-use setup link will expire on <strong>${formattedExpiry}</strong> (7 days from issue).
      </p>
    </div>
  `;

  const html = mailService.buildCollegeshubTemplate({
    title: 'Your College Workspace is Ready 🎉',
    bodyHtml,
    buttonText: 'Complete College Setup',
    buttonUrl: setupUrl,
    footerNote: 'Need assistance? Contact Collegeshub Support at support@collegeshub.org'
  });

  const text = mailService.toPlainText({
    title: 'Your College Workspace is Ready',
    bodyText: `Dear Administrator,\n\nYour subscription request for ${collegeName} has been approved!\nYour subdomain: ${slug}.${ROOT_DOMAIN}\n\nComplete your setup by opening this link within 7 days:\n${setupUrl}\n\nLink expires: ${formattedExpiry}`,
    buttonText: 'Setup URL',
    buttonUrl: setupUrl,
    footerNote: 'Collegeshub Platform Support: support@collegeshub.org'
  });

  return await mailService.send({
    to: toEmail,
    subject,
    html,
    text
  });
}

/**
 * Approve a subscription request and provision college with its subdomain and invite.
 */
async function approveAndProvisionCollege({
  requestId,
  collegeName,
  slug,
  adminEmail,
  plan = 'standard',
  features = null,
  startsAt = null,
  expiresAt = null,
  actorUser
}) {
  const prisma = getSystemClient();

  // Validate slug availability first
  const slugCheck = await checkSlugAvailability(slug);
  if (!slugCheck.available) {
    const err = new Error(slugCheck.reason);
    err.statusCode = 400;
    throw err;
  }

  const cleanSlug = slugCheck.slug;
  const targetPlan = (plan || 'standard').toLowerCase();
  const effectiveFeatures = Array.isArray(features) && features.length > 0 
    ? features 
    : (PLAN_FEATURES[targetPlan] || PLAN_FEATURES.standard);

  const startDate = startsAt ? new Date(startsAt) : new Date();
  const expiryDate = expiresAt 
    ? new Date(expiresAt) 
    : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year default

  // Generate 32-byte secure token (raw token is sent only in email)
  const { token: rawToken, hash: tokenHash } = generateToken(32);
  const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  let provisionedData = null;

  // Execute in ONE atomic transaction
  await prisma.$transaction(async (tx) => {
    // 1. Check subscription request
    const request = await tx.subscriptionRequest.findUnique({
      where: { id: requestId }
    });

    if (!request) {
      const err = new Error('Subscription request not found');
      err.statusCode = 404;
      throw err;
    }

    // Idempotency: if already approved, return existing details
    if (request.status === 'approved') {
      const existingCollege = await tx.college.findFirst({
        where: {
          OR: [{ slug: cleanSlug }, { email: adminEmail || request.adminEmail }]
        }
      });
      provisionedData = {
        idempotent: true,
        request,
        college: existingCollege
      };
      return;
    }

    // Transition rule: can only approve from 'contacted' (or 'new' if requested)
    if (request.status !== 'contacted' && request.status !== 'new') {
      const err = new Error(`Cannot approve request in '${request.status}' status. Request must be in 'contacted' or 'new' state.`);
      err.statusCode = 409;
      throw err;
    }

    const collegeId = crypto.randomUUID();
    const finalCollegeName = (collegeName || request.collegeName).trim();
    const finalAdminEmail = (adminEmail || request.adminEmail).toLowerCase().trim();
    const finalPhone = request.phone;
    const finalCode = cleanSlug.toUpperCase();

    // 2. Create College row in 'pending_setup' status
    const newCollege = await tx.college.create({
      data: {
        id: collegeId,
        name: finalCollegeName,
        code: finalCode,
        slug: cleanSlug,
        status: 'pending_setup',
        email: finalAdminEmail,
        phone: finalPhone,
        subscription: {
          plan: targetPlan,
          status: 'active',
          features: effectiveFeatures,
          startedAt: startDate.toISOString(),
          expiresAt: expiryDate.toISOString(),
          featureOverrides: {}
        },
        settings: {
          tagline: `Welcome to ${finalCollegeName}`,
          bio: 'Institution profile under initial setup.'
        },
        onboardingStatus: 'pending_invite',
        onboardingStep: 1,
        isActive: true
      }
    });

    // 3. Create initial SubscriptionPeriod row (reusable by Phase 9)
    const periodId = crypto.randomUUID();
    await tx.subscriptionPeriod.create({
      data: {
        id: periodId,
        college_id: collegeId,
        plan: targetPlan,
        features: effectiveFeatures,
        starts_at: startDate,
        expires_at: expiryDate,
        status: 'active',
        created_by: actorUser?.id || null,
        reason: 'Initial subscription period created upon request approval'
      }
    });

    // 4. Create single-use invite record
    const inviteId = crypto.randomUUID();
    const invite = await tx.collegeInvite.create({
      data: {
        id: inviteId,
        college_id: collegeId,
        email: finalAdminEmail,
        token_hash: tokenHash,
        expires_at: inviteExpiry,
        email_status: 'queued',
        created_by: actorUser?.id || null
      }
    });

    // 5. Update subscription request status to 'approved'
    const updatedRequest = await tx.subscriptionRequest.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: actorUser?.name || actorUser?.email || 'Super Admin'
      }
    });

    // 6. Record timeline event
    await tx.subscriptionRequestEvent.create({
      data: {
        id: crypto.randomUUID(),
        request_id: requestId,
        type: 'status_approved',
        from_status: request.status,
        to_status: 'approved',
        note: `Approved by ${actorUser?.name || 'Super Admin'}. Provisioned college '${finalCollegeName}' at ${cleanSlug}.${ROOT_DOMAIN}.`,
        actor_id: actorUser?.id || null,
        actor_name: actorUser?.name || actorUser?.email || 'Super Admin'
      }
    });

    // 7. Activity Log
    try {
      await logActivity({
        actorUser,
        action: 'COLLEGE_PROVISION_APPROVED',
        category: 'SUPER_ADMIN',
        resourceType: 'College',
        resourceId: collegeId,
        title: `College "${finalCollegeName}" provisioned`,
        description: `Approved subscription request and provisioned subdomain ${cleanSlug}.${ROOT_DOMAIN}`,
        metadata: {
          requestId,
          slug: cleanSlug,
          plan: targetPlan,
          adminEmail: finalAdminEmail
        }
      });
    } catch (logErr) {
      console.warn('[ActivityLog] Approval log error:', logErr.message);
    }

    provisionedData = {
      idempotent: false,
      college: newCollege,
      request: updatedRequest,
      invite,
      rawToken
    };
  });

  if (provisionedData.idempotent) {
    return {
      success: true,
      message: 'Subscription request is already approved.',
      college: provisionedData.college,
      request: provisionedData.request,
      idempotent: true
    };
  }

  // After transaction commits: send the invite email asynchronously
  try {
    const sendRes = await sendInviteEmail({
      toEmail: provisionedData.college.email,
      collegeName: provisionedData.college.name,
      slug: cleanSlug,
      token: provisionedData.rawToken,
      expiresAt: inviteExpiry
    });

    await prisma.collegeInvite.update({
      where: { id: provisionedData.invite.id },
      data: {
        email_status: sendRes.success ? 'sent' : 'failed',
        email_error: sendRes.success ? null : (sendRes.error || 'Failed to dispatch email')
      }
    });
  } catch (emailErr) {
    console.error('[CollegeProvisioning] Post-commit email dispatch failed:', emailErr.message);
    await prisma.collegeInvite.update({
      where: { id: provisionedData.invite.id },
      data: {
        email_status: 'failed',
        email_error: emailErr.message
      }
    }).catch(() => {});
  }

  return {
    success: true,
    message: `College "${provisionedData.college.name}" approved and provisioned with subdomain ${cleanSlug}.${ROOT_DOMAIN}.`,
    college: provisionedData.college,
    request: provisionedData.request,
    subdomainUrl: `https://${cleanSlug}.${ROOT_DOMAIN}`
  };
}

/**
 * Resend invite email: revokes old valid invite and creates a new one.
 */
async function resendCollegeInvite({ collegeId, actorUser }) {
  const prisma = getSystemClient();

  const college = await prisma.college.findUnique({
    where: { id: collegeId },
    select: { id: true, name: true, slug: true, email: true, status: true }
  });

  if (!college) {
    const err = new Error('College not found');
    err.statusCode = 404;
    throw err;
  }

  const { token: rawToken, hash: tokenHash } = generateToken(32);
  const inviteExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await prisma.$transaction(async (tx) => {
    // Revoke previous unused invites
    await tx.collegeInvite.updateMany({
      where: {
        college_id: collegeId,
        used_at: null,
        revoked_at: null
      },
      data: {
        revoked_at: new Date()
      }
    });

    // Create new invite
    return await tx.collegeInvite.create({
      data: {
        id: crypto.randomUUID(),
        college_id: collegeId,
        email: college.email,
        token_hash: tokenHash,
        expires_at: inviteExpiry,
        email_status: 'queued',
        created_by: actorUser?.id || null
      }
    });
  });

  // Send email
  const sendRes = await sendInviteEmail({
    toEmail: college.email,
    collegeName: college.name,
    slug: college.slug,
    token: rawToken,
    expiresAt: inviteExpiry
  });

  await prisma.collegeInvite.update({
    where: { id: invite.id },
    data: {
      email_status: sendRes.success ? 'sent' : 'failed',
      email_error: sendRes.success ? null : (sendRes.error || 'Failed to dispatch email')
    }
  });

  return {
    success: true,
    message: sendRes.success
      ? `Invitation resent to ${college.email}`
      : `New invite generated, but email dispatch failed: ${sendRes.error}`,
    emailStatus: sendRes.success ? 'sent' : 'failed'
  };
}

/**
 * Revoke an active invite link for a college.
 */
async function revokeCollegeInvite({ collegeId }) {
  const prisma = getSystemClient();
  const res = await prisma.collegeInvite.updateMany({
    where: {
      college_id: collegeId,
      used_at: null,
      revoked_at: null
    },
    data: {
      revoked_at: new Date()
    }
  });

  return {
    success: true,
    message: res.count > 0 ? 'Active invitation links revoked' : 'No active invitation to revoke'
  };
}

/**
 * Get current invite status for a college.
 */
async function getCollegeInviteStatus(collegeId) {
  const prisma = getSystemClient();
  const invite = await prisma.collegeInvite.findFirst({
    where: { college_id: collegeId },
    orderBy: { created_at: 'desc' }
  });

  if (!invite) {
    return { hasInvite: false };
  }

  let status = 'sent';
  if (invite.used_at) status = 'used';
  else if (invite.revoked_at) status = 'revoked';
  else if (new Date() > new Date(invite.expires_at)) status = 'expired';
  else if (invite.email_status === 'failed') status = 'failed';

  return {
    hasInvite: true,
    status,
    email: invite.email,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at,
    emailStatus: invite.email_status,
    emailError: invite.email_error
  };
}

module.exports = {
  checkSlugAvailability,
  approveAndProvisionCollege,
  resendCollegeInvite,
  revokeCollegeInvite,
  getCollegeInviteStatus
};
