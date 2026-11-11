'use strict';

/**
 * twoFactor.controller.js — Phase 9A (#N07)
 * Two-Factor Authentication & Known-Device Security Controller
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');
const generateToken = require('../utils/generateToken');
const {
  generate2FASetup,
  decryptTotpSecret,
  verifyTotpCode,
  verifyAndConsumeBackupCode,
  signDeviceCookie,
  verifyDeviceCookie,
  hashDeviceId
} = require('../services/twoFactorService');

function getPrisma() {
  return getSystemClient();
}

// In-memory sliding window cache for failed password attempts (15-minute expiry)
const failedPasswordTracker = new Map();

function recordFailedPasswordAttempt(identifier) {
  if (!identifier) return;
  const key = String(identifier).toLowerCase().trim();
  const now = Date.now();
  const existing = failedPasswordTracker.get(key) || { count: 0, expiresAt: now + 15 * 60 * 1000 };
  existing.count += 1;
  existing.expiresAt = now + 15 * 60 * 1000;
  failedPasswordTracker.set(key, existing);
}

function hasRecentFailedPassword(identifier) {
  if (!identifier) return false;
  const key = String(identifier).toLowerCase().trim();
  const existing = failedPasswordTracker.get(key);
  if (!existing) return false;
  if (Date.now() > existing.expiresAt) {
    failedPasswordTracker.delete(key);
    return false;
  }
  return existing.count > 0;
}

function clearFailedPasswordAttempt(identifier) {
  if (!identifier) return;
  const key = String(identifier).toLowerCase().trim();
  failedPasswordTracker.delete(key);
}

/**
 * Check whether the incoming request originates from a recognized / trusted device.
 */
async function isKnownDevice(req, user) {
  if (!user || !user.id) return false;
  try {
    const prisma = getPrisma();
    const rawCookie = req.cookies?.['__Host-acx_did'] || req.cookies?.['acx_did'] || req.headers['x-device-id'];
    const validDeviceId = verifyDeviceCookie(rawCookie);
    if (!validDeviceId) return false;

    const devHash = hashDeviceId(validDeviceId);
    const existing = await prisma.knownDevice.findFirst({
      where: {
        college_id: user.college_id || 'platform',
        userId: user.id,
        deviceIdHash: devHash
      }
    });

    return !!existing;
  } catch (err) {
    console.error('[isKnownDevice] Failed to verify device:', err.message);
    return false;
  }
}

/**
 * Helper to process device cookie and dispatch alert if unrecognized
 */
async function processKnownDevice(req, res, user) {
  const prisma = getPrisma();
  const rawCookie = req.cookies?.['__Host-acx_did'] || req.cookies?.['acx_did'] || req.headers['x-device-id'];
  const validDeviceId = verifyDeviceCookie(rawCookie);

  let isRecognized = false;
  if (validDeviceId) {
    const devHash = hashDeviceId(validDeviceId);
    const existing = await prisma.knownDevice.findFirst({
      where: {
        college_id: user.college_id || 'platform',
        userId: user.id,
        deviceIdHash: devHash
      }
    });

    if (existing) {
      isRecognized = true;
      await prisma.knownDevice.update({
        where: { id: existing.id },
        data: {
          lastSeenAt: new Date(),
          lastIp: req.ip || null,
          userAgent: req.headers['user-agent'] || null
        }
      });
    }
  }

  if (!isRecognized) {
    // Generate fresh device ID
    const newDeviceId = crypto.randomUUID();
    const newDevHash = hashDeviceId(newDeviceId);
    const signedCookie = signDeviceCookie(newDeviceId);

    await prisma.knownDevice.create({
      data: {
        college_id: user.college_id || 'platform',
        userId: user.id,
        deviceIdHash: newDevHash,
        lastIp: req.ip || null,
        userAgent: req.headers['user-agent'] || null
      }
    });

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('__Host-acx_did', signedCookie, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 3600 * 1000
    });
    // In dev / non-https test environments, also set acx_did fallback
    if (!isSecure) {
      res.cookie('acx_did', signedCookie, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 365 * 24 * 3600 * 1000
      });
    }

    // Write OutboxEvent('NEW_DEVICE_LOGIN')
    const alertPayload = {
      userId: user.id,
      userEmail: user.email,
      ip: req.ip || 'Unknown',
      userAgent: req.headers['user-agent'] || 'Unknown'
    };
    await prisma.outboxEvent.create({
      data: {
        college_id: user.college_id || 'platform',
        eventType: 'NEW_DEVICE_LOGIN',
        payload: alertPayload
      }
    });
  }
}

/**
 * POST /api/auth/2fa/setup
 * Generates TOTP secret and backup codes.
 */
async function setup2FA(req, res) {
  try {
    const prisma = getPrisma();
    const userId = req.user?.id || req.user?._id;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const setup = generate2FASetup(user.email);

    // Save encrypted secret & hashed backup codes (totpEnabled remains false until verify)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: setup.secretEnc,
        totpBackupCodes: setup.hashedBackupCodes
      }
    });

    return res.json({
      success: true,
      secretBase32: setup.secretBase32,
      otpauthUrl: setup.otpauthUrl,
      backupCodes: setup.plainBackupCodes
    });
  } catch (err) {
    console.error('[setup2FA] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to initiate 2FA setup', error: err.message });
  }
}

/**
 * POST /api/auth/2fa/verify
 * Confirms code and activates 2FA on the user account.
 */
async function verify2FA(req, res) {
  try {
    const { code } = req.body;
    const prisma = getPrisma();
    const userId = req.user?.id || req.user?._id;

    if (!code) {
      return res.status(400).json({ success: false, message: '6-digit code is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user || !user.totpSecretEnc) {
      return res.status(400).json({ success: false, message: '2FA setup has not been initiated' });
    }

    const secretBase32 = decryptTotpSecret(user.totpSecretEnc);
    const verification = verifyTotpCode({ secretBase32, code, lastAcceptedStep: user.totpLastStep });

    if (!verification.valid) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    // Activate 2FA
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: true,
        totpLastStep: verification.step,
        twofaEnrolledAt: new Date(),
        totpFailedAttempts: 0,
        totpLockedUntil: null
      }
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        college_id: user.college_id || 'platform',
        user_id: user.id,
        action: '2FA_ENABLED',
        details: JSON.stringify({ enrolledAt: new Date().toISOString() })
      }
    });

    // Register this device immediately as a trusted device upon successful 2FA setup
    await processKnownDevice(req, res, user);
    clearFailedPasswordAttempt(user.id);
    clearFailedPasswordAttempt(user.email);

    // Issue upgraded full session token if the user was under ENROLL_2FA scope
    const token = generateToken(user.id, user.college_id, user.role);

    return res.json({
      success: true,
      message: 'Two-factor authentication successfully enabled',
      token
    });
  } catch (err) {
    console.error('[verify2FA] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to verify 2FA', error: err.message });
  }
}

/**
 * POST /api/auth/2fa/validate
 * Consumes a pre-auth token and 6-digit TOTP code, issuing the final session JWT.
 */
async function validate2FA(req, res) {
  try {
    const { preAuthToken, code } = req.body;
    const prisma = getPrisma();

    if (!preAuthToken || !code) {
      return res.status(400).json({ success: false, message: 'preAuthToken and code are required' });
    }

    // 1. Verify pre-auth token
    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Pre-auth token invalid or expired' });
    }

    if (decoded.scope !== 'PREAUTH_2FA' || !decoded.jti) {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Token is not a valid pre-auth token' });
    }

    // 2. Replay check on pre-auth token JTI
    const existingUsed = await prisma.usedStepUpToken.findUnique({
      where: { jti: decoded.jti }
    });
    if (existingUsed) {
      return res.status(401).json({ success: false, code: 'PREAUTH_TOKEN_ALREADY_USED', message: 'Pre-auth token has already been consumed' });
    }

    // 3. Find user and check lockouts
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
      const remainingMs = user.totpLockedUntil.getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      return res.status(429).json({
        success: false,
        code: 'ACCOUNT_LOCKED_2FA',
        message: `Account is temporarily locked due to too many failed 2FA attempts. Locked for ${remainingMin} more minutes.`,
        attemptsRemaining: 0,
        lockedUntil: user.totpLockedUntil,
        lockedMinutes: remainingMin,
        remainingMs
      });
    }

    if (!user.totpEnabled || !user.totpSecretEnc) {
      return res.status(400).json({ success: false, message: '2FA is not enabled on this account' });
    }

    // 4. Verify code
    const secretBase32 = decryptTotpSecret(user.totpSecretEnc);
    const verification = verifyTotpCode({ secretBase32, code, lastAcceptedStep: user.totpLastStep });

    if (!verification.valid) {
      const nextFailures = (user.totpFailedAttempts || 0) + 1;
      const lockData = { totpFailedAttempts: nextFailures };

      if (nextFailures >= 5) {
        lockData.totpLockedUntil = new Date(Date.now() + 30 * 60 * 1000); // 30-minute lock
      }

      await prisma.user.update({
        where: { id: user.id },
        data: lockData
      });

      const isLocked = nextFailures >= 5;
      return res.status(isLocked ? 429 : 401).json({
        success: false,
        code: isLocked
          ? 'ACCOUNT_LOCKED_2FA'
          : verification.reason === 'REPLAYED_CODE'
            ? 'TOTP_CODE_REPLAYED'
            : 'INVALID_2FA_CODE',
        message: isLocked
          ? 'Too many failed attempts. Account locked for 30 minutes.'
          : verification.reason === 'REPLAYED_CODE'
            ? 'This code has already been used. Please wait for the next code.'
            : 'Invalid two-factor authentication code',
        attemptsRemaining: Math.max(0, 5 - nextFailures),
        isLocked,
        lockedUntil: lockData.totpLockedUntil || null,
        lockedMinutes: isLocked ? 30 : null
      });
    }

    // 5. Mark JTI consumed and update user
    await prisma.usedStepUpToken.create({
      data: {
        jti: decoded.jti,
        kind: 'preauth_2fa',
        expiresAt: new Date(decoded.exp * 1000)
      }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpLastStep: verification.step,
        totpFailedAttempts: 0,
        totpLockedUntil: null
      }
    });

    // 6. Known Device tracking & alert
    await processKnownDevice(req, res, user);
    clearFailedPasswordAttempt(user.id);
    clearFailedPasswordAttempt(user.email);

    // 7. Issue session token
    let collegeTokenEpoch = 0;
    if (user.college_id) {
      const col = await prisma.college.findUnique({ where: { id: user.college_id }, select: { tokenEpoch: true } });
      if (col) collegeTokenEpoch = col.tokenEpoch || 0;
    }

    const sessionToken = generateToken(user.id, user.college_id, user.role, collegeTokenEpoch);

    return res.json({
      success: true,
      token: sessionToken,
      user: {
        _id: user.id,
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        college_id: user.college_id
      }
    });
  } catch (err) {
    console.error('[validate2FA] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to validate 2FA', error: err.message });
  }
}

/**
 * POST /api/auth/2fa/recover
 * Recovers access using a one-time 10-character backup code.
 */
async function recover2FA(req, res) {
  try {
    const { preAuthToken, backupCode } = req.body;
    const prisma = getPrisma();

    if (!preAuthToken || !backupCode) {
      return res.status(400).json({ success: false, message: 'preAuthToken and backupCode are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Pre-auth token invalid or expired' });
    }

    const existingUsed = await prisma.usedStepUpToken.findUnique({
      where: { jti: decoded.jti }
    });
    if (existingUsed) {
      return res.status(401).json({ success: false, code: 'PREAUTH_TOKEN_ALREADY_USED', message: 'Pre-auth token has already been consumed' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    const recovery = verifyAndConsumeBackupCode(backupCode, user.totpBackupCodes);
    if (!recovery.valid) {
      return res.status(401).json({ success: false, message: 'Invalid backup code' });
    }

    // Atomically consume JTI and remove backup code
    await prisma.usedStepUpToken.create({
      data: {
        jti: decoded.jti,
        kind: 'preauth_2fa',
        expiresAt: new Date(decoded.exp * 1000)
      }
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpBackupCodes: recovery.remainingCodes,
        totpFailedAttempts: 0,
        totpLockedUntil: null
      }
    });

    // Write audit log
    await prisma.auditLog.create({
      data: {
        college_id: user.college_id || 'platform',
        user_id: user.id,
        action: '2FA_BACKUP_CODE_USED',
        details: JSON.stringify({ remainingCodesCount: recovery.remainingCodes.length })
      }
    });

    await processKnownDevice(req, res, user);

    const sessionToken = generateToken(user.id, user.college_id, user.role);

    return res.json({
      success: true,
      message: 'Backup code accepted. Please generate new backup codes if needed.',
      token: sessionToken,
      remainingCodesCount: recovery.remainingCodes.length
    });
  } catch (err) {
    console.error('[recover2FA] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to recover 2FA', error: err.message });
  }
}

// In-memory cache for 2FA email OTPs (10-minute expiry)
const emailOtpStore = new Map();

/**
 * POST /api/auth/2fa/email-otp
 * Dispatches a 6-digit one-time code to the user's verified email address
 * as an alternative to the Authenticator app.
 */
async function send2FAEmailOtp(req, res) {
  try {
    const { preAuthToken } = req.body;
    const prisma = getPrisma();

    if (!preAuthToken) {
      return res.status(400).json({ success: false, message: 'preAuthToken is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Pre-auth token invalid or expired' });
    }

    if (decoded.scope !== 'PREAUTH_2FA') {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Invalid token scope' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    if (user.totpLockedUntil && user.totpLockedUntil > new Date()) {
      const remainingMin = Math.ceil((user.totpLockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({
        success: false,
        code: 'ACCOUNT_LOCKED_2FA',
        message: `Account is temporarily locked. Please try again in ${remainingMin} minutes.`
      });
    }

    // Rate-limit resends to 1 every 60 seconds
    const existing = emailOtpStore.get(user.id);
    if (existing && Date.now() < existing.createdAt + 60 * 1000) {
      const waitSec = Math.ceil((existing.createdAt + 60 * 1000 - Date.now()) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSec} seconds before requesting a new code.`
      });
    }

    // Generate random 6-digit numeric OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const bcrypt = require('bcryptjs');
    const hashedCode = await bcrypt.hash(otpCode, 8);

    emailOtpStore.set(user.id, {
      hashedCode,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
      attemptsRemaining: 5
    });

    // Mask user email for privacy (e.g. ad***@collegeshub.com)
    const [namePart, domainPart] = user.email.split('@');
    const maskedEmail = namePart.length <= 2
      ? `${namePart}***@${domainPart}`
      : `${namePart.slice(0, 2)}***${namePart.slice(-1)}@${domainPart}`;

    // Send email using mailService
    const { send, buildCollegeshubTemplate } = require('../services/mailService');
    const bodyHtml = `
      <p style="margin:0 0 16px 0;">Hello <strong>${user.name || 'there'}</strong>,</p>
      <p style="margin:0 0 20px 0;">You requested an email verification code to sign in to your CollegesHub account.</p>
      <div style="background:#F1F5F9;border:1px dashed #0A4D94;border-radius:12px;padding:20px;text-align:center;margin:0 0 20px 0;">
        <span style="font-family:monospace;font-size:36px;font-weight:800;letter-spacing:8px;color:#0A4D94;">${otpCode}</span>
        <p style="margin:8px 0 0 0;font-size:12px;color:#64748B;">Valid for 10 minutes · Do not share this code with anyone</p>
      </div>
      <p style="margin:0;font-size:13px;color:#64748B;">If you did not request this login code, please secure your account immediately.</p>
    `;

    const html = buildCollegeshubTemplate({
      title: '🔐 Your Login Verification Code',
      preheader: `Your CollegesHub login code is ${otpCode}`,
      bodyHtml
    });

    await send({
      to: user.email,
      subject: `🔐 ${otpCode} is your CollegesHub login verification code`,
      html,
      text: `Your CollegesHub login verification code is: ${otpCode}\nThis code is valid for 10 minutes.`
    }).catch(err => {
      console.error('[send2FAEmailOtp] Email sending error:', err.message);
    });

    return res.json({
      success: true,
      message: `Verification code sent to ${maskedEmail}`,
      maskedEmail
    });
  } catch (err) {
    console.error('[send2FAEmailOtp] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send email verification code', error: err.message });
  }
}

/**
 * POST /api/auth/2fa/verify-email-otp
 * Verifies the 6-digit email OTP and issues the final session token.
 */
async function verify2FAEmailOtp(req, res) {
  try {
    const { preAuthToken, code } = req.body;
    const prisma = getPrisma();

    if (!preAuthToken || !code) {
      return res.status(400).json({ success: false, message: 'preAuthToken and 6-digit code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, code: 'INVALID_PREAUTH_TOKEN', message: 'Pre-auth token invalid or expired' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive' });
    }

    const record = emailOtpStore.get(user.id);
    if (!record || Date.now() > record.expiresAt) {
      emailOtpStore.delete(user.id);
      return res.status(400).json({
        success: false,
        code: 'OTP_EXPIRED',
        message: 'Email verification code has expired. Please request a new one.'
      });
    }

    const bcrypt = require('bcryptjs');
    const isMatch = await bcrypt.compare(String(code).trim(), record.hashedCode);
    if (!isMatch) {
      record.attemptsRemaining -= 1;
      if (record.attemptsRemaining <= 0) {
        emailOtpStore.delete(user.id);
        return res.status(401).json({
          success: false,
          code: 'OTP_MAX_ATTEMPTS',
          message: 'Too many incorrect email code attempts. Please request a new code.',
          attemptsRemaining: 0
        });
      }
      return res.status(401).json({
        success: false,
        code: 'INVALID_EMAIL_CODE',
        message: 'Invalid verification code. Please check your email.',
        attemptsRemaining: record.attemptsRemaining
      });
    }

    // Success: consume OTP
    emailOtpStore.delete(user.id);

    // Register device and clear failed markers
    await processKnownDevice(req, res, user);
    clearFailedPasswordAttempt(user.id);
    clearFailedPasswordAttempt(user.email);

    // Issue session token
    let collegeTokenEpoch = 0;
    if (user.college_id) {
      const col = await prisma.college.findUnique({ where: { id: user.college_id }, select: { tokenEpoch: true } });
      if (col) collegeTokenEpoch = col.tokenEpoch || 0;
    }

    const token = generateToken(user.id, user.college_id || null, user.role, collegeTokenEpoch);

    return res.json({
      success: true,
      message: 'Email verification successful',
      token,
      user: {
        _id: user.id,
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        college_id: user.college_id
      }
    });
  } catch (err) {
    console.error('[verify2FAEmailOtp] Error:', err);
    return res.status(500).json({ success: false, message: 'Verification failed', error: err.message });
  }
}

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA. Super Admin accounts cannot disable 2FA.
 */
async function disable2FA(req, res) {
  try {
    const prisma = getPrisma();
    const userId = req.user?.id || req.user?._id;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: false,
        totpSecretEnc: null,
        totpLastStep: null,
        totpBackupCodes: null,
        twofaEnrolledAt: null,
        totpFailedAttempts: 0,
        totpLockedUntil: null
      }
    });

    await prisma.knownDevice.deleteMany({
      where: { userId: user.id }
    });

    await prisma.auditLog.create({
      data: {
        college_id: user.college_id || 'platform',
        user_id: user.id,
        action: '2FA_DISABLED',
        details: JSON.stringify({ disabledAt: new Date().toISOString() })
      }
    });

    return res.json({
      success: true,
      message: 'Two-factor authentication successfully disabled'
    });
  } catch (err) {
    console.error('[disable2FA] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to disable 2FA', error: err.message });
  }
}

/**
 * GET /api/auth/known-devices
 */
async function listKnownDevices(req, res) {
  try {
    const prisma = getPrisma();
    const userId = req.user?.id || req.user?._id;

    const devices = await prisma.knownDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        firstSeenAt: true,
        lastSeenAt: true,
        lastIp: true,
        userAgent: true
      }
    });

    return res.json({ success: true, devices });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve known devices', error: err.message });
  }
}

/**
 * DELETE /api/auth/known-devices/:id
 */
async function removeKnownDevice(req, res) {
  try {
    const { id } = req.params;
    const prisma = getPrisma();
    const userId = req.user?.id || req.user?._id;

    await prisma.knownDevice.deleteMany({
      where: { id, userId }
    });

    return res.json({ success: true, message: 'Known device removed successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to remove known device', error: err.message });
  }
}

module.exports = {
  setup2FA,
  verify2FA,
  validate2FA,
  recover2FA,
  disable2FA,
  listKnownDevices,
  removeKnownDevice,
  processKnownDevice,
  isKnownDevice,
  recordFailedPasswordAttempt,
  hasRecentFailedPassword,
  clearFailedPasswordAttempt,
  send2FAEmailOtp,
  verify2FAEmailOtp
};
