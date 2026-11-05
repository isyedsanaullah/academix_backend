const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Unambiguous 32-character alphabet (excludes 0, 1, I, O)
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generate an unguessable 8-character PIN
 */
function generateGuardianPin() {
  const bytes = crypto.randomBytes(8);
  let pin = '';
  for (let i = 0; i < 8; i++) {
    pin += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return pin;
}

/**
 * Hash PIN using bcrypt
 */
async function hashGuardianPin(pin) {
  return await bcrypt.hash(pin, 10);
}

/**
 * Compare plain PIN with hash
 */
async function compareGuardianPin(pin, hash) {
  return await bcrypt.compare(pin, hash);
}

module.exports = {
  generateGuardianPin,
  hashGuardianPin,
  compareGuardianPin
};

