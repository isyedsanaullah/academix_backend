const bcrypt = require('bcryptjs');
const generateToken = require('../utils/generateToken');
const { verifyFirebaseToken } = require('../config/firebaseAdmin');
const { getSystemClient } = require('../config/prismaManager');
const { logActivity } = require('../services/activityLog.service');
const { ACTIONS, CATEGORIES } = require('../config/activityConstants');
const { resolveCollegeFeatures } = require('../config/featureRegistry');

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


    // Populate college details
    let college = null;
    if (user.college_id) {
      college = await prisma.college.findUnique({
        where: { id: user.college_id },
        select: { id: true, name: true, code: true, logo: true, subscription: true }
      });
      if (college) {
        college._id = college.id;
        const sub = (typeof college.subscription === 'object' && college.subscription !== null) ? college.subscription : {};
        const { effectiveKeys } = resolveCollegeFeatures(sub.plan || 'basic', sub.featureOverrides || {});
        college.effectiveFeatures = effectiveKeys;
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
        select: { id: true, name: true, code: true, logo: true, subscription: true }
      });
      if (college) {
        college._id = college.id;
        const sub = (typeof college.subscription === 'object' && college.subscription !== null) ? college.subscription : {};
        const { effectiveKeys } = resolveCollegeFeatures(sub.plan || 'basic', sub.featureOverrides || {});
        college.effectiveFeatures = effectiveKeys;
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
        select: { id: true, name: true, code: true, logo: true, subscription: true, settings: true }
      });
      if (college) {
        college._id = college.id;
        const sub = (typeof college.subscription === 'object' && college.subscription !== null) ? college.subscription : {};
        const { effectiveKeys } = resolveCollegeFeatures(sub.plan || 'basic', sub.featureOverrides || {});
        college.effectiveFeatures = effectiveKeys;
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
