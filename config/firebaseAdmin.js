const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

/**
 * Firebase Admin SDK Initialization
 * ----------------------------------
 * Looks for service account JSON in this priority order:
 *  1. /etc/secrets/firebase_service_account.json  ← Render Secret File
 *  2. ./config/firebase-service-account.json       ← Local dev
 *  3. FIREBASE_SERVICE_ACCOUNT_JSON env var         ← Env var fallback
 *  4. FIREBASE_PROJECT_ID env var                   ← Minimal (no domain automation)
 */

let firebaseApp;

function loadServiceAccount() {
  // 1. Render secret file (underscores — Render doesn't allow hyphens in filenames)
  const renderPath = '/etc/secrets/firebase_service_account.json';
  if (fs.existsSync(renderPath)) {
    console.log('[Firebase] Loading service account from Render secret file');
    return JSON.parse(fs.readFileSync(renderPath, 'utf8'));
  }

  // 2. Local dev path (with hyphens — normal filename)
  const localPath = path.join(__dirname, 'firebase-service-account.json');
  if (fs.existsSync(localPath)) {
    console.log('[Firebase] Loading service account from local config file');
    return require(localPath);
  }

  // 3. Environment variable (entire JSON as a string)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.log('[Firebase] Loading service account from FIREBASE_SERVICE_ACCOUNT_JSON env var');
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  return null;
}

try {
  const serviceAccount = loadServiceAccount();

  if (serviceAccount) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('✅ Firebase Admin initialized with service account (full features enabled)');
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== 'your-firebase-project-id') {
    // Fallback: project ID only — works for token verification but NOT domain automation
    firebaseApp = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('✅ Firebase Admin initialized with project ID (limited — no domain automation)');
  } else {
    console.warn('⚠ Firebase Admin NOT initialized — Google login will be disabled');
    console.warn('  Add firebase_service_account.json to Render Secret Files or set FIREBASE_PROJECT_ID');
  }
} catch (err) {
  console.error('❌ Firebase Admin initialization failed:', err.message);
}

/**
 * Verify a Firebase ID token and return the decoded user info.
 * @param {string} idToken - Firebase ID token from the client
 * @returns {Promise<{uid, email, name, picture}>}
 */
async function verifyFirebaseToken(idToken) {
  if (!firebaseApp) {
    throw new Error('Firebase Admin is not initialized. Configure FIREBASE_PROJECT_ID in .env');
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name || decoded.email?.split('@')[0] || 'User',
    picture: decoded.picture || '',
    emailVerified: decoded.email_verified || false,
  };
}

module.exports = { verifyFirebaseToken, firebaseApp };
