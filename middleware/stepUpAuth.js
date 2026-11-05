/**
 * stepUpAuth.js — Phase 6B
 * Middleware enforcing single-use 5-minute elevated credential tokens
 * for destructive governance operations.
 */

const jwt = require('jsonwebtoken');
const { getSystemClient } = require('../config/prismaManager');

const STEP_UP_SECRET = process.env.STEP_UP_JWT_SECRET || (process.env.JWT_SECRET ? process.env.JWT_SECRET + '_stepup' : 'step_up_default_secret_key');

async function requireStepUpAuth(req, res, next) {
  try {
    const token = req.headers['x-step-up-token'];

    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'STEP_UP_REQUIRED',
        message: 'Step-up authentication required for this destructive action'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, STEP_UP_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_STEP_UP_TOKEN',
        message: 'Step-up token is invalid or expired: ' + err.message
      });
    }

    if (!req.user || decoded.userId !== req.user.id || decoded.actionClass !== 'destructive') {
      return res.status(403).json({
        success: false,
        code: 'UNAUTHORIZED_STEP_UP',
        message: 'Step-up token does not match active authenticated session or required actionClass'
      });
    }

    const prisma = getSystemClient();

    // Check if jti has already been consumed
    const existing = await prisma.usedStepUpToken.findUnique({
      where: { jti: decoded.jti }
    });

    if (existing) {
      return res.status(401).json({
        success: false,
        code: 'STEP_UP_TOKEN_ALREADY_USED',
        message: 'Step-up token has already been consumed and cannot be replayed'
      });
    }

    // Atomically consume token
    await prisma.usedStepUpToken.create({
      data: {
        jti: decoded.jti,
        usedAt: new Date(),
        expiresAt: new Date(decoded.exp * 1000)
      }
    });

    req.stepUpSession = decoded;
    next();
  } catch (error) {
    console.error('[stepUpAuth] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify step-up authentication',
      error: error.message
    });
  }
}

module.exports = {
  requireStepUpAuth,
  STEP_UP_SECRET
};

