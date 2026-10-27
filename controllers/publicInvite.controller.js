'use strict';

/**
 * Phase 4 — Public Invite Acceptance Controller
 *
 * Handles the two public endpoints for the college admin invite flow:
 *   GET  /public/invites/:token  →  validate invite state (no side effects)
 *   POST /public/invites/:token/accept  →  create admin account + consume invite
 *
 * Security notes:
 * - Token is SHA-256-hashed before DB lookup (raw token only lives in the email URL).
 * - All invalid-state responses return the same generic shape to prevent enumeration.
 * - Invite consumption uses a conditional UPDATE (WHERE used_at IS NULL AND ...) to be
 *   atomic against double-submission races.
 * - Referrer-Policy: no-referrer is set via headers on the /setup frontend page.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');
const { hashToken } = require('../utils/token');
const generateJwt = require('../utils/generateToken');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');
const mailService = require('../services/mailService');

// ── Common password list (top-30 most common; expand as needed) ───────────────
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '123456789', 'iloveyou', 'admin123',
  'letmein', 'welcome1', 'monkey123', 'password!', 'qwerty123',
  '1234567890', 'abc123456', 'qwertyuiop', 'password12', 'test1234',
  'admin1234', 'pass1234', 'p@ssword1', 'passw0rd1', 'superman1',
  'dragon123', 'master123', 'hello1234', 'jordan123', 'shadow123',
  'michael1', 'charlie1', 'donald123', 'password2', 'pakistan1'
]);

/**
 * Resolve a raw token string to a CollegeInvite row, returning a typed result.
 */
async function resolveInvite(prisma, rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 200) {
    return { status: 'invalid' };
  }

  let tokenHash;
  try {
    tokenHash = hashToken(rawToken.trim());
  } catch {
    return { status: 'invalid' };
  }

  const invite = await prisma.collegeInvite.findUnique({
    where: { token_hash: tokenHash },
    include: {
      college: {
        select: { id: true, name: true, slug: true, status: true }
      }
    }
  });

  if (!invite) return { status: 'invalid' };
  if (invite.revoked_at !== null) return { status: 'revoked', invite };
  if (invite.used_at !== null) return { status: 'used', invite };
  if (new Date() > new Date(invite.expires_at)) return { status: 'expired', invite };

  return { status: 'valid', invite, tokenHash };
}

/**
 * GET /public/invites/:token
 * Returns invite state: valid | expired | used | revoked | invalid
 * On valid: returns { collegeName, slug, email }
 */
exports.getInviteStatus = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { status, invite } = await resolveInvite(prisma, req.params.token);

    if (status !== 'valid') {
      return res.status(200).json({
        success: false,
        valid: false,
        reason: status // 'expired' | 'used' | 'revoked' | 'invalid'
      });
    }

    return res.json({
      success: true,
      valid: true,
      data: {
        collegeName: invite.college.name,
        slug: invite.college.slug,
        email: invite.email
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /public/invites/:token/accept
 * Body: { fullName, password, confirmPassword }
 *
 * In ONE transaction:
 *   1. Re-validate invite (constant-time token hash check)
 *   2. Create admin user (email_verified = false)
 *   3. Atomically consume invite (conditional UPDATE guards against races)
 *   4. Set college status → 'onboarding'
 *   5. Generate email verification code → store on user
 *   6. Send verification email (failure does NOT roll back)
 *   7. Log activity
 *   8. Return session token (same shape as login)
 */
exports.acceptInvite = async (req, res, next) => {
  try {
    const { fullName, password, confirmPassword } = req.body;
    const rawToken = req.params.token;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'This password is too common. Please choose a stronger password.' });
    }

    const prisma = getSystemClient();

    // ── Resolve + validate invite ─────────────────────────────────────────────
    const { status, invite, tokenHash } = await resolveInvite(prisma, rawToken);

    if (status !== 'valid') {
      return res.status(400).json({
        success: false,
        message: 'This invite link is invalid, has expired, or has already been used.',
        reason: status
      });
    }

    // ── Tenant slug check (if X-Tenant-Slug header is present) ───────────────
    const tenantSlug = (req.headers['x-tenant-slug'] || '').toLowerCase().trim();
    if (tenantSlug && invite.college.slug && tenantSlug !== invite.college.slug) {
      return res.status(400).json({
        success: false,
        message: 'This invite link does not match the current college subdomain.',
        reason: 'invalid'
      });
    }

    // Password must not equal the email address
    if (password.toLowerCase() === invite.email.toLowerCase()) {
      return res.status(400).json({ success: false, message: 'Password cannot be the same as your email address.' });
    }

    // ── Check for existing user with this email ───────────────────────────────
    const existingUser = await prisma.user.findUnique({
      where: { email: invite.email.toLowerCase() }
    });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
        reason: 'used'
      });
    }

    // ── Generate email verification code (6-digit numeric, 15-minute expiry) ──
    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));
    const verificationExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // ── Hash password ─────────────────────────────────────────────────────────
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // ── Transaction: create user + consume invite + update college status ──────
    let adminUser;
    try {
      adminUser = await prisma.$transaction(async (tx) => {
        // 1. Create admin user (emailVerified = false)
        const newUser = await tx.user.create({
          data: {
            name: fullName.trim(),
            email: invite.email.toLowerCase(),
            password: hashedPassword,
            role: 'admin',
            college_id: invite.college_id,
            emailVerified: false,
            verificationCode,
            verificationCodeExpires: verificationExpiry,
            authProvider: 'local'
          }
        });

        // 2. Atomically consume the invite.
        //    We use updateMany with a WHERE clause so that if a concurrent
        //    request already consumed it, this returns count=0 and we abort.
        const consumeResult = await tx.collegeInvite.updateMany({
          where: {
            id: invite.id,
            used_at: null,
            revoked_at: null,
            expires_at: { gt: new Date() }
          },
          data: { used_at: new Date() }
        });

        if (consumeResult.count === 0) {
          // Another request beat us to it — abort
          throw Object.assign(new Error('INVITE_ALREADY_CONSUMED'), { code: 'INVITE_ALREADY_CONSUMED' });
        }

        // 3. Advance college status: pending_setup → onboarding
        await tx.college.update({
          where: { id: invite.college_id },
          data: { status: 'onboarding' }
        });

        return newUser;
      });
    } catch (txErr) {
      if (txErr.code === 'INVITE_ALREADY_CONSUMED') {
        return res.status(409).json({
          success: false,
          message: 'This invite link has already been used. Please contact Collegeshub support.',
          reason: 'used'
        });
      }
      throw txErr;
    }

    // ── Send verification email (failure does NOT roll back) ──────────────────
    const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
    const verifyUrl = process.env.NODE_ENV === 'development'
      ? `http://${invite.college.slug}.localhost:3000/verify-email`
      : `https://${invite.college.slug}.${rootDomain}/verify-email`;

    const emailHtml = mailService.buildCollegeshubTemplate({
      title: 'Verify your email address',
      preheader: `Your ${invite.college.name} admin account is almost ready`,
      bodyHtml: `
        <p>Hi <strong>${fullName.trim()}</strong>,</p>
        <p>Your admin account for <strong>${invite.college.name}</strong> has been created. 
           Please verify your email address to continue setting up your college workspace.</p>
        <p style="text-align:center;margin:28px 0;">
          <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#ffffff;
                       background:#0A4D94;padding:16px 24px;border-radius:10px;display:inline-block;">
            ${verificationCode}
          </span>
        </p>
        <p>Enter this code on the verification page. It expires in <strong>15 minutes</strong>.</p>
        <p style="font-size:13px;color:#94a3b8;">
          If you did not create this account, please contact 
          <a href="mailto:support@collegeshub.org" style="color:#299A49;">support@collegeshub.org</a>.
        </p>
      `,
      buttonText: 'Go to Verification Page',
      buttonUrl: verifyUrl,
      footerNote: `This code is valid for 15 minutes and can only be used once.`
    });

    const emailText = mailService.toPlainText({
      title: 'Verify your email address',
      bodyText: `Your verification code is: ${verificationCode}\n\nThis code expires in 15 minutes.\n\nVerification page: ${verifyUrl}`,
      footerNote: 'If you did not create this account, contact support@collegeshub.org'
    });

    // Fire-and-forget — log but don't fail
    mailService.send({
      to: invite.email,
      subject: `[Collegeshub] Verify your email — ${invite.college.name}`,
      html: emailHtml,
      text: emailText
    }).then(result => {
      if (!result.success) {
        console.error('[Phase4] Verification email failed:', result.error);
      }
    }).catch(e => console.error('[Phase4] Verification email error:', e.message));

    // ── Activity log ──────────────────────────────────────────────────────────
    logActivity({
      college_id: invite.college_id,
      actorUser: adminUser,
      action: ACTIONS.CREATE || 'INVITE_ACCEPTED',
      category: CATEGORIES.AUTHENTICATION || 'authentication',
      resourceType: 'User',
      resourceId: adminUser.id,
      title: 'College Admin Account Created',
      description: `${fullName.trim()} accepted the invite and created the admin account for ${invite.college.name}. Email verification pending.`
    }).catch(e => console.error('[Phase4] Activity log error:', e.message));

    // ── Issue JWT session (same shape as login) ───────────────────────────────
    const authToken = generateJwt(adminUser.id, invite.college_id, adminUser.role);

    return res.status(201).json({
      success: true,
      message: 'Account created. Please verify your email to continue.',
      data: {
        _id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
        emailVerified: false,
        college: {
          id: invite.college_id,
          name: invite.college.name,
          slug: invite.college.slug,
          status: 'onboarding'
        },
        token: authToken
      }
    });
  } catch (err) {
    next(err);
  }
};
