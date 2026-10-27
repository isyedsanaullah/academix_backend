'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const { generateToken, hashToken } = require('../utils/token');
const { send: sendMail } = require('../services/mailService');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');

const ALLOWED_STAFF_ROLES = ['principal', 'registrar', 'accountant', 'teacher', 'employee'];

// ── GET /admin/onboarding/staff ─────────────────────────────────────────────
exports.getStaffList = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId;

    const staffMembers = await prisma.user.findMany({
      where: {
        college_id: collegeId,
        role: { in: ALLOWED_STAFF_ROLES }
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        emailVerified: true,
        resetCode: true,
        resetCodeExpires: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const formatted = staffMembers.map(u => ({
      id: u.id,
      _id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      phone: u.phone || '',
      status: u.emailVerified && !u.resetCode ? 'active' : 'invited',
      inviteExpiresAt: u.resetCodeExpires,
      isExpired: u.resetCodeExpires ? new Date(u.resetCodeExpires) < new Date() : false,
      createdAt: u.createdAt
    }));

    res.json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

// ── POST /admin/onboarding/staff ────────────────────────────────────────────
exports.createStaff = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const tenantDb = req.tenantClient || prisma;
    const collegeId = req.collegeId;

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { id: true, name: true, slug: true, code: true, onboarding_state: true }
    });
    if (!college) {
      return res.status(404).json({ success: false, message: 'College workspace not found.' });
    }

    // Accepts either a single staff object in body or { staffList: [...] }
    const incomingList = Array.isArray(req.body.staffList)
      ? req.body.staffList
      : [req.body];

    const results = {
      created: [],
      skipped: [],
      failed: []
    };

    const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
    const appUrl = process.env.APP_URL || 'https://collegeshub.org';
    const slug = (college.slug || college.code).toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';

    for (const item of incomingList) {
      const name = (item.name || '').trim();
      const email = (item.email || '').trim().toLowerCase();
      const role = (item.role || 'employee').toLowerCase();
      const phone = (item.phone || '').trim();
      const designation = (item.designation || '').trim();

      if (!name || name.length < 2) {
        results.failed.push({ email: email || 'unknown', reason: 'Full name is required (min 2 chars)' });
        continue;
      }

      if (!email || !email.includes('@')) {
        results.failed.push({ email, name, reason: 'Valid email address is required' });
        continue;
      }

      if (!ALLOWED_STAFF_ROLES.includes(role)) {
        results.failed.push({ email, name, reason: `Role '${role}' is not allowed. Must be one of: ${ALLOWED_STAFF_ROLES.join(', ')}` });
        continue;
      }

      // Check duplicate email
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        results.skipped.push({ email, name, reason: 'Email already registered in system' });
        continue;
      }

      // Generate 32-byte single-use token with 3-day expiry
      const { token: rawToken, hash: tokenHash } = generateToken(32);
      const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

      // Temporary placeholder password (cannot be used directly since user must set password)
      const placeholderHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);

      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          role,
          phone: phone || null,
          password: placeholderHash,
          college_id: collegeId,
          authProvider: 'local',
          emailVerified: false,
          resetCode: tokenHash,
          resetCodeExpires: expiresAt
        }
      });

      // Role profile creation (Teacher or Employee)
      if (role === 'teacher' && tenantDb.teacher) {
        await tenantDb.teacher.create({
          data: {
            user_id: newUser.id,
            college_id: collegeId,
            status: 'active'
          }
        }).catch(() => {});
      } else if (role === 'employee' && tenantDb.employee) {
        await tenantDb.employee.create({
          data: {
            user_id: newUser.id,
            college_id: collegeId,
            designation: designation || 'Staff',
            department: 'Administration',
            status: 'active'
          }
        }).catch(() => {});
      }

      // Build Set-Password URL on tenant subdomain
      const setPasswordUrl = isDev
        ? `http://${slug}.localhost:3000/set-password/${rawToken}`
        : `https://${slug}.${rootDomain}/set-password/${rawToken}`;

      // Dispatch invitation email via mailService wrapper
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff;">
          <div style="margin-bottom: 24px; text-align: center;">
            <h2 style="color: #0A4D94; margin: 0;">Colleges<span style="color: #299A49;">hub</span><span style="color: #299A49; font-size: 14px;">.org</span></h2>
            <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Campus Management Platform</p>
          </div>
          <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background: #f8fafc;">
            <h3 style="color: #0f172a; margin-top: 0;">Welcome to ${college.name}</h3>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
              Hello <strong>${name}</strong>,<br/>
              An administrative account has been created for you as <strong>${role.toUpperCase()}</strong> at <strong>${college.name}</strong>.
            </p>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
              Please click the button below to set your account password and activate your access:
            </p>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${setPasswordUrl}" style="background-color: #0A4D94; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                Set Your Password
              </a>
            </div>
            <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin-bottom: 0;">
              This invitation link is valid for <strong>3 days</strong> and can only be used once.<br/>
              If button doesn't work, copy this link: <a href="${setPasswordUrl}" style="color: #0A4D94;">${setPasswordUrl}</a>
            </p>
          </div>
        </div>
      `;

      try {
        await sendMail({
          to: email,
          subject: `Set your password for ${college.name} — Collegeshub`,
          html: emailHtml,
          text: `Welcome to ${college.name}! Set your password here: ${setPasswordUrl} (Link expires in 3 days)`
        });
      } catch (mailErr) {
        console.error(`Invitation email delivery failed for ${email}:`, mailErr.message);
      }

      results.created.push({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: 'invited'
      });
    }

    // Update onboarding state steps.staff to 'done'
    const existingState = college.onboarding_state || {};
    const updatedState = {
      ...existingState,
      steps: {
        ...(existingState.steps || {}),
        staff: 'done'
      },
      updatedAt: new Date().toISOString()
    };

    await prisma.college.update({
      where: { id: collegeId },
      data: { onboarding_state: updatedState }
    });

    logActivity({
      college_id: collegeId,
      actorUser: req.user,
      action: ACTIONS.USER_CREATED || 'USER_CREATED',
      category: CATEGORIES.ADMINISTRATION || 'Administration',
      resourceType: 'User',
      resourceId: results.created.map(u => u.id).join(','),
      title: 'Staff Accounts Created',
      description: `Created ${results.created.length} staff accounts (${results.skipped.length} skipped, ${results.failed.length} failed).`
    }).catch(e => console.error('Activity log error:', e.message));

    res.json({
      success: true,
      message: `Staff processing finished: ${results.created.length} created, ${results.skipped.length} skipped.`,
      summary: {
        total: incomingList.length,
        created: results.created.length,
        skipped: results.skipped.length,
        failed: results.failed.length
      },
      data: {
        ...results,
        onboarding_state: updatedState
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /admin/onboarding/staff/:userId/resend ─────────────────────────────
exports.resendStaffInvite = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const collegeId = req.collegeId;
    const { userId } = req.params;

    const user = await prisma.user.findFirst({
      where: { id: userId, college_id: collegeId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Staff user not found.' });
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { name: true, slug: true, code: true }
    });

    const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
    const slug = (college.slug || college.code).toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';

    const { token: rawToken, hash: tokenHash } = generateToken(32);
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetCode: tokenHash,
        resetCodeExpires: expiresAt
      }
    });

    const setPasswordUrl = isDev
      ? `http://${slug}.localhost:3000/set-password/${rawToken}`
      : `https://${slug}.${rootDomain}/set-password/${rawToken}`;

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff;">
        <div style="margin-bottom: 24px; text-align: center;">
          <h2 style="color: #0A4D94; margin: 0;">Colleges<span style="color: #299A49;">hub</span><span style="color: #299A49; font-size: 14px;">.org</span></h2>
        </div>
        <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background: #f8fafc;">
          <h3 style="color: #0f172a; margin-top: 0;">New Password Setup Link</h3>
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            Hello <strong>${user.name}</strong>,<br/>
            Here is your new link to set your password for <strong>${college.name}</strong>:
          </p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${setPasswordUrl}" style="background-color: #0A4D94; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
              Set Your Password
            </a>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Valid for 3 days. Link: ${setPasswordUrl}</p>
        </div>
      </div>
    `;

    await sendMail({
      to: user.email,
      subject: `New password setup link for ${college.name}`,
      html: emailHtml,
      text: `Set your password for ${college.name}: ${setPasswordUrl}`
    }).catch(e => console.error('Resend email error:', e.message));

    res.json({
      success: true,
      message: `Invitation email resent to ${user.email}.`
    });
  } catch (error) {
    next(error);
  }
};

// ── GET /public/set-password/:token ─────────────────────────────────────────
exports.getSetPasswordStatus = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { token } = req.params;

    if (!token || token.length !== 64) {
      return res.status(400).json({ success: false, valid: false, reason: 'invalid', message: 'Invalid or malformed setup link.' });
    }

    const tokenHash = hashToken(token);
    const user = await prisma.user.findFirst({
      where: { resetCode: tokenHash }
    });

    if (!user) {
      return res.status(404).json({ success: false, valid: false, reason: 'invalid', message: 'This setup link is invalid or has already been used.' });
    }

    if (!user.resetCodeExpires || new Date(user.resetCodeExpires) < new Date()) {
      return res.status(410).json({ success: false, valid: false, reason: 'expired', message: 'This setup link has expired. Please ask your administrator to resend your invite.' });
    }

    let college = null;
    if (user.college_id) {
      college = await prisma.college.findUnique({
        where: { id: user.college_id },
        select: { name: true, slug: true, code: true, logo: true }
      });
    }

    res.json({
      success: true,
      valid: true,
      data: {
        name: user.name,
        email: user.email,
        role: user.role,
        college_name: college?.name || null,
        college: college ? {
          name: college.name,
          slug: college.slug || college.code.toLowerCase(),
          logo: college.logo
        } : null
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── POST /public/set-password/:token ────────────────────────────────────────
exports.submitSetPassword = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ success: false, message: 'Passwords do not match.' });
    }

    const tokenHash = hashToken(token);
    const user = await prisma.user.findFirst({
      where: { resetCode: tokenHash }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'This link is invalid or has already been used.' });
    }

    if (!user.resetCodeExpires || new Date(user.resetCodeExpires) < new Date()) {
      return res.status(410).json({ success: false, message: 'This link has expired. Please contact your college administrator.' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        emailVerified: true,
        resetCode: null,
        resetCodeExpires: null
      }
    });

    res.json({
      success: true,
      message: 'Password set successfully! You can now log in to your account.'
    });
  } catch (error) {
    next(error);
  }
};
