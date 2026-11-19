'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');
const { getFrontendBaseUrl } = require('../config/env');
const { TRIAL_DAYS, TRIAL_ENTITLEMENT_PLAN } = require('../config/trialConfig');
const { generateToken: generateSecureToken, hashToken } = require('../utils/token');
const generateJwt = require('../utils/generateToken');
const {
  sendInvitationEmail,
  sendInvitationRenewalRequestEmail
} = require('../services/mailService');

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const RENEWAL_REQUEST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// Helper to create audit log
const createAuditLog = async (prisma, { userId, collegeId, action, details, req }) => {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId || 'system',
        college_id: collegeId || null,
        action,
        details,
        ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress) : null,
        userAgent: req ? req.headers['user-agent'] : null
      }
    });
  } catch (e) {
    console.error('AuditLog creation failed:', e.message);
  }
};

function sanitizeInvitation(inv) {
  if (!inv) return null;
  const { tokenHash, ...rest } = inv;
  return {
    ...rest,
    _id: inv.id
  };
}

function buildInvitationUrl(rawToken) {
  return `${getFrontendBaseUrl()}/register/invitation/${rawToken}`;
}

/**
 * Resolve and classify an invitation token without mutating DB state.
 * Keeps GET verification idempotent so email security scanners cannot burn a link.
 */
async function resolveInvitationState(prisma, rawToken) {
  const cleanToken = typeof rawToken === 'string' ? rawToken.trim().toLowerCase() : '';
  if (!cleanToken || !/^[a-f0-9]{64}$/.test(cleanToken)) {
    return { state: 'invalid', message: 'This invitation link is invalid or malformed.' };
  }

  let tokenHash;
  try {
    tokenHash = hashToken(cleanToken);
  } catch {
    return { state: 'invalid', message: 'This invitation link is invalid.' };
  }

  const invitation = await prisma.collegeInvitation.findUnique({ where: { tokenHash } });
  if (!invitation) {
    return { state: 'invalid', message: 'This invitation link is invalid or no longer exists.' };
  }

  if (invitation.status === 'accepted' || invitation.acceptedAt) {
    return {
      state: 'used',
      invitation,
      message: 'This invitation link has already been used to create an institution workspace. Please log in to continue.'
    };
  }

  if (invitation.status === 'cancelled') {
    return {
      state: 'invalid',
      reason: 'cancelled',
      invitation,
      message: 'This invitation link was cancelled by an administrator.'
    };
  }

  if (invitation.status === 'expired' || new Date() > new Date(invitation.expiresAt)) {
    return {
      state: 'expired',
      invitation,
      message: 'This invitation link has expired. You can request a new invitation below.'
    };
  }

  if (invitation.status !== 'pending') {
    return {
      state: 'invalid',
      invitation,
      message: 'This invitation link is no longer active.'
    };
  }

  return { state: 'valid', invitation, tokenHash };
}

// ── Super Admin: Send College Invitation (NO plan pre-selected) ───────────
exports.inviteCollege = async (req, res, next) => {
  try {
    const { email, collegeName } = req.body;
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const cleanCollegeName = typeof collegeName === 'string' && collegeName.trim()
      ? collegeName.trim().slice(0, 160)
      : null;

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: 'Valid official college email is required.' });
    }

    const prisma = getSystemClient();

    // 1. Check if email already registered as user or college
    const existingCollege = await prisma.college.findUnique({ where: { email: cleanEmail } });
    if (existingCollege) {
      return res.status(400).json({ success: false, message: 'A college with this email is already registered.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'A user account with this email address already exists.' });
    }

    // 2. Prevent duplicate active pending invitations for the same email
    const activeInvite = await prisma.collegeInvitation.findFirst({
      where: {
        email: cleanEmail,
        status: 'pending',
        expiresAt: { gt: new Date() }
      }
    });
    if (activeInvite) {
      return res.status(400).json({
        success: false,
        message: 'An active pending invitation already exists for this email address. Please resend or cancel the existing invitation.'
      });
    }

    // 3. Generate cryptographically secure token + SHA-256 hash & 48h expiration
    const { token, hash: tokenHash } = generateSecureToken(32);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // 4. Store invitation in DB (hash only, no planId)
    const invitation = await prisma.collegeInvitation.create({
      data: {
        email: cleanEmail,
        collegeName: cleanCollegeName,
        tokenHash,
        status: 'pending',
        invitedBy: req.user.id,
        expiresAt
      }
    });

    // 5. Log audit event
    await createAuditLog(prisma, {
      userId: req.user.id,
      action: 'INVITATION_SENT',
      details: `Invited college ${cleanEmail}${cleanCollegeName ? ` (${cleanCollegeName})` : ''}`,
      req
    });

    const inviteUrl = buildInvitationUrl(token);

    // 6. Send invitation email — fail loudly so the admin knows delivery failed
    try {
      await sendInvitationEmail(cleanEmail, {
        inviteUrl,
        expiresAt,
        collegeName: cleanCollegeName,
        invitationId: invitation.id
      });
    } catch (emailError) {
      return res.status(500).json({
        success: false,
        message: 'Invitation record created but email delivery failed. Please check the server email configuration and resend the invitation.',
        data: {
          invitation: sanitizeInvitation(invitation),
          inviteUrl
        }
      });
    }

    return res.status(201).json({
      success: true,
      message: `Invitation successfully sent to ${cleanEmail}`,
      data: {
        invitation: sanitizeInvitation(invitation),
        inviteUrl
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Super Admin: List All Invitations ───────────────────────────────────
exports.getInvitations = async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const prisma = getSystemClient();

    // Auto-update expired invitations
    await prisma.collegeInvitation.updateMany({
      where: {
        status: 'pending',
        expiresAt: { lte: new Date() }
      },
      data: { status: 'expired' }
    });

    const where = {};
    if (status) where.status = status;
    if (search) {
      const q = search.trim();
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { collegeName: { contains: q, mode: 'insensitive' } }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 20;
    const skipNum = (pageNum - 1) * limitNum;

    const [total, invitations] = await Promise.all([
      prisma.collegeInvitation.count({ where }),
      prisma.collegeInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: skipNum,
        take: limitNum
      })
    ]);

    return res.json({
      success: true,
      data: invitations.map(sanitizeInvitation),
      pagination: {
        total,
        page: pageNum,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Super Admin: Resend Invitation ──────────────────────────────────────
exports.resendInvitation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const invitation = await prisma.collegeInvitation.findUnique({ where: { id } });
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    if (invitation.status === 'accepted' || invitation.acceptedAt) {
      return res.status(400).json({ success: false, message: 'This invitation has already been accepted and completed.' });
    }

    const { token: newToken, hash: newTokenHash } = generateSecureToken(32);
    const newExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const updated = await prisma.collegeInvitation.update({
      where: { id },
      data: {
        tokenHash: newTokenHash,
        expiresAt: newExpiresAt,
        status: 'pending',
        renewalRequestedAt: null
      }
    });

    await createAuditLog(prisma, {
      userId: req.user.id,
      action: 'INVITATION_RESENT',
      details: `Resent invitation to ${updated.email}`,
      req
    });

    const inviteUrl = buildInvitationUrl(newToken);

    try {
      await sendInvitationEmail(updated.email, {
        inviteUrl,
        expiresAt: newExpiresAt,
        collegeName: updated.collegeName,
        invitationId: updated.id
      });
    } catch (emailError) {
      return res.status(500).json({
        success: false,
        message: 'Token refreshed in database but email delivery failed. Please check the server email configuration.',
        data: {
          invitation: sanitizeInvitation(updated),
          inviteUrl
        }
      });
    }

    return res.json({
      success: true,
      message: `Invitation resent to ${updated.email}`,
      data: {
        invitation: sanitizeInvitation(updated),
        inviteUrl
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Super Admin: Cancel Invitation (Soft Cancel) ───────────────────────
exports.cancelInvitation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const prisma = getSystemClient();

    const invitation = await prisma.collegeInvitation.findUnique({ where: { id } });
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found.' });
    }

    if (invitation.status === 'accepted' || invitation.acceptedAt) {
      return res.status(400).json({ success: false, message: 'Cannot cancel an accepted invitation.' });
    }

    const cancelled = await prisma.collegeInvitation.update({
      where: { id },
      data: { status: 'cancelled' }
    });

    await createAuditLog(prisma, {
      userId: req.user.id,
      action: 'INVITATION_CANCELLED',
      details: `Cancelled invitation for ${cancelled.email}`,
      req
    });

    return res.json({
      success: true,
      message: 'Invitation cancelled successfully.',
      data: sanitizeInvitation(cancelled)
    });
  } catch (error) {
    next(error);
  }
};

// ── Public: Verify Invitation Token (Read-Only, Idempotent) ─────────────
exports.verifyInvitationToken = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const resolved = await resolveInvitationState(prisma, req.params.token);

    if (resolved.state !== 'valid') {
      return res.status(200).json({
        success: false,
        valid: false,
        state: resolved.state,
        message: resolved.message,
        canRequestNew: resolved.state === 'expired',
        expiresAt: resolved.invitation?.expiresAt || null
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      state: 'valid',
      data: {
        email: resolved.invitation.email,
        collegeName: resolved.invitation.collegeName || null,
        expiresAt: resolved.invitation.expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Public: Request a New Invitation (for expired links) ────────────────
exports.requestNewInvitation = async (req, res, next) => {
  try {
    const { token, email } = req.body || {};
    const prisma = getSystemClient();

    let invitation = null;
    if (token && typeof token === 'string') {
      const resolved = await resolveInvitationState(prisma, token);
      if (resolved.state === 'valid') {
        return res.status(400).json({
          success: false,
          state: 'valid',
          message: 'Your current invitation link is still active. Please complete your registration.'
        });
      }
      if (resolved.state === 'used') {
        return res.status(400).json({
          success: false,
          state: 'used',
          message: 'This invitation has already been used. Please log in instead.'
        });
      }
      if (resolved.invitation) {
        invitation = resolved.invitation;
      }
    }

    if (!invitation && email && typeof email === 'string') {
      const cleanEmail = email.trim().toLowerCase();
      invitation = await prisma.collegeInvitation.findFirst({
        where: { email: cleanEmail },
        orderBy: { createdAt: 'desc' }
      });
      if (invitation && (invitation.status === 'accepted' || invitation.acceptedAt)) {
        return res.status(400).json({
          success: false,
          state: 'used',
          message: 'An account has already been created with this email. Please log in instead.'
        });
      }
    }

    if (!invitation) {
      // Generic message to prevent email enumeration
      return res.status(200).json({
        success: true,
        message: 'If an expired invitation exists for this request, the CollegesHub team has been notified.'
      });
    }

    if (
      invitation.renewalRequestedAt &&
      Date.now() - new Date(invitation.renewalRequestedAt).getTime() < RENEWAL_REQUEST_COOLDOWN_MS
    ) {
      return res.status(200).json({
        success: true,
        alreadyRequested: true,
        message: 'A new invitation request was already sent recently. Our team will resend your link shortly.'
      });
    }

    const now = new Date();
    await prisma.collegeInvitation.update({
      where: { id: invitation.id },
      data: {
        status: invitation.status === 'pending' && now > new Date(invitation.expiresAt) ? 'expired' : invitation.status,
        renewalRequestedAt: now
      }
    });

    await createAuditLog(prisma, {
      userId: 'public',
      action: 'INVITATION_RENEWAL_REQUESTED',
      details: `Renewal requested for expired invitation ${invitation.email}`,
      req
    });

    // Notify Super Admins (in-app + email)
    try {
      const superAdmins = await prisma.user.findMany({
        where: { role: 'superAdmin', isActive: true },
        select: { id: true, email: true }
      });

      const adminPanelUrl = `${getFrontendBaseUrl()}/super-admin/colleges`;

      if (superAdmins.length > 0) {
        await prisma.notification.createMany({
          data: superAdmins.map(sa => ({
            college_id: 'SYSTEM',
            recipient: sa.id,
            title: 'New College Invitation Requested',
            message: `${invitation.email}${invitation.collegeName ? ` (${invitation.collegeName})` : ''} requested a new invitation link after expiry.`,
            type: 'system',
            link: '/super-admin/colleges'
          }))
        }).catch(() => {});
      }

      const notifyTarget = process.env.SUPER_ADMIN_EMAIL || superAdmins[0]?.email;
      if (notifyTarget) {
        await sendInvitationRenewalRequestEmail(notifyTarget, {
          email: invitation.email,
          collegeName: invitation.collegeName,
          requestedAt: now,
          adminPanelUrl
        }).catch(err => console.error('[InviteRenewal] Email notify failed:', err.message));
      }
    } catch (notifyErr) {
      console.error('[InviteRenewal] Notification error:', notifyErr.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Your request for a new invitation link has been sent to the CollegesHub team.'
    });
  } catch (error) {
    next(error);
  }
};

// ── Public: Accept Invitation & Create Admin Account (14-Day Trial) ──────
exports.acceptInvitation = async (req, res, next) => {
  try {
    const { token, name, designation, collegeName, password } = req.body;
    if (!token || !name || !password) {
      return res.status(400).json({ success: false, message: 'Name, password, and invitation token are required.' });
    }
    if (String(name).trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters long.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    const prisma = getSystemClient();

    // 1. Verify invitation
    const resolved = await resolveInvitationState(prisma, token);
    if (resolved.state !== 'valid') {
      return res.status(resolved.state === 'used' ? 409 : 400).json({
        success: false,
        state: resolved.state,
        message: resolved.message
      });
    }
    const invitation = resolved.invitation;

    // 2. Check existing college or user (guard against duplicate registration)
    const [existingCollege, existingUser] = await Promise.all([
      prisma.college.findUnique({ where: { email: invitation.email } }),
      prisma.user.findUnique({ where: { email: invitation.email.toLowerCase() } })
    ]);
    if (existingCollege || existingUser) {
      return res.status(409).json({
        success: false,
        state: 'used',
        message: 'An account for this institution already exists. Please log in.'
      });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const cleanName = String(name).trim();
    const resolvedCollegeName =
      (typeof collegeName === 'string' && collegeName.trim()) ||
      invitation.collegeName ||
      `${cleanName}'s Institution`;

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const tempCode = `COL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const dbUrl = process.env.DATABASE_URL || '';

    // 3. Atomic transaction: consume invite + create college in TRIAL + create admin user
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const consumed = await tx.collegeInvitation.updateMany({
          where: {
            id: invitation.id,
            status: 'pending',
            acceptedAt: null,
            expiresAt: { gt: now }
          },
          data: {
            status: 'accepted',
            acceptedAt: now
          }
        });

        if (consumed.count === 0) {
          throw Object.assign(new Error('INVITE_ALREADY_CONSUMED'), { code: 'INVITE_ALREADY_CONSUMED' });
        }

        const cleanDesignation = typeof designation === 'string' && designation.trim()
          ? designation.trim().slice(0, 80)
          : 'Principal';

        const college = await tx.college.create({
          data: {
            name: resolvedCollegeName,
            code: tempCode,
            email: invitation.email,
            mongoUrl: dbUrl,
            status: 'onboarding',
            onboardingStatus: 'registered',
            onboardingStep: 1,
            onboarding_state: { adminDesignation: cleanDesignation },
            planId: TRIAL_ENTITLEMENT_PLAN,
            subStatus: 'TRIAL',
            trialStartedAt: now,
            trialEndsAt,
            subscription: {
              plan: TRIAL_ENTITLEMENT_PLAN,
              status: 'trial',
              trialStartedAt: now.toISOString(),
              trialEndsAt: trialEndsAt.toISOString()
            }
          }
        });

        const adminUser = await tx.user.create({
          data: {
            name: cleanName,
            email: invitation.email.toLowerCase(),
            password: hashedPassword,
            role: 'admin',
            college_id: college.id,
            emailVerified: true,
            authProvider: 'local'
          }
        });

        await tx.collegeInvitation.update({
          where: { id: invitation.id },
          data: { collegeId: college.id }
        });

        return { college, adminUser };
      });
    } catch (txErr) {
      if (txErr.code === 'INVITE_ALREADY_CONSUMED') {
        return res.status(409).json({
          success: false,
          state: 'used',
          message: 'This invitation link has already been used. Please log in to continue.'
        });
      }
      throw txErr;
    }

    const { college, adminUser } = result;

    // 4. Audit Log
    await createAuditLog(prisma, {
      userId: adminUser.id,
      collegeId: college.id,
      action: 'INVITATION_ACCEPTED',
      details: `College admin ${adminUser.email} accepted invitation and started ${TRIAL_DAYS}-day free trial`,
      req
    });

    // 5. Issue JWT using canonical generateToken ({ userId, college_id, role, tokenEpoch })
    const authToken = generateJwt(adminUser.id, college.id, adminUser.role, college.tokenEpoch || 0);

    res.cookie('academix_token', authToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    const collegePayload = {
      ...college,
      _id: college.id,
      daysRemaining: TRIAL_DAYS
    };

    return res.status(201).json({
      success: true,
      message: 'Invitation accepted successfully! Your 14-day free trial has started.',
      token: authToken,
      data: {
        user: {
          _id: adminUser.id,
          id: adminUser.id,
          name: adminUser.name,
          email: adminUser.email,
          role: adminUser.role,
          emailVerified: true,
          email_verified: true,
          college_id: college.id,
          college: collegePayload
        },
        college: collegePayload
      }
    });
  } catch (error) {
    next(error);
  }
};
