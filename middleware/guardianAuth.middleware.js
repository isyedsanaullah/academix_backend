const crypto = require('crypto');
const { getSystemClient } = require('../config/prismaManager');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Guardian Authentication Middleware
 * Validates bearer token against GuardianToken table, verifies College status,
 * tokenEpoch, session active status, and active student state.
 */
async function guardianProtect(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header'
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Token is required' });
    }

    const tokenHash = hashToken(token);
    const prisma = getSystemClient();

    const guardianToken = await prisma.guardianToken.findUnique({
      where: { tokenHash }
    });

    if (!guardianToken || guardianToken.revokedAt || new Date(guardianToken.expiresAt) < new Date()) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Guardian session expired or invalid'
      });
    }

    // Check college status and tokenEpoch
    const college = await prisma.college.findUnique({
      where: { id: guardianToken.college_id },
      select: { subStatus: true, tokenEpoch: true }
    });

    if (!college) {
      return res.status(401).json({ success: false, code: 'COLLEGE_NOT_FOUND', message: 'College not found' });
    }

    if (college.subStatus === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        code: 'TENANT_SUSPENDED',
        message: 'College subscription is suspended. Access blocked.'
      });
    }

    if (guardianToken.tokenEpoch < (college.tokenEpoch || 0)) {
      return res.status(401).json({
        success: false,
        code: 'TOKEN_EPOCH_EXPIRED',
        message: 'Session revoked due to security state change'
      });
    }

    // Load GuardianSession
    const session = await prisma.guardianSession.findUnique({
      where: { id: guardianToken.sessionId }
    });

    if (!session || !session.isActive) {
      return res.status(401).json({
        success: false,
        code: 'SESSION_INACTIVE',
        message: 'Guardian session is inactive'
      });
    }

    // Load Student
    const student = await prisma.student.findFirst({
      where: {
        id: session.studentId,
        college_id: guardianToken.college_id,
        status: 'active'
      }
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        code: 'STUDENT_NOT_ACTIVE',
        message: 'Associated student record is inactive or withdrawn'
      });
    }

    req.collegeId = guardianToken.college_id;
    req.guardianSession = session;
    req.guardianToken = guardianToken;
    req.studentId = session.studentId;
    req.student = student;

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  guardianProtect,
  hashToken
};
