/**
 * Cloudflare R2 Client Configuration
 * ────────────────────────────────────
 * Initializes and exports a singleton S3-compatible client for the private
 * `collegeshub` R2 bucket. All credentials are read from server-side
 * environment variables — they must NEVER reach the frontend or logs.
 */
const { S3Client } = require('@aws-sdk/client-s3');

// ── Required env vars (validated at init, secrets never printed) ──────
const REQUIRED_VARS = [
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];

let _client = null;
let _configValid = false;

/**
 * Validate that all required R2 environment variables are present.
 * Throws a clear error listing missing keys (never their values).
 */
function validateR2Config() {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `R2 configuration error: missing environment variable(s): ${missing.join(', ')}. ` +
      'Set them in the hosting provider or .env file. Never commit secret values.'
    );
  }
  _configValid = true;
}

/**
 * Get or create the singleton S3-compatible R2 client.
 * @returns {S3Client}
 */
function getR2Client() {
  if (_client) return _client;

  validateR2Config();

  _client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Required for S3-compatible endpoints like R2
  });

  return _client;
}

/**
 * @returns {string} The configured bucket name.
 */
function getBucketName() {
  if (!_configValid) validateR2Config();
  return process.env.R2_BUCKET_NAME;
}

/**
 * Check whether R2 is configured (all env vars present).
 * Does NOT throw — use for conditional feature checks.
 * @returns {boolean}
 */
function isR2Configured() {
  try {
    if (_configValid) return true;
    validateR2Config();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getR2Client,
  getBucketName,
  isR2Configured,
  validateR2Config,
};
