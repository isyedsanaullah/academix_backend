'use strict';

/**
 * webhookCrypto.js — Phase 9E (#N06)
 * Dedicated AES-256-GCM encryption for Webhook secrets and HMAC-SHA256 signature generator.
 * Secrets require plaintext retrieval to sign outgoing HTTP requests.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';

function getEncryptionKey() {
  const secret = process.env.WEBHOOK_SECRET_ENC_KEY || process.env.JWT_SECRET || 'academix_webhook_secret_key_32_bytes_len!';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypt a plaintext webhook secret using AES-256-GCM
 * @param {string} plaintext
 * @returns {string} format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
function encryptWebhookSecret(plaintext) {
  if (!plaintext) throw new Error('Secret to encrypt cannot be empty');
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${KEY_VERSION}:${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

/**
 * Decrypt an encrypted webhook secret
 * @param {string} encryptedString format: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * @returns {string} plaintext
 */
function decryptWebhookSecret(encryptedString) {
  if (!encryptedString) throw new Error('Encrypted secret cannot be empty');

  const parts = encryptedString.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted webhook secret format');
  }

  const [version, ivHex, authTagHex, ciphertextHex] = parts;
  if (version !== KEY_VERSION) {
    throw new Error(`Unsupported secret version: ${version}`);
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Sign webhook payload with HMAC-SHA256
 * Signature header format: "t=<unix_seconds>,v1=<hmac_hex>"
 * @param {string} secret Plaintext webhook secret
 * @param {object|string} payload Webhook payload
 * @param {number} [timestamp] Unix timestamp in seconds
 * @returns {{ signatureHeader: string, timestamp: number }}
 */
function signWebhookPayload(secret, payload, timestamp = null) {
  const t = timestamp !== null ? timestamp : Math.floor(Date.now() / 1000);
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const dataToSign = `${t}.${rawBody}`;

  const hmac = crypto.createHmac('sha256', secret).update(dataToSign).digest('hex');
  const signatureHeader = `t=${t},v1=${hmac}`;

  return { signatureHeader, timestamp: t };
}

module.exports = {
  encryptWebhookSecret,
  decryptWebhookSecret,
  signWebhookPayload
};

