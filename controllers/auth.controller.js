const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');
const { verifyFirebaseToken } = require('../config/firebaseAdmin');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');
const { resolveCollegeFeatures } = require('../config/featureRegistry');
const { getEntitlements } = require('../middleware/loadEntitlements');
const mailService = require('../services/mailService');

// @desc    Register a new user

// @route   POST /api/auth/register
// @access  Private (Admin/SuperAdmin)
exports.register = async (req, res, next) => {
  try {
    const { name, email, password, role, college_id, phone } = req.body;
    const prisma = getSystemClient();

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    if (role === 'superAdmin' && req.user && req.user.role !== 'superAdmin') {
      return res.status(403).json({ success: false, message: 'Cannot create superAdmin users' });
    }

    let assignedCollegeId = college_id;
    if (req.user && req.user.role !== 'superAdmin') {
      assignedCollegeId = req.user.college_id;
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = password ? await bcrypt.hash(password, salt) : null;

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        role: role || 'student',
        college_id: assignedCollegeId || null,
        phone,
        authProvider: 'local'
      }
    });

    const token = generateToken(user.id, user.college_id, user.role);

    res.status(201).json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        college_id: user.college_id,
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login user (email/password)
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const prisma = getSystemClient();

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email/username and password' });
    }

    // Support login by email or username
    const query = email.includes('@') ? { email: email.toLowerCase() } : { username: email.toLowerCase() };
    const user = await prisma.user.findUnique({
      where: query
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account has been deactivated' });
    }

    // Google-only users cannot use password login
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({ success: false, message: 'This account uses Google sign-in. Please use the Google login button.' });
    }

    const isMatch = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Phase 2: Host & Tenant Isolation Login Check
    const hostType = (req.headers['x-host-type'] || '').toLowerCase();
    const tenantSlug = (req.headers['x-tenant-slug'] || '').toLowerCase().trim();

    if (user.role === 'superAdmin') {
      // Super admin can only log in from admin host or root, NEVER on a tenant subdomain
      if (hostType === 'tenant' || tenantSlug) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } else {
      // Non-super-admin can NEVER log in on the admin host
      if (hostType === 'admin') {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      // If tenant slug is provided (subdomain), user must belong to this specific college
      if (tenantSlug) {
        const userCollege = await prisma.college.findUnique({
          where: { id: user.college_id },
          select: { id: true, slug: true, code: true, status: true }
        });

        if (!userCollege) {
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const collegeSlug = (userCollege.slug || userCollege.code).toLowerCase();
        if (collegeSlug !== tenantSlug) {
          return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
      }

      // If a college ID is asserted by the client (code-based login on root domain),
      // validate it server-side so a direct API call cannot bypass the college isolation.
      const expectedCollegeId = (req.headers['x-expected-college-id'] || '').trim();
      if (expectedCollegeId) {
        if (!user.college_id || user.college_id !== expectedCollegeId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied: Your account does not belong to this institution.'
          });
        }
      }
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Log Activity
    logActivity({
      college_id: user.college_id || null,
      actorUser: user,
      action: ACTIONS.LOGIN,
      category: CATEGORIES.AUTHENTICATION,
      resourceType: 'User',
      resourceId: user.id,
      title: `${user.name} Login`,
      description: `${user.name} logged in successfully.`
    }).catch(e => console.error('Activity log error:', e.message));

    // Populate college details (Super Admin has user.college_id = null)
    let college = null;
    if (user.college_id) {
      college = await prisma.college.findUnique({
        where: { id: user.college_id },
        select: {
          id: true, name: true, code: true, slug: true, status: true, logo: true,
          subscription: true, onboarding_state: true, subscription_status: true, grace_until: true
        }
      });
      if (college) {
        if (college.status === 'onboarding' && user.role !== 'admin') {
          return res.status(403).json({ success: false, message: 'College setup is not finished yet.' });
        }
        if (college.status === 'pending_setup' && user.role !== 'superAdmin') {
          return res.status(403).json({ success: false, message: 'College setup is not finished yet.' });
        }
        const isSuspended = college.status === 'suspended' || college.subscription_status === 'suspended';
        if (isSuspended) {
          if (user.role !== 'admin' && user.role !== 'superAdmin') {
            return res.status(403).json({
              success: false,
              code: 'SUBSCRIPTION_SUSPENDED',
              message: "This college's subscription has expired. Please contact your college administration."
            });
          }
          college.subscriptionSuspended = true;
        }
        college._id = college.id;
        const ent = await getEntitlements(user.college_id);
        college.effectiveFeatures = ent.active ? ent.effectiveFeatures : [];
      }
    }

    const token = generateToken(user.id, user.college_id || null, user.role);

    res.json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        college,
        token
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Login / Register with Google (Firebase)
// @route   POST /api/auth/google
// @access  Public
exports.googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    const prisma = getSystemClient();

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Firebase ID token is required' });
    }

    // Verify the token with Firebase Admin
    const firebaseUser = await verifyFirebaseToken(idToken);

    // Look up existing user by firebaseUid OR email
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { firebaseUid: firebaseUser.uid },
          { email: firebaseUser.email }
        ]
      }
    });

    if (!user) {
      // No pre-provisioned user found — reject
      return res.status(403).json({
        success: false,
        message: 'No account found for this Google email. Please contact your administrator to get access.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account has been deactivated' });
    }

    // Prepare updates
    const updateData = {
      emailVerified: true,
      lastLogin: new Date()
    };

    // Link Firebase UID if not already linked
    if (!user.firebaseUid) {
      updateData.firebaseUid = firebaseUser.uid;
      updateData.authProvider = user.password ? 'local' : 'google';
    }

    // Update profile info from Google
    if (!user.avatar && firebaseUser.picture) {
      updateData.avatar = firebaseUser.picture;
    }

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    // Populate college
    let college = null;
    if (updatedUser.college_id) {
      college = await prisma.college.findUnique({
        where: { id: updatedUser.college_id },
        select: {
          id: true, name: true, code: true, slug: true, status: true, logo: true,
          subscription: true, onboarding_state: true, subscription_status: true, grace_until: true
        }
      });
      if (college) {
        if (college.status === 'onboarding' && updatedUser.role !== 'admin') {
          return res.status(403).json({ success: false, message: 'College setup is not finished yet.' });
        }
        if (college.status === 'pending_setup' && updatedUser.role !== 'superAdmin') {
          return res.status(403).json({ success: false, message: 'College setup is not finished yet.' });
        }
        const isSuspended = college.status === 'suspended' || college.subscription_status === 'suspended';
        if (isSuspended) {
          if (updatedUser.role !== 'admin' && updatedUser.role !== 'superAdmin') {
            return res.status(403).json({
              success: false,
              code: 'SUBSCRIPTION_SUSPENDED',
              message: "This college's subscription has expired. Please contact your college administration."
            });
          }
          college.subscriptionSuspended = true;
        }
        college._id = college.id;
        const ent = await getEntitlements(updatedUser.college_id);
        college.effectiveFeatures = ent.active ? ent.effectiveFeatures : [];
      }
    }

    const token = generateToken(updatedUser.id, updatedUser.college_id || null, updatedUser.role);

    res.json({
      success: true,
      data: {
        _id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        avatar: updatedUser.avatar,
        college,
        token
      }
    });
  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ success: false, message: 'Google token expired. Please try again.' });
    }
    if (error.code === 'auth/argument-error' || error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ success: false, message: 'Invalid Google token.' });
    }
    next(error);
  }
};

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Populate college details
    let college = null;
    if (user.college_id) {
      college = await prisma.college.findUnique({
        where: { id: user.college_id },
        select: {
          id: true, name: true, code: true, slug: true, status: true, logo: true,
          subscription: true, settings: true, onboarding_state: true,
          subscription_status: true, grace_until: true
        }
      });
      if (college) {
        const isSuspended = college.status === 'suspended' || college.subscription_status === 'suspended';
        if (isSuspended) {
          if (user.role !== 'admin' && user.role !== 'superAdmin') {
            return res.status(403).json({
              success: false,
              code: 'SUBSCRIPTION_SUSPENDED',
              message: "This college's subscription has expired. Please contact your college administration."
            });
          }
          college.subscriptionSuspended = true;
        }
        college._id = college.id;
        const ent = await getEntitlements(user.college_id);
        college.effectiveFeatures = ent.active ? ent.effectiveFeatures : [];
      }
    }

    res.json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        college,
        authProvider: user.authProvider,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/update-password
// @access  Private
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const prisma = getSystemClient();

    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Google-only users setting password for first time
    if (!user.password) {
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          authProvider: 'local'
        }
      });
      
      const token = generateToken(updatedUser.id, updatedUser.college_id, updatedUser.role);
      return res.json({ success: true, message: 'Password set successfully', data: { token } });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword
      }
    });

    const token = generateToken(updatedUser.id, updatedUser.college_id, updatedUser.role);

    res.json({
      success: true,
      message: 'Password updated successfully',
      data: { token }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Phase 4: Email Verification ─────────────────────────────────────────────

// In-memory resend rate tracking (per email address)
const resendAttempts = new Map();
const RESEND_HOURLY_MAX = 5;

/**
 * @desc  Submit 6-digit email verification code
 * @route POST /api/auth/verify-email
 * @access Private (requires JWT)
 */
exports.verifyEmail = async (req, res, next) => {
  try {
    const { code } = req.body;
    const prisma = getSystemClient();

    if (!code || !/^\d{6}$/.test(String(code).trim())) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 6-digit code.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.emailVerified) {
      return res.json({ success: true, message: 'Email is already verified.', alreadyVerified: true });
    }

    if (!user.verificationCode || !user.verificationCodeExpires) {
      return res.status(400).json({
        success: false,
        message: 'No verification code found. Please request a new code.',
        code: 'NO_CODE'
      });
    }

    if (new Date() > new Date(user.verificationCodeExpires)) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
        code: 'CODE_EXPIRED'
      });
    }

    // Constant-time comparison
    const crypto = require('crypto');
    const incoming = Buffer.from(String(code).trim().padEnd(6, '\0'));
    const stored   = Buffer.from(String(user.verificationCode).padEnd(6, '\0'));
    const match = incoming.length === stored.length && crypto.timingSafeEqual(incoming, stored);

    if (!match) {
      return res.status(400).json({ success: false, message: 'Incorrect code. Please try again.', code: 'WRONG_CODE' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationCode: null, verificationCodeExpires: null }
    });

    logActivity({
      college_id: user.college_id || null,
      actorUser: user,
      action: 'EMAIL_VERIFIED',
      category: CATEGORIES.AUTHENTICATION || 'authentication',
      resourceType: 'User',
      resourceId: user.id,
      title: 'Email Verified',
      description: `${user.name} verified their email address.`
    }).catch(e => console.error('[verifyEmail] Activity log error:', e.message));

    return res.json({ success: true, message: 'Email verified successfully.' });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc  Resend email verification code (60s cooldown, max 5/hour)
 * @route POST /api/auth/resend-verification
 * @access Private (requires JWT)
 */
exports.resendVerification = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.emailVerified) {
      return res.json({ success: true, message: 'Email is already verified.', alreadyVerified: true });
    }

    const now = Date.now();
    const key = user.email;
    const record = resendAttempts.get(key) || { count: 0, windowStart: now };

    if (now - record.windowStart > 60 * 60 * 1000) { record.count = 0; record.windowStart = now; }

    if (record.count >= RESEND_HOURLY_MAX) {
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again in an hour.', code: 'RATE_LIMITED' });
    }

    if (user.verificationCodeExpires) {
      const sentAt = new Date(user.verificationCodeExpires).getTime() - 15 * 60 * 1000;
      const secondsSinceSend = (now - sentAt) / 1000;
      if (secondsSinceSend < 60) {
        const waitSeconds = Math.ceil(60 - secondsSinceSend);
        return res.status(429).json({ success: false, message: `Please wait ${waitSeconds}s before requesting a new code.`, code: 'COOLDOWN', waitSeconds });
      }
    }

    const newCode = String(Math.floor(100000 + Math.random() * 900000));
    const newExpiry = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({ where: { id: user.id }, data: { verificationCode: newCode, verificationCodeExpires: newExpiry } });

    record.count++;
    resendAttempts.set(key, record);

    let collegeName = 'your institution', collegeSlug = null;
    if (user.college_id) {
      const college = await prisma.college.findUnique({ where: { id: user.college_id }, select: { name: true, slug: true } });
      if (college) { collegeName = college.name; collegeSlug = college.slug; }
    }

    const rootDomain = process.env.ROOT_DOMAIN || 'collegeshub.org';
    const verifyUrl = process.env.NODE_ENV === 'development'
      ? `http://${collegeSlug}.localhost:3000/verify-email`
      : `https://${collegeSlug}.${rootDomain}/verify-email`;

    const emailHtml = mailService.buildCollegeshubTemplate({
      title: 'Your new verification code',
      bodyHtml: `
        <p>Hi <strong>${user.name}</strong>,</p>
        <p>Here is your new verification code for <strong>${collegeName}</strong>:</p>
        <p style="text-align:center;margin:28px 0;">
          <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#ffffff;background:#0A4D94;padding:16px 24px;border-radius:10px;display:inline-block;">${newCode}</span>
        </p>
        <p>Expires in <strong>15 minutes</strong>.</p>
      `,
      buttonText: 'Verify Email',
      buttonUrl: verifyUrl
    });

    mailService.send({
      to: user.email,
      subject: `[Collegeshub] New verification code — ${collegeName}`,
      html: emailHtml,
      text: `Your verification code: ${newCode}\n\nExpires in 15 minutes.\n${verifyUrl}`
    }).catch(e => console.error('[resendVerification] Email error:', e.message));

    return res.json({ success: true, message: 'A new code has been sent to your email.', expiresIn: 15 * 60 });
  } catch (error) {
    next(error);
  }
};
