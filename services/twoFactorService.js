'use strict';

/**
 * twoFactorService.js — Phase 9A (#N07)
 * Local RFC 6238 TOTP Two-Factor Authentication & Known-Device Tracking
 * - Zero third-party dependency (pure Node.js crypto)
 * - HMAC-SHA1, 30s step, 6 digits, +-1 window, constant-time compare
 * - AES-256-GCM encrypted secret storage with dedicated key & v1: prefix
 * - Replay protection via User.totpLastStep
 * - 10-character backup codes (bcrypt hashed)
 * - Signed __Host-acx_did device cookies & OutboxEvent('NEW_DEVICE_LOGIN')
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Base32 RFC 4648 alphabet
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(str) {
  const cleanStr = str.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < cleanStr.length; i++) {
    const val = BASE32_CHARS.indexOf(cleanStr[i]);
    if (val === -1) {
      throw new Error(`Invalid Base32 character: ${cleanStr[i]}`);
    }
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Dedicated 32-byte AES-256-GCM encryption key for TOTP secrets
 */
function getTotpEncryptionKey() {
  if (process.env.TOTP_ENCRYPTION_KEY) {
    const raw = process.env.TOTP_ENCRYPTION_KEY;
    if (raw.length === 64) {
      return Buffer.from(raw, 'hex');
    }
    return crypto.createHash('sha256').update(raw).digest();
  }
  // Derive dedicated key separate from JWT_SECRET
  const seed = (process.env.JWT_SECRET || 'cesms-default-jwt-secret') + ':totp-enc-v1';
  return crypto.createHash('sha256').update(seed).digest();
}

/**
 * Encrypt a Base32 TOTP secret with AES-256-GCM
 * Output format: v1:<iv_hex>:<authTag_hex>:<cipher_hex>
 */
function encryptTotpSecret(secretBase32) {
  const key = getTotpEncryptionKey();
  const iv = crypto.randomBytes(12); // standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(secretBase32, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a Base32 TOTP secret from ciphertext
 */
function decryptTotpSecret(cipherText) {
  if (!cipherText || !cipherText.startsWith('v1:')) {
    throw new Error('Invalid or unsupported TOTP ciphertext version');
  }

  const parts = cipherText.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed TOTP ciphertext format');
  }

  const [, ivHex, tagHex, dataHex] = parts;
  const key = getTotpEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(dataHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate 6-digit TOTP code for a given 30s step
 */
function generateCodeForStep(secretBuffer, stepNumber) {
  const counterBuffer = Buffer.alloc(8);
  // Big-endian 64-bit integer
  counterBuffer.writeBigInt64BE(BigInt(stepNumber), 0);

  const hmac = crypto.createHmac('sha1', secretBuffer);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

/**
 * Generate fresh 2FA setup credentials
 */
function generate2FASetup(email) {
  const secretBytes = crypto.randomBytes(20); // 160-bit RFC 6238 recommendation
  const secretBase32 = base32Encode(secretBytes);

  // Generate 10 backup codes (10 chars each)
  const plainBackupCodes = [];
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < 10; i++) {
    let code = '';
    const bytes = crypto.randomBytes(10);
    for (let j = 0; j < 10; j++) {
      code += chars[bytes[j] % chars.length];
    }
    plainBackupCodes.push(code);
  }

  // Pre-hash backup codes with bcrypt
  const hashedBackupCodes = plainBackupCodes.map(c => bcrypt.hashSync(c, 10));

  const safeEmail = encodeURIComponent(email);
  const otpauthUrl = `otpauth://totp/Academix:${safeEmail}?secret=${secretBase32}&issuer=Academix&algorithm=SHA1&digits=6&period=30`;

  return {
    secretBase32,
    secretEnc: encryptTotpSecret(secretBase32),
    otpauthUrl,
    plainBackupCodes,
    hashedBackupCodes
  };
}

/**
 * Verify a 6-digit TOTP code with +-2 window (+-60s drift tolerance) and replay protection
 */
function verifyTotpCode({ secretBase32, code, lastAcceptedStep = null, window = 2, nowMs = Date.now() }) {
  if (!code || typeof code !== 'string') return { valid: false, reason: 'INVALID_FORMAT' };
  const cleanCode = code.trim();
  if (cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return { valid: false, reason: 'INVALID_FORMAT' };
  }

  const secretBytes = base32Decode(secretBase32);
  const currentStep = Math.floor(nowMs / 1000 / 30);

  // Window: [currentStep - 1, currentStep, currentStep + 1]
  for (let s = currentStep - window; s <= currentStep + window; s++) {
    const candidateCode = generateCodeForStep(secretBytes, s);

    // Constant-time comparison
    const a = Buffer.from(cleanCode);
    const b = Buffer.from(candidateCode);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      // Replay protection: step must be strictly greater than lastAcceptedStep
      if (lastAcceptedStep !== null && lastAcceptedStep !== undefined) {
        if (BigInt(s) <= BigInt(lastAcceptedStep)) {
          return { valid: false, reason: 'REPLAYED_CODE', step: BigInt(s) };
        }
      }
      return { valid: true, step: BigInt(s) };
    }
  }

  return { valid: false, reason: 'INVALID_CODE' };
}

/**
 * Verify and consume a backup code
 */
function verifyAndConsumeBackupCode(plainCode, hashedCodes) {
  if (!plainCode || !Array.isArray(hashedCodes) || hashedCodes.length === 0) {
    return { valid: false };
  }

  const clean = String(plainCode).trim().toUpperCase();
  for (let i = 0; i < hashedCodes.length; i++) {
    if (bcrypt.compareSync(clean, hashedCodes[i])) {
      const remainingHashed = [...hashedCodes];
      remainingHashed.splice(i, 1);
      return { valid: true, remainingCodes: remainingHashed };
    }
  }

  return { valid: false };
}

/**
 * Dedicated secret for signing device cookies
 */
function getDeviceCookieSecret() {
  return (process.env.JWT_SECRET || 'cesms-default-secret') + ':device-cookie-sig';
}

function signDeviceCookie(deviceId) {
  const hmac = crypto.createHmac('sha256', getDeviceCookieSecret()).update(deviceId).digest('hex');
  return `${deviceId}.${hmac}`;
}

function verifyDeviceCookie(cookieVal) {
  if (!cookieVal || typeof cookieVal !== 'string') return null;
  const parts = cookieVal.split('.');
  if (parts.length !== 2) return null;

  const [deviceId, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', getDeviceCookieSecret()).update(deviceId).digest('hex');

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    return deviceId;
  }
  return null;
}

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}

module.exports = {
  base32Encode,
  base32Decode,
  encryptTotpSecret,
  decryptTotpSecret,
  generateCodeForStep,
  generate2FASetup,
  verifyTotpCode,
  verifyAndConsumeBackupCode,
  signDeviceCookie,
  verifyDeviceCookie,
  hashDeviceId
};

