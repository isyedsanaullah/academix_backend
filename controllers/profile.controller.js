// ─── Profile Controller (Multi-DB with Prisma) ───────────────────
const bcrypt = require('bcryptjs');
const { getSystemClient } = require('../config/prismaManager');
const { generateCode, sendVerificationEmail, sendPasswordResetEmail } = require('../utils/emailService');
const { resolveCollegeFeatures } = require('../config/featureRegistry');

exports.getProfile = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let extra = {};
    if (req.tenantClient && req.collegeId) {
      const tenantDb = req.tenantClient;
      if (user.role === 'student') {
        const student = await tenantDb.student.findFirst({
          where: { college_id: req.collegeId, user_id: user.id }
        });
        if (student) {
          extra = {
            studentId: student.id,
            rollNumber: student.rollNumber,
            class: student.class,
            section: student.section,
            group: student.group,
            qrCode: student.qrCode,
            registrationNumber: student.registrationNumber,
            photo: student.photo
          };
        }
      } else if (user.role === 'teacher') {
        const teacher = await tenantDb.teacher.findFirst({
          where: { college_id: req.collegeId, user_id: user.id }
        });
        if (teacher) {
          let teacherSubs = [];
          if (teacher.subjects && teacher.subjects.length > 0) {
            teacherSubs = await tenantDb.subject.findMany({
              where: {
                college_id: req.collegeId,
                name: { in: teacher.subjects }
              }
            });
          }
          if (teacherSubs.length === 0) {
            teacherSubs = await tenantDb.subject.findMany({
              where: {
                college_id: req.collegeId,
                teacher_id: user.id,
                isActive: true
              }
            });
          }
          extra = {
            teacherId: teacher.id,
            employeeCode: teacher.employeeCode,
            qualification: teacher.qualification,
            specialization: teacher.specialization,
            qrCode: teacher.qrCode,
            teacherSubjects: teacherSubs.map(s => ({ ...s, _id: s.id }))
          };
        }
      }
    }

    let aiKeyStatus = { hasKey: false, verified: false, provider: '' };
    const aiKey = await prisma.aIApiKey.findFirst({
      where: { userId, isActive: true }
    });
    if (aiKey) {
      aiKeyStatus = {
        hasKey: true,
        verified: true,
        provider: aiKey.provider || 'gemini',
        usageCount: aiKey.usageCount || 0
      };
    }

    let planInfo = { plan: 'basic', name: 'Basic', effectiveFeatures: [] };
    if (user.role === 'superAdmin') {
      planInfo = { plan: 'enterprise', name: 'Enterprise', effectiveFeatures: [] };
    } else if (req.collegeId) {
      const college = await prisma.college.findUnique({
        where: { id: req.collegeId }
      });
      if (college && college.subscription) {
        const sub = college.subscription; // parsed Json
        const { effectiveKeys } = resolveCollegeFeatures(sub.plan || 'basic', sub.featureOverrides || {});
        planInfo = {
          plan: sub.plan || sub.planId || 'basic',
          name: sub.planName || sub.plan || 'Basic',
          effectiveFeatures: effectiveKeys
        };
      }
    }

    res.json({
      success: true,
      data: {
        _id: user.id,
        name: user.name,
        email: user.email,
        username: user.username || '',
        role: user.role,
        phone: user.phone,
        cnic: user.cnic,
        avatar: user.avatar,
        authProvider: user.authProvider || 'local',
        emailVerified: user.emailVerified || false,
        qrCode: user.qrCode || '',
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        ...extra,
        aiKeyStatus,
        planInfo
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;
    const { name, phone, cnic, avatar } = req.body;
    
    const updates = {};
    if (name) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (cnic !== undefined) updates.cnic = cnic;
    if (avatar !== undefined) updates.avatar = avatar;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updates
    });

    res.json({
      success: true,
      data: { ...user, _id: user.id },
      message: 'Profile updated'
    });
  } catch (error) {
    next(error);
  }
};

exports.setUsername = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;
    const { username } = req.body;

    if (!username || username.length < 3) {
      return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Only letters, numbers, underscores' });
    }

    const existing = await prisma.user.findFirst({
      where: {
        username: username.toLowerCase(),
        id: { not: userId }
      }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username already taken' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { username: username.toLowerCase() }
    });

    res.json({ success: true, message: 'Username set successfully' });
  } catch (error) {
    next(error);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.password) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password required' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        authProvider: user.authProvider === 'google' ? 'local' : user.authProvider
      }
    });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
};

exports.sendVerificationCode = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.json({ success: true, message: 'Email already verified' });
    }

    const code = generateCode();

    await prisma.user.update({
      where: { id: userId },
      data: {
        verificationCode: code,
        verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    await sendVerificationEmail(user.email, code, user.name);
    res.json({ success: true, message: `Verification code sent to ${user.email}` });
  } catch (error) {
    next(error);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Code is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.verificationCode || user.verificationCodeExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Code expired.' });
    }
    if (user.verificationCode !== code) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        verificationCode: null,
        verificationCodeExpires: null
      }
    });

    res.json({ success: true, message: 'Email verified successfully ✅' });
  } catch (error) {
    next(error);
  }
};

exports.changeEmail = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const userId = req.user.id || req.user._id;
    const { newEmail, password } = req.body;

    if (!newEmail || !password) {
      return res.status(400).json({ success: false, message: 'New email and password required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Password is incorrect' });
    }

    const exists = await prisma.user.findFirst({
      where: {
        email: newEmail.toLowerCase(),
        id: { not: userId }
      }
    });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const code = generateCode();

    await prisma.user.update({
      where: { id: userId },
      data: {
        email: newEmail.toLowerCase(),
        emailVerified: false,
        verificationCode: code,
        verificationCodeExpires: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    await sendVerificationEmail(newEmail, code, user.name);
    res.json({ success: true, message: `Email changed. Code sent to ${newEmail}` });
  } catch (error) {
    next(error);
  }
};

exports.requestPasswordReset = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.json({ success: true, message: 'If this email exists, a code has been sent.' });
    }

    const code = generateCode();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetCode: code,
        resetCodeExpires: new Date(Date.now() + 10 * 60 * 1000)
      }
    });

    await sendPasswordResetEmail(user.email, code, user.name);
    res.json({ success: true, message: 'Reset code sent to your email' });
  } catch (error) {
    next(error);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const prisma = getSystemClient();
    const { email, code, newPassword } = req.body;

    if (!email || !code || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    if (!user.resetCode || user.resetCodeExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'Code expired.' });
    }
    if (user.resetCode !== code) {
      return res.status(400).json({ success: false, message: 'Invalid reset code' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetCode: null,
        resetCodeExpires: null
      }
    });

    res.json({ success: true, message: 'Password reset successful.' });
  } catch (error) {
    next(error);
  }
};
