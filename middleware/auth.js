const jwt = require('jsonwebtoken');
const { getSystemClient } = require('../config/prismaManager');

// Protect routes - verify JWT token
const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized - no token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const prisma = getSystemClient();
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    // Phase 6A: Token epoch session revocation check
    if (user.college_id) {
      const college = await prisma.college.findUnique({
        where: { id: user.college_id },
        select: { tokenEpoch: true }
      });
      if (college && typeof decoded.tokenEpoch === 'number' && decoded.tokenEpoch < college.tokenEpoch) {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EPOCH_EXPIRED',
          message: 'Session revoked — please log in again'
        });
      }
    }

    req.user = {
      ...user,
      _id: user.id
    };
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized - invalid token'
    });
  }
};

module.exports = protect;
