const admin = require('firebase-admin');

/**
 * Firebase Admin SDK Initialization
 * ----------------------------------
 * Used to verify Google ID tokens sent from the frontend.
 * 
 * Setup:
 *  1. Go to Firebase Console > Project Settings > Service Accounts
 *  2. Click "Generate new private key" and download the JSON
 *  3. Place it at backend/config/firebase-service-account.json
 *  OR just set FIREBASE_PROJECT_ID in .env for simple init
 */

let firebaseApp;

try {
  // Try to load service account file first (more secure, full features)
  const serviceAccount = require('./firebase-service-account.json');
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log('✅ Firebase Admin initialized with service account');
} catch {
  // Fallback: initialize with just project ID (works for ID token verification)
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== 'your-firebase-project-id') {
    firebaseApp = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    console.log('✅ Firebase Admin initialized with project ID');
  } else {
    console.warn('⚠ Firebase Admin NOT initialized — Google login will be disabled');
    console.warn('  Set FIREBASE_PROJECT_ID in .env or add firebase-service-account.json');
  }
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
