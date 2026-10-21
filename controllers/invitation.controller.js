const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getSystemClient } = require('../config/prismaManager');
const { sendInvitationEmail } = require('../utils/emailService');

// Helper to create audit log
const createAuditLog = async (prisma, { userId, collegeId, action, details, req }) => {
  try {
    await prisma.auditLog.create({
      data: {
        user_id: userId || 'system',
        college_id: collegeId || null,
        action,
        details,
        ipAddress: req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : null,
        userAgent: req ? req.headers['user-agent'] : null
      }
    });
  } catch (e) {
    console.error('AuditLog creation failed:', e.message);
  }
};

// ── Super Admin: Send College Invitation ────────────────────────────────
exports.inviteCollege = async (req, res, next) => {
  try {
    const { email, planId = 'starter' } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid official college email is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
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

    // 3. Validate planId if Subscription exists
    const subscriptionPlan = await prisma.subscription.findFirst({
      where: {
        OR: [
          { planId: planId.toLowerCase() },
          { id: planId }
        ]
      }
    });
    const finalPlanId = subscriptionPlan ? subscriptionPlan.planId : planId.toLowerCase();

    // 4. Generate cryptographically secure token & 48h expiration
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // 5. Store invitation in DB
    const invitation = await prisma.collegeInvitation.create({
      data: {
        email: cleanEmail,
        planId: finalPlanId,
        token,
        status: 'pending',
        invitedBy: req.user.id,
        expiresAt
      }
    });

    // 6. Log audit event
    await createAuditLog(prisma, {
      userId: req.user.id,
      action: 'INVITATION_SENT',
      details: `Invited college ${cleanEmail} with plan ${finalPlanId}`,
      req
    });

    const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/register/invitation/${token}`;

    // 7. Send invitation email — fail loudly so the admin knows delivery failed
    try {
      await sendInvitationEmail(cleanEmail, {
        inviteUrl,
        planId: finalPlanId,
        expiresAt
      });
    } catch (emailError) {
      // Full SMTP error already logged inside emailService; return generic message
      return res.status(500).json({
        success: false,
        message: 'Invitation record created but email delivery failed. Please check the server email configuration and resend the invitation.',
      });
    }

    res.status(201).json({
      success: true,
      message: `Invitation successfully sent to ${cleanEmail}`,
      data: {
        invitation: {
          ...invitation,
          _id: invitation.id
        },
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
    if (search) where.email = { contains: search.trim().toLowerCase(), mode: 'insensitive' };

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

    res.json({
      success: true,
      data: invitations.map(i => ({ ...i, _id: i.id })),
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

    if (invitation.status === 'accepted') {
      return res.status(400).json({ success: false, message: 'This invitation has already been accepted and completed.' });
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const newExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    const updated = await prisma.collegeInvitation.update({
      where: { id },
      data: {
        token: newToken,
        expiresAt: newExpiresAt,
        status: 'pending'
      }
    });

    await createAuditLog(prisma, {
      userId: req.user.id,
      action: 'INVITATION_RESENT',
      details: `Resent invitation to ${updated.email}`,
      req
    });

    const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/register/invitation/${newToken}`;

    // Resend the invitation email
    try {
      await sendInvitationEmail(updated.email, {
        inviteUrl,
        planId: updated.planId,
        expiresAt: newExpiresAt
      });
    } catch (emailError) {
      return res.status(500).json({
        success: false,
        message: 'Token refreshed in database but email delivery failed. Please check the server email configuration.',
      });
    }

    res.json({
      success: true,
      message: `Invitation resent to ${updated.email}`,
      data: {
        invitation: { ...updated, _id: updated.id },
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

    if (invitation.status === 'accepted') {
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

    res.json({
      success: true,
      message: 'Invitation cancelled successfully.',
      data: { ...cancelled, _id: cancelled.id }
    });
  } catch (error) {
    next(error);
  }
};

// ── Public: Verify Invitation Token ────────────────────────────────────
exports.verifyInvitationToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    const prisma = getSystemClient();

    const invitation = await prisma.collegeInvitation.findUnique({ where: { token } });
    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invalid invitation link.' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This invitation is no longer active (status: ${invitation.status}).`
      });
    }

    if (new Date() > new Date(invitation.expiresAt)) {
      await prisma.collegeInvitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
      return res.status(400).json({ success: false, message: 'This invitation has expired. Please request a new invitation.' });
    }

    res.json({
      success: true,
      data: {
        email: invitation.email,
        planId: invitation.planId,
        expiresAt: invitation.expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// ── Public: Accept Invitation & Create Admin Account ────────────────────
exports.acceptInvitation = async (req, res, next) => {
  try {
    const { token, name, designation, password } = req.body;
    if (!token || !name || !password) {
      return res.status(400).json({ success: false, message: 'Name, password, and invitation token are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }

    const prisma = getSystemClient();

    // 1. Verify invitation
    const invitation = await prisma.collegeInvitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invalid or inactive invitation token.' });
    }
    if (new Date() > new Date(invitation.expiresAt)) {
      await prisma.collegeInvitation.update({ where: { id: invitation.id }, data: { status: 'expired' } });
      return res.status(400).json({ success: false, message: 'Invitation has expired.' });
    }

    // 2. Auto-generate draft college workspace
    const tempCode = `COL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const mongoUrl = process.env.DATABASE_URL || `postgresql://postgres:Sana%40346@localhost:5432/academix?schema=public`;

    const college = await prisma.college.create({
      data: {
        name: `${name}'s Institution`,
        code: tempCode,
        email: invitation.email,
        mongoUrl,
        subscription: {
          plan: invitation.planId === 'basic' ? 'starter' : (invitation.planId || 'starter'),
          status: 'active',
          startedAt: new Date()
        },
        onboardingStatus: 'registered',
        onboardingStep: 1
      }
    });

    // 3. Hash password & Create College Admin user with emailVerified = true
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const adminUser = await prisma.user.create({
      data: {
        name,
        email: invitation.email.toLowerCase(),
        password: hashedPassword,
        role: 'admin',
        college_id: college.id,
        emailVerified: true,
        authProvider: 'local'
      }
    });

    // 4. Update invitation status to accepted
    await prisma.collegeInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        collegeId: college.id
      }
    });

    // 5. Audit Log
    await createAuditLog(prisma, {
      userId: adminUser.id,
      collegeId: college.id,
      action: 'INVITATION_ACCEPTED',
      details: `College admin ${adminUser.email} accepted invitation and created workspace`,
      req
    });

    // 6. Issue JWT & Set HTTP-Only Cookie
    const tokenSecret = process.env.JWT_SECRET || 'academix_secret_key_2026';
    const authToken = jwt.sign(
      { id: adminUser.id, role: adminUser.role, college_id: college.id },
      tokenSecret,
      { expiresIn: '7d' }
    );

    res.cookie('academix_token', authToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(201).json({
      success: true,
      message: 'Invitation accepted successfully! Redirecting to onboarding wizard...',
      token: authToken,
      data: {
        user: {
          _id: adminUser.id,
          id: adminUser.id,
          name: adminUser.name,
          email: adminUser.email,
          role: adminUser.role,
          college_id: college.id
        },
        college: {
          _id: college.id,
          id: college.id,
          onboardingStatus: college.onboardingStatus,
          onboardingStep: college.onboardingStep
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
