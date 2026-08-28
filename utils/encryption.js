const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const SECRET = process.env.ENCRYPTION_SECRET || 'default_32_char_secret_change_me!';

// Ensure key is exactly 32 bytes
const getKey = () => {
  return crypto.createHash('sha256').update(SECRET).digest();
};

/**
 * Encrypt a plaintext string
 * @param {string} text - The plaintext to encrypt
 * @returns {{ encrypted: string, iv: string }} - The encrypted data and IV
 */
const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encrypted,
    iv: iv.toString('hex')
  };
};

/**
 * Decrypt an encrypted string
 * @param {string} encrypted - The encrypted hex string
 * @param {string} iv - The initialization vector hex string
 * @returns {string} - The decrypted plaintext
 */
const decrypt = (encrypted, iv) => {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(iv, 'hex')
  );
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * Mask an API key for safe display (show first 8 and last 4 chars)
 * @param {string} key - The full API key
 * @returns {string} - Masked key like "AIzaSyBx...Ab4c"
 */
const maskKey = (key) => {
  if (!key || key.length < 16) return '••••••••';
  return key.slice(0, 8) + '••••••••' + key.slice(-4);
};

module.exports = { encrypt, decrypt, maskKey };
